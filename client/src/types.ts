export type Theme = 'dark' | 'light';

/** Simulated tools an agent may be permitted to use (nothing is actually searched, run or sent). */
export const TOOL_IDS = ['web_search', 'code_interpreter', 'file_reader', 'ticket_system', 'email_sender', 'knowledge_base', 'calculator'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/** A built-in agent, as served by GET /api/agents. */
export interface Agent {
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

/** What the user edits in the agent creator, and what is exported to / imported from JSON. */
export interface AgentDraft {
  name: string;
  description: string;
  icon: string;
  systemPrompt: string;
  temperature: number;
  tools: ToolId[];
}

/** A user-created agent, persisted in localStorage. */
export interface CustomAgent extends AgentDraft {
  id: string;
  createdAt: number;
  updatedAt: number;
}

/** The thing a chat thread is with: either a built-in or a custom agent, normalised for the UI. */
export interface ActiveAgent {
  key: string; // built-in id, or "custom:<id>"
  name: string;
  icon: string;
  subtitle: string;
  gradient: string;
  custom: boolean;
}

export interface WorkflowStepInfo {
  id: string;
  agentId: string;
  agentName: string;
  agentIcon: string;
  agentGradient: string;
  role: string;
  label: string;
}

export interface Workflow {
  id: string;
  command: string; // "/research"
  name: string;
  description: string;
  icon: string;
  promptStarter: string;
  steps: WorkflowStepInfo[];
}

export type StepStatus = 'pending' | 'active' | 'complete' | 'error';

export interface TraceStep {
  id: string;
  agentName: string;
  agentIcon: string;
  role: string;
  label: string;
  status: StepStatus;
  output: string; // streamed text of intermediate steps (the final step's text is the message itself)
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  status: 'streaming' | 'done' | 'error';
  error?: string;
  trace?: TraceStep[];
  workflowId?: string;
}

/** Events the server streams back from POST /api/chat. */
export type ServerEvent =
  | { type: 'plan'; workflowId: string; steps: Array<Omit<TraceStep, 'output' | 'startedAt' | 'endedAt'>> }
  | { type: 'step'; id: string; status: StepStatus; error?: string }
  | { type: 'step_delta'; id: string; content: string }
  | { type: 'stream'; content: string }
  | { type: 'error'; content: string }
  | { type: 'done'; message: { role: 'assistant'; content: string } | null };

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  keywords?: string;
  shortcut?: string;
  icon: React.ReactNode;
  run: () => void;
}
