import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../../config/env.js';
import type { ApprovalView, OrchestrationSummary, OrchestrationTaskView, OrchestrationView } from '../../contracts.js';
import type { Db } from '../../db/client.js';
import { HttpError, badRequest, notFound, unavailable } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { RateLimiter } from '../../middleware/rateLimit.js';
import { authOf, canManage, requireAuth, type AuthContext } from '../../middleware/session.js';
import type { Platform } from '../../platform.js';
import { findAgent } from '../agents/registry.js';
import { audit } from '../audit/audit.js';
import { MAX_TASKS } from './plan.js';
import { NODE_TYPES } from '../studio/graph.js';
import { accessibleProjectIds } from '../knowledge/memory.js';
import type { Orchestrator } from './engine.js';

/** A person may have this many orchestrations in progress at once. */
export const MAX_ACTIVE_PER_USER = 3;
const ACTIVE = ['PLANNING', 'RUNNING', 'PAUSED', 'SYNTHESIZING'] as const;
export const workflowInclude = { workflow: { select: { id: true, name: true } }, workflowVersion: { select: { version: true } } } as const;

/** Members see their own orchestrations; workspace owners and admins see everyone's in the workspace. */
const visible = (ctx: AuthContext) => ({ workspaceId: ctx.workspaceId, ...(canManage(ctx.workspaceRole) ? {} : { userId: ctx.user.id }) });
const ms = (d: Date | null | undefined) => d?.getTime() ?? null;

type ApprovalRow = {
  id: string; orchestrationId: string; tools: string[]; reason: string; status: ApprovalView['status']; requestedById: string | null; decidedAt: Date | null;
  note: string | null; createdAt: Date; requestedBy?: { name: string } | null; decidedBy?: { name: string } | null; task?: { key: string; title: string } | null;
};

function approvalView(a: ApprovalRow, ctx: AuthContext, task?: { key: string; title: string }): ApprovalView {
  const t = task ?? a.task ?? { key: '?', title: '' };
  return {
    id: a.id, orchestrationId: a.orchestrationId, taskKey: t.key, taskTitle: t.title, tools: a.tools, reason: a.reason, status: a.status,
    requestedBy: a.requestedBy?.name ?? null, decidedBy: a.decidedBy?.name ?? null, decidedAt: ms(a.decidedAt), note: a.note, createdAt: a.createdAt.getTime(),
    canDecide: a.status === 'PENDING' && (a.requestedById === ctx.user.id || canManage(ctx.workspaceRole))
  };
}

async function load(db: Db, ctx: AuthContext, id: string) {
  return db.orchestration.findFirst({
    where: { id, ...visible(ctx) },
    include: {
      user: { select: { name: true } }, ...workflowInclude,
      tasks: { include: { approval: { include: { requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } } } } }
    }
  });
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;
const byKey = (a: { key: string }, b: { key: string }) => Number(a.key.slice(1)) - Number(b.key.slice(1));

export function summary(o: Omit<Loaded, 'tasks'> & { tasks: Array<{ status: string }> }, ctx: AuthContext): OrchestrationSummary {
  return {
    id: o.id, goal: o.goal,
    workflow: o.workflowId ? { id: o.workflowId, name: o.workflow?.name ?? 'Deleted workflow', version: o.workflowVersion?.version ?? null } : null,
    projectId: o.projectId, status: o.status, durable: o.durable, provider: o.provider, model: o.model, modelCalls: o.modelCalls,
    inputTokens: o.inputTokens, outputTokens: o.outputTokens, error: o.error, user: o.user?.name ?? null, mine: o.userId === ctx.user.id,
    createdAt: o.createdAt.getTime(), endedAt: ms(o.endedAt),
    tasks: {
      total: o.tasks.length,
      done: o.tasks.filter(t => ['SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'].includes(t.status)).length,
      waitingApproval: o.tasks.filter(t => t.status === 'WAITING_APPROVAL').length
    }
  };
}

function view(o: Loaded, ctx: AuthContext): OrchestrationView {
  const taskList: OrchestrationTaskView[] = [...o.tasks].sort(byKey).map(t => {
    const agent = findAgent(t.agentId);
    const type = NODE_TYPES.find(n => n.kind === t.kind);
    return {
      key: t.key, title: t.title, kind: t.kind, nodeId: t.nodeId, agentId: t.agentId,
      agentName: agent?.name ?? (t.kind === 'agent' ? t.agentId : type?.label ?? t.kind), agentIcon: agent?.icon ?? (t.kind === 'agent' ? '🤖' : '⚙️'), instruction: t.instruction,
      tools: t.tools, dependsOn: t.dependsOn, status: t.status, attempt: t.attempt, maxAttempts: t.maxAttempts, output: t.output, error: t.error,
      toolCalls: Array.isArray(t.toolCalls) ? (t.toolCalls as OrchestrationTaskView['toolCalls']) : [],
      modelCalls: t.modelCalls, inputTokens: t.inputTokens, outputTokens: t.outputTokens, startedAt: ms(t.startedAt), endedAt: ms(t.endedAt),
      approval: t.approval ? approvalView(t.approval, ctx, t) : null
    };
  });
  return {
    ...summary(o, ctx), planSummary: o.planSummary, output: o.output, sources: o.sources, taskList,
    canManage: o.userId === ctx.user.id || canManage(ctx.workspaceRole)
  };
}

const StartBody = z.object({
  goal: z.string().trim().min(3, 'Describe the goal in a few words.').max(4000, 'The goal is too long (max 4000 characters).'),
  /** Project context: knowledge searches during the run can read this project's memory and files. */
  projectId: z.string().max(60).nullish()
}).strict();
const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_.:-]{8,100}$/, 'Idempotency-Key must be 8-100 letters, digits or _ . : -');
const DecideBody = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(500).optional() }).strict();

/** 503 until orchestration can actually run here (database + accounts, and a queue on serverless hosts). */
function requireOrchestrator(orch: Orchestrator | null, reason: string | undefined): RequestHandler {
  return (_req, _res, next) => (orch ? next() : next(unavailable(reason ?? 'Orchestration is not available on this server.')));
}

/** /api/v1/orchestrations */
export function orchestrationsRouter(deps: { platform: Platform; log: Logger; limiter: RateLimiter; orchestrator: Orchestrator | null; reason?: string }): Router {
  const { platform, log, limiter, orchestrator } = deps;
  const r = Router();
  r.use(requireAuth(platform), requireOrchestrator(orchestrator, deps.reason));
  const db = () => platform.db!;
  const orch = () => orchestrator!;

  r.post('/', limiter.middleware(), async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const body = StartBody.safeParse(req.body ?? {});
      if (!body.success) return next(badRequest(body.error.issues[0]?.message ?? 'Invalid request'));
      const rawKey = req.get('Idempotency-Key');
      const key = rawKey === undefined ? null : IdempotencyKey.safeParse(rawKey);
      if (key && !key.success) return next(badRequest(key.error.issues[0].message));
      const idempotencyKey = key?.success ? key.data : null;
      if (idempotencyKey) {
        const existing = await db().orchestration.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: ctx.workspaceId, idempotencyKey } }, select: { id: true, userId: true } });
        if (existing) {
          if (existing.userId !== ctx.user.id) return next(new HttpError('CONFLICT', 'This Idempotency-Key was already used by someone else in this workspace.'));
          return res.status(200).json({ id: existing.id, created: false });
        }
      }
      const active = await db().orchestration.count({ where: { workspaceId: ctx.workspaceId, userId: ctx.user.id, status: { in: [...ACTIVE] } } });
      if (active >= MAX_ACTIVE_PER_USER) return next(new HttpError('RATE_LIMITED', `You already have ${MAX_ACTIVE_PER_USER} orchestrations in progress. Wait for one to finish or cancel one.`));
      // Planning, up to MAX_TASKS tasks and the synthesis are separate model calls: charge them up front.
      if (!limiter.charge(req.ip ?? 'unknown', MAX_TASKS + 1)) return limiter.tooMany(res);
      if (body.data.projectId && !(await accessibleProjectIds(db(), { workspaceId: ctx.workspaceId, userId: ctx.user.id, role: ctx.workspaceRole })).includes(body.data.projectId)) {
        return next(notFound('Project not found'));
      }
      const started = await orch().start({ userId: ctx.user.id, workspaceId: ctx.workspaceId }, body.data.goal, idempotencyKey, { projectId: body.data.projectId ?? null });
      if (started.created) {
        await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'orchestration.started', targetType: 'orchestration', targetId: started.id, ip: req.ip });
      }
      res.status(started.created ? 202 : 200).json(started);
    } catch (err) { next(err); }
  });

  r.get('/', async (_req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const rows = await db().orchestration.findMany({
        where: visible(ctx), orderBy: { createdAt: 'desc' }, take: 30,
        include: { user: { select: { name: true } }, ...workflowInclude, tasks: { select: { status: true } } }
      });
      res.set('Cache-Control', 'private, no-store');
      res.json(rows.map(o => summary(o, ctx)));
    } catch (err) { next(err); }
  });

  r.get('/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const o = await load(db(), ctx, req.params.id);
      if (!o) return next(notFound('Orchestration not found'));
      res.set('Cache-Control', 'private, no-store');
      res.json(view(o, ctx));
    } catch (err) { next(err); }
  });

  const manageable = async (ctx: AuthContext, id: string) => {
    const o = await db().orchestration.findFirst({ where: { id, ...visible(ctx) }, select: { id: true, userId: true, status: true } });
    if (!o) throw notFound('Orchestration not found');
    if (o.userId !== ctx.user.id && !canManage(ctx.workspaceRole)) throw new HttpError('FORBIDDEN', 'Only the person who started it, or a workspace admin, can do this.');
    return o;
  };

  r.post('/:id/cancel', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const o = await manageable(ctx, req.params.id);
      if (!(await orch().cancel(o.id))) return next(new HttpError('CONFLICT', `This orchestration already ended (${o.status.toLowerCase()}).`));
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'orchestration.cancelled', targetType: 'orchestration', targetId: o.id, ip: req.ip });
      res.status(202).json({ cancelled: true });
    } catch (err) { next(err); }
  });

  for (const action of ['pause', 'resume'] as const) {
    r.post(`/:id/${action}`, async (req, res, next) => {
      try {
        const ctx = authOf(res)!;
        const o = await manageable(ctx, req.params.id);
        if (!(await orch()[action](o.id))) return next(new HttpError('CONFLICT', action === 'pause' ? 'Only a running orchestration can be paused.' : 'Only a paused orchestration can be resumed.'));
        await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: `orchestration.${action}d`, targetType: 'orchestration', targetId: o.id, ip: req.ip });
        res.status(202).json({ status: action === 'pause' ? 'PAUSED' : 'RUNNING' });
      } catch (err) { next(err); }
    });
  }

  r.post('/:id/tasks/:key/retry', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const o = await manageable(ctx, req.params.id);
      if (!/^T\d{1,2}$/.test(req.params.key)) return next(notFound('Task not found'));
      if (!limiter.charge(req.ip ?? 'unknown', 2)) return limiter.tooMany(res);
      if ((await orch().retryTask(o.id, req.params.key)) !== 'ok') return next(new HttpError('CONFLICT', 'Only a failed task of a failed orchestration can be retried.'));
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'orchestration.task_retried', targetType: 'orchestration', targetId: o.id, metadata: { task: req.params.key }, ip: req.ip });
      res.status(202).json({ retried: true });
    } catch (err) { next(err); }
  });

  return r;
}

/** /api/v1/approvals: the approvals inbox. */
export function approvalsRouter(deps: { platform: Platform; log: Logger; orchestrator: Orchestrator | null; reason?: string }): Router {
  const { platform, log, orchestrator } = deps;
  const r = Router();
  r.use(requireAuth(platform), requireOrchestrator(orchestrator, deps.reason));
  const db = () => platform.db!;
  const include = { requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } }, task: { select: { key: true, title: true } } } as const;
  // Members see approvals for their own orchestrations; owners and admins see the workspace's.
  const scope = (ctx: AuthContext) => ({ workspaceId: ctx.workspaceId, ...(canManage(ctx.workspaceRole) ? {} : { requestedById: ctx.user.id }) });

  r.get('/', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const status = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional().safeParse(req.query.status);
      if (!status.success) return next(badRequest('Invalid status'));
      const rows = await db().approvalRequest.findMany({ where: { ...scope(ctx), ...(status.data && { status: status.data }) }, orderBy: { createdAt: 'desc' }, take: 50, include });
      res.set('Cache-Control', 'private, no-store');
      res.json(rows.map(a => approvalView(a, ctx)));
    } catch (err) { next(err); }
  });

  r.post('/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const body = DecideBody.safeParse(req.body ?? {});
      if (!body.success) return next(badRequest('Send { "decision": "approve" | "reject", "note"?: string }'));
      const a = await db().approvalRequest.findFirst({ where: { id: req.params.id, workspaceId: ctx.workspaceId }, select: { id: true, requestedById: true, orchestrationId: true } });
      if (!a || (a.requestedById !== ctx.user.id && !canManage(ctx.workspaceRole))) return next(notFound('Approval not found'));
      const approve = body.data.decision === 'approve';
      if ((await orchestrator!.decide(a.id, { userId: ctx.user.id, workspaceId: ctx.workspaceId }, approve, body.data.note)) !== 'ok') {
        return next(new HttpError('CONFLICT', 'This approval was already decided or cancelled.'));
      }
      await audit(db(), log, {
        workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: approve ? 'approval.approved' : 'approval.rejected',
        targetType: 'approval', targetId: a.id, metadata: { orchestrationId: a.orchestrationId }, ip: req.ip
      });
      const row = await db().approvalRequest.findUniqueOrThrow({ where: { id: a.id }, include });
      res.json(approvalView(row, ctx));
    } catch (err) { next(err); }
  });

  return r;
}

/** What /meta reports about orchestration, and the reason shown when it is unavailable. */
export function orchestrationStatus(cfg: AppConfig, platform: Platform): { available: boolean; reason?: string } {
  if (!platform.db || !platform.auth) return { available: false, reason: 'Orchestration needs accounts (DATABASE_URL and BETTER_AUTH_SECRET).' };
  if (!cfg.redisUrl && cfg.orchestration.serverless) {
    return { available: false, reason: 'On a serverless host, orchestration needs a job queue: set REDIS_URL and run a worker process (npm run worker) on a long-running host.' };
  }
  if (!cfg.redisUrl && !cfg.orchestration.worker) return { available: false, reason: 'ORCHESTRATION_WORKER is off and there is no REDIS_URL, so nothing would run the jobs.' };
  return { available: true };
}
