import type { Graph, GraphContext, GraphIssue, NodeTypeInfo } from '../../../server/src/modules/studio/graph';
import type { OrchestrationStatus, OrchestrationSummary } from '../../../server/src/contracts';
import { ApiError, errorMessage } from './api';

export type { Graph, GraphContext, GraphIssue, NodeTypeInfo } from '../../../server/src/modules/studio/graph';

export interface WorkflowSummary {
  id: string; name: string; description: string; createdBy: string | null; updatedAt: number;
  version: number | null; valid: boolean; steps: number; lastRun: { status: OrchestrationStatus; at: number } | null;
}
export interface WorkflowVersionView { version: number; graph: Graph; valid: boolean; note: string | null; createdAt: number; issues: GraphIssue[] }
export interface WorkflowDetail {
  id: string; name: string; description: string; templateId: string | null; createdBy: string | null; canDelete: boolean;
  createdAt: number; updatedAt: number; version: WorkflowVersionView | null;
}
export interface VersionSummary { version: number; valid: boolean; note: string | null; createdBy: string | null; createdAt: number; steps: number }
export interface Template { id: string; name: string; description: string; graph: Graph; issues: GraphIssue[] }
export interface StudioCatalog {
  nodeTypes: NodeTypeInfo[];
  context: GraphContext;
  agents: Array<{ id: string; name: string; icon: string; category: string; tools: string[] }>;
  tools: Array<{ id: string; label: string; description: string; available: boolean; reason?: string }>;
}

async function call<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data: unknown = null;
  try { data = res.status === 204 ? null : await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(res.status, errorMessage(data) || `Request failed (${res.status})`);
  return data as T;
}

const enc = encodeURIComponent;
const base = '/api/v1/studio';

export const studio = {
  catalog: () => call<StudioCatalog>('GET', `${base}/node-types`),
  templates: () => call<Template[]>('GET', `${base}/templates`),
  list: () => call<WorkflowSummary[]>('GET', `${base}/workflows`),
  create: (body: { name: string; description?: string; templateId?: string; graph?: Graph }) => call<WorkflowDetail>('POST', `${base}/workflows`, body),
  get: (id: string) => call<WorkflowDetail>('GET', `${base}/workflows/${enc(id)}`),
  rename: (id: string, body: { name?: string; description?: string }) => call<WorkflowDetail>('PATCH', `${base}/workflows/${enc(id)}`, body),
  remove: (id: string) => call<null>('DELETE', `${base}/workflows/${enc(id)}`),
  versions: (id: string) => call<VersionSummary[]>('GET', `${base}/workflows/${enc(id)}/versions`),
  version: (id: string, v: number) => call<WorkflowVersionView>('GET', `${base}/workflows/${enc(id)}/versions/${v}`),
  save: (id: string, graph: Graph, baseVersion: number | undefined, note?: string) =>
    call<{ version: number; valid: boolean; issues: GraphIssue[] }>('POST', `${base}/workflows/${enc(id)}/versions`, { graph, baseVersion, ...(note && { note }) }),
  run: (id: string, input: string, key: string) => call<{ id: string; created: boolean }>('POST', `${base}/workflows/${enc(id)}/runs`, { input }, { 'Idempotency-Key': key }),
  runs: (id: string) => call<OrchestrationSummary[]>('GET', `${base}/workflows/${enc(id)}/runs`)
};

/** A free node id for a kind: agent_1, agent_2, … */
export function nextNodeId(kind: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const stem = kind.replace(/[^a-z0-9_]/g, '_');
  for (let i = 1; ; i++) if (!used.has(`${stem}_${i}`)) return `${stem}_${i}`;
}

/** Default settings for a new node of a kind. */
export function defaultConfig(kind: string, firstAgent = 'research-agent'): Record<string, unknown> {
  switch (kind) {
    case 'agent': return { agentId: firstAgent, prompt: '', tools: [] };
    case 'llm': return { system: '', prompt: '{{input}}', temperature: 0.7 };
    case 'tool': return { toolId: 'calculator', args: { expression: '{{input}}' } };
    case 'condition': return { source: '', operator: 'contains', value: '', caseSensitive: false };
    case 'template': return { text: '{{input}}' };
    case 'merge': return { join: 'all', separator: '\n\n' };
    case 'extract': return { source: '', path: 'result' };
    case 'approval': return { message: '' };
    case 'delay': return { seconds: 10 };
    case 'output': return { template: '' };
    default: return {};
  }
}
