// Wire contracts shared by the API and the React client. Types only: the client imports this file with
// `import type`, so nothing here may have a runtime value.

export type StepStatus = 'pending' | 'active' | 'complete' | 'error';
export type ChatRole = 'user' | 'assistant';

export interface HistoryMessage {
  role: ChatRole;
  content: string;
}

/** A built-in agent as served by GET /api/v1/agents (never includes the system prompt). */
export interface PublicAgent {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  color: string;
  gradient: string;
  tools: string[];
  mostUsed: boolean;
  useCase: string;
}

export interface PublicWorkflowStep {
  id: string;
  agentId: string;
  agentName: string;
  agentIcon: string;
  agentGradient: string;
  role: string;
  label: string;
}

export interface PublicWorkflow {
  id: string;
  command: string;
  name: string;
  description: string;
  icon: string;
  promptStarter: string;
  steps: PublicWorkflowStep[];
}

export interface PlanStep {
  id: string;
  agentName: string;
  agentIcon: string;
  role: string;
  label: string;
  status: StepStatus;
}

/** Events streamed back from POST /api/v1/chat (one JSON object per SSE `data:` line). */
export type ChatEvent =
  | { type: 'plan'; workflowId: string; steps: PlanStep[] }
  | { type: 'step'; id: string; status: StepStatus; error?: string }
  | { type: 'step_delta'; id: string; content: string }
  | { type: 'stream'; content: string }
  | { type: 'error'; content: string }
  | { type: 'done'; message: { role: 'assistant'; content: string } | null };

export type ProviderId = 'openai' | 'gemini' | 'demo';

export interface HealthResponse {
  ok: boolean;
  mode: 'live' | 'demo';
  provider: ProviderId;
  agents: number;
}

/** What this deployment has configured. Booleans and names only, never secret values. */
export interface MetaResponse {
  version: string;
  mode: 'live' | 'demo';
  provider: ProviderId;
  providers: Record<Exclude<ProviderId, 'demo'>, { configured: boolean; model: string | null }>;
  features: {
    database: boolean;
    auth: boolean;
    email: boolean;
    redis: boolean;
    storage: boolean;
  };
}

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; requestId?: string; details?: unknown };
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'FEATURE_UNAVAILABLE'
  | 'INTERNAL';
