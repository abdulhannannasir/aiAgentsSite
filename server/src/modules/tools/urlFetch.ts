import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { z } from 'zod';
import { ToolError, type ToolDefinition } from './types.js';

const MAX_BYTES = 2_000_000;   // read at most this much of a response
const MAX_CHARS = 12_000;      // and give the model at most this much text
const MAX_REDIRECTS = 4;

/** Addresses a server-side fetch must never reach: private, loopback, link-local, metadata, reserved, multicast. */
const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const) BLOCKED.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
] as const) BLOCKED.addSubnet(addr, prefix, 'ipv6');

/** True for addresses that must not be fetched (including IPv4 addresses embedded in IPv6). */
export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isBlockedAddress(mapped[1]);
  const family = net.isIP(address);
  if (!family) return true; // not an IP at all: refuse
  return BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Checks a URL before any connection: scheme, port, credentials and IP-literal hosts. */
export function checkUrl(raw: string, allowPrivate = false): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ToolError('That is not a valid URL.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ToolError('Only http and https URLs can be fetched.');
  if (url.username || url.password) throw new ToolError('URLs with credentials are not allowed.');
  if (url.port && url.port !== '80' && url.port !== '443' && !allowPrivate) throw new ToolError('Only the standard ports (80 and 443) are allowed.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || (net.isIP(host) && isBlockedAddress(host)))) {
    throw new ToolError('That address is private or reserved and cannot be fetched.');
  }
  return url;
}

/**
 * DNS lookup used at connection time: every address the name resolves to must be public. Checking here (and not
 * just before the request) closes the DNS-rebinding gap between "check" and "connect".
 */
export function guardedLookup(hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some(a => isBlockedAddress(a.address))) {
      return callback(Object.assign(new Error(`${hostname} resolves to a private or reserved address`), { code: 'EBLOCKED' }));
    }
    if (options.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

/** Turns HTML into readable text: drops scripts/styles/nav chrome, keeps paragraph breaks, decodes common entities. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  const text = html
    .replace(/<(head|title|script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; })
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

export interface UrlFetchOptions {
  /** Tests only: allow private addresses (the local mock server). Never set in production. */
  allowPrivateNetwork?: boolean;
}

export function createUrlFetchTool(opts: UrlFetchOptions = {}): ToolDefinition<{ url: string }> {
  const dispatcher = new Agent({
    connect: opts.allowPrivateNetwork ? {} : { lookup: guardedLookup as never },
    headersTimeout: 10_000,
    bodyTimeout: 10_000
  });

  return {
    id: 'url_fetch',
    label: 'Read a web page',
    description: 'Fetches a public web page or text/JSON document by URL and returns its readable text (up to about 12,000 characters). Use it when the user gives a link or when you need the current content of a known page.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full http(s) URL' } }, required: ['url'] },
    input: z.object({ url: z.string().min(1).max(2000) }),
    timeoutMs: 15_000,
    untrustedOutput: true,
    availability: { available: true },
    async run({ url: raw }, ctx) {
      let url = checkUrl(raw, opts.allowPrivateNetwork);
      for (let hop = 0; ; hop++) {
        let res;
        try {
          res = await undiciFetch(url, {
            dispatcher, redirect: 'manual', signal: ctx.signal,
            headers: { 'User-Agent': 'AgentVerseBot/1.0 (+url_fetch tool)', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1' }
          });
        } catch (err) {
          const cause = (err as { cause?: { code?: string; message?: string } }).cause;
          if (cause?.code === 'EBLOCKED') throw new ToolError('That address is private or reserved and cannot be fetched.');
          if (ctx.signal.aborted) throw new ToolError('The fetch was stopped.');
          throw new ToolError(`Could not reach ${url.hostname}${cause?.code ? ` (${cause.code})` : ''}.`);
        }
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          await res.body?.cancel().catch(() => {});
          if (hop >= MAX_REDIRECTS) throw new ToolError('Too many redirects.');
          url = checkUrl(new URL(res.headers.get('location')!, url).toString(), opts.allowPrivateNetwork);
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          throw new ToolError(`${url.hostname} answered HTTP ${res.status}.`);
        }
        const type = (res.headers.get('content-type') ?? '').toLowerCase();
        const isHtml = type.includes('text/html') || type.includes('application/xhtml');
        if (!isHtml && !type.startsWith('text/') && !type.includes('json') && !type.includes('xml')) {
          await res.body?.cancel().catch(() => {});
          throw new ToolError(`Unsupported content type "${type || 'unknown'}"; only web pages and text can be read.`);
        }
        // Read at most MAX_BYTES, then stop the download.
        const reader = res.body!.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (size < MAX_BYTES) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
          size += value.byteLength;
        }
        await reader.cancel().catch(() => {});
        const body = new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES));
        const { title, text } = isHtml ? htmlToText(body) : { title: '', text: body.trim() };
        const clipped = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[… truncated, ${text.length - MAX_CHARS} more characters]` : text;
        ctx.log.info({ tool: 'url_fetch', host: url.hostname, bytes: size }, 'tool fetched a page');
        return `${title ? `Title: ${title}\n` : ''}URL: ${url.toString()}\n\n${clipped || '(no readable text)'}`;
      }
    }
  };
}
