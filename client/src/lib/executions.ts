import { ApiError, errorMessage } from './api';

export type ExecutionStatus = 'QUEUED' | 'RUNNING' | 'WAITING_INPUT' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface ExecutionSummary {
  id: string; agentKey: string; agentName: string; workflowId: string | null; conversationId: string | null;
  status: ExecutionStatus; provider: string; model: string | null; modelCalls: number;
  inputTokens: number | null; outputTokens: number | null; toolCalls: number; error: string | null;
  user: string | null; mine: boolean; createdAt: number; startedAt: number | null; endedAt: number | null; durationMs: number | null; input: string;
}
export interface ExecutionDetail extends Omit<ExecutionSummary, 'toolCalls' | 'durationMs'> {
  agentVersion: number | null; output: string | null; running: boolean;
  tools: Array<{ id: string; tool: string; input: Record<string, unknown>; status: 'SUCCEEDED' | 'FAILED'; summary: string; durationMs: number; at: number }>;
}

async function call<T>(method: string, url: string): Promise<T> {
  const res = await fetch(url, { method, credentials: 'same-origin', headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? '{}' : undefined });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(res.status, errorMessage(data) || `Request failed (${res.status})`);
  return data as T;
}

export const executions = {
  list: (status?: ExecutionStatus) => call<ExecutionSummary[]>('GET', `/api/v1/executions?limit=100${status ? `&status=${status}` : ''}`),
  get: (id: string) => call<ExecutionDetail>('GET', `/api/v1/executions/${encodeURIComponent(id)}`),
  cancel: (id: string) => call<{ cancelled: boolean }>('POST', `/api/v1/executions/${encodeURIComponent(id)}/cancel`)
};

export const formatTokens = (i: number | null, o: number | null) => (i === null && o === null ? '—' : `${(i ?? 0).toLocaleString()} in · ${(o ?? 0).toLocaleString()} out`);
