import type { ProviderId } from '../../contracts.js';

/** Everything a provider needs to know about who is answering. */
export interface ChatAgent {
  name: string;
  description?: string;
  systemPrompt: string;
  greeting?: string;
  temperature?: number;
  /** Tool permissions (tool ids). Only tools that are also available on this server are offered to the model. */
  tools: string[];
  /** A specific provider/model for this agent; unset = the deployment's default. */
  provider?: Exclude<ProviderId, 'demo'> | null;
  model?: string | null;
}

/** A tool call requested by the model. `meta` carries provider data that must be sent back unchanged (e.g. Gemini thought signatures). */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

/** One turn of the conversation as the providers see it. */
export type Turn =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

/** A tool the model may call, described as JSON Schema (the subset both providers accept). */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderRequest {
  agent: ChatAgent;
  turns: Turn[];
  tools?: ToolSpec[];
}

export type ProviderEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  /** Token counts as reported by the provider. Sent at most once per call; absent when the provider reports none. */
  | { type: 'usage'; inputTokens: number; outputTokens: number };

export interface ModelCapabilities {
  streaming: boolean;
  tools: boolean;
}

/**
 * A model provider bound to one model. `run` yields events; it throws a ProviderError if the provider fails.
 * Retries and fallback models are the adapter's own business and only happen before the first event.
 */
export interface ProviderAdapter {
  readonly id: Exclude<ProviderId, 'demo'>;
  readonly model: string;
  readonly capabilities: ModelCapabilities;
  run(req: ProviderRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent>;
}

export type ProviderErrorKind = 'auth' | 'quota' | 'unavailable' | 'timeout' | 'network' | 'bad_request' | 'blocked' | 'empty';

const USER_MESSAGES: Record<ProviderErrorKind, string> = {
  auth: 'The AI provider rejected the server\'s credentials. An administrator needs to check the API key.',
  quota: 'The AI provider\'s usage limit was reached. Please try again later.',
  unavailable: 'The AI provider is unavailable right now. Please try again in a moment.',
  timeout: 'The AI provider took too long to answer. Please try again.',
  network: 'The server could not reach the AI provider. Please try again.',
  bad_request: 'The AI provider could not process this request.',
  blocked: 'The AI provider declined to answer this request.',
  empty: 'The AI provider returned an empty answer. Please try again.'
};

/** A provider failure with a message that is safe to show users (details stay in the logs). */
export class ProviderError extends Error {
  readonly userMessage: string;
  constructor(readonly kind: ProviderErrorKind, detail: string, readonly status?: number) {
    super(detail);
    this.name = 'ProviderError';
    this.userMessage = USER_MESSAGES[kind];
  }
}

/** Maps an HTTP status from a provider to an error kind. */
export function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'unavailable';
  return 'bad_request';
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
