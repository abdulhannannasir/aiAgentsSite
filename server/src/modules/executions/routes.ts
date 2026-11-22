import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { HttpError, badRequest, notFound } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { authOf, canManage, requireAuth, type AuthContext } from '../../middleware/session.js';
import type { Platform } from '../../platform.js';
import { findAgent } from '../agents/registry.js';
import { audit } from '../audit/audit.js';
import { runningExecutions } from './running.js';

const STATUSES = ['QUEUED', 'RUNNING', 'WAITING_INPUT', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;

/** Members see their own runs; workspace owners and admins see everyone's in the workspace. */
const visible = (ctx: AuthContext) => ({ workspaceId: ctx.workspaceId, ...(canManage(ctx.workspaceRole) ? {} : { userId: ctx.user.id }) });

async function agentNames(db: Db, keys: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const customIds = keys.filter(k => k.startsWith('custom:')).map(k => k.slice('custom:'.length));
  if (customIds.length) {
    const rows = await db.agentVersion.findMany({ where: { agentId: { in: customIds } }, orderBy: { version: 'desc' }, distinct: ['agentId'], select: { agentId: true, name: true } });
    for (const r of rows) names.set(`custom:${r.agentId}`, r.name);
  }
  for (const k of keys) if (!names.has(k)) names.set(k, findAgent(k)?.name ?? (k.startsWith('custom:') ? 'Deleted agent' : k));
  return names;
}

/** GET /executions, GET /executions/:id, POST /executions/:id/cancel */
export function executionsRouter(platform: Platform, log: Logger): Router {
  const r = Router();
  r.use(requireAuth(platform));
  const db = () => platform.db!;

  const ListQuery = z.object({
    status: z.enum(STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.coerce.number().int().positive().optional()
  });

  r.get('/', async (req, res, next) => {
    try {
      const q = ListQuery.safeParse(req.query);
      if (!q.success) return next(badRequest('Invalid query'));
      const ctx = authOf(res)!;
      const rows = await db().agentExecution.findMany({
        where: { ...visible(ctx), ...(q.data.status && { status: q.data.status }), ...(q.data.before && { createdAt: { lt: new Date(q.data.before) } }) },
        orderBy: { createdAt: 'desc' }, take: q.data.limit,
        include: { user: { select: { name: true } }, _count: { select: { tools: true } } }
      });
      const names = await agentNames(db(), [...new Set(rows.map(x => x.agentKey))]);
      res.set('Cache-Control', 'private, no-store');
      res.json(rows.map(e => ({
        id: e.id, agentKey: e.agentKey, agentName: names.get(e.agentKey), workflowId: e.workflowId, conversationId: e.conversationId,
        status: e.status, provider: e.provider, model: e.model, modelCalls: e.modelCalls, inputTokens: e.inputTokens, outputTokens: e.outputTokens,
        toolCalls: e._count.tools, error: e.error, user: e.user?.name ?? null, mine: e.userId === ctx.user.id,
        createdAt: e.createdAt.getTime(), startedAt: e.startedAt?.getTime() ?? null, endedAt: e.endedAt?.getTime() ?? null,
        durationMs: e.startedAt && e.endedAt ? e.endedAt.getTime() - e.startedAt.getTime() : null,
        input: e.input.slice(0, 200)
      })));
    } catch (err) { next(err); }
  });

  r.get('/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const e = await db().agentExecution.findFirst({
        where: { id: req.params.id, ...visible(ctx) },
        include: { tools: { orderBy: { createdAt: 'asc' } }, user: { select: { name: true } }, agentVersion: { select: { version: true } } }
      });
      if (!e) return next(notFound('Execution not found'));
      const names = await agentNames(db(), [e.agentKey]);
      res.set('Cache-Control', 'private, no-store');
      res.json({
        id: e.id, agentKey: e.agentKey, agentName: names.get(e.agentKey), agentVersion: e.agentVersion?.version ?? null, workflowId: e.workflowId,
        conversationId: e.conversationId, status: e.status, provider: e.provider, model: e.model, modelCalls: e.modelCalls,
        inputTokens: e.inputTokens, outputTokens: e.outputTokens, error: e.error, user: e.user?.name ?? null, mine: e.userId === ctx.user.id,
        input: e.input, output: e.output ? e.output.slice(0, 8000) : null,
        createdAt: e.createdAt.getTime(), startedAt: e.startedAt?.getTime() ?? null, endedAt: e.endedAt?.getTime() ?? null,
        running: runningExecutions.get(e.id) !== undefined,
        tools: e.tools.map(t => ({ id: t.id, tool: t.toolId, input: t.input, status: t.status, summary: t.summary, durationMs: t.durationMs, at: t.createdAt.getTime() }))
      });
    } catch (err) { next(err); }
  });

  r.post('/:id/cancel', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const e = await db().agentExecution.findFirst({ where: { id: req.params.id, ...visible(ctx) }, select: { id: true, status: true, userId: true } });
      if (!e) return next(notFound('Execution not found'));
      if (e.userId !== ctx.user.id && !canManage(ctx.workspaceRole)) return next(new HttpError('FORBIDDEN', 'Only the person who started a run, or a workspace admin, can cancel it.'));
      if (e.status !== 'RUNNING' && e.status !== 'QUEUED') return next(new HttpError('CONFLICT', `This run already ended (${e.status.toLowerCase()}).`));
      if (!runningExecutions.cancel(e.id)) {
        return next(new HttpError('CONFLICT', 'This run is not running on this server instance, so it cannot be stopped from here.'));
      }
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'execution.cancelled', targetType: 'execution', targetId: e.id, ip: req.ip });
      res.status(202).json({ cancelled: true });
    } catch (err) { next(err); }
  });

  return r;
}
