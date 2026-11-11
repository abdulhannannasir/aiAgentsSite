import type { HistoryMessage, PlanStep } from '../../contracts.js';
import { Prisma, type Db } from '../../db/client.js';
import { notFound } from '../../lib/errors.js';
import type { AuthContext } from '../../middleware/session.js';

export interface TraceStepRecord extends PlanStep {
  output: string;
}

export interface RunStart {
  conversationId: string | null;
  agentKey: string;
  agentId?: string | null;
  agentVersionId?: string | null;
  workflowId?: string | null;
  message: string;
  provider: string;
  model: string | null;
  maxHistory: number;
  maxHistoryChars: number;
}

export interface Run {
  conversationId: string;
  executionId: string;
  isNewConversation: boolean;
  /** Earlier turns loaded from the database (the client's copy is not trusted for signed-in users). */
  history: HistoryMessage[];
}

/**
 * Starts a persisted run: finds (or creates) the conversation, stores the user's message and opens an
 * AgentExecution in RUNNING state. The conversation must belong to the caller's workspace AND to the caller.
 */
export async function startRun(db: Db, ctx: AuthContext, s: RunStart): Promise<Run> {
  let conversationId = s.conversationId;
  let history: HistoryMessage[] = [];
  let isNew = false;

  if (conversationId) {
    const conv = await db.conversation.findFirst({ where: { id: conversationId, workspaceId: ctx.workspaceId, userId: ctx.user.id, agentKey: s.agentKey } });
    if (!conv) throw notFound('Conversation not found');
    const rows = await db.message.findMany({ where: { conversationId, status: 'DONE' }, orderBy: { createdAt: 'desc' }, take: s.maxHistory });
    history = rows.reverse().filter(m => m.content.trim()).map(m => ({ role: m.role === 'USER' ? 'user' : 'assistant', content: m.content.slice(0, s.maxHistoryChars) }));
  } else {
    const conv = await db.conversation.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, agentKey: s.agentKey, agentId: s.agentId ?? null, title: s.message.replace(/\s+/g, ' ').trim().slice(0, 80) || 'New conversation' }
    });
    conversationId = conv.id;
    isNew = true;
  }

  await db.message.create({ data: { conversationId, role: 'USER', content: s.message, workflowId: s.workflowId ?? null } });
  const execution = await db.agentExecution.create({
    data: {
      workspaceId: ctx.workspaceId, userId: ctx.user.id, conversationId, agentKey: s.agentKey, agentId: s.agentId ?? null,
      agentVersionId: s.agentVersionId ?? null, workflowId: s.workflowId ?? null, status: 'RUNNING', provider: s.provider, model: s.model,
      input: s.message, startedAt: new Date()
    }
  });
  return { conversationId, executionId: execution.id, isNewConversation: isNew, history };
}

export interface RunEnd {
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  output: string;
  error?: string | null;
  trace?: TraceStepRecord[];
  workflowId?: string | null;
  modelCalls: number;
  provider: string;
  model: string | null;
  /** As reported by the provider; null when it reported nothing (never estimated). */
  inputTokens?: number | null;
  outputTokens?: number | null;
  tools?: Array<{ toolId: string; input: Record<string, unknown>; ok: boolean; summary: string; durationMs: number }>;
}

/** Stores the reply, closes the execution and meters usage. Runs even if the client disconnected. */
export async function finishRun(db: Db, ctx: AuthContext, run: Run, e: RunEnd): Promise<void> {
  const keepReply = e.output.trim() || e.status === 'FAILED';
  await db.$transaction([
    db.agentExecution.update({
      where: { id: run.executionId },
      data: {
        status: e.status, output: e.output || null, error: e.error ?? null, modelCalls: e.modelCalls, endedAt: new Date(),
        inputTokens: e.inputTokens ?? null, outputTokens: e.outputTokens ?? null
      }
    }),
    ...(e.tools?.length ? [db.toolInvocation.createMany({
      data: e.tools.map(t => ({
        executionId: run.executionId, toolId: t.toolId, input: t.input as Prisma.InputJsonValue,
        status: t.ok ? 'SUCCEEDED' as const : 'FAILED' as const, summary: t.summary, durationMs: t.durationMs
      }))
    })] : []),
    ...(keepReply ? [db.message.create({
      data: {
        conversationId: run.conversationId, role: 'ASSISTANT', content: e.output, executionId: run.executionId,
        status: e.status === 'FAILED' && !e.output.trim() ? 'ERROR' : 'DONE', error: e.status === 'FAILED' ? e.error ?? 'The reply failed.' : null,
        workflowId: e.workflowId ?? null, trace: e.trace ? (e.trace as unknown as Prisma.InputJsonValue) : undefined
      }
    })] : []),
    db.conversation.update({ where: { id: run.conversationId }, data: { updatedAt: new Date() } }),
    ...(e.modelCalls > 0 ? [db.usageRecord.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, kind: 'AI_REQUEST', quantity: e.modelCalls, provider: e.provider, model: e.model, executionId: run.executionId }
    })] : []),
    ...(e.inputTokens != null ? [db.usageRecord.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, kind: 'INPUT_TOKENS', quantity: e.inputTokens, provider: e.provider, model: e.model, executionId: run.executionId }
    })] : []),
    ...(e.outputTokens != null ? [db.usageRecord.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, kind: 'OUTPUT_TOKENS', quantity: e.outputTokens, provider: e.provider, model: e.model, executionId: run.executionId }
    })] : []),
    ...(e.workflowId ? [db.usageRecord.create({
      data: { workspaceId: ctx.workspaceId, userId: ctx.user.id, kind: 'WORKFLOW_RUN', quantity: 1, provider: e.provider, model: e.model, executionId: run.executionId }
    })] : [])
  ]);
}
