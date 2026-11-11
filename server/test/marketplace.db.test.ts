import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { Client, TEST_DB, resetDatabase, sql, startDbApp } from './db-helpers.js';

async function user(s: TestServer, email: string, name = 'Grace Brewster Hopper') {
  const c = new Client(s.url);
  expect((await c.signUp(email, 'correct horse battery', name)).status).toBe(200);
  return c;
}
const stat = async (c: Client, id: string) => ((await c.get('/api/v1/marketplace/agents')).json as Array<{ id: string }>).find(x => x.id === id) as Record<string, unknown>;

describe.skipIf(!TEST_DB)('marketplace (PostgreSQL)', () => {
  let s: TestServer;
  beforeAll(async () => { await resetDatabase(); s = await startDbApp(); });
  afterAll(async () => { await s?.close(); });
  beforeEach(resetDatabase);

  it('starts with honest zeros: no runs, no rating', async () => {
    const list = (await new Client(s.url).get('/api/v1/marketplace/agents')).json;
    expect(list).toHaveLength(42);
    expect(list.find((x: { id: string }) => x.id === 'translator')).toEqual({ id: 'translator', runsTotal: 0, runs30d: 0, successRate: null, rating: null, reviewCount: 0 });
  });

  it('counts real single-agent runs, but not workflow runs, and computes the success rate', async () => {
    const c = await user(s, 'g@example.com');
    await c.chat({ agentId: 'translator', message: 'one' });
    await c.chat({ agentId: 'translator', message: 'two' });
    await c.chat({ workflowId: 'research', message: 'x', threadKey: 'translator' });
    await sql(`UPDATE agent_executions SET status = 'FAILED' WHERE input = 'two'`);
    expect(await stat(c, 'translator')).toMatchObject({ runsTotal: 2, runs30d: 2, successRate: 0.5, favorite: false });
    await sql(`UPDATE agent_executions SET "createdAt" = now() - interval '40 days' WHERE input = 'one'`);
    expect(await stat(c, 'translator')).toMatchObject({ runsTotal: 2, runs30d: 1 });
  });

  it('reviews: only after using the agent, 1-5 whole stars, one per person, editable and deletable', async () => {
    const c = await user(s, 'g@example.com');
    const before = await c.req('PUT', '/api/v1/marketplace/agents/translator/review', { rating: 5 });
    expect(before.status).toBe(403);
    expect(before.json.error.message).toMatch(/at least once/);

    await c.chat({ agentId: 'translator', message: 'hola' });
    expect((await c.req('PUT', '/api/v1/marketplace/agents/translator/review', { rating: 6 })).status).toBe(400);
    expect((await c.req('PUT', '/api/v1/marketplace/agents/translator/review', { rating: 4.5 })).status).toBe(400);
    expect((await c.req('PUT', '/api/v1/marketplace/agents/translator/review', { rating: 4, comment: 'x'.repeat(1001) })).status).toBe(400);

    const saved = await c.req('PUT', '/api/v1/marketplace/agents/translator/review', { rating: 4, comment: '  Good tone \u0007 ' });
    expect(saved.json).toMatchObject({ rating: 4, comment: 'Good tone', author: 'Grace H.', mine: true });
    await c.req('PUT', '/api/v1/marketplace/agents/translator/review', { rating: 2, comment: 'Changed my mind' });
    expect(await sql('SELECT rating, comment FROM agent_reviews')).toEqual([{ rating: 2, comment: 'Changed my mind' }]);

    const other = await user(s, 'h@example.com', 'Alan');
    await other.chat({ agentId: 'translator', message: 'hi' });
    await other.req('PUT', '/api/v1/marketplace/agents/translator/review', { rating: 5 });
    expect(await stat(other, 'translator')).toMatchObject({ rating: 3.5, reviewCount: 2 });

    const detail = (await other.get('/api/v1/marketplace/agents/translator')).json;
    expect(detail.reviews.map((r: { author: string; mine: boolean }) => [r.author, r.mine])).toEqual([['Alan', true], ['Grace H.', false]]);
    expect(detail.me).toMatchObject({ runs: 1, canReview: true, review: { rating: 5 } });
    expect(detail.me.conversations).toHaveLength(1);

    expect((await c.del('/api/v1/marketplace/agents/translator/review')).status).toBe(204);
    expect((await c.del('/api/v1/marketplace/agents/translator/review')).status).toBe(404);
    expect(await stat(c, 'translator')).toMatchObject({ rating: 5, reviewCount: 1 });
  });

  it('guests can read stats and reviews but not write; unknown agents are 404', async () => {
    const guest = new Client(s.url);
    const d = await guest.get('/api/v1/marketplace/agents/translator');
    expect(d.status).toBe(200);
    expect(d.json.me).toBeNull();
    expect((await guest.req('PUT', '/api/v1/marketplace/agents/translator/review', { rating: 5 })).status).toBe(401);
    expect((await guest.req('PUT', '/api/v1/marketplace/favorites/translator', {})).status).toBe(401);
    expect((await guest.get('/api/v1/marketplace/agents/nope')).status).toBe(404);
  });

  it('favorites: built-in and visible saved agents only; removed with the agent', async () => {
    const a = await user(s, 'a@example.com');
    const b = await user(s, 'b@example.com');
    expect((await a.req('PUT', '/api/v1/marketplace/favorites/translator', {})).status).toBe(204);
    expect((await a.req('PUT', '/api/v1/marketplace/favorites/translator', {})).status).toBe(204); // idempotent
    expect((await a.req('PUT', '/api/v1/marketplace/favorites/not-an-agent', {})).status).toBe(404);

    const mine = (await a.post('/api/v1/custom-agents', { name: 'Mine', systemPrompt: 'p' })).json;
    expect((await a.req('PUT', `/api/v1/marketplace/favorites/custom:${mine.id}`, {})).status).toBe(204);
    expect((await b.req('PUT', `/api/v1/marketplace/favorites/custom:${mine.id}`, {})).status).toBe(404); // not visible to b
    expect((await a.get('/api/v1/marketplace/favorites')).json).toEqual(['translator', `custom:${mine.id}`]);
    expect(await stat(a, 'translator')).toMatchObject({ favorite: true });
    expect(await stat(b, 'translator')).toMatchObject({ favorite: false });

    await a.del(`/api/v1/custom-agents/${mine.id}`);
    expect((await a.get('/api/v1/marketplace/favorites')).json).toEqual(['translator']);
    expect((await a.del('/api/v1/marketplace/favorites/translator')).status).toBe(204);
    expect((await a.get('/api/v1/marketplace/favorites')).json).toEqual([]);
  });
});

describe('marketplace without a database', () => {
  it('answers 503 so the UI can hide stats instead of showing fake ones', async () => {
    const { startApp } = await import('./helpers.js');
    const app = await startApp();
    try {
      const r = await fetch(`${app.url}/api/v1/marketplace/agents`);
      expect(r.status).toBe(503);
      expect((await r.json()).error.code).toBe('FEATURE_UNAVAILABLE');
    } finally {
      await app.close();
    }
  });
});
