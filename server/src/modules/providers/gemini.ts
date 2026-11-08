import type { GeminiConfig } from '../../config/env.js';
import type { HistoryMessage } from '../../contracts.js';
import type { Logger } from '../../lib/logger.js';
import { sleep } from '../../lib/time.js';
import type { ChatAgent, ProviderAdapter } from './types.js';

// Temporary server trouble: retry the same model, then try the next one.
const RETRY_STATUSES = new Set([500, 502, 503, 504]);

type GeminiContent = { role: 'user' | 'model'; parts: [{ text: string }] };

/** The parts of a streamed Gemini chunk we read. */
interface GeminiChunk {
  error?: { message?: string };
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
}

/**
 * Gemini wants roles 'user' / 'model', starting with 'user'. Merge neighbours that share a role and drop any
 * leading model turns (history is capped, so it can start mid-conversation).
 */
export function toGeminiContents(messages: HistoryMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n\n${m.content}`;
    else contents.push({ role, parts: [{ text: m.content }] });
  }
  while (contents.length && contents[0].role !== 'user') contents.shift();
  return contents;
}

class TimeoutError extends Error {
  readonly timedOut = true;
}

/** fetch() that gives up if the response headers have not arrived within `ms`. After that only `signal` can cancel. */
async function fetchWithHeaderTimeout(url: string, init: RequestInit, signal: AbortSignal | undefined, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  if (signal?.aborted) ctrl.abort();
  else signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    throw timedOut ? new TimeoutError(`no response within ${ms}ms`) : err;
  } finally {
    clearTimeout(timer);
  }
}

/** reader.read() that fails (and cancels the stream) if nothing arrives for `ms`. */
function readWithIdleTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject BEFORE cancelling: cancel() resolves the pending read as "done", which would win the race and
      // make a stalled stream look like one that finished normally.
      reject(new Error(`Gemini stream stalled (no data for ${ms}ms)`));
      reader.cancel().catch(() => {});
    }, ms);
  });
  return Promise.race([reader.read(), stalled]).finally(() => clearTimeout(timer));
}

/**
 * Google Gemini, streamed, with retries and backup models. Opening the stream only ever happens before any
 * text reaches the user, so retrying and switching models is invisible to them. Rules:
 *   temporary errors (5xx, network)        -> retry the same model once, then try the next model
 *   no response within the timeout         -> try the next model at once (a hang means overload)
 *   429 (this model's quota / rate limit)  -> try the next model at once
 *   404 (model not available to this key)  -> try the next model straight away
 *   anything else (400, 401, 403, ...)     -> give up now; retrying or switching cannot help
 * Waits are bounded: each attempt must start responding within `timeoutMs`, opening a stream takes at most
 * `deadlineMs` in total, and an open stream that is silent for `idleMs` is cut off.
 */
export function createGeminiProvider(cfg: GeminiConfig & { apiKey: string }, log: Logger): ProviderAdapter {
  async function open(agent: ChatAgent, messages: HistoryMessage[], signal: AbortSignal): Promise<Response> {
    // The key goes in a header (never the URL) so it can't leak into request logs.
    const headers = { 'x-goog-api-key': cfg.apiKey, 'Content-Type': 'application/json' };
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: agent.systemPrompt }] },
      ...(agent.temperature != null && { generationConfig: { temperature: agent.temperature } }),
      contents: toGeminiContents(messages)
    });
    const startedAt = Date.now();
    let lastError: Error | null = null;

    for (const model of cfg.models) {
      for (let attempt = 1; attempt <= cfg.attemptsPerModel; attempt++) {
        if (signal.aborted) throw new Error('aborted');
        const remaining = cfg.deadlineMs - (Date.now() - startedAt);
        if (remaining <= 0) throw lastError ?? new Error('Gemini: out of time');
        const timeoutMs = Math.min(cfg.timeoutMs, remaining);
        const at = { model, attempt, of: cfg.attemptsPerModel };

        let res: Response;
        try {
          const url = `${cfg.baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
          res = await fetchWithHeaderTimeout(url, { method: 'POST', headers, body }, signal, timeoutMs);
        } catch (err) {
          if (signal.aborted) throw err;
          if (err instanceof TimeoutError) {
            lastError = new Error(`Gemini (${model}) gave no response within ${timeoutMs}ms`);
            log.warn(at, `gemini: no response within ${timeoutMs}ms, trying next model`);
            break; // don't wait on a model that is hanging; move to the next one
          }
          const message = err instanceof Error ? err.message : String(err);
          lastError = new Error(`Gemini (${model}) network error: ${message}`);
          log.warn(at, `gemini: network error ${message}`);
          if (attempt < cfg.attemptsPerModel) await sleep(cfg.retryDelayMs, signal);
          continue;
        }

        if (res.ok && res.body) {
          if (model !== cfg.model) log.warn({ model }, `gemini: ${cfg.model} unavailable, answered by backup model ${model}`);
          return res;
        }

        // Read Google's explanation, but never wait long for it.
        let bodyTimer: NodeJS.Timeout | undefined;
        const detail = await Promise.race([
          res.text().catch(() => ''),
          new Promise<string>(resolve => { bodyTimer = setTimeout(() => resolve(''), 2000); })
        ]);
        clearTimeout(bodyTimer);
        let reason: string = detail;
        try { reason = JSON.parse(detail).error?.message || detail; } catch { /* not JSON: use the raw text */ }
        reason = String(reason).replace(/\s+/g, ' ').slice(0, 200);
        lastError = new Error(`Gemini (${model}) responded ${res.status} ${reason}`);
        log.warn({ ...at, status: res.status }, `gemini: HTTP ${res.status} ${reason}`);
        if (RETRY_STATUSES.has(res.status)) {
          if (attempt < cfg.attemptsPerModel) await sleep(cfg.retryDelayMs, signal);
          continue;
        }
        if (res.status === 429 || res.status === 404) break; // quota hit / unknown model: next one
        throw lastError; // key / request problems are the same for every model
      }
    }
    throw lastError ?? new Error('Gemini unavailable');
  }

  return {
    id: 'gemini',
    model: cfg.model,
    async *stream(agent, messages, signal) {
      const res = await open(agent, messages, signal);
      let yielded = false;
      let blockReason: string | null = null;

      function* handleLines(lines: string[]): Generator<string> {
        for (const raw of lines) {
          const line = raw.replace(/\r$/, ''); // Gemini's SSE uses CRLF
          if (!line.startsWith('data:')) continue;
          let chunk: GeminiChunk;
          try { chunk = JSON.parse(line.slice(5).trim()) as GeminiChunk; } catch { continue; } // ignore malformed lines
          if (chunk.error) throw new Error(`Gemini error: ${String(chunk.error.message || '').slice(0, 200)}`);
          if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
          const text = (chunk.candidates?.[0]?.content?.parts ?? [])
            .filter(p => !p.thought) // never show the model's internal reasoning
            .map(p => p.text || '')
            .join('');
          if (text) { yielded = true; yield text; }
        }
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await readWithIdleTimeout(reader, cfg.idleMs);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        yield* handleLines(lines);
      }
      yield* handleLines([buffer]);
      if (!yielded) throw new Error(blockReason ? `Gemini blocked the prompt (${blockReason})` : 'Gemini returned no text');
    }
  };
}
