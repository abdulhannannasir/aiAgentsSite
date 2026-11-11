import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { HttpError, badRequest, notFound, unavailable } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { authOf, requireAuth } from '../../middleware/session.js';
import type { Platform } from '../../platform.js';
import { audit } from '../audit/audit.js';
import { findVisibleAgent } from './customAgents.js';
import { AGENTS, findAgent } from './registry.js';

/** Real, recorded numbers for one built-in agent. Nothing here is estimated. */
export interface AgentStats {
  id: string;
  /** Single-agent replies recorded (workflow runs are not credited to the agent whose chat they started in). */
  runsTotal: number;
  runs30d: number;
  /** Share of recorded runs that completed; null until there is at least one run. */
  successRate: number | null;
  rating: number | null;
  reviewCount: number;
  /** Signed in only. */
  favorite?: boolean;
}

export interface ReviewDto { id: string; rating: number; comment: string; author: string; mine: boolean; createdAt: number; updatedAt: number }

const BUILT_IN_KEYS = AGENTS.map(a => a.id);
const DAY = 24 * 60 * 60 * 1000;

/** "Ada Lovelace" -> "Ada L.": reviews are shown across workspaces, so full names are not. */
export const displayName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'AgentVerse user';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};

export async function agentStats(db: Db, keys: string[] = BUILT_IN_KEYS, now = Date.now()): Promise<Map<string, AgentStats>> {
  const where = { agentKey: { in: keys }, workflowId: null };
  const [total, recent, completed, ratings] = await Promise.all([
    db.agentExecution.groupBy({ by: ['agentKey'], where, _count: { _all: true } }),
    db.agentExecution.groupBy({ by: ['agentKey'], where: { ...where, createdAt: { gte: new Date(now - 30 * DAY) } }, _count: { _all: true } }),
    db.agentExecution.groupBy({ by: ['agentKey'], where: { ...where, status: 'COMPLETED' }, _count: { _all: true } }),
    db.agentReview.groupBy({ by: ['agentKey'], where: { agentKey: { in: keys } }, _avg: { rating: true }, _count: { _all: true } })
  ]);
  const count = (rows: Array<{ agentKey: string; _count: { _all: number } }>, k: string) => rows.find(r => r.agentKey === k)?._count._all ?? 0;
  const out = new Map<string, AgentStats>();
  for (const k of keys) {
    const runsTotal = count(total, k);
    const r = ratings.find(x => x.agentKey === k);
    out.set(k, {
      id: k, runsTotal, runs30d: count(recent, k),
      successRate: runsTotal ? Math.round((count(completed, k) / runsTotal) * 1000) / 1000 : null,
      rating: r?._avg.rating != null ? Math.round(r._avg.rating * 10) / 10 : null,
      reviewCount: r?._count._all ?? 0
    });
  }
  return out;
}

/** /api/v1/marketplace: stats, favorites and reviews. Needs a database; answers 503 without one. */
export function marketplaceRouter(platform: Platform, log: Logger): Router {
  const r = Router();
  const needDb: RequestHandler = (_req, _res, next) => next(platform.db ? undefined : unavailable('Marketplace stats need a database (DATABASE_URL).'));
  const needAuth = requireAuth(platform);
  const db = () => platform.db!;
  r.use(needDb);

  const builtIn: RequestHandler = (req, _res, next) => next(findAgent(req.params.id) ? undefined : notFound('Agent not found'));

  r.get('/agents', async (_req, res, next) => {
    try {
      const stats = await agentStats(db());
      const ctx = authOf(res);
      const favs = ctx ? new Set((await db().agentFavorite.findMany({ where: { userId: ctx.user.id }, select: { agentKey: true } })).map(f => f.agentKey)) : null;
      res.set('Cache-Control', ctx ? 'private, no-store' : 'public, max-age=60');
      res.json([...stats.values()].map(s => (favs ? { ...s, favorite: favs.has(s.id) } : s)));
    } catch (err) { next(err); }
  });

  r.get('/agents/:id', builtIn, async (req, res, next) => {
    try {
      const id = req.params.id;
      const ctx = authOf(res);
      const [stats, reviews] = await Promise.all([
        agentStats(db(), [id]),
        db().agentReview.findMany({ where: { agentKey: id }, orderBy: { updatedAt: 'desc' }, take: 20, include: { user: { select: { name: true } } } })
      ]);
      const mine = ctx ? await Promise.all([
        db().agentFavorite.findUnique({ where: { userId_agentKey: { userId: ctx.user.id, agentKey: id } } }),
        db().agentExecution.count({ where: { userId: ctx.user.id, agentKey: id, workflowId: null } }),
        db().agentReview.findUnique({ where: { userId_agentKey: { userId: ctx.user.id, agentKey: id } } }),
        db().conversation.findMany({ where: { workspaceId: ctx.workspaceId, userId: ctx.user.id, agentKey: id }, orderBy: { updatedAt: 'desc' }, take: 5, include: { _count: { select: { messages: true } } } })
      ]) : null;
      const toReview = (rv: (typeof reviews)[number]): ReviewDto => ({
        id: rv.id, rating: rv.rating, comment: rv.comment, author: displayName(rv.user.name), mine: rv.userId === ctx?.user.id,
        createdAt: rv.createdAt.getTime(), updatedAt: rv.updatedAt.getTime()
      });
      res.set('Cache-Control', 'private, no-store');
      res.json({
        stats: { ...stats.get(id)!, ...(mine && { favorite: !!mine[0] }) },
        reviews: reviews.map(toReview),
        me: mine && {
          runs: mine[1],
          canReview: mine[1] > 0,
          review: mine[2] ? { rating: mine[2].rating, comment: mine[2].comment } : null,
          conversations: mine[3].map(c => ({ id: c.id, title: c.title, messageCount: c._count.messages, updatedAt: c.updatedAt.getTime() }))
        }
      });
    } catch (err) { next(err); }
  });

  // ---- favorites (built-in agents, or saved agents you can see)
  const isFavoritable = async (key: string, res: Parameters<RequestHandler>[1]) => {
    if (findAgent(key)) return true;
    if (!key.startsWith('custom:')) return false;
    return !!(await findVisibleAgent(db(), authOf(res)!, key.slice('custom:'.length)));
  };

  r.get('/favorites', needAuth, async (_req, res, next) => {
    try {
      const rows = await db().agentFavorite.findMany({ where: { userId: authOf(res)!.user.id }, orderBy: { createdAt: 'asc' } });
      res.json(rows.map(f => f.agentKey));
    } catch (err) { next(err); }
  });

  r.put('/favorites/:key', needAuth, async (req, res, next) => {
    try {
      const key = req.params.key;
      if (key.length > 120 || !(await isFavoritable(key, res))) return next(notFound('Agent not found'));
      const userId = authOf(res)!.user.id;
      if (await db().agentFavorite.count({ where: { userId } }) >= 200) return next(badRequest('You can favorite up to 200 agents.'));
      await db().agentFavorite.upsert({ where: { userId_agentKey: { userId, agentKey: key } }, create: { userId, agentKey: key }, update: {} });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  r.delete('/favorites/:key', needAuth, async (req, res, next) => {
    try {
      await db().agentFavorite.deleteMany({ where: { userId: authOf(res)!.user.id, agentKey: req.params.key } });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // ---- reviews (built-in agents; only from people who have actually used the agent)
  const ReviewBody = z.object({
    rating: z.number().int('Rating must be a whole number').min(1, 'Rating must be 1 to 5').max(5, 'Rating must be 1 to 5'),
    // eslint-disable-next-line no-control-regex
    comment: z.string().transform(s => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()).pipe(z.string().max(1000, 'Comment is too long (max 1000)')).default('')
  });

  r.put('/agents/:id/review', needAuth, builtIn, async (req, res, next) => {
    try {
      const parsed = ReviewBody.safeParse(req.body);
      if (!parsed.success) return next(badRequest(parsed.error.issues[0].message));
      const ctx = authOf(res)!;
      const agentKey = req.params.id;
      const used = await db().agentExecution.count({ where: { userId: ctx.user.id, agentKey, workflowId: null } });
      if (!used) return next(new HttpError('FORBIDDEN', 'Chat with this agent at least once before reviewing it.'));
      const rv = await db().agentReview.upsert({
        where: { userId_agentKey: { userId: ctx.user.id, agentKey } },
        create: { userId: ctx.user.id, agentKey, ...parsed.data },
        update: parsed.data,
        include: { user: { select: { name: true } } }
      });
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'review.saved', targetType: 'agent', targetId: agentKey, metadata: { rating: rv.rating }, ip: req.ip });
      res.json({ id: rv.id, rating: rv.rating, comment: rv.comment, author: displayName(rv.user.name), mine: true, createdAt: rv.createdAt.getTime(), updatedAt: rv.updatedAt.getTime() } satisfies ReviewDto);
    } catch (err) { next(err); }
  });

  r.delete('/agents/:id/review', needAuth, builtIn, async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const { count } = await db().agentReview.deleteMany({ where: { userId: ctx.user.id, agentKey: req.params.id } });
      if (!count) return next(notFound('You have not reviewed this agent'));
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'review.deleted', targetType: 'agent', targetId: req.params.id, ip: req.ip });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return r;
}
