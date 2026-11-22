import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { createEmbedder, cosine, EmbeddingError } from '../src/modules/knowledge/embeddings.js';
import { chunkText, extractText } from '../src/modules/knowledge/extract.js';
import { assembleContext, type SearchHit } from '../src/modules/knowledge/memory.js';
import { cleanFileName } from '../src/modules/knowledge/routes.js';
import { attachmentHeader, createLocalStorage, createS3Storage, downloadType } from '../src/modules/storage/storage.js';
import { json, startUpstream } from './helpers.js';

const log = createLogger('silent');
const fixture = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/policy.pdf'));

describe('text extraction', () => {
  it('reads PDFs, text, Markdown, CSV and HTML', async () => {
    expect((await extractText(fixture, 'application/pdf', 'policy.pdf')).text).toContain('Hotel nights are capped at 180 euros');
    expect(await extractText(Buffer.from('\uFEFF# Notes\nhello'), 'text/markdown', 'notes.md')).toEqual({ text: '# Notes\nhello' });
    expect((await extractText(Buffer.from('a,b\n1,2'), 'application/octet-stream', 'data.csv')).text).toBe('a,b\n1,2');
    expect((await extractText(Buffer.from('<html><head><title>T</title><script>x()</script></head><body><p>Body text</p></body></html>'), 'text/html', 'p.html')).text).toBe('T\n\nBody text');
  });

  it('explains what it cannot read', async () => {
    expect(await extractText(Buffer.from('not a pdf'), 'application/pdf', 'x.pdf')).toEqual({ text: null, reason: 'The file is named as a PDF but is not one.' });
    expect((await extractText(Buffer.from('%PDF-1.4 broken'), 'application/pdf', 'x.pdf')).reason).toBe('The PDF could not be read.');
    expect((await extractText(Buffer.from([0x50, 0x00, 0x01]), 'text/plain', 'x.txt')).reason).toBe('The file looks binary, not text.');
    expect((await extractText(Buffer.from([1, 2, 3]), 'image/png', 'x.png')).reason).toContain('not extracted from this file type');
    expect((await extractText(Buffer.from('   '), 'text/plain', 'x.txt')).reason).toBe('The file is empty.');
  });

  it('chunks long text at paragraph and sentence boundaries with overlap', () => {
    expect(chunkText('short')).toEqual(['short']);
    expect(chunkText('   ')).toEqual([]);
    const paras = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ${'word '.repeat(40).trim()}.`).join('\n\n');
    const chunks = chunkText(paras, 600, 100);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(600);
    expect(chunks[0].startsWith('Paragraph 0.')).toBe(true);
    // consecutive chunks overlap, so a fact on a boundary is never cut in two without context
    expect(chunks[1].slice(0, 30)).not.toBe('');
    const joined = chunks.join(' ');
    for (let i = 0; i < 12; i++) expect(joined).toContain(`Paragraph ${i}.`);
    const noBreaks = chunkText('x'.repeat(2500), 1000, 100);
    expect(noBreaks.every(c => c.length <= 1000)).toBe(true);
  });
});

describe('embeddings', () => {
  let upstream: Awaited<ReturnType<typeof startUpstream>>;
  beforeAll(async () => {
    upstream = await startUpstream([(req, body, res) => {
      const b = JSON.parse(body);
      if (req.url?.endsWith('/embeddings')) {
        if (b.input.includes('FAIL')) return json(res, 429, { error: { message: 'rate limited' } });
        // answer out of order to prove results are re-sorted by index
        return json(res, 200, { data: b.input.map((_: string, i: number) => ({ index: i, embedding: [i, 1] })).reverse(), usage: { prompt_tokens: b.input.length * 3 } });
      }
      return json(res, 200, { embeddings: b.requests.map((r: { content: { parts: Array<{ text: string }> } }) => ({ values: [r.content.parts[0].text.length, 0] })) });
    }]);
  });
  afterAll(async () => { await upstream?.close(); });

  it('uses OpenAI\'s embeddings API in batches and keeps the input order', async () => {
    const e = createEmbedder(loadConfig({ NODE_ENV: 'test', OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: upstream.url }), log)!;
    expect(e).toMatchObject({ provider: 'openai', model: 'text-embedding-3-small' });
    upstream.calls.length = 0;
    const texts = Array.from({ length: 70 }, (_, i) => `t${i}`);
    const r = await e.embed(texts);
    expect(upstream.calls).toHaveLength(2); // 64 + 6
    expect(JSON.parse(upstream.calls[0].body)).toMatchObject({ model: 'text-embedding-3-small', input: texts.slice(0, 64) });
    expect(upstream.calls[0].headers.authorization).toBe('Bearer sk-test');
    expect(r.vectors[0]).toEqual([0, 1]);
    expect(r.vectors[65]).toEqual([1, 1]);
    expect(r.tokens).toBe(210);
    await expect(e.embed(['FAIL'])).rejects.toThrow(EmbeddingError);
  });

  it('uses Gemini\'s batchEmbedContents with 768 dimensions', async () => {
    const e = createEmbedder(loadConfig({ NODE_ENV: 'test', GEMINI_API_KEY: 'g-key', GEMINI_BASE_URL: upstream.url }), log)!;
    expect(e).toMatchObject({ provider: 'gemini', model: 'gemini-embedding-001' });
    upstream.calls.length = 0;
    const r = await e.embed(['abc', 'hello']);
    expect(upstream.calls[0].url).toBe('/models/gemini-embedding-001:batchEmbedContents');
    expect(upstream.calls[0].headers['x-goog-api-key']).toBe('g-key');
    expect(JSON.parse(upstream.calls[0].body).requests[0]).toEqual({ model: 'models/gemini-embedding-001', content: { parts: [{ text: 'abc' }] }, outputDimensionality: 768 });
    expect(r).toEqual({ vectors: [[3, 0], [5, 0]], tokens: null });
  });

  it('is off without a key or when disabled, and computes cosine similarity', () => {
    expect(createEmbedder(loadConfig({ NODE_ENV: 'test' }), log)).toBeNull();
    expect(createEmbedder(loadConfig({ NODE_ENV: 'test', OPENAI_API_KEY: 'k', EMBEDDING_PROVIDER: 'none' }), log)).toBeNull();
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 0], [1, 0, 0])).toBe(0);
  });
});

describe('storage', () => {
  it('keeps local files inside the storage directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-store-'));
    const s = createLocalStorage(dir);
    await s.put('ws/w1/p/p1/f1', Buffer.from('hi'), 'text/plain');
    expect((await s.get('ws/w1/p/p1/f1')).toString()).toBe('hi');
    expect(await s.signedDownloadUrl('ws/w1/p/p1/f1', { filename: 'a', mime: 'text/plain', expiresIn: 60 })).toBeNull();
    for (const bad of ['../etc/passwd', '/abs', 'a/../../b', 'a b', 'x\\y']) await expect(s.put(bad, Buffer.from(''), 'x')).rejects.toThrow('invalid storage key');
    await s.delete('ws/w1/p/p1/f1');
    await expect(s.get('ws/w1/p/p1/f1')).rejects.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('talks to S3-compatible storage (R2) with signed requests and presigned downloads', async () => {
    // A stand-in for an S3 endpoint: records requests and keeps objects in memory (signatures are not verified here).
    const objects = new Map<string, Buffer>();
    const seen: Array<{ method: string; url: string; auth: string }> = [];
    const fake = await startUpstream([(req, body, res) => {
      seen.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization ?? '') });
      const key = decodeURIComponent(req.url!.split('?')[0]);
      if (req.method === 'PUT') { objects.set(key, Buffer.from(body, 'latin1')); res.writeHead(200, { ETag: '"x"' }); return res.end(); }
      if (req.method === 'GET' && objects.has(key)) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(objects.get(key)); }
      if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
      res.writeHead(404); res.end('<Error><Code>NoSuchKey</Code></Error>');
    }]);
    try {
      const s3 = createS3Storage({ bucket: 'files', endpoint: fake.url, region: 'auto', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', forcePathStyle: true });
      await s3.put('ws/w1/p/p1/f1', Buffer.from('hello'), 'text/plain');
      expect(seen[0]).toMatchObject({ method: 'PUT', url: '/files/ws/w1/p/p1/f1?x-id=PutObject' });
      expect(seen[0].auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/);
      expect((await s3.get('ws/w1/p/p1/f1')).toString()).toBe('hello');
      const url = new URL((await s3.signedDownloadUrl('ws/w1/p/p1/f1', { filename: 'a b.txt', mime: 'text/plain', expiresIn: 300 }))!);
      expect(url.pathname).toBe('/files/ws/w1/p/p1/f1');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(url.searchParams.get('response-content-disposition')).toBe(attachmentHeader('a b.txt'));
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      await s3.delete('ws/w1/p/p1/f1');
      await expect(s3.get('ws/w1/p/p1/f1')).rejects.toThrow();
      await expect(s3.put('../x', Buffer.from(''), 'x')).rejects.toThrow('invalid storage key');
    } finally { await fake.close(); }
  });

  it('builds safe download headers and file names', () => {
    expect(attachmentHeader('Résumé "final".pdf')).toBe('attachment; filename="R_sum_ _final_.pdf"; filename*=UTF-8\'\'R%C3%A9sum%C3%A9%20%22final%22.pdf');
    expect(downloadType('text/html')).toBe('application/octet-stream');
    expect(downloadType('application/pdf')).toBe('application/pdf');
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('C:\\Users\\a\\report\u0000.pdf')).toBe('report.pdf');
    expect(cleanFileName('..')).toBe('file');
  });
});

describe('context assembly', () => {
  const hit = (i: number, content: string): SearchHit => ({ id: `m${i}`, title: `Doc ${i}`, content, scope: 'PROJECT', source: 'FILE', projectId: 'p', fileId: 'f', agentKey: null, chunkIndex: i, score: 0.9, match: 'both' });
  it('labels sources [K1]… and stays within the character budget', () => {
    const { text, sources } = assembleContext([hit(0, 'a'.repeat(1000)), hit(1, 'b'.repeat(1000)), hit(2, 'c'.repeat(5000)), hit(3, 'd')], 2500);
    // The third passage is cut to the remaining room; nothing more fits after it.
    expect(sources.map(s => s.ref)).toEqual(['K1', 'K2', 'K3']);
    expect(text).toMatch(/c…$/);
    expect(text.startsWith('[K1] Doc 0 (file, part 1, project memory)\n')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(2500);
    expect(assembleContext([], 1000)).toEqual({ text: '', sources: [] });
  });
});
