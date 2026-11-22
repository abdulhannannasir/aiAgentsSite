import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/lib/logger.js';
import { PlanError, citedKeys, demoPlan, extractJson, plannerPrompt, validatePlan } from '../src/modules/orchestration/plan.js';
import { createInProcessQueue, redisConnection, type Job } from '../src/modules/orchestration/queue.js';
import { needsApproval } from '../src/modules/orchestration/engine.js';
import { createToolRegistry } from '../src/modules/tools/registry.js';

const tools = createToolRegistry();
const task = (id: string, agentId: string, extra: Record<string, unknown> = {}) => ({ id, title: id, agentId, instruction: 'do it', ...extra });

describe('plan validation', () => {
  it('accepts a valid DAG and limits tools to the agent and this server', () => {
    const plan = validatePlan({
      summary: 's',
      tasks: [
        task('T1', 'seo-specialist', { tools: ['url_fetch', 'web_search', 'calculator'] }),
        task('T2', 'translator'),
        task('T3', 'project-manager', { dependsOn: ['T1', 'T2', 'T1'] })
      ]
    }, tools);
    // web_search needs TAVILY_API_KEY (not set) and the SEO agent has no calculator permission.
    expect(plan.tasks[0].tools).toEqual(['url_fetch']);
    expect(plan.tasks[2].dependsOn).toEqual(['T1', 'T2']);
  });

  it.each([
    [{ summary: 's', tasks: [] }, 'tasks'],
    [{ summary: 's', tasks: [task('T1', 'nope')] }, 'unknown agent "nope"'],
    [{ summary: 's', tasks: [task('T1', 'translator', { dependsOn: ['T2'] }), task('T2', 'translator')] }, 'not an earlier task'],
    [{ summary: 's', tasks: [task('T1', 'translator', { dependsOn: ['T1'] })] }, 'not an earlier task'],
    [{ summary: 's', tasks: [task('T1', 'translator'), task('T1', 'translator')] }, 'used twice'],
    [{ summary: 's', tasks: [task('X', 'translator')] }, 'ids are T1'],
    [{ summary: 's', tasks: Array.from({ length: 7 }, (_, i) => task(`T${i + 1}`, 'translator')) }, 'tasks']
  ])('rejects %j', (raw, message) => {
    expect(() => validatePlan(raw, tools)).toThrow(PlanError);
    expect(() => validatePlan(raw, tools)).toThrow(message);
  });

  it('extracts JSON from fenced or chatty replies', () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a": {"b": 2}} done')).toEqual({ a: { b: 2 } });
    expect(() => extractJson('no json')).toThrow(PlanError);
    expect(() => extractJson('{oops}')).toThrow('not valid JSON');
  });

  it('collects cited task keys in order, ignoring unknown ones', () => {
    expect(citedKeys('A [T2]. B [T1, T3]. C [T9]. D [T2].', ['T1', 'T2', 'T3'])).toEqual(['T2', 'T1', 'T3']);
    expect(citedKeys('no citations', ['T1'])).toEqual([]);
  });

  it('lists only usable tools in the planner prompt, and the demo plan is valid', () => {
    const prompt = plannerPrompt(tools);
    expect(prompt).toContain('- seo-specialist:');
    expect(prompt).not.toMatch(/Tools: [^\n]*web_search/); // not configured here
    const demo = demoPlan('a goal');
    expect(validatePlan({ summary: demo.summary, tasks: demo.tasks.map(t => ({ ...t, id: t.key })) }, tools).tasks).toHaveLength(3);
  });

  it('requires approval only for tools that reach outside the server', () => {
    expect(needsApproval(tools, ['url_fetch', 'calculator', 'current_time'])).toEqual(['url_fetch']);
    expect(needsApproval(tools, ['calculator'])).toEqual([]);
  });
});

describe('job queues', () => {
  it('runs in-process jobs with a concurrency limit and drops duplicates that are still waiting', async () => {
    const q = createInProcessQueue(createLogger('silent'), 2);
    const seen: string[] = [];
    let running = 0, peak = 0;
    const release: Array<() => void> = [];
    q.work(async (job: Job) => {
      running++; peak = Math.max(peak, running); seen.push(job.id);
      await new Promise<void>(r => release.push(r));
      running--;
    });
    for (const id of ['a', 'b', 'c', 'c', 'd']) await q.add({ kind: 'task', id });
    await q.add({ kind: 'task', id: 'later' }, { delayMs: 5 });
    await new Promise(r => setTimeout(r, 20));
    expect(peak).toBe(2);
    while (release.length) { release.shift()!(); await new Promise(r => setTimeout(r, 5)); }
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'later']);
    await q.close();
  });

  it('parses Redis URLs for BullMQ', () => {
    expect(redisConnection('rediss://user:p%40ss@cache.example.com:6380/2')).toEqual({
      host: 'cache.example.com', port: 6380, username: 'user', password: 'p@ss', db: 2, tls: {}, maxRetriesPerRequest: null
    });
    expect(redisConnection('redis://localhost')).toMatchObject({ host: 'localhost', port: 6379, db: 0, maxRetriesPerRequest: null });
  });
});
