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

/** GET /api/v1/agents/:id adds example prompts and the ids of workflows the agent is part of. */
export interface PublicAgentDetail extends PublicAgent {
  examples: string[];
  workflows: string[];
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
  | { type: 'conversation'; id: string; executionId: string } // signed-in requests: where this reply is saved
  | { type: 'tool'; id: string; tool: string; label: string; status: 'running' | 'done' | 'error'; input?: Record<string, unknown>; summary?: string; durationMs?: number }
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
  /** Multi-agent orchestration (Phase 5): whether it can run here, and whether its jobs survive restarts. */
  orchestration: { available: boolean; durable: boolean; worker: boolean; reason?: string };
}

// ---------------------------------------------------------------- orchestration (Phase 5)

export type OrchestrationStatus = 'PLANNING' | 'RUNNING' | 'PAUSED' | 'SYNTHESIZING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type OrchestrationTaskStatus = 'PENDING' | 'WAITING_APPROVAL' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface ApprovalView {
  id: string;
  orchestrationId: string;
  taskKey: string;
  taskTitle: string;
  tools: string[];
  reason: string;
  status: ApprovalStatus;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: number | null;
  note: string | null;
  createdAt: number;
  /** Whether the caller may approve or reject it (the requester, or a workspace owner/admin). */
  canDecide: boolean;
}

export interface OrchestrationTaskView {
  key: string;
  title: string;
  /** 'agent' for planner tasks; the studio node kind for workflow runs. */
  kind: string;
  /** The studio node this task ran (workflow runs). */
  nodeId: string | null;
  agentId: string;
  agentName: string;
  agentIcon: string;
  instruction: string;
  tools: string[];
  dependsOn: string[];
  status: OrchestrationTaskStatus;
  attempt: number;
  maxAttempts: number;
  output: string | null;
  error: string | null;
  toolCalls: Array<{ tool: string; ok: boolean; summary: string; durationMs: number }>;
  modelCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  startedAt: number | null;
  endedAt: number | null;
  approval: ApprovalView | null;
}

export interface OrchestrationSummary {
  id: string;
  goal: string;
  /** Set for runs of a studio workflow. */
  workflow: { id: string; name: string; version: number | null } | null;
  /** Project context of the run, if any. */
  projectId: string | null;
  status: OrchestrationStatus;
  durable: boolean;
  provider: string;
  model: string | null;
  modelCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  tasks: { total: number; done: number; waitingApproval: number };
  error: string | null;
  user: string | null;
  mine: boolean;
  createdAt: number;
  endedAt: number | null;
}

export interface OrchestrationView extends OrchestrationSummary {
  planSummary: string | null;
  output: string | null;
  /** Task keys the answer cites, in order of first citation. */
  sources: string[];
  taskList: OrchestrationTaskView[];
  canManage: boolean;
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
