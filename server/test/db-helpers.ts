import { execSync } from 'node:child_process';
import pg from 'pg';
import { startApp, type TestServer } from './helpers.js';

/**
 * Integration tests run against a real PostgreSQL database named by TEST_DATABASE_URL (never DATABASE_URL, so a
 * developer's data can't be wiped by accident). They are skipped when it is not set.
 */
export const TEST_DB = process.env.TEST_DATABASE_URL ?? '';
export const ORIGIN = 'http://localhost:3999';
export const SECRET = 'test-secret-test-secret-test-secret-0123';

let migrated = false;
/** Applies migrations once, then empties every table (fast, keeps the schema). */
export async function resetDatabase() {
  if (!migrated) {
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: 'pipe' });
    migrated = true;
  }
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
    if (rows.length) await client.query(`TRUNCATE ${rows.map(r => `"${r.tablename}"`).join(', ')} CASCADE`);
  } finally {
    await client.end();
  }
}

export async function sql<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try { return (await client.query<T>(text, params)).rows; } finally { await client.end(); }
}

export const startDbApp = (env: Record<string, string> = {}): Promise<TestServer> =>
  startApp({ DATABASE_URL: TEST_DB, BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: ORIGIN, ...env });

/** A tiny cookie-jar client for one user. */
export class Client {
  cookies = new Map<string, string>();
  constructor(private base: string) {}

  async req(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = { Origin: ORIGIN, ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (!value || /max-age=0/i.test(c)) this.cookies.delete(name); else this.cookies.set(name, value);
    }
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* SSE or HTML */ }
    return { status: res.status, headers: res.headers, json: json as any, text }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  patch = (p: string, b: unknown) => this.req('PATCH', p, b);
  del = (p: string) => this.req('DELETE', p);

  signUp(email: string, password = 'correct horse battery', name = 'Test User') {
    return this.post('/api/auth/sign-up/email', { email, password, name });
  }
  signIn(email: string, password = 'correct horse battery') {
    return this.post('/api/auth/sign-in/email', { email, password });
  }

  /** POST /api/v1/chat and parse the SSE events. */
  async chat(body: unknown) {
    const r = await this.req('POST', '/api/v1/chat', body);
    const events = r.text.split('\n\n').filter(b => b.startsWith('data: ')).map(b => JSON.parse(b.slice(6)));
    return { ...r, events, answer: events.filter(e => e.type === 'stream').map(e => e.content).join('') };
  }
}

/** Rewrites an emailed link (built from BETTER_AUTH_URL) to point at the test server. */
export const linkFrom = (text: string, base: string) => {
  const m = /(http:\/\/localhost:3999\S+)/.exec(text);
  if (!m) throw new Error(`no link in: ${text}`);
  return m[1].replace(ORIGIN, base);
};
