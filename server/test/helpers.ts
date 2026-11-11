import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import type { ChatEvent } from '../src/contracts.js';

export interface TestServer {
  url: string;
  ctx: AppContext;
  close: () => Promise<void>;
}

/** Starts the app on a random port with a clean env plus `env` overrides (no keys = demo mode). */
export async function startApp(env: Record<string, string> = {}): Promise<TestServer> {
  const cfg = loadConfig({ NODE_ENV: 'test', ...env });
  const ctx = createApp(cfg, { demoDelay: () => 0, staticDir: null });
  const server = ctx.app.listen(0);
  await new Promise(r => server.once('listening', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    ctx,
    close: () => new Promise(r => { server.closeAllConnections(); server.close(() => { void ctx.close().then(() => r()); }); })
  };
}

export type UpstreamHandler = (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void | Promise<void>;

/** A fake model API. Each request is recorded and answered by the next handler in `handlers` (the last repeats). */
export async function startUpstream(handlers: UpstreamHandler[]) {
  const calls: Array<{ url: string; headers: http.IncomingHttpHeaders; body: string }> = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ url: req.url ?? '', headers: req.headers, body });
    const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)];
    await handler(req, body, res);
  });
  server.listen(0);
  await new Promise(r => server.once('listening', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); })
  };
}

export const sse = (res: http.ServerResponse, events: unknown[], { crlf = false, done }: { crlf?: boolean; done?: string } = {}) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const nl = crlf ? '\r\n' : '\n';
  for (const e of events) res.write(`data: ${JSON.stringify(e)}${nl}${nl}`);
  if (done) res.write(`data: ${done}${nl}${nl}`);
  res.end();
};

export const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

export const geminiChunk = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });
export const openaiChunk = (content: string) => ({ choices: [{ delta: { content } }] });

/** POSTs to the chat endpoint and collects every SSE event. */
export async function chat(url: string, body: unknown, path = '/api/v1/chat') {
  const res = await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    return { status: res.status, headers: res.headers, json: JSON.parse(text), events: [] as ChatEvent[], text: '' };
  }
  const events = text.split('\n\n').filter(Boolean).map(block => JSON.parse(block.replace(/^data: /, '')) as ChatEvent);
  const answer = events.filter(e => e.type === 'stream').map(e => (e as { content: string }).content).join('');
  return { status: res.status, headers: res.headers, json: null, events, text: answer };
}
