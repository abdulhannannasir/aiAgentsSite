import type { ApprovalView, OrchestrationStatus, OrchestrationSummary, OrchestrationView } from '../../../server/src/contracts';
import { ApiError, errorMessage } from './api';

export type { ApprovalView, OrchestrationStatus, OrchestrationSummary, OrchestrationTaskStatus, OrchestrationTaskView, OrchestrationView } from '../../../server/src/contracts';

async function call<T>(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: method === 'POST' ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(res.status, errorMessage(data) || `Request failed (${res.status})`);
  return data as T;
}

const enc = encodeURIComponent;

export const orchestrations = {
  /** `key` makes a retried submit (double click, flaky network) return the same orchestration instead of a second one. */
  start: (goal: string, key: string) => call<{ id: string; created: boolean }>('POST', '/api/v1/orchestrations', { goal }, { 'Idempotency-Key': key }),
  list: () => call<OrchestrationSummary[]>('GET', '/api/v1/orchestrations'),
  get: (id: string) => call<OrchestrationView>('GET', `/api/v1/orchestrations/${enc(id)}`),
  cancel: (id: string) => call<{ cancelled: boolean }>('POST', `/api/v1/orchestrations/${enc(id)}/cancel`),
  pause: (id: string) => call<{ status: string }>('POST', `/api/v1/orchestrations/${enc(id)}/pause`),
  resume: (id: string) => call<{ status: string }>('POST', `/api/v1/orchestrations/${enc(id)}/resume`),
  retryTask: (id: string, key: string) => call<{ retried: boolean }>('POST', `/api/v1/orchestrations/${enc(id)}/tasks/${enc(key)}/retry`),
  approvals: () => call<ApprovalView[]>('GET', '/api/v1/approvals?status=PENDING'),
  decide: (approvalId: string, decision: 'approve' | 'reject') => call<ApprovalView>('POST', `/api/v1/approvals/${enc(approvalId)}`, { decision })
};

export const ACTIVE_STATUSES: OrchestrationStatus[] = ['PLANNING', 'RUNNING', 'PAUSED', 'SYNTHESIZING'];
export const isActive = (s: OrchestrationStatus) => ACTIVE_STATUSES.includes(s);

/**
 * Groups tasks into stages by dependency depth: stage 1 has no dependencies, stage n depends on something in stage n-1.
 * Tasks in the same stage can run in parallel.
 */
export function stagesOf<T extends { key: string; dependsOn: string[] }>(tasks: T[]): T[][] {
  const depth = new Map<string, number>();
  const byKey = new Map(tasks.map(t => [t.key, t]));
  const depthOf = (key: string, seen = new Set<string>()): number => {
    if (depth.has(key)) return depth.get(key)!;
    const t = byKey.get(key);
    if (!t || seen.has(key)) return 0;
    seen.add(key);
    const d = t.dependsOn.length ? 1 + Math.max(...t.dependsOn.map(k => depthOf(k, seen))) : 0;
    depth.set(key, d);
    return d;
  };
  const stages: T[][] = [];
  for (const t of tasks) (stages[depthOf(t.key)] ??= []).push(t);
  return stages.filter(Boolean);
}
