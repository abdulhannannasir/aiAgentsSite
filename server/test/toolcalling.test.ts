import { afterEach, describe, expect, it } from 'vitest';
import { chat, geminiChunk, json, openaiChunk, sse, startApp, startUpstream, type TestServer } from './helpers.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function setup(handlers: Parameters<typeof startUpstream>[0], env: (url: string) => Record<string, string>) {
  const upstream = await startUpstream(handlers);
  const app: TestServer = await startApp(env(upstream.url));
  cleanups.push(upstream.close, app.close);
  return { upstream, app };
}

const openaiToolCall = (id: string, name: string, args: string) => [
  { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args.slice(0, 5) } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] } }] },
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  { choices: [], usage: { prompt_tokens: 50, completion_tokens: 7 } }
];
const env = (url: string) => ({ OPENAI_API_KEY: 'sk', OPENAI_BASE_URL: url, OPENAI_MODEL: 'gpt-test' });
// The Personal Productivity Assistant may use the calculator and the clock.
const ask = (app: TestServer, message: string) => chat(app.url, { agentId: 'personal-assistant', message });

describe('tool calling (OpenAI)', () => {
  it('runs a permitted tool, sends the result back, streams the final answer and meters both calls', async () => {
    const { upstream, app } = await setup([
      (_q, _b, res) => sse(res, openaiToolCall('call_1', 'calculator', '{"expression":"1200*0.15"}'), { done: '[DONE]' }),
      (_q, _b, res) => sse(res, [openaiChunk('It is 180.'), { choices: [], usage: { prompt_tokens: 80, completion_tokens: 5 } }], { done: '[DONE]' })
    ], env);
    const r = await ask(app, 'What is 15% of 1200?');
    expect(r.text).toBe('It is 180.');
    const tools = r.events.filter(e => e.type === 'tool');
    expect(tools).toEqual([
      { type: 'tool', id: 'call_1', tool: 'calculator', label: 'Calculator', status: 'running', input: { expression: '1200*0.15' } },
      expect.objectContaining({ type: 'tool', id: 'call_1', tool: 'calculator', status: 'done', summary: '1200*0.15 = 180' })
    ]);
    const first = JSON.parse(upstream.calls[0].body);
    expect(first.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(['current_time', 'calculator']);
    const second = JSON.parse(upstream.calls[1].body).messages;
    expect(second.at(-2)).toEqual({ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'calculator', arguments: '{"expression":"1200*0.15"}' } }] });
    expect(second.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '1200*0.15 = 180' });
  });

  it('refuses a tool the agent is not permitted to use and tells the model so', async () => {
    const { upstream, app } = await setup([
      (_q, _b, res) => sse(res, openaiToolCall('call_x', 'email_sender', '{"to":"a@b.c"}'), { done: '[DONE]' }),
      (_q, _b, res) => sse(res, [openaiChunk('I cannot send email.')], { done: '[DONE]' })
    ], env);
    const r = await ask(app, 'Email my boss');
    expect(r.events.filter(e => e.type === 'tool').at(-1)).toMatchObject({ tool: 'email_sender', status: 'error', summary: 'Not permitted for this agent.' });
    expect(JSON.parse(upstream.calls[1].body).messages.at(-1).content).toMatch(/not available to this agent/);
    expect(r.text).toBe('I cannot send email.');
  });

  it('a tool error goes back to the model instead of breaking the reply', async () => {
    const { upstream, app } = await setup([
      (_q, _b, res) => sse(res, openaiToolCall('c', 'calculator', '{"expression":"1/0"}'), { done: '[DONE]' }),
      (_q, _b, res) => sse(res, [openaiChunk('Division by zero is undefined.')], { done: '[DONE]' })
    ], env);
    const r = await ask(app, '1/0?');
    expect(r.events.filter(e => e.type === 'tool').at(-1)).toMatchObject({ status: 'error', summary: 'Division by zero.' });
    expect(JSON.parse(upstream.calls[1].body).messages.at(-1).content).toBe('Error: Division by zero.');
    expect(r.text).toMatch(/undefined/);
  });

  it('stops offering tools after four rounds so the model must answer', async () => {
    let n = 0;
    const { upstream, app } = await setup([(_q, _b, res) => {
      n++;
      if (n <= 4) return sse(res, openaiToolCall(`c${n}`, 'current_time', '{"timezone":"UTC"}'), { done: '[DONE]' });
      return sse(res, [openaiChunk('Done.')], { done: '[DONE]' });
    }], env);
    const r = await ask(app, 'loop');
    expect(r.text).toBe('Done.');
    expect(upstream.calls).toHaveLength(5);
    expect(JSON.parse(upstream.calls[3].body).tools).toBeDefined();
    expect(JSON.parse(upstream.calls[4].body).tools).toBeUndefined();
  });

  it('counts every extra model call against the rate limit', async () => {
    const { upstream, app } = await setup([(_q, _b, res) => sse(res, openaiToolCall('c', 'current_time', '{}'), { done: '[DONE]' })],
      url => ({ ...env(url), RATE_LIMIT_MAX: '2' }));
    const r = await ask(app, 'x');
    expect(upstream.calls).toHaveLength(2); // the request itself + one extra call; the third is refused
    expect(r.events.find(e => e.type === 'error')).toMatchObject({ content: expect.stringMatching(/usage limit/) });
  });

  it('agents without tool permissions are not offered tools', async () => {
    const { upstream, app } = await setup([(_q, _b, res) => sse(res, [openaiChunk('Hola')], { done: '[DONE]' })], env);
    await chat(app.url, { agentId: 'translator', message: 'hi' });
    expect(JSON.parse(upstream.calls[0].body).tools).toBeUndefined();
    expect(JSON.parse(upstream.calls[0].body).messages[0].content).not.toMatch(/You can call tools/);
  });
});

describe('tool calling (Gemini)', () => {
  it('sends functionDeclarations, returns functionResponse in a user turn and echoes the thought signature', async () => {
    const { upstream, app } = await setup([
      (_q, _b, res) => sse(res, [{ candidates: [{ content: { parts: [{ functionCall: { name: 'calculator', args: { expression: '2+2' } }, thoughtSignature: 'sig-abc' }] } }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 4, thoughtsTokenCount: 6 } }]),
      (_q, _b, res) => sse(res, [geminiChunk('Four.'), { usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 2 } }])
    ], url => ({ GEMINI_API_KEY: 'g', GEMINI_BASE_URL: url, GEMINI_MODEL: 'main', GEMINI_FALLBACK_MODELS: '', GEMINI_RETRY_DELAY_MS: '0' }));
    const r = await ask(app, '2+2?');
    expect(r.text).toBe('Four.');
    const first = JSON.parse(upstream.calls[0].body);
    expect(first.tools[0].functionDeclarations.map((d: { name: string }) => d.name)).toEqual(['current_time', 'calculator']);
    const contents = JSON.parse(upstream.calls[1].body).contents;
    expect(contents.at(-2)).toEqual({ role: 'model', parts: [{ functionCall: { name: 'calculator', args: { expression: '2+2' } }, thoughtSignature: 'sig-abc' }] });
    expect(contents.at(-1)).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'calculator', response: { result: '2+2 = 4' } } }] });
  });
});

describe('what can run here', () => {
  it('GET /models lists only configured providers\' allowed models; GET /tools lists every tool honestly', async () => {
    const app = await startApp({ OPENAI_API_KEY: 'sk', OPENAI_MODEL: 'gpt-a', OPENAI_MODELS: 'gpt-a, gpt-b' });
    cleanups.push(app.close);
    const models = await (await fetch(`${app.url}/api/v1/models`)).json();
    expect(models.default).toEqual({ provider: 'openai', model: 'gpt-a' });
    expect(models.providers.find((p: { id: string }) => p.id === 'openai').models.map((m: { id: string; isDefault: boolean }) => [m.id, m.isDefault])).toEqual([['gpt-a', true], ['gpt-b', false]]);
    expect(models.providers.find((p: { id: string }) => p.id === 'gemini')).toMatchObject({ configured: false, models: [] });
    const tools = await (await fetch(`${app.url}/api/v1/tools`)).json();
    expect(tools.filter((t: { available: boolean }) => t.available).map((t: { id: string }) => t.id)).toEqual(['url_fetch', 'calculator', 'current_time']);
  });

  it('demo mode lists no models', async () => {
    const app = await startApp();
    cleanups.push(app.close);
    expect(await (await fetch(`${app.url}/api/v1/models`)).json()).toMatchObject({ default: null });
    void json;
  });
});
