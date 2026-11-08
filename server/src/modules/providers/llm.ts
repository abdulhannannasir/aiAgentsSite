import type { AppConfig } from '../../config/env.js';
import type { HistoryMessage, ProviderId } from '../../contracts.js';
import type { Logger } from '../../lib/logger.js';
import { buildDemoResponse, streamDemoText } from './demo.js';
import { createGeminiProvider } from './gemini.js';
import { createOpenAIProvider } from './openai.js';
import type { ChatAgent, ProviderAdapter } from './types.js';

export interface LLMService {
  /** The provider answering chat on this deployment ('demo' when no key is configured). */
  readonly provider: ProviderId;
  readonly model: string | null;
  /**
   * Streams a reply. With `strict`, a provider failure is thrown instead of being replaced by the demo reply,
   * so callers that need real output (workflow steps) can report the failure honestly.
   */
  complete(agent: ChatAgent, messages: HistoryMessage[], signal: AbortSignal, opts?: { strict?: boolean }): AsyncGenerator<string>;
  /** Canned streaming text (demo mode). */
  demoText(text: string, signal: AbortSignal): AsyncGenerator<string>;
}

export function createProvider(cfg: AppConfig, log: Logger): ProviderAdapter | null {
  if (cfg.provider === 'openai' && cfg.openai.apiKey) return createOpenAIProvider({ ...cfg.openai, apiKey: cfg.openai.apiKey });
  if (cfg.provider === 'gemini' && cfg.gemini.apiKey) return createGeminiProvider({ ...cfg.gemini, apiKey: cfg.gemini.apiKey }, log);
  return null;
}

export function createLLMService(cfg: AppConfig, log: Logger, opts: { demoDelay?: () => number } = {}): LLMService {
  const adapter = createProvider(cfg, log);
  const demoText = (text: string, signal: AbortSignal) => streamDemoText(text, signal, opts.demoDelay);

  return {
    provider: adapter?.id ?? 'demo',
    model: adapter?.model ?? null,
    demoText,
    async *complete(agent, messages, signal, { strict = false } = {}) {
      if (adapter) {
        let started = false;
        try {
          const history = messages.map(({ role, content }) => ({ role, content }));
          for await (const token of adapter.stream(agent, history, signal)) {
            started = true;
            yield token;
          }
          return;
        } catch (err) {
          if (signal.aborted) return;
          log.error({ provider: adapter.id, err: err instanceof Error ? err.message : String(err) }, 'provider error');
          if (started || strict) throw err; // can't cleanly switch to demo mid-reply (or the caller wants the error)
          // Nothing sent yet: fall through to the clearly labelled demo reply. (Phase 4 replaces this with an explicit error.)
        }
      }
      yield* demoText(buildDemoResponse(agent), signal);
    }
  };
}
