import { ApiError, errorMessage } from './api';
import type { AgentDraft, Message, TraceStep } from '../types';

/* ------------------------------------------------------------------ types */

export interface AccountUser { id: string; email: string; name: string; emailVerified: boolean; role: string }
export interface WorkspaceSummary { id: string; name: string; slug: string; role: 'owner' | 'admin' | 'member' | string }
export interface Me { user: AccountUser; workspace: WorkspaceSummary | null; workspaces: WorkspaceSummary[] }

export type Visibility = 'PRIVATE' | 'WORKSPACE';

/** A custom agent stored in the workspace (server). Same core fields as the browser's CustomAgent. */
export interface SavedAgent extends AgentDraft {
  id: string;
  visibility: Visibility;
  version: number;
  versionId: string;
  createdById: string | null;
  createdByName: string | null;
  canEdit: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationSummary { id: string; agentKey: string; title: string; messageCount: number; createdAt: number; updatedAt: number }
interface ConversationDetail {
  id: string;
  agentKey: string;
  title: string;
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; status: 'done' | 'error'; error?: string; trace?: Array<Partial<TraceStep>>; workflowId?: string; createdAt: number }>;
}

/* ------------------------------------------------------------------ http */

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try { data = await res.json(); } catch { /* empty or not JSON */ }
  if (res.status === 429) {
    // Better Auth sends X-Retry-After (seconds); our API sends Retry-After. Never invent a number.
    const wait = Number(res.headers.get('x-retry-after') ?? res.headers.get('retry-after'));
    throw new ApiError(429, wait > 0
      ? `Too many attempts. Please wait ${wait} second${wait === 1 ? '' : 's'} and try again.`
      : 'Too many attempts. Please wait a minute and try again.');
  }
  if (!res.ok) {
    // Our API: { error: { message } }. Better Auth: { message, code }.
    const msg = errorMessage(data) || (data as { message?: string } | null)?.message || `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

const here = () => `${location.origin}${location.pathname}`;

/* ------------------------------------------------------------------ auth (Better Auth endpoints) */

export const auth = {
  signUp: (name: string, email: string, password: string) =>
    call<unknown>('POST', '/api/auth/sign-up/email', { name, email, password, callbackURL: `${here()}#/auth/verified` }),
  signIn: (email: string, password: string) => call<unknown>('POST', '/api/auth/sign-in/email', { email, password }),
  signOut: () => call<unknown>('POST', '/api/auth/sign-out', {}),
  requestReset: (email: string) => call<unknown>('POST', '/api/auth/request-password-reset', { email, redirectTo: `${here()}#/auth/reset-password` }),
  resetPassword: (token: string, newPassword: string) => call<unknown>('POST', '/api/auth/reset-password', { token, newPassword }),
  resendVerification: (email: string) => call<unknown>('POST', '/api/auth/send-verification-email', { email, callbackURL: `${here()}#/auth/verified` })
};

/* ------------------------------------------------------------------ account + workspaces */

export const account = {
  me: () => call<Me>('GET', '/api/v1/me'),
  createWorkspace: (name: string) => call<WorkspaceSummary>('POST', '/api/v1/workspaces', { name }),
  activateWorkspace: (id: string) => call<WorkspaceSummary>('POST', `/api/v1/workspaces/${encodeURIComponent(id)}/activate`, {})
};

/* ------------------------------------------------------------------ saved agents */

export const savedAgents = {
  list: () => call<SavedAgent[]>('GET', '/api/v1/custom-agents'),
  create: (d: AgentDraft & { visibility?: Visibility }) => call<SavedAgent>('POST', '/api/v1/custom-agents', d),
  update: (id: string, d: Partial<AgentDraft> & { visibility?: Visibility }) => call<SavedAgent>('PATCH', `/api/v1/custom-agents/${encodeURIComponent(id)}`, d),
  remove: (id: string) => call<void>('DELETE', `/api/v1/custom-agents/${encodeURIComponent(id)}`),
  importMany: (agents: AgentDraft[]) => call<SavedAgent[]>('POST', '/api/v1/custom-agents/import', { agents })
};

/* ------------------------------------------------------------------ saved conversations */

const toMessage = (m: ConversationDetail['messages'][number]): Message => ({
  id: m.id, role: m.role, content: m.content, createdAt: m.createdAt, status: m.status, error: m.error, workflowId: m.workflowId,
  trace: m.trace?.map((t, i) => ({
    id: t.id ?? `step-${i}`, agentName: t.agentName ?? '', agentIcon: t.agentIcon ?? '🤖', role: t.role ?? '', label: t.label ?? '',
    status: t.status ?? 'complete', output: t.output ?? ''
  }))
});

export const conversations = {
  list: (agentKey?: string, limit = 30) =>
    call<ConversationSummary[]>('GET', `/api/v1/conversations?limit=${limit}${agentKey ? `&agentKey=${encodeURIComponent(agentKey)}` : ''}`),
  /** The newest saved conversation with an agent, as chat messages (null if there is none). */
  async latest(agentKey: string): Promise<{ id: string; messages: Message[] } | null> {
    const [first] = await conversations.list(agentKey, 1);
    if (!first) return null;
    const detail = await call<ConversationDetail>('GET', `/api/v1/conversations/${encodeURIComponent(first.id)}`);
    return { id: detail.id, messages: detail.messages.map(toMessage) };
  },
  remove: (id: string) => call<void>('DELETE', `/api/v1/conversations/${encodeURIComponent(id)}`)
};
