import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { json, openaiChunk, sse, startUpstream, type TestServer } from './helpers.js';
import { Client, ORIGIN, TEST_DB, resetDatabase, sql, startDbApp } from './db-helpers.js';

const PDF = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/policy.pdf'));
const CONCEPTS = [/hotel|accommodation|lodging/i, /travel|trip|flight/i, /receipt|expense|reimburs/i, /deploy|release|ship/i, /python|code/i];
/** A tiny deterministic "embedding": one dimension per concept, so synonyms land close together. */
const fakeEmbedding = (t: string) => [...CONCEPTS.map(r => (r.test(t) ? 1 : 0)), 0.05];

function fakeOpenAI() {
  const state = { failEmbeddings: false, chats: [] as any[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const handler = (req: http.IncomingMessage, raw: string, res: http.ServerResponse) => {
    const body = JSON.parse(raw);
    if (req.url?.endsWith('/embeddings')) {
      if (state.failEmbeddings) return json(res, 503, { error: { message: 'down' } });
      return json(res, 200, { data: body.input.map((t: string, index: number) => ({ index, embedding: fakeEmbedding(t) })), usage: { prompt_tokens: body.input.length * 2 } });
    }
    state.chats.push(body);
    const last = body.messages.at(-1);
    if (body.tools?.some((t: { function: { name: string } }) => t.function.name === 'knowledge_base') && last.role === 'user') {
      return sse(res, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'k1', function: { name: 'knowledge_base', arguments: JSON.stringify({ query: last.content }) } }] } }] }], { done: '[DONE]' });
    }
    const text = last.role === 'tool' ? `Answer from knowledge: ${last.content.slice(0, 400)}` : `echo<${String(last.content).slice(0, 300)}>`;
    sse(res, [openaiChunk(text)], { done: '[DONE]' });
  };
  return { state, handler };
}

async function user(s: TestServer, email: string) {
  const c = new Client(s.url);
  expect((await c.signUp(email)).status).toBe(200);
  const me = (await c.get('/api/v1/me')).json;
  return { c, id: me.user.id as string, workspaceId: me.workspace.id as string };
}
const addMember = (workspaceId: string, userId: string, role = 'member') =>
  sql('INSERT INTO workspace_members (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())', [randomUUID(), workspaceId, userId, role]);

async function upload(c: Client, base: string, projectId: string, name: string, body: Buffer, type = '') {
  const res = await fetch(`${base}/api/v1/projects/${projectId}/files`, {
    method: 'POST', body,
    headers: { Origin: ORIGIN, Cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), ...(type && { 'X-File-Type': type }) }
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await get(); if (ok(v)) return v; if (Date.now() > end) throw new Error(`timed out: ${JSON.stringify(v).slice(0, 500)}`); await new Promise(r => setTimeout(r, 25)); }
}

describe.skipIf(!TEST_DB)('projects, files and memory (PostgreSQL)', () => {
  let s: TestServer;
  let upstream: Awaited<ReturnType<typeof startUpstream>>;
  let model: ReturnType<typeof fakeOpenAI>;
  let dir: string;
  let pgvector: boolean;
  beforeAll(async () => {
    await resetDatabase();
    pgvector = (await sql("SELECT 1 FROM pg_extension WHERE extname = 'vector'")).length > 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-files-'));
    model = fakeOpenAI();
    upstream = await startUpstream([(req, body, res) => model.handler(req, body, res)]);
    s = await startDbApp({ OPENAI_API_KEY: 'sk', OPENAI_BASE_URL: upstream.url, OPENAI_MODEL: 'gpt-a', STORAGE_DIR: dir, MAX_UPLOAD_MB: '1', RATE_LIMIT_MAX: '1000' },
      { orchestration: { options: { retryBaseMs: 20, recoverEveryMs: null } } });
  });
  afterAll(async () => { await s?.close(); await upstream?.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  beforeEach(async () => { await resetDatabase(); model.state.failEmbeddings = false; model.state.chats = []; });

  /** Owner + member + admin in one workspace. */
  async function team() {
    const owner = await user(s, 'owner@example.com');
    const member = await user(s, 'member@example.com');
    const admin = await user(s, 'admin@example.com');
    await addMember(owner.workspaceId, member.id, 'member');
    await addMember(owner.workspaceId, admin.id, 'admin');
    await member.c.post(`/api/v1/workspaces/${owner.workspaceId}/activate`);
    await admin.c.post(`/api/v1/workspaces/${owner.workspaceId}/activate`);
    return { owner, member, admin };
  }

  it('reports what retrieval can use here', async () => {
    const { owner } = await team();
    expect((await owner.c.get('/api/v1/memory/status')).json).toEqual({
      embeddings: { provider: 'openai', model: 'text-embedding-3-small' }, vectorSearch: pgvector ? 'pgvector' : 'in-app', storage: 'local', maxUploadMb: 1
    });
    expect((await new Client(s.url).get('/api/v1/memory/status')).status).toBe(401);
  });

  it('keeps private projects private and lets only creators or admins change them', async () => {
    const { owner, member, admin } = await team();
    const priv = (await owner.c.post('/api/v1/projects', { name: 'Secret', visibility: 'PRIVATE' })).json;
    const shared = (await owner.c.post('/api/v1/projects', { name: 'Shared', description: 'For everyone' })).json;
    expect(shared).toMatchObject({ visibility: 'WORKSPACE', canEdit: true, counts: { files: 0, memories: 0, workflows: 0, runs: 0 } });
    expect((await member.c.get('/api/v1/projects')).json.map((p: { name: string }) => p.name)).toEqual(['Shared']);
    expect((await admin.c.get('/api/v1/projects')).json.map((p: { name: string }) => p.name).sort()).toEqual(['Secret', 'Shared']);
    expect((await member.c.get(`/api/v1/projects/${priv.id}`)).status).toBe(404);
    expect((await member.c.patch(`/api/v1/projects/${shared.id}`, { name: 'Mine' })).status).toBe(403);
    expect((await admin.c.patch(`/api/v1/projects/${shared.id}`, { archived: true })).json.archived).toBe(true);
    expect((await owner.c.get('/api/v1/projects')).json.map((p: { name: string }) => p.name)).toEqual(['Secret']);
    expect((await owner.c.get('/api/v1/projects?archived=1')).json).toHaveLength(2);
    expect((await owner.c.post('/api/v1/projects', { name: '' })).status).toBe(400);
    const outsider = await user(s, 'outsider@example.com');
    expect((await outsider.c.get(`/api/v1/projects/${shared.id}`)).status).toBe(404);
  });

  it('uploads files: extracts and indexes text, explains what it cannot read, refuses duplicates and oversize files', async () => {
    const { owner } = await team();
    const p = (await owner.c.post('/api/v1/projects', { name: 'Ops' })).json;
    const pdf = await upload(owner.c, s.url, p.id, 'Expense Policy.pdf', PDF);
    expect(pdf.status).toBe(201);
    expect(pdf.json).toMatchObject({ name: 'Expense Policy.pdf', mime: 'application/pdf', size: PDF.length, status: 'READY', error: null, chunks: 1, searchable: true, uploadedBy: 'Test User' });
    const rows = await sql<{ embeddingModel: string; n: number }>('SELECT "embeddingModel", cardinality(embedding) AS n FROM memory_records');
    expect(rows).toEqual([{ embeddingModel: 'text-embedding-3-small', n: 6 }]);
    expect((await upload(owner.c, s.url, p.id, 'copy.pdf', PDF)).status).toBe(409);
    const png = await upload(owner.c, s.url, p.id, 'logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]), 'image/png');
    expect(png.json).toMatchObject({ status: 'READY', searchable: false, error: expect.stringContaining('not extracted from this file type') });
    const fake = await upload(owner.c, s.url, p.id, 'fake.pdf', Buffer.from('hello'));
    expect(fake.json).toMatchObject({ status: 'FAILED', error: 'The file is named as a PDF but is not one.' });
    const big = await upload(owner.c, s.url, p.id, 'big.txt', Buffer.alloc(1.5 * 1024 * 1024, 'a'));
    expect(big.status).toBe(400);
    expect(big.json.error.message).toBe('The file is too large (max 1 MB).');
    const traversal = await upload(owner.c, s.url, p.id, '../../evil.txt', Buffer.from('notes about deploys'));
    expect(traversal.json.name).toBe('evil.txt');
    expect(fs.readdirSync(path.join(dir, `ws/${owner.workspaceId}/p/${p.id}`))).toHaveLength(4);

    // Embedding failure: the file stays searchable by keyword, and says so.
    model.state.failEmbeddings = true;
    const notes = await upload(owner.c, s.url, p.id, 'notes.md', Buffer.from('# Release checklist\nShip on Tuesdays.'));
    expect(notes.json).toMatchObject({ status: 'READY', chunks: 1, error: expect.stringContaining('keyword search only') });
    model.state.failEmbeddings = false;
    const re = await owner.c.post(`/api/v1/projects/${p.id}/files/${notes.json.id}/reindex`);
    expect(re.json).toMatchObject({ error: null, chunks: 1 });

    const list = (await owner.c.get(`/api/v1/projects/${p.id}/files`)).json;
    expect(list.map((f: { name: string }) => f.name)).toEqual(['notes.md', 'evil.txt', 'fake.pdf', 'logo.png', 'Expense Policy.pdf']);
  });

  it('downloads only as an attachment, only for people who can see the project, and deletes cleanly', async () => {
    const { owner, member } = await team();
    const priv = (await owner.c.post('/api/v1/projects', { name: 'Secret', visibility: 'PRIVATE' })).json;
    const f = (await upload(owner.c, s.url, priv.id, 'policy.pdf', PDF)).json;
    const res = await fetch(`${s.url}/api/v1/projects/${priv.id}/files/${f.id}/download`, { headers: { Cookie: [...owner.c.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="policy.pdf"; filename*=UTF-8''policy.pdf`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    expect((await member.c.get(`/api/v1/projects/${priv.id}/files/${f.id}/download`)).status).toBe(404);
    expect((await member.c.del(`/api/v1/projects/${priv.id}/files/${f.id}`)).status).toBe(404);
    expect((await owner.c.del(`/api/v1/projects/${priv.id}/files/${f.id}`)).status).toBe(204);
    expect(await sql('SELECT count(*)::int AS n FROM memory_records')).toEqual([{ n: 0 }]);
    expect(fs.readdirSync(path.join(dir, `ws/${owner.workspaceId}/p/${priv.id}`))).toEqual([]);
  });

  it('stores notes in four scopes with the right visibility, edit rights and expiry', async () => {
    const { owner, member, admin } = await team();
    const p = (await owner.c.post('/api/v1/projects', { name: 'Ops' })).json;
    const priv = (await owner.c.post('/api/v1/projects', { name: 'Secret', visibility: 'PRIVATE' })).json;
    const mine = (await owner.c.post('/api/v1/memory', { scope: 'USER', content: 'I prefer short answers.' })).json;
    const ws = (await owner.c.post('/api/v1/memory', { scope: 'WORKSPACE', title: 'Travel', content: 'Book flights two weeks ahead.' })).json;
    const proj = (await owner.c.post('/api/v1/memory', { scope: 'PROJECT', projectId: priv.id, content: 'Launch code name is Falcon.' })).json;
    const agent = (await owner.c.post('/api/v1/memory', { scope: 'AGENT', agentKey: 'customer-support', content: 'Always offer the refund form.', expiresInDays: 30 })).json;
    expect(mine).toMatchObject({ scope: 'USER', title: 'I prefer short answers.', embedded: true, canEdit: true });
    expect(agent).toMatchObject({ agentName: 'Customer Support Specialist', expiresAt: expect.any(Number) });
    expect((await owner.c.post('/api/v1/memory', { scope: 'PROJECT', projectId: 'nope', content: 'x' })).status).toBe(404);
    expect((await owner.c.post('/api/v1/memory', { scope: 'AGENT', agentKey: 'nope', content: 'x' })).status).toBe(404);
    expect((await member.c.post('/api/v1/memory', { scope: 'PROJECT', projectId: priv.id, content: 'x' })).status).toBe(404);

    const titles = async (c: Client, q = '') => (await c.get(`/api/v1/memory${q}`)).json.map((n: { title: string }) => n.title).sort();
    expect(await titles(owner.c)).toEqual(['Always offer the refund form.', 'I prefer short answers.', 'Launch code name is Falcon.', 'Travel']);
    expect(await titles(member.c)).toEqual(['Always offer the refund form.', 'Travel']); // not the owner's private note or private project
    expect(await titles(admin.c)).toEqual(['Always offer the refund form.', 'Launch code name is Falcon.', 'Travel']); // admins see projects, never others' private notes
    expect(await titles(owner.c, `?projectId=${priv.id}`)).toEqual(['Launch code name is Falcon.']);
    expect(await titles(owner.c, '?scope=USER')).toEqual(['I prefer short answers.']);
    expect((await member.c.get(`/api/v1/memory?projectId=${priv.id}`)).status).toBe(404);
    void p; void proj;

    expect((await member.c.patch(`/api/v1/memory/${ws.id}`, { content: 'no' })).status).toBe(403);
    expect((await admin.c.patch(`/api/v1/memory/${ws.id}`, { content: 'Book flights three weeks ahead.' })).json.content).toBe('Book flights three weeks ahead.');
    expect((await admin.c.del(`/api/v1/memory/${mine.id}`)).status).toBe(404);
    expect((await owner.c.patch(`/api/v1/memory/${mine.id}`, { expiresInDays: null })).json.expiresAt).toBeNull();

    // Expired memories disappear from lists and searches, and are cleaned up.
    await sql(`UPDATE memory_records SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`, [agent.id]);
    expect(await titles(member.c)).toEqual(['Travel']);
    expect(await sql('SELECT count(*)::int AS n FROM memory_records WHERE id = $1', [agent.id])).toEqual([{ n: 0 }]);
  });

  it('searches semantically and by keyword, only within what the person may see, with labelled context', async () => {
    const { owner, member } = await team();
    const priv = (await owner.c.post('/api/v1/projects', { name: 'Secret', visibility: 'PRIVATE' })).json;
    const shared = (await owner.c.post('/api/v1/projects', { name: 'Shared' })).json;
    await upload(owner.c, s.url, priv.id, 'policy.pdf', PDF);
    await upload(owner.c, s.url, shared.id, 'deploys.md', Buffer.from('Deploy runbook: release on Tuesdays after the smoke test.'));
    await owner.c.post('/api/v1/memory', { scope: 'USER', content: 'My hotel loyalty number is 12345.' });

    // "accommodation" appears in no text: only the semantic match finds the hotel cap.
    const sem = (await owner.c.post('/api/v1/memory/search', { query: 'accommodation budget' })).json;
    expect(sem.mode).toBe('semantic+keyword');
    expect(sem.hits.map((h: { title: string; match: string }) => [h.title, h.match]).sort()).toEqual([['My hotel loyalty number is 12345.', 'semantic'], ['policy.pdf', 'semantic']]);
    expect(sem.hits.find((h: { title: string }) => h.title === 'policy.pdf')).toMatchObject({ scope: 'PROJECT', source: 'FILE', file: { name: 'policy.pdf', projectId: priv.id }, ref: expect.stringMatching(/^K\d$/) });
    expect(sem.context).toContain('Hotel nights are capped at 180 euros');
    expect(sem.context).toMatch(/^\[K1\] /);

    const kw = (await owner.c.post('/api/v1/memory/search', { query: 'smoke test' })).json;
    expect(kw.hits.map((h: { title: string; match: string }) => [h.title, h.match])).toEqual([['deploys.md', 'keyword']]);
    const both = (await owner.c.post('/api/v1/memory/search', { query: 'release' })).json;
    expect(both.hits[0]).toMatchObject({ title: 'deploys.md', match: 'both' });

    // The member sees neither the owner's private note nor the private project's file.
    const theirs = (await member.c.post('/api/v1/memory/search', { query: 'hotel accommodation' })).json;
    expect(theirs.hits).toEqual([]);
    expect((await member.c.post('/api/v1/memory/search', { query: 'release' })).json.hits.map((h: { title: string }) => h.title)).toEqual(['deploys.md']);
    // Limited to one project
    expect((await owner.c.post('/api/v1/memory/search', { query: 'hotel', projectId: shared.id, scopes: ['PROJECT'] })).json.hits).toEqual([]);
    expect((await member.c.post('/api/v1/memory/search', { query: 'x', projectId: priv.id })).status).toBe(404);

    // Embeddings down: keyword results, and the response says so.
    model.state.failEmbeddings = true;
    const fallback = (await owner.c.post('/api/v1/memory/search', { query: 'hotel' })).json;
    expect(fallback).toMatchObject({ mode: 'keyword', semanticError: expect.stringContaining('keyword') });
    expect(fallback.hits.map((h: { title: string }) => h.title).sort()).toEqual(['My hotel loyalty number is 12345.', 'policy.pdf']);
  });

  it('gives signed-in chat agents a knowledge tool limited to the caller, and none to guests', async () => {
    const { owner, member } = await team();
    await owner.c.post('/api/v1/memory', { scope: 'WORKSPACE', title: 'Refunds', content: 'Refunds are processed within 5 business days.' });
    await owner.c.post('/api/v1/memory', { scope: 'USER', content: 'Owner-only secret: the refund override code is 999.' });
    const r = await member.c.chat({ agentId: 'customer-support', message: 'How long do refunds take?' });
    expect(r.events.find((e: { type: string }) => e.type === 'tool')).toMatchObject({ tool: 'knowledge_base', status: 'running', input: { query: 'How long do refunds take?' } });
    expect(r.answer).toContain('Refunds are processed within 5 business days');
    expect(r.answer).not.toContain('override code');
    expect(r.answer).toContain('trust="untrusted"');
    const offered = model.state.chats[0].tools.map((t: { function: { name: string } }) => t.function.name);
    expect(offered).toContain('knowledge_base');

    model.state.chats = [];
    const guest = await new Client(s.url).chat({ agentId: 'customer-support', message: 'How long do refunds take?' });
    expect(guest.answer).toContain('echo<');
    expect(model.state.chats[0].tools ?? []).not.toContainEqual(expect.objectContaining({ function: expect.objectContaining({ name: 'knowledge_base' }) }));
  });

  it('runs a Knowledge search step in a studio workflow, scoped to the workflow\'s project', async () => {
    const { owner } = await team();
    const p = (await owner.c.post('/api/v1/projects', { name: 'Finance' })).json;
    await upload(owner.c, s.url, p.id, 'policy.pdf', PDF);
    const graph = {
      nodes: [
        { id: 'q', kind: 'input', label: 'Question', position: { x: 0, y: 0 }, config: {} },
        { id: 'look', kind: 'knowledge', label: 'Look it up', position: { x: 200, y: 0 }, config: { query: '{{input}}', limit: 3 } },
        { id: 'out', kind: 'output', label: 'Out', position: { x: 400, y: 0 }, config: { template: '{{look}}' } }
      ],
      edges: [{ id: 'a', source: 'q', target: 'look' }, { id: 'b', source: 'look', target: 'out' }]
    };
    const w = (await owner.c.post('/api/v1/studio/workflows', { name: 'Lookup', graph })).json;
    expect(w.version.valid).toBe(true);
    const run = async () => {
      const id = (await owner.c.post(`/api/v1/studio/workflows/${w.id}/runs`, { input: 'hotel accommodation limit' })).json.id;
      return until(() => owner.c.get(`/api/v1/orchestrations/${id}`).then(r => r.json), o => ['COMPLETED', 'FAILED'].includes(o.status));
    };
    // Without a project, project files are out of scope.
    expect((await run()).output).toBe('No matching notes or documents were found.');
    expect((await owner.c.patch(`/api/v1/studio/workflows/${w.id}`, { projectId: 'nope' })).status).toBe(404);
    expect((await owner.c.patch(`/api/v1/studio/workflows/${w.id}`, { projectId: p.id })).json.projectId).toBe(p.id);
    const o = await run();
    expect(o).toMatchObject({ status: 'COMPLETED', projectId: p.id });
    expect(o.output).toContain('[K1] policy.pdf (file, part 1, project memory)');
    expect(o.output).toContain('Hotel nights are capped at 180 euros');
    expect(o.taskList[1].toolCalls[0]).toMatchObject({ tool: 'knowledge_base', ok: true, summary: '1 result for “hotel accommodation limit”' });
    const activity = (await owner.c.get(`/api/v1/projects/${p.id}/activity`)).json;
    expect(activity.workflows).toEqual([expect.objectContaining({ name: 'Lookup' })]);
    expect(activity.runs.filter((r: { status: string }) => r.status === 'COMPLETED')).toHaveLength(1);
    expect((await owner.c.post('/api/v1/orchestrations', { goal: 'Plan the offsite', projectId: 'nope' })).status).toBe(404);
  });

  it('reindexes memory written without embeddings (admins only), and deleting a project removes its files', async () => {
    const { owner, member } = await team();
    const p = (await owner.c.post('/api/v1/projects', { name: 'Temp' })).json;
    await upload(owner.c, s.url, p.id, 'a.txt', Buffer.from('travel notes'));
    model.state.failEmbeddings = true;
    await owner.c.post('/api/v1/memory', { scope: 'WORKSPACE', content: 'Trip budget is 2000.' });
    model.state.failEmbeddings = false;
    expect(await sql('SELECT count(*)::int AS n FROM memory_records WHERE "embeddingModel" IS NULL')).toEqual([{ n: 1 }]);
    expect((await member.c.post('/api/v1/memory/reindex')).status).toBe(403);
    expect((await owner.c.post('/api/v1/memory/reindex')).json).toEqual({ reindexed: 1, remaining: 0 });

    const w = (await owner.c.post('/api/v1/studio/workflows', { name: 'Linked' })).json;
    await owner.c.patch(`/api/v1/studio/workflows/${w.id}`, { projectId: p.id });
    expect((await member.c.del(`/api/v1/projects/${p.id}`)).status).toBe(403);
    expect((await owner.c.del(`/api/v1/projects/${p.id}`)).status).toBe(204);
    expect(fs.existsSync(path.join(dir, `ws/${owner.workspaceId}/p/${p.id}`)) && fs.readdirSync(path.join(dir, `ws/${owner.workspaceId}/p/${p.id}`)).length).toBeFalsy();
    expect(await sql('SELECT count(*)::int AS n FROM project_files')).toEqual([{ n: 0 }]);
    expect((await owner.c.get(`/api/v1/studio/workflows/${w.id}`)).json.projectId).toBeNull(); // the workflow stays, unlinked
    expect(await sql(`SELECT action FROM audit_logs WHERE action LIKE 'project.%' OR action LIKE 'file.%' ORDER BY "createdAt"`)).toEqual([
      { action: 'project.created' }, { action: 'file.uploaded' }, { action: 'project.deleted' }
    ]);
  });
});
