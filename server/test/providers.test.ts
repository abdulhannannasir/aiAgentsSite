import { afterEach, describe, expect, it } from 'vitest';
import { toGeminiContents } from '../src/modules/providers/gemini.js';
import { chat, geminiChunk, json, openaiChunk, sse, startApp, startUpstream, type TestServer } from './helpers.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function setup(handlers: Parameters<typeof startUpstream>[0], env: (upstreamUrl: string) => Record<string, string>) {
  const upstream = await startUpstream(handlers);
  const app: TestServer = await startApp(env(upstream.url));
  cleanups.push(upstream.close, app.close);
  return { upstream, app };
}

const geminiEnv = (url: string, extra: Record<string, string> = {}) => ({
  GEMINI_API_KEY: 'g-key', GEMINI_BASE_URL: url, GEMINI_MODEL: 'main', GEMINI_FALLBACK_MODELS: 'backup',
  GEMINI_RETRY_DELAY_MS: '0', ...extra
});

describe('OpenAI provider', () => {
  it('streams tokens and sends the agent prompt, model, temperature and history', async () => {
    const { upstream, app } = await setup(
      [(_req, _body, res) => sse(res, [openaiChunk('Hello'), openaiChunk(' world'), { choices: [{ delta: {} }] }], { done: '[DONE]' })],
      url => ({ OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: url, OPENAI_MODEL: 'gpt-test' })
    );
    const r = await chat(app.url, {
      agent: { name: 'Tester', systemPrompt: 'Be brief', temperature: 0.2 },
      message: 'hi', history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'reply' }]
    });
    expect(r.text).toBe('Hello world');
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0].url).toBe('/chat/completions');
    expect(upstream.calls[0].headers.authorization).toBe('Bearer sk-test');
    expect(JSON.parse(upstream.calls[0].body)).toEqual({
      model: 'gpt-test', stream: true, stream_options: { include_usage: true }, temperature: 0.2,
      messages: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'earlier' }, { role: 'assistant', content: 'reply' }, { role: 'user', content: 'hi' }]
    });
  });

  it('reports a provider failure honestly in live mode (no canned demo text), with a user-safe reason', async () => {
    const { app } = await setup([(_req, _body, res) => json(res, 401, { error: { message: 'bad key sk-secret' } })], url => ({ OPENAI_API_KEY: 'sk-bad', OPENAI_BASE_URL: url }));
    const r = await chat(app.url, { agentId: 'translator', message: 'hi' });
    expect(r.text).toBe('');
    const err = r.events.find(e => e.type === 'error') as { content: string };
    expect(err.content).toMatch(/rejected the server's credentials/);
    expect(err.content).not.toMatch(/sk-secret|401/); // provider details stay in the logs
    expect(r.events.at(-1)).toEqual({ type: 'done', message: null });
  });

  it('fails a workflow step honestly instead of inventing output', async () => {
    let n = 0;
    const { app } = await setup([(_req, _body, res) => {
      n++;
      if (n === 1) return sse(res, [openaiChunk('research notes')], { done: '[DONE]' });
      return json(res, 500, { error: 'boom' });
    }], url => ({ OPENAI_API_KEY: 'sk', OPENAI_BASE_URL: url }));
    const r = await chat(app.url, { workflowId: 'research', message: 'topic' });
    const steps = r.events.filter(e => e.type === 'step').map(e => `${(e as { id: string }).id}:${(e as { status: string }).status}`);
    expect(steps).toEqual(['gather:active', 'gather:complete', 'synthesize:active', 'synthesize:error']);
    expect(r.events.find(e => e.type === 'error')).toMatchObject({ content: expect.stringMatching(/Synthesizer step failed/) });
    expect(r.text).toBe('');
    expect(r.events.at(-1)).toEqual({ type: 'done', message: null });
  });

  it('passes earlier step outputs to later steps', async () => {
    const outputs = ['FACTS-1', 'DRAFT-2', 'FINAL-3'];
    let n = 0;
    const { upstream, app } = await setup([(_req, _body, res) => sse(res, [openaiChunk(outputs[n++])], { done: '[DONE]' })], url => ({ OPENAI_API_KEY: 'sk', OPENAI_BASE_URL: url }));
    const r = await chat(app.url, { workflowId: 'research', message: 'my topic' });
    expect(r.text).toBe('FINAL-3');
    const prompts = upstream.calls.map(c => JSON.parse(c.body).messages);
    expect(prompts[2][1].content).toMatch(/my topic[\s\S]*FACTS-1[\s\S]*DRAFT-2/);
    expect(prompts[1][0].content).toMatch(/You are working as the Synthesizer/);
    expect(JSON.parse(upstream.calls[0].body)).not.toHaveProperty('temperature');
  });
});

describe('Gemini provider', () => {
  it('streams text, hides thought parts, handles CRLF and sends the key in a header', async () => {
    const { upstream, app } = await setup([(_req, _body, res) => sse(res, [
      { candidates: [{ content: { parts: [{ text: 'secret reasoning', thought: true }] } }] },
      geminiChunk('Hi'), geminiChunk(' there')
    ], { crlf: true })], url => geminiEnv(url));
    const r = await chat(app.url, { agentId: 'translator', message: 'hello' });
    expect(r.text).toBe('Hi there');
    expect(upstream.calls[0].url).toBe('/models/main:streamGenerateContent?alt=sse');
    expect(upstream.calls[0].headers['x-goog-api-key']).toBe('g-key');
    expect(upstream.calls[0].url).not.toContain('g-key');
  });

  it('retries a 503 once on the same model, then succeeds', async () => {
    const { upstream, app } = await setup([
      (_req, _body, res) => json(res, 503, { error: { message: 'high demand' } }),
      (_req, _body, res) => sse(res, [geminiChunk('ok')])
    ], url => geminiEnv(url));
    expect((await chat(app.url, { agentId: 'translator', message: 'x' })).text).toBe('ok');
    expect(upstream.calls.map(c => c.url)).toEqual(['/models/main:streamGenerateContent?alt=sse', '/models/main:streamGenerateContent?alt=sse']);
  });

  it('skips straight to the backup model on 429 and 404', async () => {
    for (const status of [429, 404]) {
      const { upstream, app } = await setup([
        (_req, _body, res) => json(res, status, { error: { message: 'nope' } }),
        (_req, _body, res) => sse(res, [geminiChunk('from backup')])
      ], url => geminiEnv(url));
      expect((await chat(app.url, { agentId: 'translator', message: 'x' })).text).toBe('from backup');
      expect(upstream.calls.map(c => c.url.split(':')[0])).toEqual(['/models/main', '/models/backup']);
    }
  });

  it('gives up immediately on 400/401/403 (no other model could fix it)', async () => {
    const { upstream, app } = await setup([(_req, _body, res) => json(res, 403, { error: { message: 'forbidden' } })], url => geminiEnv(url));
    const r = await chat(app.url, { workflowId: 'brainstorm', message: 'x' });
    expect(upstream.calls).toHaveLength(1);
    expect(r.events.some(e => e.type === 'error')).toBe(true);
  });

  it('moves to the next model when one hangs past the timeout', async () => {
    const { upstream, app } = await setup([
      () => { /* never answers */ },
      (_req, _body, res) => sse(res, [geminiChunk('fast backup')])
    ], url => geminiEnv(url, { GEMINI_TIMEOUT_MS: '200', GEMINI_DEADLINE_MS: '3000' }));
    const started = Date.now();
    expect((await chat(app.url, { agentId: 'translator', message: 'x' })).text).toBe('fast backup');
    expect(Date.now() - started).toBeLessThan(2500);
    expect(upstream.calls).toHaveLength(2);
  });

  it('reports a blocked prompt as a failure, not an empty answer', async () => {
    const { app } = await setup([(_req, _body, res) => sse(res, [{ promptFeedback: { blockReason: 'SAFETY' } }])], url => geminiEnv(url));
    const r = await chat(app.url, { workflowId: 'brainstorm', message: 'x' });
    expect(r.events.find(e => e.type === 'step' && e.status === 'error')).toBeTruthy();
  });
});

describe('toGeminiContents', () => {
  it('maps roles, merges neighbours and drops leading model turns', () => {
    expect(toGeminiContents([
      { role: 'assistant', content: 'stray' },
      { role: 'user', content: 'a' }, { role: 'user', content: 'b' },
      { role: 'assistant', content: 'c' }
    ])).toEqual([
      { role: 'user', parts: [{ text: 'a\n\nb' }] },
      { role: 'model', parts: [{ text: 'c' }] }
    ]);
  });
});
