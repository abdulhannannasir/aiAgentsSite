import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { Client, ORIGIN, TEST_DB, linkFrom, resetDatabase, sql, startDbApp } from './db-helpers.js';

describe.skipIf(!TEST_DB)('accounts (PostgreSQL)', () => {
  let s: TestServer;
  beforeAll(async () => { await resetDatabase(); s = await startDbApp(); });
  afterAll(async () => { await s?.close(); });
  beforeEach(resetDatabase);

  it('reports accounts as enabled in /meta', async () => {
    const meta = await (await fetch(`${s.url}/api/v1/meta`)).json();
    expect(meta.features).toMatchObject({ database: true, auth: true, email: false });
  });

  it('sign-up creates the user, a personal workspace they own, a session, and an audit trail', async () => {
    const c = new Client(s.url);
    const up = await c.signUp('ada@example.com', 'correct horse battery', 'Ada Lovelace');
    expect(up.status).toBe(200);
    expect([...c.cookies.keys()].some(k => k.includes('session_token'))).toBe(true);
    const cookie = up.headers.getSetCookie().find(h => h.includes('session_token'))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await c.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.json.user).toMatchObject({ email: 'ada@example.com', name: 'Ada Lovelace', role: 'user' });
    expect(me.json.workspace).toMatchObject({ name: "Ada's workspace", role: 'owner' });
    expect(me.json.workspaces).toHaveLength(1);

    const [pw] = await sql<{ password: string }>('SELECT password FROM accounts');
    expect(pw.password).not.toContain('correct horse'); // stored hashed
    const actions = (await sql<{ action: string }>('SELECT action FROM audit_logs ORDER BY "createdAt"')).map(r => r.action);
    expect(actions).toEqual(expect.arrayContaining(['user.signed_up', 'session.created']));
  });

  it('rejects duplicate emails, weak passwords and wrong credentials', async () => {
    const c = new Client(s.url);
    expect((await c.signUp('bob@example.com')).status).toBe(200);
    expect((await new Client(s.url).signUp('bob@example.com')).status).toBeGreaterThanOrEqual(400);
    expect((await new Client(s.url).signUp('short@example.com', 'short')).status).toBe(400);
    const wrong = await new Client(s.url).signIn('bob@example.com', 'not the password');
    expect(wrong.status).toBe(401);
    const right = new Client(s.url);
    expect((await right.signIn('bob@example.com')).status).toBe(200);
    expect((await right.get('/api/v1/me')).status).toBe(200);
  });

  it('signing out ends the session', async () => {
    const c = new Client(s.url);
    await c.signUp('carol@example.com');
    expect((await c.post('/api/auth/sign-out')).status).toBe(200);
    expect((await c.get('/api/v1/me')).status).toBe(401);
  });

  it('protected routes answer 401 to guests, and public routes still work', async () => {
    const guest = new Client(s.url);
    for (const p of ['/api/v1/me', '/api/v1/workspaces', '/api/v1/custom-agents', '/api/v1/conversations']) {
      const r = await guest.get(p);
      expect(r.status, p).toBe(401);
      expect(r.json.error.code).toBe('UNAUTHENTICATED');
    }
    expect((await guest.get('/api/v1/agents')).status).toBe(200);
  });

  it('password reset: emailed link → new password works, old one does not, other sessions end', async () => {
    const c = new Client(s.url);
    await c.signUp('dan@example.com', 'old password 123');
    const r = await new Client(s.url).post('/api/auth/request-password-reset', { email: 'dan@example.com', redirectTo: `${ORIGIN}/#/auth/reset-password` });
    expect(r.status).toBe(200);
    const mail = s.ctx.platform.mailer.outbox.at(-1)!;
    expect(mail.to).toBe('dan@example.com');
    const link = await new Client(s.url).get(linkFrom(mail.text, s.url).replace(s.url, ''));
    expect(link.status).toBe(302);
    // Better Auth appends the token as a query parameter, before the hash route: /?token=…#/auth/reset-password
    const location = new URL(link.headers.get('location')!);
    expect(location.hash).toBe('#/auth/reset-password');
    const token = location.searchParams.get('token');
    expect(token).toBeTruthy();
    expect((await new Client(s.url).post('/api/auth/reset-password', { token, newPassword: 'brand new password' })).status).toBe(200);
    expect((await new Client(s.url).signIn('dan@example.com', 'old password 123')).status).toBe(401);
    expect((await new Client(s.url).signIn('dan@example.com', 'brand new password')).status).toBe(200);
    expect((await c.get('/api/v1/me')).status).toBe(401); // revokeSessionsOnPasswordReset
  });

  it('asking to reset an unknown email reveals nothing', async () => {
    const r = await new Client(s.url).post('/api/auth/request-password-reset', { email: 'nobody@example.com', redirectTo: `${ORIGIN}/#/auth/reset-password` });
    expect(r.status).toBe(200);
    expect(s.ctx.platform.mailer.outbox.some(m => m.to === 'nobody@example.com')).toBe(false);
  });

  it('rejects auth requests from an untrusted origin, with or without a session cookie (CSRF)', async () => {
    const r = await new Client(s.url).req('POST', '/api/auth/sign-up/email', { email: 'x@example.com', password: 'correct horse battery', name: 'X' }, { Origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    const c = new Client(s.url);
    await c.signUp('frank@example.com');
    expect((await c.req('POST', '/api/auth/sign-out', {}, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await c.get('/api/v1/me')).status).toBe(200); // still signed in
  });
});

describe.skipIf(!TEST_DB)('email verification required (PostgreSQL)', () => {
  let s: TestServer;
  beforeAll(async () => { await resetDatabase(); s = await startDbApp({ REQUIRE_EMAIL_VERIFICATION: 'true' }); });
  afterAll(async () => { await s?.close(); });
  afterEach(resetDatabase);

  it('no session until the emailed link is opened; the link verifies and signs in', async () => {
    const c = new Client(s.url);
    const up = await c.signUp('eve@example.com');
    expect(up.status).toBe(200);
    expect((await c.get('/api/v1/me')).status).toBe(401);
    expect((await new Client(s.url).signIn('eve@example.com')).status).toBe(403); // EMAIL_NOT_VERIFIED

    const mail = s.ctx.platform.mailer.outbox.find(m => m.to === 'eve@example.com' && /Confirm/.test(m.subject))!;
    const v = new Client(s.url);
    const opened = await v.get(linkFrom(mail.text, s.url).replace(s.url, ''));
    expect([200, 302]).toContain(opened.status);
    expect((await v.get('/api/v1/me')).json.user.emailVerified).toBe(true);
    expect((await new Client(s.url).signIn('eve@example.com')).status).toBe(200);
  });
});
