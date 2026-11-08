import type { HistoryMessage, ProviderId } from '../../contracts.js';

/** Everything a provider needs to know about who is answering. */
export interface ChatAgent {
  name: string;
  description?: string;
  systemPrompt: string;
  greeting?: string;
  temperature?: number;
  tools: string[];
}

/**
 * A model provider. `stream` yields text tokens; it throws if the provider fails. Retries and fallback
 * models are the adapter's own business and only happen before the first token is yielded.
 */
export interface ProviderAdapter {
  readonly id: Exclude<ProviderId, 'demo'>;
  readonly model: string;
  stream(agent: ChatAgent, messages: HistoryMessage[], signal: AbortSignal): AsyncGenerator<string>;
}

/** Splits a byte stream into lines, keeping a partial last line for the next chunk. */
export async function* readLines(reader: { read(): Promise<{ value?: Uint8Array; done: boolean }> }): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    yield* lines;
  }
  buffer += decoder.decode();
  if (buffer) yield buffer; // a final line may arrive without a trailing newline
}
