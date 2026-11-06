import { readSSE } from './sse';
import type { Agent, AgentDraft, ServerEvent, Workflow } from '../types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status})`);
  return (await res.json()) as T;
}

export const fetchAgents = () => getJson<Agent[]>('/api/agents');
export const fetchWorkflows = () => getJson<Workflow[]>('/api/workflows');
export const fetchHealth = () => getJson<{ ok: boolean; mode: 'live' | 'demo'; provider: string; agents: number }>('/api/health');

export interface ChatRequest {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  agentId?: string;
  agent?: Pick<AgentDraft, 'name' | 'description' | 'systemPrompt' | 'temperature' | 'tools'>;
  workflowId?: string;
}

/** POSTs a chat message and reports each streamed server event. Throws ApiError for non-2xx responses. */
export async function streamChat(request: ChatRequest, signal: AbortSignal, onEvent: (event: ServerEvent) => void): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });
  if (res.status === 429) throw new ApiError(429, 'You are sending messages too fast. Please wait a minute.');
  if (!res.ok || !res.body) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* body was not JSON */
    }
    throw new ApiError(res.status, detail || `Chat failed (${res.status}). Please try again.`);
  }
  await readSSE<ServerEvent>(res.body, onEvent);
}
