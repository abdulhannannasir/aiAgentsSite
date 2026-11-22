import type { AppConfig } from '../../config/env.js';
import type { Logger } from '../../lib/logger.js';

export interface EmbeddingResult { vectors: number[][]; tokens: number | null }

/** Turns text into vectors for semantic search. One model per deployment; records remember which model made them. */
export interface Embedder {
  readonly provider: 'openai' | 'gemini';
  readonly model: string;
  embed(texts: string[], signal?: AbortSignal): Promise<EmbeddingResult>;
}

export class EmbeddingError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

const BATCH = 64;
/** Gemini embeddings are asked for 768 dimensions (its default is larger); OpenAI's small model gives 1536. */
export const GEMINI_DIMENSIONS = 768;
const MAX_INPUT_CHARS = 8000;

async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(30_000);
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (err) {
    throw new EmbeddingError(timeout.aborted ? 'The embedding service timed out.' : `Could not reach the embedding service (${err instanceof Error ? err.message : 'network error'}).`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new EmbeddingError(`The embedding service answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`, res.status);
  }
  return res.json();
}

export function createEmbedder(cfg: AppConfig, log: Logger): Embedder | null {
  const e = cfg.embeddings;
  if (!e.provider || !e.apiKey || !e.model || !e.baseUrl) return null;
  const { apiKey, model, baseUrl } = e;

  if (e.provider === 'openai') {
    return {
      provider: 'openai', model,
      async embed(texts, signal) {
        const vectors: number[][] = [];
        let tokens: number | null = null;
        for (let i = 0; i < texts.length; i += BATCH) {
          const batch = texts.slice(i, i + BATCH).map(t => t.slice(0, MAX_INPUT_CHARS));
          const data = await post(`${baseUrl}/embeddings`, { Authorization: `Bearer ${apiKey}` }, { model, input: batch }, signal) as
            { data?: Array<{ index: number; embedding: number[] }>; usage?: { prompt_tokens?: number } };
          if (!Array.isArray(data.data) || data.data.length !== batch.length) throw new EmbeddingError('The embedding service returned an unexpected answer.');
          for (const d of [...data.data].sort((a, b) => a.index - b.index)) vectors.push(d.embedding);
          if (typeof data.usage?.prompt_tokens === 'number') tokens = (tokens ?? 0) + data.usage.prompt_tokens;
        }
        log.debug({ model, n: texts.length }, 'embedded');
        return { vectors, tokens };
      }
    };
  }

  return {
    provider: 'gemini', model,
    async embed(texts, signal) {
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH).map(t => t.slice(0, MAX_INPUT_CHARS));
        const data = await post(`${baseUrl}/models/${encodeURIComponent(model)}:batchEmbedContents`, { 'x-goog-api-key': apiKey }, {
          requests: batch.map(t => ({ model: `models/${model}`, content: { parts: [{ text: t }] }, outputDimensionality: GEMINI_DIMENSIONS }))
        }, signal) as { embeddings?: Array<{ values: number[] }> };
        if (!Array.isArray(data.embeddings) || data.embeddings.length !== batch.length) throw new EmbeddingError('The embedding service returned an unexpected answer.');
        for (const d of data.embeddings) vectors.push(d.values);
      }
      // Gemini's embedding API does not report token counts.
      return { vectors, tokens: null };
    }
  };
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
