import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chat, startApp, type TestServer } from './helpers.js';

let s: TestServer;
beforeAll(async () => { s = await startApp(); });
afterAll(async () => { await s.close(); });

describe('platform endpoints', () => {
  it('GET /healthz', async () => {
    const res = await fetch(`${s.url}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it.each(['/api/health', '/api/v1/health'])('GET %s keeps the original shape', async path => {
    expect(await (await fetch(s.url + path)).json()).toEqual({ ok: true, mode: 'demo', provider: 'demo', agents: 42 });
  });

  it('GET /api/v1/meta reports configuration as booleans only', async () => {
    const meta = await (await fetch(`${s.url}/api/v1/meta`)).json();
    expect(meta).toMatchObject({ mode: 'demo', provider: 'demo', providers: { openai: { configured: false }, gemini: { configured: false } } });
    expect(Object.values(meta.features).every(v => typeof v === 'boolean')).toBe(true);
  });

  it('never leaks a key through /meta', async () => {
    const live = await startApp({ OPENAI_API_KEY: 'sk-secret-value' });
    try {
      const text = await (await fetch(`${live.url}/api/v1/meta`)).text();
      expect(text).not.toContain('sk-secret-value');
      expect(JSON.parse(text).providers.openai).toEqual({ configured: true, model: 'gpt-4o-mini' });
    } finally {
      await live.close();
    }
  });
});

describe('agents and workflows', () => {
  it('lists 42 agents without system prompts or greetings', async () => {
    const agents = await (await fetch(`${s.url}/api/v1/agents`)).json();
    expect(agents).toHaveLength(42);
    expect(new Set(agents.map((a: { id: string }) => a.id)).size).toBe(42);
    for (const a of agents) {
      expect(a).not.toHaveProperty('systemPrompt');
      expect(a).not.toHaveProperty('greeting');
      expect(a).toMatchObject({ id: expect.any(String), name: expect.any(String), category: expect.any(String), tools: expect.any(Array) });
    }
  });

  it('gets one agent, and a JSON 404 for an unknown one', async () => {
    expect((await (await fetch(`${s.url}/api/agents/coding-assistant`)).json()).name).toBe('Full-Stack Coding Assistant');
    const res = await fetch(`${s.url}/api/v1/agents/nope`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatchObject({ code: 'NOT_FOUND', requestId: expect.any(String) });
  });

  it('lists the 4 workflows with resolved agents and caching', async () => {
    const res = await fetch(`${s.url}/api/v1/workflows`);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const workflows = await res.json();
    expect(workflows.map((w: { command: string }) => w.command)).toEqual(['/research', '/code-review', '/legal-draft', '/brainstorm']);
    for (const w of workflows) {
      expect(w.steps).toHaveLength(3);
      for (const step of w.steps) expect(step).toMatchObject({ agentName: expect.any(String), agentIcon: expect.any(String), agentGradient: expect.any(String) });
      expect(w.steps[0]).not.toHaveProperty('instruction');
    }
  });

  it('answers unknown /api routes with JSON, not the SPA', async () => {
    const res = await fetch(`${s.url}/api/v1/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/json/);
  });
});

describe('chat validation', () => {
  it.each([
    [{ agentId: 'coding-assistant' }, 400, /Missing or invalid/],
    [{ agentId: 'coding-assistant', message: '   ' }, 400, /Missing or invalid/],
    [{ agentId: 'coding-assistant', message: 'x'.repeat(4001) }, 400, /too long/],
    [{ agentId: 'coding-assistant', message: 'hi', history: 'nope' }, 400, /Invalid history/],
    [{ agentId: 'coding-assistant', message: 'hi', history: [{ role: 'system', content: 'x' }] }, 400, /Invalid history/],
    [{ message: 'hi' }, 400, /Missing or invalid/],
    [{ agentId: 'nope', message: 'hi' }, 404, /Agent not found/],
    [{ workflowId: 'nope', message: 'hi' }, 404, /Workflow not found/],
    [{ agent: { name: '', systemPrompt: 'x' }, message: 'hi' }, 400, /Invalid agent/],
    [{ agent: { name: 'A', systemPrompt: 'x'.repeat(4001) }, message: 'hi' }, 400, /Invalid agent/],
    [{ agent: { name: 'A', systemPrompt: 'x', temperature: 3 }, message: 'hi' }, 400, /Invalid agent/]
  ])('rejects %j with %i', async (body, status, message) => {
    const r = await chat(s.url, body);
    expect(r.status).toBe(status);
    expect(r.json.error.message).toMatch(message);
  });

  it('rejects a malformed JSON body with a 400', async () => {
    const res = await fetch(`${s.url}/api/v1/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('chat in demo mode', () => {
  it('streams a labelled canned reply for a built-in agent and ends with done', async () => {
    const r = await chat(s.url, { agentId: 'sales-agent', message: 'hello' }, '/api/chat');
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/Sales & Lead Generator/);
    expect(r.text).toMatch(/Demo mode/);
    expect(r.text).toMatch(/Tools are not connected yet, so none were run/);
    expect(r.text).not.toMatch(/Status: Sent|Ticket #/); // the old fake tool results are gone
    expect(r.events.at(-1)).toEqual({ type: 'done', message: { role: 'assistant', content: r.text } });
  });

  it('accepts a custom agent', async () => {
    const r = await chat(s.url, { agent: { name: 'Pirate', systemPrompt: 'Talk like a pirate', temperature: 1, tools: ['web_search', 'rm_rf'] }, message: 'hi' });
    expect(r.text).toMatch(/I'm Pirate/);
    expect(r.text).toMatch(/`web_search`/);
    expect(r.text).not.toMatch(/rm_rf/); // unknown tools are dropped
  });

  it('runs a workflow: plan, each step active then complete, final answer streamed, done', async () => {
    const r = await chat(s.url, { workflowId: 'research', message: 'solid-state batteries' });
    const types = r.events.map(e => (e.type === 'step' ? `step:${e.id}:${e.status}` : e.type));
    expect(types[0]).toBe('plan');
    const plan = r.events[0] as Extract<typeof r.events[number], { type: 'plan' }>;
    expect(plan.steps.map(st => st.status)).toEqual(['pending', 'pending', 'pending']);
    expect(types.filter(t => t.startsWith('step:'))).toEqual([
      'step:gather:active', 'step:gather:complete', 'step:synthesize:active', 'step:synthesize:complete', 'step:review:active', 'step:review:complete'
    ]);
    expect(types).toContain('step_delta');
    expect(r.text).toMatch(/Deep Research Brief \(demo preview\)/);
    expect(types.at(-1)).toBe('done');
  });
});

describe('security headers and CORS', () => {
  it('sends a CSP, frame protection and nosniff, and no x-powered-by', async () => {
    const res = await fetch(`${s.url}/api/v1/health`);
    expect(res.headers.get('content-security-policy')).toMatch(/script-src 'self'/);
    expect(res.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('echoes a safe X-Request-Id and replaces an unsafe one', async () => {
    const ok = await fetch(`${s.url}/api/v1/health`, { headers: { 'X-Request-Id': 'abc-123' } });
    expect(ok.headers.get('x-request-id')).toBe('abc-123');
    const bad = await fetch(`${s.url}/api/v1/health`, { headers: { 'X-Request-Id': 'evil\u0001id' } }).catch(() => null);
    if (bad) expect(bad.headers.get('x-request-id')).not.toContain('evil');
    const weird = await fetch(`${s.url}/api/v1/health`, { headers: { 'X-Request-Id': 'a'.repeat(200) } });
    expect(weird.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('allows only listed origins', async () => {
    const app = await startApp({ CORS_ORIGINS: 'https://allowed.test' });
    try {
      const yes = await fetch(`${app.url}/api/v1/health`, { headers: { Origin: 'https://allowed.test' } });
      expect(yes.headers.get('access-control-allow-origin')).toBe('https://allowed.test');
      expect(yes.headers.get('access-control-allow-credentials')).toBe('true');
      const no = await fetch(`${app.url}/api/v1/health`, { headers: { Origin: 'https://evil.test' } });
      expect(no.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await app.close();
    }
  });
});

describe('rate limiting', () => {
  it('limits chat per IP and charges workflows for every step', async () => {
    const app = await startApp({ RATE_LIMIT_MAX: '4' });
    try {
      // a 3-step workflow costs 3 of the 4
      expect((await chat(app.url, { workflowId: 'brainstorm', message: 'x' })).status).toBe(200);
      expect((await chat(app.url, { agentId: 'translator', message: 'x' })).status).toBe(200);
      const limited = await chat(app.url, { agentId: 'translator', message: 'x' });
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBe('60');
      expect(limited.json.error.code).toBe('RATE_LIMITED');
    } finally {
      await app.close();
    }
  });

  it('refuses a workflow that would go over the limit without charging it', async () => {
    const app = await startApp({ RATE_LIMIT_MAX: '2' });
    try {
      expect((await chat(app.url, { workflowId: 'brainstorm', message: 'x' })).status).toBe(429);
      expect((await chat(app.url, { agentId: 'translator', message: 'x' })).status).toBe(200);
    } finally {
      await app.close();
    }
  });
});
