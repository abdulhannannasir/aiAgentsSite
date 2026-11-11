import { readSSE } from './sse';
import type { HealthResponse, MetaResponse } from '../../../server/src/contracts';
import type { Agent, AgentDraft, ServerEvent, Workflow } from '../types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Reads the message from an API error body: `{ error: { message } }` (v1), or the older `{ error: "..." }`. */
export function errorMessage(body: unknown): string {
  const e = (body as { error?: unknown } | null)?.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') return (e as { message: string }).message;
  return '';
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status})`);
  return (await res.json()) as T;
}

export const fetchAgents = () => getJson<Agent[]>('/api/v1/agents');
export const fetchWorkflows = () => getJson<Workflow[]>('/api/v1/workflows');
export const fetchHealth = () => getJson<HealthResponse>('/api/v1/health');
export const fetchMeta = () => getJson<MetaResponse>('/api/v1/meta');

export interface ChatRequest {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  agentId?: string;
  agent?: Pick<AgentDraft, 'name' | 'description' | 'systemPrompt' | 'temperature' | 'tools'>;
  workflowId?: string;
  /** Signed in only: a saved agent, the saved conversation to continue, and the thread it belongs to. */
  customAgentId?: string;
  conversationId?: string;
  threadKey?: string;
}

/** POSTs a chat message and reports each streamed server event. Throws ApiError for non-2xx responses. */
export async function streamChat(request: ChatRequest, signal: AbortSignal, onEvent: (event: ServerEvent) => void): Promise<void> {
  const res = await fetch('/api/v1/chat', {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });
  if (res.status === 429) throw new ApiError(429, 'You are sending messages too fast. Please wait a minute.');
  if (!res.ok || !res.body) {
    let detail = '';
    try {
      detail = errorMessage(await res.json());
    } catch {
      /* body was not JSON */
    }
    throw new ApiError(res.status, detail || `Chat failed (${res.status}). Please try again.`);
  }
  await readSSE<ServerEvent>(res.body, onEvent);
}
