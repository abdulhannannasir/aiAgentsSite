import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { json, openaiChunk, sse, startApp, startUpstream, type TestServer } from './helpers.js';
import { Client, TEST_DB, resetDatabase, sql, startDbApp } from './db-helpers.js';
import { QUEUE_NAME, redisConnection } from '../src/modules/orchestration/queue.js';

const TEST_REDIS = process.env.TEST_REDIS_URL ?? '';
const FAST = { orchestration: { options: { retryBaseMs: 20, recoverEveryMs: null } } };

type Reply = (res: http.ServerResponse, prompt: string) => void;
const text = (t: string, usage = { prompt_tokens: 10, completion_tokens: 2 }): Reply => res => sse(res, [openaiChunk(t), { choices: [], usage }], { done: '[DONE]' });
const status = (code: number): Reply => res => json(res, code, { error: { message: `status ${code}` } });
const planOf = (tasks: unknown[], summary = 'Split the work.') => text(JSON.stringify({ summary, tasks }));
const T = (id: string, agentId: string, dependsOn: string[] = [], tools: string[] = []) => ({ id, title: `Do ${id}`, agentId, instruction: `Work on ${id}.`, dependsOn, tools });

/**
 * A fake OpenAI that answers by role: the planner gets `planner` replies (in order), the synthesizer `synth`, and
 * each task `T<n>` its own queue of replies (default: "Result <n>").
 */
function fakeModel() {
  const state = { planner: [] as Reply[], synth: [] as Reply[], tasks: {} as Record<string, Reply[]>, prompts: [] as Array<{ role: string; body: any }> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const handler = (_req: http.IncomingMessage, raw: string, res: http.ServerResponse) => {
    const body = JSON.parse(raw);
    const system = body.messages[0]?.content ?? '';
    const user = body.messages.at(-1)?.content ?? '';
    if (system.includes('You are the planner')) {
      state.prompts.push({ role: 'planner', body });
      return (state.planner.shift() ?? planOf([T('T1', 'research-agent')]))(res, user);
    }
    if (system.includes('You combine the results')) {
      state.prompts.push({ role: 'synth', body });
      return (state.synth.shift() ?? text('Combined answer [T1] [T2, T9].'))(res, user);
    }
    const key = /Your task \((T\d+)\)/.exec(user)?.[1] ?? '?';
    state.prompts.push({ role: key, body });
    return (state.tasks[key]?.shift() ?? text(`Result ${key}`))(res, user);
  };
  return { state, handler };
}

async function user(s: TestServer, email: string) {
  const c = new Client(s.url);
  expect((await c.signUp(email)).status).toBe(200);
  const me = (await c.get('/api/v1/me')).json;
  return { c, id: me.user.id as string, workspaceId: me.workspace.id as string };
}

async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await get();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out; last value: ${JSON.stringify(v).slice(0, 800)}`);
    await new Promise(r => setTimeout(r, 25));
  }
}

const start = (c: Client, goal = 'Compare two databases for a startup', headers: Record<string, string> = {}) => c.req('POST', '/api/v1/orchestrations', { goal }, headers);
const get = (c: Client, id: string) => c.get(`/api/v1/orchestrations/${id}`).then(r => r.json);
const settled = (c: Client, id: string, statuses = ['COMPLETED', 'FAILED', 'CANCELLED']) => until(() => get(c, id), o => statuses.includes(o.status));
const task = (o: any, key: string) => o.taskList.find((t: { key: string }) => t.key === key); // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!TEST_DB)('orchestration (PostgreSQL, in-process queue)', () => {
  let s: TestServer;
  let upstream: Awaited<ReturnType<typeof startUpstream>>;
  let model: ReturnType<typeof fakeModel>;
  beforeAll(async () => {
    await resetDatabase();
    model = fakeModel();
    upstream = await startUpstream([(req, body, res) => model.handler(req, body, res)]);
    s = await startDbApp({ OPENAI_API_KEY: 'sk', OPENAI_BASE_URL: upstream.url, OPENAI_MODEL: 'gpt-a', RATE_LIMIT_MAX: '1000' }, FAST);
  });
  afterAll(async () => { await s?.close(); await upstream?.close(); });
  beforeEach(async () => {
    await resetDatabase();
    Object.assign(model.state, { planner: [], synth: [], tasks: {}, prompts: [] });
  });

  it('plans a DAG, runs independent tasks, passes only dependency outputs, and synthesises with provenance', async () => {
    const a = await user(s, 'a@example.com');
    model.state.planner = [planOf([T('T1', 'research-agent'), T('T2', 'data-analyst'), T('T3', 'project-manager', ['T1', 'T2'])])];
    model.state.synth = [text('Postgres fits [T1]. Costs differ [T2, T3]. Unknown [T7].', { prompt_tokens: 100, completion_tokens: 20 })];
    const r = await start(a.c);
    expect(r.status).toBe(202);
    const o = await settled(a.c, r.json.id);

    expect(o).toMatchObject({ status: 'COMPLETED', planSummary: 'Split the work.', sources: ['T1', 'T2', 'T3'], durable: false, provider: 'openai', model: 'gpt-a', modelCalls: 5, mine: true, canManage: true });
    expect(o.output).toContain('Postgres fits [T1]');
    expect(o.taskList.map((t: { key: string; status: string; output: string; agentName: string }) => [t.key, t.status, t.output])).toEqual([
      ['T1', 'SUCCEEDED', 'Result T1'], ['T2', 'SUCCEEDED', 'Result T2'], ['T3', 'SUCCEEDED', 'Result T3']
    ]);
    expect(task(o, 'T3')).toMatchObject({ agentName: 'Project Manager', dependsOn: ['T1', 'T2'], attempt: 1 });
    // Least privilege: T1 sees no other task's output; T3 sees exactly its dependencies.
    const prompt = (k: string) => model.state.prompts.find(p => p.role === k)!.body.messages.at(-1).content as string;
    expect(prompt('T1')).not.toContain('Result of');
    expect(prompt('T3')).toContain('--- Result of T1 (Do T1) ---\nResult T1');
    expect(prompt('T3')).toContain('--- Result of T2 (Do T2) ---\nResult T2');
    // The synthesizer gets every result and the goal.
    expect(prompt('synth')).toContain('Compare two databases');
    expect(prompt('synth')).toContain('Result of T3');

    expect(await sql(`SELECT kind, SUM(quantity)::int AS q FROM usage_records GROUP BY kind ORDER BY kind`)).toEqual([
      { kind: 'AI_REQUEST', q: 5 }, { kind: 'INPUT_TOKENS', q: 140 }, { kind: 'OUTPUT_TOKENS', q: 28 }, { kind: 'ORCHESTRATION_RUN', q: 1 }
    ]);
    expect(o).toMatchObject({ inputTokens: 140, outputTokens: 28 });
    expect(await sql(`SELECT action FROM audit_logs WHERE action LIKE 'orchestration.%'`)).toEqual([{ action: 'orchestration.started' }]);

    const list = (await a.c.get('/api/v1/orchestrations')).json;
    expect(list).toEqual([expect.objectContaining({ id: o.id, status: 'COMPLETED', tasks: { total: 3, done: 3, waitingApproval: 0 } })]);
  });

  it('asks the planner to repair an invalid plan once, and fails honestly when it cannot', async () => {
    const a = await user(s, 'a@example.com');
    model.state.planner = [planOf([T('T1', 'no-such-agent')]), planOf([T('T1', 'translator')])];
    const ok = await settled(a.c, (await start(a.c)).json.id);
    expect(ok.status).toBe('COMPLETED');
    expect(model.state.prompts.filter(p => p.role === 'planner')).toHaveLength(2);
    expect(model.state.prompts.filter(p => p.role === 'planner')[1].body.messages.at(-1).content).toContain('unknown agent "no-such-agent"');

    model.state.prompts = [];
    model.state.planner = [text('I would rather not.'), planOf([T('T1', 'translator'), T('T2', 'translator', ['T3'])])];
    const bad = await settled(a.c, (await start(a.c, 'Another goal')).json.id);
    expect(bad).toMatchObject({ status: 'FAILED', error: 'The planner did not produce a valid plan. Try rephrasing the goal.', taskList: [] });
  });

  it('retries a task after a transient provider error with backoff', async () => {
    const a = await user(s, 'a@example.com');
    model.state.tasks.T1 = [status(503), text('Recovered result')];
    const o = await settled(a.c, (await start(a.c)).json.id);
    expect(o.status).toBe('COMPLETED');
    expect(task(o, 'T1')).toMatchObject({ status: 'SUCCEEDED', attempt: 2, output: 'Recovered result', error: null });
  });

  it('dead-letters a task on a permanent error, skips its dependents, and resumes after a manual retry', async () => {
    const a = await user(s, 'a@example.com');
    model.state.planner = [planOf([T('T1', 'research-agent'), T('T2', 'data-analyst', ['T1']), T('T3', 'translator')])];
    model.state.tasks.T1 = [status(401)];
    const failed = await settled(a.c, (await start(a.c)).json.id);
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toContain('T1 failed');
    expect(task(failed, 'T1')).toMatchObject({ status: 'FAILED', attempt: 1, error: expect.stringContaining('credentials') });
    expect(task(failed, 'T2')).toMatchObject({ status: 'SKIPPED', error: 'Skipped because T1 did not complete.' });
    expect(task(failed, 'T3').status).toBe('SUCCEEDED');
    expect(model.state.prompts.some(p => p.role === 'synth')).toBe(false);

    expect((await a.c.post(`/api/v1/orchestrations/${failed.id}/tasks/T3/retry`)).status).toBe(409); // only failed tasks
    expect((await a.c.post(`/api/v1/orchestrations/${failed.id}/tasks/T1/retry`)).status).toBe(202);
    const done = await settled(a.c, failed.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.taskList.map((t: { status: string }) => t.status)).toEqual(['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED']);
    expect(model.state.prompts.filter(p => p.role === 'T3')).toHaveLength(1); // the finished task did not run again
    expect(await sql(`SELECT action FROM audit_logs WHERE action = 'orchestration.task_retried'`)).toHaveLength(1);
  });

  it('holds tasks that reach outside services until a person approves, and skips them when rejected', async () => {
    const a = await user(s, 'a@example.com');
    model.state.planner = [planOf([T('T1', 'seo-specialist', [], ['url_fetch', 'code_interpreter']), T('T2', 'translator'), T('T3', 'content-writer', ['T1'])])];
    const id = (await start(a.c)).json.id;
    const waiting = await until(() => get(a.c, id), o => task(o, 'T1')?.status === 'WAITING_APPROVAL' && task(o, 'T2')?.status === 'SUCCEEDED');
    expect(waiting.status).toBe('RUNNING');
    // Tools are limited to what the agent has AND what exists here: code_interpreter is dropped.
    expect(task(waiting, 'T1')).toMatchObject({ tools: ['url_fetch'], approval: { status: 'PENDING', tools: ['url_fetch'], canDecide: true, taskKey: 'T1' } });
    expect(waiting.tasks.waitingApproval).toBe(1);
    const inbox = (await a.c.get('/api/v1/approvals?status=PENDING')).json;
    expect(inbox).toEqual([expect.objectContaining({ orchestrationId: id, taskKey: 'T1', reason: expect.stringContaining('url_fetch') })]);

    expect((await a.c.post(`/api/v1/approvals/${inbox[0].id}`, { decision: 'maybe' })).status).toBe(400);
    expect((await a.c.post(`/api/v1/approvals/${inbox[0].id}`, { decision: 'approve', note: 'ok' })).json).toMatchObject({ status: 'APPROVED', decidedBy: 'Test User', note: 'ok' });
    expect((await a.c.post(`/api/v1/approvals/${inbox[0].id}`, { decision: 'reject' })).status).toBe(409);
    const done = await settled(a.c, id);
    expect(done.status).toBe('COMPLETED');
    const t1 = model.state.prompts.find(p => p.role === 'T1')!.body;
    expect(t1.tools.map((x: { function: { name: string } }) => x.function.name)).toEqual(['url_fetch']);

    // Rejecting: the task and what depends on it are skipped; the rest is still combined.
    model.state.prompts = [];
    model.state.planner = [planOf([T('T1', 'seo-specialist', [], ['url_fetch']), T('T2', 'translator'), T('T3', 'content-writer', ['T1'])])];
    const id2 = (await start(a.c, 'Second goal')).json.id;
    const w2 = await until(() => get(a.c, id2), o => task(o, 'T1')?.approval?.status === 'PENDING');
    expect((await a.c.post(`/api/v1/approvals/${task(w2, 'T1').approval.id}`, { decision: 'reject' })).status).toBe(200);
    const d2 = await settled(a.c, id2);
    expect(d2.status).toBe('COMPLETED');
    expect(d2.taskList.map((t: { status: string }) => t.status)).toEqual(['SKIPPED', 'SUCCEEDED', 'SKIPPED']);
    expect(task(d2, 'T1').error).toBe('A person rejected the tool use this task asked for.');
    expect(model.state.prompts.find(p => p.role === 'synth')!.body.messages.at(-1).content).toContain('Not available: T1 (Do T1)');
    expect(model.state.prompts.some(p => p.role === 'T1')).toBe(false);
  });

  it('cancels a run in progress, including its pending approvals', async () => {
    const a = await user(s, 'a@example.com');
    model.state.planner = [planOf([T('T1', 'seo-specialist', [], ['url_fetch'])])];
    const id = (await start(a.c)).json.id;
    await until(() => get(a.c, id), o => task(o, 'T1')?.status === 'WAITING_APPROVAL');
    expect((await a.c.post(`/api/v1/orchestrations/${id}/cancel`)).status).toBe(202);
    const o = await get(a.c, id);
    expect(o).toMatchObject({ status: 'CANCELLED', error: 'Cancelled.' });
    expect(task(o, 'T1')).toMatchObject({ status: 'CANCELLED', approval: { status: 'CANCELLED', canDecide: false } });
    expect((await a.c.post(`/api/v1/orchestrations/${id}/cancel`)).status).toBe(409);
    expect((await a.c.post(`/api/v1/approvals/${task(o, 'T1').approval.id}`, { decision: 'approve' })).status).toBe(409);
  });

  it('honours Idempotency-Key, isolates workspaces, limits active runs and validates input', async () => {
    const a = await user(s, 'a@example.com');
    const b = await user(s, 'b@example.com');
    model.state.planner = Array(5).fill(planOf([T('T1', 'seo-specialist', [], ['url_fetch'])]));
    const key = { 'Idempotency-Key': 'key-0123456789' };
    const first = await start(a.c, 'Goal one', key);
    const again = await start(a.c, 'Goal one', key);
    expect([first.status, again.status]).toEqual([202, 200]);
    expect(again.json).toEqual({ id: first.json.id, created: false });
    expect((await start(b.c, 'Goal one', key)).status).toBe(202); // keys are per workspace
    expect((await start(a.c, 'Goal', { 'Idempotency-Key': 'x' })).status).toBe(400);

    expect((await b.c.get(`/api/v1/orchestrations/${first.json.id}`)).status).toBe(404);
    expect((await b.c.post(`/api/v1/orchestrations/${first.json.id}/cancel`)).status).toBe(404);
    const pending = await until(() => get(a.c, first.json.id), o => task(o, 'T1')?.approval?.status === 'PENDING');
    expect((await b.c.post(`/api/v1/approvals/${task(pending, 'T1').approval.id}`, { decision: 'approve' })).status).toBe(404);
    expect((await b.c.get('/api/v1/approvals')).json.every((x: { orchestrationId: string }) => x.orchestrationId !== first.json.id)).toBe(true);

    await start(a.c, 'Goal two');
    await start(a.c, 'Goal three');
    const fourth = await start(a.c, 'Goal four');
    expect(fourth.status).toBe(429);
    expect(fourth.json.error.message).toContain('3 orchestrations in progress');
    expect((await start(a.c, 'x')).status).toBe(400);
    expect((await new Client(s.url).post('/api/v1/orchestrations', { goal: 'hello there' })).status).toBe(401);
  });

  it('recovers a task whose worker stopped (expired lease) and re-runs it', async () => {
    const a = await user(s, 'a@example.com');
    model.state.planner = [planOf([T('T1', 'seo-specialist', [], ['url_fetch']), T('T2', 'translator')])];
    const id = (await start(a.c)).json.id;
    await until(() => get(a.c, id), o => task(o, 'T1')?.status === 'WAITING_APPROVAL' && task(o, 'T2')?.status === 'SUCCEEDED');
    // Simulate a worker that claimed T2 and died mid-run.
    await sql(`UPDATE orchestration_tasks SET status = 'RUNNING', output = NULL, "leaseUntil" = now() - interval '1 minute' WHERE key = 'T2'`);
    await s.ctx.orchestration.orchestrator!.recover();
    const o = await until(() => get(a.c, id), x => task(x, 'T2')?.status === 'SUCCEEDED');
    expect(task(o, 'T2')).toMatchObject({ attempt: 2, output: 'Result T2' });
    expect(model.state.prompts.filter(p => p.role === 'T2')).toHaveLength(2);
  });

  it('reports orchestration in /meta', async () => {
    const meta = (await new Client(s.url).get('/api/v1/meta')).json;
    expect(meta.orchestration).toEqual({ available: true, durable: false, worker: true });
  });
});

describe.skipIf(!TEST_DB)('orchestration in demo mode and when unavailable', () => {
  it('runs a clearly labelled demo plan without an AI provider', async () => {
    await resetDatabase();
    const s = await startDbApp({}, FAST);
    try {
      const a = await user(s, 'a@example.com');
      const o = await settled(a.c, (await start(a.c)).json.id);
      expect(o).toMatchObject({ status: 'COMPLETED', provider: 'demo', modelCalls: 0 });
      expect(o.planSummary).toContain('Demo plan');
      expect(o.output).toContain('canned preview');
      expect(o.taskList).toHaveLength(3);
      expect(o.sources).toEqual(['T1', 'T2', 'T3']);
    } finally { await s.close(); }
  });

  it('is unavailable without accounts, and on serverless hosts without Redis', async () => {
    const guest = await startApp();
    const serverless = await startDbApp({ VERCEL: '1' });
    try {
      expect((await new Client(guest.url).get('/api/v1/meta')).json.orchestration).toMatchObject({ available: false, reason: expect.stringContaining('DATABASE_URL') });
      const meta = (await new Client(serverless.url).get('/api/v1/meta')).json.orchestration;
      expect(meta).toMatchObject({ available: false, reason: expect.stringContaining('REDIS_URL') });
      const c = new Client(serverless.url);
      await c.signUp('s@example.com');
      const r = await c.post('/api/v1/orchestrations', { goal: 'hello there' });
      expect(r.status).toBe(503);
      expect(r.json.error.code).toBe('FEATURE_UNAVAILABLE');
    } finally { await guest.close(); await serverless.close(); }
  });
});

describe.skipIf(!TEST_DB || !TEST_REDIS)('orchestration with Redis (BullMQ, separate worker)', () => {
  const prefix = `test-${randomUUID()}`;
  afterAll(async () => {
    const q = new Queue(QUEUE_NAME, { connection: redisConnection(TEST_REDIS), prefix });
    await q.obliterate({ force: true });
    await q.close();
  });

  it('queues durably from an API-only server and a separate worker process runs the job', async () => {
    await resetDatabase();
    const model = fakeModel();
    const upstream = await startUpstream([(req, body, res) => model.handler(req, body, res)]);
    const env = { OPENAI_API_KEY: 'sk', OPENAI_BASE_URL: upstream.url, OPENAI_MODEL: 'gpt-a', REDIS_URL: TEST_REDIS };
    const api = await startDbApp(env, { orchestration: { ...FAST.orchestration, redisPrefix: prefix, worker: false } });
    let worker: TestServer | null = null;
    try {
      const meta = (await new Client(api.url).get('/api/v1/meta')).json.orchestration;
      expect(meta).toEqual({ available: true, durable: true, worker: false });
      const a = await user(api, 'a@example.com');
      const id = (await start(a.c)).json.id;
      await new Promise(r => setTimeout(r, 400));
      expect((await get(a.c, id)).status).toBe('PLANNING'); // nobody consumes the queue yet
      worker = await startDbApp(env, { orchestration: { ...FAST.orchestration, redisPrefix: prefix, worker: true } });
      const o = await settled(a.c, id);
      expect(o).toMatchObject({ status: 'COMPLETED', durable: true });
    } finally {
      await worker?.close();
      await api.close();
      await upstream.close();
    }
  });
});
