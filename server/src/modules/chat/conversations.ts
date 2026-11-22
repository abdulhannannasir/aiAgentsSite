import { Router } from 'express';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { authOf, requireAuth } from '../../middleware/session.js';
import type { Platform } from '../../platform.js';
import { audit } from '../audit/audit.js';

/** GET /conversations, GET /conversations/:id, DELETE /conversations/:id — always the caller's own, in the active workspace. */
export function conversationsRouter(platform: Platform, log: Logger): Router {
  const r = Router();
  r.use(requireAuth(platform));
  const db = () => platform.db!;

  const ListQuery = z.object({
    agentKey: z.string().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30)
  });
  r.get('/', async (req, res, next) => {
    try {
      const q = ListQuery.safeParse(req.query);
      if (!q.success) return next(badRequest('Invalid query'));
      const ctx = authOf(res)!;
      const rows = await db().conversation.findMany({
        where: { workspaceId: ctx.workspaceId, userId: ctx.user.id, ...(q.data.agentKey && { agentKey: q.data.agentKey }) },
        orderBy: { updatedAt: 'desc' }, take: q.data.limit,
        include: { _count: { select: { messages: true } } }
      });
      res.json(rows.map(c => ({ id: c.id, agentKey: c.agentKey, title: c.title, messageCount: c._count.messages, createdAt: c.createdAt.getTime(), updatedAt: c.updatedAt.getTime() })));
    } catch (err) { next(err); }
  });

  r.get('/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const c = await db().conversation.findFirst({
        where: { id: req.params.id, workspaceId: ctx.workspaceId, userId: ctx.user.id },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 500 } }
      });
      if (!c) return next(notFound('Conversation not found'));
      res.json({
        id: c.id, agentKey: c.agentKey, title: c.title, createdAt: c.createdAt.getTime(), updatedAt: c.updatedAt.getTime(),
        messages: c.messages.map(m => ({
          id: m.id, role: m.role === 'USER' ? 'user' : 'assistant', content: m.content, status: m.status === 'ERROR' ? 'error' : 'done',
          error: m.error ?? undefined, trace: m.trace ?? undefined, workflowId: m.workflowId ?? undefined, createdAt: m.createdAt.getTime()
        }))
      });
    } catch (err) { next(err); }
  });

  r.delete('/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const { count } = await db().conversation.deleteMany({ where: { id: req.params.id, workspaceId: ctx.workspaceId, userId: ctx.user.id } });
      if (!count) return next(notFound('Conversation not found'));
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'conversation.deleted', targetType: 'conversation', targetId: req.params.id, ip: req.ip });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return r;
}
