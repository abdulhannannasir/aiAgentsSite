import type { HistoryMessage } from '../../contracts.js';
import type { ChatAgent, ProviderAdapter } from './types.js';
import { readLines } from './types.js';

export interface OpenAIOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** OpenAI (or any OpenAI-compatible) chat completions, streamed. */
export function createOpenAIProvider(opts: OpenAIOptions): ProviderAdapter {
  return {
    id: 'openai',
    model: opts.model,
    async *stream(agent: ChatAgent, messages: HistoryMessage[], signal: AbortSignal) {
      const res = await fetch(`${opts.baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: opts.model,
          stream: true,
          ...(agent.temperature != null && { temperature: agent.temperature }),
          messages: [{ role: 'system', content: agent.systemPrompt }, ...messages]
        })
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new Error(`OpenAI responded ${res.status} ${detail.slice(0, 200)}`);
      }

      for await (const line of readLines(res.body.getReader())) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        let token: unknown;
        try {
          token = JSON.parse(data).choices?.[0]?.delta?.content;
        } catch {
          continue; // ignore malformed keep-alive lines
        }
        if (typeof token === 'string' && token) yield token;
      }
    }
  };
}
