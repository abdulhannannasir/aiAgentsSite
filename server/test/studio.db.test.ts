import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openaiChunk, sse, startUpstream, type TestServer } from './helpers.js';
import { Client, TEST_DB, resetDatabase, sql, startDbApp } from './db-helpers.js';
import { TEMPLATES } from '../src/modules/studio/templates.js';

type Graph = { nodes: Array<{ id: string; kind: string; label: string; position: { x: number; y: number }; config: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }> };
const n = (id: string, kind: string, config: Record<string, unknown> = {}) => ({ id, kind, label: id, position: { x: 0, y: 0 }, config });
const e = (source: string, target: string, sourceHandle?: 'true' | 'false') => ({ id: `${source}-${target}`, source, target, ...(sourceHandle && { sourceHandle }) });

/** A fake model: the classifier answers BUG when the message mentions a crash; every other call echoes its prompt. */
function fakeModel() {
  const prompts: Array<{ system: string; user: string; model: string }> = [];
  const handler = (_req: http.IncomingMessage, raw: string, res: http.ServerResponse) => {
    const body = JSON.parse(raw);
    const system = String(body.messages[0]?.content ?? '');
    const user = String(body.messages.at(-1)?.content ?? '');
    prompts.push({ system, user, model: body.model });
    const reply = user.includes('Answer with exactly one word: BUG or OTHER') ? (/crash/i.test(user) ? 'BUG' : 'OTHER') : `echo<${user.slice(0, 160)}>`;
    sse(res, [openaiChunk(reply), { choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } }], { done: '[DONE]' });
  };
  return { prompts, handler };
}

async function user(s: TestServer, email: string) {
  const c = new Client(s.url);
  expect((await c.signUp(email)).status).toBe(200);
  return c;
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
const run = (c: Client, id: string, input: string) => c.post(`/api/v1/studio/workflows/${id}/runs`, { input });
const get = (c: Client, id: string) => c.get(`/api/v1/orchestrations/${id}`).then(r => r.json);
const settled = (c: Client, id: string) => until(() => get(c, id), o => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(o.status));
const byNode = (o: any) => Object.fromEntries(o.taskList.map((t: { nodeId: string; status: string }) => [t.nodeId, t.status])); // eslint-disable-line @typescript-eslint/no-explicit-any
const task = (o: any, nodeId: string) => o.taskList.find((t: { nodeId: string }) => t.nodeId === nodeId); // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!TEST_DB)('workflow studio (PostgreSQL)', () => {
  let s: TestServer;
  let upstream: Awaited<ReturnType<typeof startUpstream>>;
  let model: ReturnType<typeof fakeModel>;
  beforeAll(async () => {
    await resetDatabase();
    model = fakeModel();
    upstream = await startUpstream([(req, body, res) => model.handler(req, body, res)]);
    s = await startDbApp({ OPENAI_API_KEY: 'sk', OPENAI_BASE_URL: upstream.url, OPENAI_MODEL: 'gpt-a', RATE_LIMIT_MAX: '1000' }, { orchestration: { options: { retryBaseMs: 20, recoverEveryMs: null } } });
  });
  afterAll(async () => { await s?.close(); await upstream?.close(); });
  beforeEach(async () => { await resetDatabase(); model.prompts.length = 0; });

  const create = async (c: Client, body: Record<string, unknown>) => {
    const r = await c.post('/api/v1/studio/workflows', body);
    expect(r.status).toBe(201);
    return r.json;
  };
  const save = (c: Client, id: string, graph: Graph, baseVersion?: number) => c.post(`/api/v1/studio/workflows/${id}/versions`, { graph, ...(baseVersion && { baseVersion }) });

  it('serves node types, templates and validation without signing in', async () => {
    const c = new Client(s.url);
    const types = (await c.get('/api/v1/studio/node-types')).json;
    expect(types.nodeTypes.filter((t: { available: boolean }) => t.available)).toHaveLength(12);
    expect(types.nodeTypes.find((t: { kind: string }) => t.kind === 'code')).toMatchObject({ available: false, reason: expect.stringContaining('sandbox') });
    expect(types.context.tools.find((t: { id: string }) => t.id === 'url_fetch')).toEqual({ id: 'url_fetch', available: true, external: true });
    const templates = (await c.get('/api/v1/studio/templates')).json;
    expect(templates.map((t: { id: string }) => t.id)).toEqual(TEMPLATES.map(t => t.id));
    expect(templates.every((t: { issues: Array<{ severity: string }> }) => !t.issues.some(i => i.severity === 'error'))).toBe(true);
    const v = (await c.post('/api/v1/studio/validate', { graph: { nodes: [], edges: [] } })).json;
    expect(v.issues[0].message).toContain('empty');
    expect((await c.get('/api/v1/studio/workflows')).status).toBe(401);
  });

  it('creates workflows from templates, saves versions (drafts with errors too) and guards concurrent saves', async () => {
    const a = await user(s, 'a@example.com');
    const w = await create(a, { name: 'Triage', templateId: 'support-triage' });
    expect(w).toMatchObject({ name: 'Triage', templateId: 'support-triage', canDelete: true, version: { version: 1, valid: true, note: 'From the “Support triage” template' } });
    expect((await a.post('/api/v1/studio/workflows', { name: 'X', templateId: 'nope' })).status).toBe(404);
    expect((await a.post('/api/v1/studio/workflows', { name: '' })).status).toBe(400);

    const broken: Graph = { nodes: [n('i', 'input')], edges: [] };
    const draft = await save(a, w.id, broken, 1);
    expect(draft.status).toBe(201);
    expect(draft.json).toMatchObject({ version: 2, valid: false, issues: [expect.objectContaining({ message: expect.stringContaining('Add an Output') })] });
    expect((await save(a, w.id, broken, 1)).status).toBe(409); // someone (we) saved v2 meanwhile
    expect((await a.post(`/api/v1/studio/workflows/${w.id}/versions`, { graph: { nodes: 'x' } })).status).toBe(400);

    const runDraft = await run(a, w.id, 'hello');
    expect(runDraft.status).toBe(400);
    expect(runDraft.json.error.message).toContain('Version 2 has errors');
    const versions = (await a.get(`/api/v1/studio/workflows/${w.id}/versions`)).json;
    expect(versions.map((v: { version: number; valid: boolean; createdBy: string }) => [v.version, v.valid, v.createdBy])).toEqual([[2, false, 'Test User'], [1, true, 'Test User']]);
    expect((await a.get(`/api/v1/studio/workflows/${w.id}/versions/1`)).json.graph.nodes).toHaveLength(7);

    // An older valid version can still be run explicitly.
    expect((await a.post(`/api/v1/studio/workflows/${w.id}/runs`, { input: 'App crashes', version: 1 })).status).toBe(202);
    expect((await a.patch(`/api/v1/studio/workflows/${w.id}`, { name: 'Renamed' })).json.name).toBe('Renamed');
    expect((await a.get('/api/v1/studio/workflows')).json).toEqual([expect.objectContaining({ id: w.id, name: 'Renamed', version: 2, valid: false, steps: 1 })]);
  });

  it('runs a branching workflow: only the taken branch runs, the merge continues, and the output is the result', async () => {
    const a = await user(s, 'a@example.com');
    const w = await create(a, { name: 'Triage', templateId: 'support-triage' });

    const bug = await settled(a, (await run(a, w.id, 'The app crashes when I log in')).json.id);
    expect(bug.status).toBe('COMPLETED');
    expect(byNode(bug)).toEqual({ message: 'SUCCEEDED', classify: 'SUCCEEDED', is_bug: 'SUCCEEDED', bug_report: 'SUCCEEDED', reply: 'SKIPPED', merge: 'SUCCEEDED', result: 'SUCCEEDED' });
    expect(task(bug, 'is_bug').output).toBe('true');
    expect(task(bug, 'reply').error).toBe('Skipped because the condition “Is it a bug?” took the other branch.');
    expect(bug.output).toContain('echo<Turn this customer message into a bug report');
    expect(bug).toMatchObject({ workflow: { id: w.id, name: 'Triage', version: 1 }, modelCalls: 2, sources: ['T7'] });
    // The classifier is a Prompt step with its own system prompt; the bug report uses the agent's own prompt.
    expect(model.prompts[0].system).toBe('You classify customer messages.');
    expect(model.prompts[1].system).toContain('Full-Stack Engineer');

    model.prompts.length = 0;
    const other = await settled(a, (await run(a, w.id, 'How do I change my email?')).json.id);
    expect(byNode(other)).toMatchObject({ bug_report: 'SKIPPED', reply: 'SUCCEEDED', merge: 'SUCCEEDED', result: 'SUCCEEDED' });
    expect(other.output).toContain('Write a friendly, concise reply');

    const runs = (await a.get(`/api/v1/studio/workflows/${w.id}/runs`)).json;
    expect(runs).toHaveLength(2);
    expect((await a.get('/api/v1/studio/workflows')).json[0].lastRun.status).toBe('COMPLETED');
  });

  it('runs data steps without a model: template, tool with templated arguments, extract, delay and joined outputs', async () => {
    const a = await user(s, 'a@example.com');
    const graph: Graph = {
      nodes: [
        n('i', 'input'),
        n('calc', 'tool', { toolId: 'calculator', args: { expression: '{{input}} * 2' } }),
        n('json', 'template', { text: '{"order": {"id": "A-{{input}}", "items": [1, 2]}}' }),
        n('order', 'extract', { source: '{{json}}', path: 'order.id' }),
        n('wait', 'delay', { seconds: 1 }),
        n('out1', 'output', { template: 'Doubled: {{calc}}' }),
        n('out2', 'output', { template: 'Order {{order}}' })
      ],
      edges: [e('i', 'calc'), e('i', 'json'), e('json', 'order'), e('order', 'wait'), e('calc', 'out1'), e('wait', 'out2')]
    };
    const w = await create(a, { name: 'Data', graph });
    expect(w.version.valid).toBe(true);
    const started = Date.now();
    const o = await settled(a, (await run(a, w.id, '21')).json.id);
    expect(o.status).toBe('COMPLETED');
    expect(o.output).toBe('Doubled: 21 * 2 = 42\n\nOrder A-21');
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    expect(o.modelCalls).toBe(0);
    expect(task(o, 'calc').toolCalls).toEqual([expect.objectContaining({ tool: 'calculator', ok: true })]);
    expect(model.prompts).toHaveLength(0);

    // A failing data step fails the run with the reason (no retries: trying again cannot help).
    const bad = await create(a, { name: 'Bad', graph: { nodes: [n('i', 'input'), n('x', 'extract', { source: '{{input}}', path: 'a' }), n('o', 'output')], edges: [e('i', 'x'), e('x', 'o')] } });
    const failed = await settled(a, (await run(a, bad.id, 'not json')).json.id);
    expect(failed.status).toBe('FAILED');
    expect(task(failed, 'x')).toMatchObject({ status: 'FAILED', attempt: 1, error: 'No JSON found in the input.' });
    expect(task(failed, 'o').status).toBe('SKIPPED');
  });

  it('pauses at an approval step until a person approves, and skips the rest when rejected', async () => {
    const a = await user(s, 'a@example.com');
    const w = await create(a, { name: 'Post', templateId: 'reviewed-post' });
    const id = (await run(a, w.id, 'Remote work')).json.id;
    const waiting = await until(() => get(a, id), o => task(o, 'review')?.status === 'WAITING_APPROVAL');
    expect(task(waiting, 'review').approval).toMatchObject({ status: 'PENDING', tools: [], canDecide: true, reason: expect.stringContaining('Review the draft before it is polished:\n\necho<Write a 500-word blog post') });
    expect(task(waiting, 'polish').status).toBe('PENDING');
    expect((await a.post(`/api/v1/approvals/${task(waiting, 'review').approval.id}`, { decision: 'approve' })).status).toBe(200);
    const done = await settled(a, id);
    expect(done.status).toBe('COMPLETED');
    expect(task(done, 'review').output).toContain('echo<Write a 500-word blog post');
    expect(done.output).toContain('echo<Improve this post for search');

    const id2 = (await run(a, w.id, 'Another topic')).json.id;
    const w2 = await until(() => get(a, id2), o => task(o, 'review')?.approval?.status === 'PENDING');
    await a.post(`/api/v1/approvals/${task(w2, 'review').approval.id}`, { decision: 'reject' });
    const rejected = await settled(a, id2);
    expect(rejected).toMatchObject({ status: 'FAILED', error: expect.stringContaining('No Output step produced a result') });
    expect(byNode(rejected)).toMatchObject({ review: 'SKIPPED', polish: 'SKIPPED', result: 'SKIPPED' });
  });

  it('pauses and resumes a run', async () => {
    const a = await user(s, 'a@example.com');
    const w = await create(a, { name: 'Post', templateId: 'reviewed-post' });
    const id = (await run(a, w.id, 'Topic')).json.id;
    const waiting = await until(() => get(a, id), o => task(o, 'review')?.status === 'WAITING_APPROVAL');
    expect((await a.post(`/api/v1/orchestrations/${id}/pause`)).status).toBe(202);
    expect((await a.post(`/api/v1/orchestrations/${id}/pause`)).status).toBe(409);
    await a.post(`/api/v1/approvals/${task(waiting, 'review').approval.id}`, { decision: 'approve' });
    await new Promise(r => setTimeout(r, 300));
    const paused = await get(a, id);
    expect(paused.status).toBe('PAUSED');
    expect(task(paused, 'polish').status).toBe('PENDING'); // nothing new starts while paused
    expect((await a.post(`/api/v1/orchestrations/${id}/resume`)).status).toBe(202);
    expect((await settled(a, id)).status).toBe('COMPLETED');
    expect((await a.post(`/api/v1/orchestrations/${id}/resume`)).status).toBe(409);
    expect(await sql(`SELECT action FROM audit_logs WHERE action IN ('orchestration.paused', 'orchestration.resumed') ORDER BY "createdAt"`)).toEqual([{ action: 'orchestration.paused' }, { action: 'orchestration.resumed' }]);
  });

  it('keeps workflows inside the workspace and soft-deletes them', async () => {
    const a = await user(s, 'a@example.com');
    const b = await user(s, 'b@example.com');
    const w = await create(a, { name: 'Mine', templateId: 'research' });
    for (const [method, path, body] of [['GET', '', undefined], ['PATCH', '', { name: 'x' }], ['DELETE', '', undefined], ['GET', '/versions', undefined], ['POST', '/runs', { input: 'x' }], ['POST', '/versions', { graph: { nodes: [], edges: [] } }]] as const) {
      const r = await b.req(method, `/api/v1/studio/workflows/${w.id}${path}`, body);
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    expect((await b.get('/api/v1/studio/workflows')).json).toEqual([]);
    const id = (await run(a, w.id, 'A topic')).json.id;
    await settled(a, id);
    expect((await a.del(`/api/v1/studio/workflows/${w.id}`)).status).toBe(204);
    expect((await a.get(`/api/v1/studio/workflows/${w.id}`)).status).toBe(404);
    // The run keeps its history and still names the workflow.
    expect((await get(a, id)).workflow).toEqual({ id: w.id, name: 'Mine', version: 1 });
    expect(await sql('SELECT count(*)::int AS n FROM workflows')).toEqual([{ n: 1 }]);
  });
});
