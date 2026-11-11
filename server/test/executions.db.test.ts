import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openaiChunk, sse, startUpstream, type TestServer } from './helpers.js';
import { Client, TEST_DB, resetDatabase, sql, startDbApp } from './db-helpers.js';

const toolCall = (id: string, name: string, args: string) => [
  { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] } }] },
  { choices: [], usage: { prompt_tokens: 50, completion_tokens: 7 } }
];

async function user(s: TestServer, email: string) {
  const c = new Client(s.url);
  expect((await c.signUp(email)).status).toBe(200);
  const me = (await c.get('/api/v1/me')).json;
  return { c, id: me.user.id as string, workspaceId: me.workspace.id as string };
}

describe.skipIf(!TEST_DB)('executions (PostgreSQL)', () => {
  let s: TestServer;
  let upstream: Awaited<ReturnType<typeof startUpstream>>;
  let script: Array<(res: http.ServerResponse) => void>;
  beforeAll(async () => {
    await resetDatabase();
    upstream = await startUpstream([(_q, _b, res) => (script.shift() ?? (r => sse(r, [openaiChunk('ok')], { done: '[DONE]' })))(res)]);
    s = await startDbApp({ OPENAI_API_KEY: 'sk', OPENAI_BASE_URL: upstream.url, OPENAI_MODEL: 'gpt-a', OPENAI_MODELS: 'gpt-a,gpt-b' });
  });
  afterAll(async () => { await s?.close(); await upstream?.close(); });
  beforeEach(async () => { script = []; upstream.calls.length = 0; await resetDatabase(); });
  afterEach(() => { script = []; });

  it('records tokens summed over every model call, usage rows and each tool invocation', async () => {
    const a = await user(s, 'a@example.com');
    script = [
      res => sse(res, toolCall('c1', 'calculator', '{"expression":"2*21"}'), { done: '[DONE]' }),
      res => sse(res, [openaiChunk('42'), { choices: [], usage: { prompt_tokens: 80, completion_tokens: 5 } }], { done: '[DONE]' })
    ];
    await a.c.chat({ agentId: 'personal-assistant', message: 'what is 2*21' });
    const [ex] = await sql<{ status: string; modelCalls: number; inputTokens: number; outputTokens: number; model: string }>('SELECT status, "modelCalls", "inputTokens", "outputTokens", model FROM agent_executions');
    expect(ex).toEqual({ status: 'COMPLETED', modelCalls: 2, inputTokens: 130, outputTokens: 12, model: 'gpt-a' });
    expect(await sql('SELECT kind, quantity FROM usage_records ORDER BY kind')).toEqual([
      { kind: 'AI_REQUEST', quantity: 2 }, { kind: 'INPUT_TOKENS', quantity: 130 }, { kind: 'OUTPUT_TOKENS', quantity: 12 }
    ]);

    const list = (await a.c.get('/api/v1/executions')).json;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ agentName: 'Personal Productivity Assistant', status: 'COMPLETED', toolCalls: 1, inputTokens: 130, mine: true });
    const detail = (await a.c.get(`/api/v1/executions/${list[0].id}`)).json;
    expect(detail.tools).toEqual([expect.objectContaining({ tool: 'calculator', input: { expression: '2*21' }, status: 'SUCCEEDED', summary: '2*21 = 42' })]);
    expect(detail).toMatchObject({ input: 'what is 2*21', output: '42', running: false });
  });

  it('leaves tokens empty when the provider reports none (never estimated)', async () => {
    const a = await user(s, 'a@example.com');
    script = [res => sse(res, [openaiChunk('hi')], { done: '[DONE]' })];
    await a.c.chat({ agentId: 'translator', message: 'hi' });
    expect(await sql('SELECT "inputTokens", "outputTokens" FROM agent_executions')).toEqual([{ inputTokens: null, outputTokens: null }]);
    expect(await sql(`SELECT kind FROM usage_records WHERE kind <> 'AI_REQUEST'`)).toEqual([]);
  });

  it('a saved agent can be pinned to an allowed model, which then answers; other models are refused', async () => {
    const a = await user(s, 'a@example.com');
    expect((await a.c.post('/api/v1/custom-agents', { name: 'X', systemPrompt: 'p', provider: 'openai', model: 'gpt-zzz' })).json.error.message).toMatch(/not available on this server/);
    expect((await a.c.post('/api/v1/custom-agents', { name: 'X', systemPrompt: 'p', provider: 'openai' })).json.error.message).toMatch(/both a provider and a model/);
    const agent = (await a.c.post('/api/v1/custom-agents', { name: 'Pinned', systemPrompt: 'p', provider: 'openai', model: 'gpt-b' })).json;
    expect(agent).toMatchObject({ provider: 'openai', model: 'gpt-b' });
    await a.c.chat({ customAgentId: agent.id, message: 'hi' });
    expect(JSON.parse(upstream.calls[0].body).model).toBe('gpt-b');
    expect((await sql('SELECT model FROM agent_executions'))[0]).toEqual({ model: 'gpt-b' });
    const back = await a.c.patch(`/api/v1/custom-agents/${agent.id}`, { provider: null, model: null });
    expect(back.json).toMatchObject({ version: 2, provider: null, model: null });
  });

  it('members see their own runs, admins see the whole workspace, other workspaces see nothing', async () => {
    const owner = await user(s, 'owner@example.com');
    const member = await user(s, 'member@example.com');
    const outsider = await user(s, 'out@example.com');
    await sql('INSERT INTO workspace_members (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())', [randomUUID(), owner.workspaceId, member.id, 'member']);
    await member.c.post(`/api/v1/workspaces/${owner.workspaceId}/activate`);
    await owner.c.chat({ agentId: 'translator', message: 'owner run' });
    await member.c.chat({ agentId: 'translator', message: 'member run' });
    expect((await member.c.get('/api/v1/executions')).json.map((e: { input: string }) => e.input)).toEqual(['member run']);
    expect((await owner.c.get('/api/v1/executions')).json.map((e: { input: string; mine: boolean }) => [e.input, e.mine])).toEqual([['member run', false], ['owner run', true]]);
    const ownerRun = (await owner.c.get('/api/v1/executions')).json[1].id;
    expect((await member.c.get(`/api/v1/executions/${ownerRun}`)).status).toBe(404);
    expect((await outsider.c.get(`/api/v1/executions/${ownerRun}`)).status).toBe(404);
    expect((await outsider.c.get('/api/v1/executions')).json).toEqual([]);
  });

  it('a running reply can be cancelled through the API; finished runs cannot', async () => {
    const a = await user(s, 'a@example.com');
    // A stream that sends one token, then stalls until the connection closes.
    script = [res => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify(openaiChunk('partial '))}\n\n`); }];
    const pending = a.c.chat({ agentId: 'translator', message: 'long task' });
    let id: string | undefined;
    for (let i = 0; i < 50 && !id; i++) {
      await new Promise(r => setTimeout(r, 50));
      id = (await a.c.get('/api/v1/executions?status=RUNNING')).json[0]?.id;
    }
    expect(id).toBeTruthy();
    expect((await a.c.get(`/api/v1/executions/${id}`)).json.running).toBe(true);
    expect((await a.c.post(`/api/v1/executions/${id}/cancel`)).status).toBe(202);
    const r = await pending;
    expect(r.events.find(e => e.type === 'error')).toMatchObject({ content: 'This run was cancelled.' });
    expect(r.events.at(-1)?.type).toBe('done');
    expect((await sql<{ status: string; output: string }>('SELECT status, output FROM agent_executions'))[0]).toEqual({ status: 'CANCELLED', output: 'partial ' });
    const again = await a.c.post(`/api/v1/executions/${id}/cancel`);
    expect(again.status).toBe(409);
    expect(again.json.error.message).toMatch(/already ended/);
    expect((await sql(`SELECT action FROM audit_logs WHERE action = 'execution.cancelled'`))).toHaveLength(1);
  });

  it('guests cannot list or cancel executions', async () => {
    const guest = new Client(s.url);
    expect((await guest.get('/api/v1/executions')).status).toBe(401);
    expect((await guest.post('/api/v1/executions/x/cancel')).status).toBe(401);
  });
});
