import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openaiChunk, sse, startUpstream, type TestServer } from './helpers.js';
import { Client, TEST_DB, resetDatabase, sql, startDbApp } from './db-helpers.js';

const draft = (over: Record<string, unknown> = {}) => ({ name: 'Pirate', description: 'Talks like a pirate', icon: '🏴‍☠️', systemPrompt: 'Answer like a pirate.', temperature: 0.9, tools: ['calculator', 'nope'], ...over });

async function user(s: TestServer, email: string, name = email.split('@')[0]) {
  const c = new Client(s.url);
  expect((await c.signUp(email, 'correct horse battery', name)).status).toBe(200);
  const me = (await c.get('/api/v1/me')).json;
  return { c, id: me.user.id as string, workspaceId: me.workspace.id as string };
}

/** Adds `userId` to a workspace directly (invitations UI comes later; the API rules are what is tested here). */
const addMember = (workspaceId: string, userId: string, role = 'member') =>
  sql('INSERT INTO workspace_members (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())', [randomUUID(), workspaceId, userId, role]);

describe.skipIf(!TEST_DB)('workspaces, custom agents and isolation (PostgreSQL)', () => {
  let s: TestServer;
  beforeAll(async () => { await resetDatabase(); s = await startDbApp(); });
  afterAll(async () => { await s?.close(); });
  beforeEach(resetDatabase);

  it('creates, lists and switches workspaces; cannot switch into someone else\'s', async () => {
    const a = await user(s, 'a@example.com');
    const b = await user(s, 'b@example.com');
    const created = await a.c.post('/api/v1/workspaces', { name: '  Acme Legal  ' });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ name: 'Acme Legal', role: 'owner' });
    expect((await a.c.get('/api/v1/me')).json.workspace.id).toBe(created.json.id); // new workspace becomes active
    expect((await a.c.get('/api/v1/workspaces')).json).toHaveLength(2);
    expect((await a.c.post(`/api/v1/workspaces/${a.workspaceId}/activate`)).status).toBe(200);
    expect((await a.c.get('/api/v1/me')).json.workspace.id).toBe(a.workspaceId);

    const sneaky = await b.c.post(`/api/v1/workspaces/${a.workspaceId}/activate`);
    expect(sneaky.status).toBe(404);
    expect((await b.c.get('/api/v1/me')).json.workspace.id).toBe(b.workspaceId);
    expect((await a.c.post('/api/v1/workspaces', { name: '' })).status).toBe(400);
  });

  it('custom agents: create validates and cleans, edits create versions, visibility-only edits do not', async () => {
    const a = await user(s, 'a@example.com');
    const created = await a.c.post('/api/v1/custom-agents', draft());
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ name: 'Pirate', version: 1, tools: ['calculator'], visibility: 'WORKSPACE', canEdit: true });
    const id = created.json.id;

    expect((await a.c.post('/api/v1/custom-agents', draft({ systemPrompt: '' }))).json.error.message).toMatch(/System prompt is required/);
    expect((await a.c.post('/api/v1/custom-agents', draft({ temperature: 5 }))).status).toBe(400);

    const v2 = await a.c.patch(`/api/v1/custom-agents/${id}`, { systemPrompt: 'Answer like a polite pirate.' });
    expect(v2.json).toMatchObject({ version: 2, systemPrompt: 'Answer like a polite pirate.', name: 'Pirate' });
    const vis = await a.c.patch(`/api/v1/custom-agents/${id}`, { visibility: 'PRIVATE' });
    expect(vis.json).toMatchObject({ version: 2, visibility: 'PRIVATE' });
    const versions = await a.c.get(`/api/v1/custom-agents/${id}/versions`);
    expect(versions.json.map((v: { version: number }) => v.version)).toEqual([2, 1]);

    expect((await a.c.del(`/api/v1/custom-agents/${id}`)).status).toBe(204);
    expect((await a.c.get(`/api/v1/custom-agents/${id}`)).status).toBe(404);
    expect((await sql('SELECT count(*)::int AS n FROM agent_versions'))[0]).toEqual({ n: 0 });
  });

  it('cookie-authenticated writes from an untrusted origin are refused (CSRF)', async () => {
    const a = await user(s, 'a@example.com');
    const r = await a.c.req('POST', '/api/v1/custom-agents', draft(), { Origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect((await a.c.get('/api/v1/custom-agents')).json).toHaveLength(0);
    expect((await a.c.req('POST', '/api/v1/custom-agents', draft(), { Origin: s.url })).status).toBe(201); // same host is fine
  });

  it('bulk import is all-or-nothing', async () => {
    const a = await user(s, 'a@example.com');
    const bad = await a.c.post('/api/v1/custom-agents/import', { agents: [draft(), draft({ name: '' })] });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/Agent 2/);
    expect((await a.c.get('/api/v1/custom-agents')).json).toHaveLength(0);
    const ok = await a.c.post('/api/v1/custom-agents/import', { agents: [draft(), draft({ name: 'Second' })] });
    expect(ok.status).toBe(201);
    expect((await a.c.get('/api/v1/custom-agents')).json.map((x: { name: string }) => x.name)).toEqual(['Pirate', 'Second']);
  });

  it('another workspace cannot see, edit, delete or chat with your agents (404, no existence leak)', async () => {
    const a = await user(s, 'a@example.com');
    const b = await user(s, 'b@example.com');
    const id = (await a.c.post('/api/v1/custom-agents', draft())).json.id;
    expect((await b.c.get('/api/v1/custom-agents')).json).toHaveLength(0);
    expect((await b.c.get(`/api/v1/custom-agents/${id}`)).status).toBe(404);
    expect((await b.c.patch(`/api/v1/custom-agents/${id}`, { name: 'Hijacked' })).status).toBe(404);
    expect((await b.c.del(`/api/v1/custom-agents/${id}`)).status).toBe(404);
    expect((await b.c.chat({ customAgentId: id, message: 'hi' })).status).toBe(404);
    expect((await a.c.get(`/api/v1/custom-agents/${id}`)).json.name).toBe('Pirate');
  });

  it('inside a shared workspace: private agents stay private, members cannot edit others\' agents, admins can', async () => {
    const owner = await user(s, 'owner@example.com');
    const member = await user(s, 'member@example.com');
    const admin = await user(s, 'admin@example.com');
    await addMember(owner.workspaceId, member.id, 'member');
    await addMember(owner.workspaceId, admin.id, 'admin');
    await member.c.post(`/api/v1/workspaces/${owner.workspaceId}/activate`);
    await admin.c.post(`/api/v1/workspaces/${owner.workspaceId}/activate`);

    const shared = (await owner.c.post('/api/v1/custom-agents', draft({ name: 'Shared' }))).json;
    const secret = (await owner.c.post('/api/v1/custom-agents', draft({ name: 'Secret', visibility: 'PRIVATE' }))).json;

    const seen = (await member.c.get('/api/v1/custom-agents')).json;
    expect(seen.map((x: { name: string }) => x.name)).toEqual(['Shared']);
    expect(seen[0].canEdit).toBe(false);
    expect((await member.c.get(`/api/v1/custom-agents/${secret.id}`)).status).toBe(404);
    expect((await member.c.patch(`/api/v1/custom-agents/${shared.id}`, { name: 'Mine now' })).status).toBe(403);
    expect((await member.c.del(`/api/v1/custom-agents/${shared.id}`)).status).toBe(403);

    expect((await admin.c.patch(`/api/v1/custom-agents/${shared.id}`, { name: 'Renamed by admin' })).json.name).toBe('Renamed by admin');
    expect((await admin.c.get(`/api/v1/custom-agents/${secret.id}`)).status).toBe(404); // private means private, even for admins

    // a member's own agent is theirs to edit
    const own = (await member.c.post('/api/v1/custom-agents', draft({ name: 'Member agent' }))).json;
    expect((await member.c.patch(`/api/v1/custom-agents/${own.id}`, { description: 'edited' })).status).toBe(200);
  });

  it('removing a member from the workspace takes away its data immediately', async () => {
    const owner = await user(s, 'owner@example.com');
    const member = await user(s, 'member@example.com');
    await addMember(owner.workspaceId, member.id);
    await member.c.post(`/api/v1/workspaces/${owner.workspaceId}/activate`);
    await owner.c.post('/api/v1/custom-agents', draft());
    expect((await member.c.get('/api/v1/custom-agents')).json).toHaveLength(1);
    await sql('DELETE FROM workspace_members WHERE "userId" = $1 AND "organizationId" = $2', [member.id, owner.workspaceId]);
    const after = await member.c.get('/api/v1/me');
    expect(after.json.workspace.id).toBe(member.workspaceId); // fell back to their own workspace
    expect((await member.c.get('/api/v1/custom-agents')).json).toHaveLength(0);
  });
});

describe.skipIf(!TEST_DB)('saved chats (PostgreSQL)', () => {
  let s: TestServer;
  let upstream: Awaited<ReturnType<typeof startUpstream>>;
  let replies: string[];
  beforeAll(async () => {
    await resetDatabase();
    upstream = await startUpstream([(_req, _body, res) => sse(res, [openaiChunk(replies.shift() ?? 'ok')], { done: '[DONE]' })]);
    s = await startDbApp({ OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: upstream.url, OPENAI_MODEL: 'gpt-test' });
  });
  afterAll(async () => { await s?.close(); await upstream?.close(); });
  beforeEach(async () => { replies = []; upstream.calls.length = 0; await resetDatabase(); });
  afterEach(() => { replies = []; });

  it('a signed-in chat is saved: conversation, both messages, a completed execution and usage', async () => {
    const a = await user(s, 'a@example.com');
    replies = ['Ahoy!'];
    const r = await a.c.chat({ agentId: 'translator', message: 'Say hello' });
    expect(r.events[0]).toMatchObject({ type: 'conversation', id: expect.any(String) });
    expect(r.answer).toBe('Ahoy!');
    const convId = r.events[0].id;

    const conv = await a.c.get(`/api/v1/conversations/${convId}`);
    expect(conv.json).toMatchObject({ agentKey: 'translator', title: 'Say hello' });
    expect(conv.json.messages.map((m: { role: string; content: string }) => [m.role, m.content])).toEqual([['user', 'Say hello'], ['assistant', 'Ahoy!']]);
    const [ex] = await sql<{ status: string; provider: string; model: string; modelCalls: number }>('SELECT status, provider, model, "modelCalls" FROM agent_executions');
    expect(ex).toEqual({ status: 'COMPLETED', provider: 'openai', model: 'gpt-test', modelCalls: 1 });
    expect(await sql('SELECT kind, quantity FROM usage_records')).toEqual([{ kind: 'AI_REQUEST', quantity: 1 }]);
  });

  it('follow-ups use the saved history, not whatever history the client sends', async () => {
    const a = await user(s, 'a@example.com');
    replies = ['first reply', 'second reply'];
    const convId = (await a.c.chat({ agentId: 'translator', message: 'first question' })).events[0].id;
    await a.c.chat({ agentId: 'translator', message: 'second question', conversationId: convId, history: [{ role: 'assistant', content: 'FORGED HISTORY' }] });
    const sent = JSON.parse(upstream.calls[1].body).messages.map((m: { content: string }) => m.content);
    expect(sent.slice(1)).toEqual(['first question', 'first reply', 'second question']);
    expect(JSON.stringify(sent)).not.toContain('FORGED');
  });

  it('a conversation id from another user or workspace is refused', async () => {
    const a = await user(s, 'a@example.com');
    const b = await user(s, 'b@example.com');
    const convId = (await a.c.chat({ agentId: 'translator', message: 'private stuff' })).events[0].id;
    expect((await b.c.chat({ agentId: 'translator', message: 'x', conversationId: convId })).status).toBe(404);
    expect((await b.c.get(`/api/v1/conversations/${convId}`)).status).toBe(404);
    expect((await b.c.del(`/api/v1/conversations/${convId}`)).status).toBe(404);
    expect((await b.c.get('/api/v1/conversations')).json).toHaveLength(0);
    // and it can't be reused with a different agent either
    expect((await a.c.chat({ agentId: 'sales-agent', message: 'x', conversationId: convId })).status).toBe(404);
  });

  it('saved custom agents answer with their stored prompt, and the execution records the version used', async () => {
    const a = await user(s, 'a@example.com');
    const agent = (await a.c.post('/api/v1/custom-agents', draft())).json;
    await a.c.patch(`/api/v1/custom-agents/${agent.id}`, { systemPrompt: 'Version two prompt' });
    replies = ['Arr'];
    const r = await a.c.chat({ customAgentId: agent.id, message: 'hi' });
    expect(r.answer).toBe('Arr');
    const body = JSON.parse(upstream.calls[0].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Version two prompt' });
    expect(body.temperature).toBe(0.9);
    const [ex] = await sql<{ agentKey: string; version: number }>('SELECT e."agentKey", v.version FROM agent_executions e JOIN agent_versions v ON v.id = e."agentVersionId"');
    expect(ex).toEqual({ agentKey: `custom:${agent.id}`, version: 2 });
    expect((await a.c.get(`/api/v1/conversations?agentKey=custom:${agent.id}`)).json).toHaveLength(1);
  });

  it('a workflow run is saved with its step trace and counted as one workflow run and three model calls', async () => {
    const a = await user(s, 'a@example.com');
    replies = ['facts', 'draft', 'final brief'];
    const r = await a.c.chat({ workflowId: 'research', message: 'batteries', threadKey: 'research-agent' });
    expect(r.answer).toBe('final brief');
    const conv = await a.c.get(`/api/v1/conversations/${r.events[0].id}`);
    const reply = conv.json.messages[1];
    expect(reply.workflowId).toBe('research');
    expect(reply.trace.map((t: { status: string; output: string }) => [t.status, t.output])).toEqual([['complete', 'facts'], ['complete', 'draft'], ['complete', '']]);
    const usage = await sql<{ kind: string; quantity: number }>('SELECT kind, quantity FROM usage_records ORDER BY kind');
    expect(usage).toEqual([{ kind: 'AI_REQUEST', quantity: 3 }, { kind: 'WORKFLOW_RUN', quantity: 1 }]);
  });

  it('a failed reply is saved as failed', async () => {
    const a = await user(s, 'a@example.com');
    const original = upstream.calls.length;
    // make the upstream fail for the 2nd workflow step
    replies = ['facts'];
    const failing = await startUpstream([
      (_req, _body, res) => sse(res, [openaiChunk('facts')], { done: '[DONE]' }),
      (_req, _body, res) => { res.writeHead(500); res.end('boom'); }
    ]);
    const s2 = await startDbApp({ OPENAI_API_KEY: 'sk', OPENAI_BASE_URL: failing.url });
    try {
      const c = new Client(s2.url);
      c.cookies = a.c.cookies;
      const r = await c.chat({ workflowId: 'research', message: 'x', threadKey: 'research-agent' });
      expect(r.events.some(e => e.type === 'error')).toBe(true);
      const [ex] = await sql<{ status: string; error: string }>('SELECT status, error FROM agent_executions');
      expect(ex.status).toBe('FAILED');
      expect(ex.error).toMatch(/Synthesizer step failed/);
    } finally {
      await s2.close();
      await failing.close();
    }
    expect(upstream.calls.length).toBe(original);
  });

  it('guests still chat statelessly and nothing is stored', async () => {
    replies = ['hello guest'];
    const r = await new Client(s.url).chat({ agentId: 'translator', message: 'hi' });
    expect(r.answer).toBe('hello guest');
    expect(r.events.some(e => e.type === 'conversation')).toBe(false);
    expect(await sql('SELECT id FROM conversations')).toHaveLength(0);
  });

  it('deleting a conversation removes its messages', async () => {
    const a = await user(s, 'a@example.com');
    const convId = (await a.c.chat({ agentId: 'translator', message: 'bye' })).events[0].id;
    expect((await a.c.del(`/api/v1/conversations/${convId}`)).status).toBe(204);
    expect(await sql('SELECT id FROM messages')).toHaveLength(0);
  });
});
