import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { Prisma } from '../../db/client.js';
import { HttpError, badRequest, notFound, unavailable } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { RateLimiter } from '../../middleware/rateLimit.js';
import { authOf, canManage, requireAuth, type AuthContext } from '../../middleware/session.js';
import type { Platform } from '../../platform.js';
import { AGENTS } from '../agents/registry.js';
import { audit } from '../audit/audit.js';
import type { Orchestrator } from '../orchestration/engine.js';
import { MAX_ACTIVE_PER_USER, summary, workflowInclude } from '../orchestration/routes.js';
import type { ToolRegistry } from '../tools/registry.js';
import { graphContext } from './context.js';
import { GraphSchema, NODE_TYPES, hasErrors, validateGraph, type GraphIssue } from './graph.js';
import { STARTER, TEMPLATES } from './templates.js';
import { accessibleProjectIds } from '../knowledge/memory.js';

const Meta = z.object({ name: z.string().trim().min(1, 'Give the workflow a name.').max(80), description: z.string().trim().max(500).optional() });
const CreateBody = Meta.extend({ templateId: z.string().max(60).optional(), graph: z.unknown().optional() }).strict();
const SaveBody = z.object({ graph: z.unknown(), note: z.string().trim().max(200).optional(), baseVersion: z.number().int().positive().optional() }).strict();
const RunBody = z.object({ input: z.string().trim().min(1, 'Type the input for this run.').max(4000), version: z.number().int().positive().optional() }).strict();
const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_.:-]{8,100}$/);

/**
 * /api/v1/studio: workflows built in the visual editor. Workflows are shared by the workspace: every member can view,
 * edit (each save is a new, attributed version) and run them; the creator or an owner/admin can delete one.
 */
export function studioRouter(deps: { platform: Platform; log: Logger; tools: ToolRegistry; limiter: RateLimiter; orchestrator: Orchestrator | null; orchestrationReason?: string }): Router {
  const { platform, log, tools, limiter, orchestrator } = deps;
  const r = Router();
  const db = (): Db => platform.db!;
  const ctxOf = () => graphContext(tools);

  // What the editor needs: node types (with availability), agents and the tools on this server. Public.
  r.get('/node-types', (_req, res) => {
    res.json({
      nodeTypes: NODE_TYPES,
      context: ctxOf(),
      agents: AGENTS.map(a => ({ id: a.id, name: a.name, icon: a.icon, category: a.category, tools: a.tools })),
      tools: tools.list()
    });
  });
  r.get('/templates', (_req, res) => res.json(TEMPLATES.map(t => ({ ...t, issues: validateGraph(t.graph, ctxOf()).issues }))));
  r.post('/validate', (req, res) => res.json(validateGraph((req.body ?? {}).graph, ctxOf())));

  r.use(requireAuth(platform));

  const find = async (ctx: AuthContext, id: string) => {
    const w = await db().workflow.findFirst({ where: { id, workspaceId: ctx.workspaceId, deletedAt: null }, include: { versions: { orderBy: { version: 'desc' }, take: 1 }, createdBy: { select: { name: true } } } });
    if (!w) throw notFound('Workflow not found');
    return w;
  };
  type Found = Awaited<ReturnType<typeof find>>;
  const view = (w: Found, ctx: AuthContext) => {
    const v = w.versions[0];
    return {
      id: w.id, name: w.name, description: w.description, templateId: w.templateId, projectId: w.projectId, createdBy: w.createdBy?.name ?? null,
      canDelete: w.createdById === ctx.user.id || canManage(ctx.workspaceRole), createdAt: w.createdAt.getTime(), updatedAt: w.updatedAt.getTime(),
      version: v ? { version: v.version, graph: v.graph, valid: v.valid, note: v.note, createdAt: v.createdAt.getTime(), issues: validateGraph(v.graph, ctxOf()).issues } : null
    };
  };

  r.get('/workflows', async (_req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const rows = await db().workflow.findMany({
        where: { workspaceId: ctx.workspaceId, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 100,
        include: {
          versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, valid: true, graph: true } },
          createdBy: { select: { name: true } },
          runs: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, createdAt: true } }
        }
      });
      res.set('Cache-Control', 'private, no-store');
      res.json(rows.map(w => ({
        id: w.id, name: w.name, description: w.description, createdBy: w.createdBy?.name ?? null, updatedAt: w.updatedAt.getTime(),
        version: w.versions[0]?.version ?? null, valid: w.versions[0]?.valid ?? false,
        steps: (w.versions[0]?.graph as { nodes?: unknown[] } | undefined)?.nodes?.length ?? 0,
        lastRun: w.runs[0] ? { status: w.runs[0].status, at: w.runs[0].createdAt.getTime() } : null
      })));
    } catch (err) { next(err); }
  });

  r.post('/workflows', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const body = CreateBody.safeParse(req.body ?? {});
      if (!body.success) return next(badRequest(body.error.issues[0]?.message ?? 'Invalid request'));
      const template = body.data.templateId ? TEMPLATES.find(t => t.id === body.data.templateId) : null;
      if (body.data.templateId && !template) return next(notFound('Template not found'));
      const graphRaw = body.data.graph ?? template?.graph ?? STARTER;
      const shape = GraphSchema.safeParse(graphRaw);
      if (!shape.success) return next(badRequest('The graph is malformed.', { issues: shape.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) }));
      const { issues } = validateGraph(shape.data, ctxOf());
      const w = await db().workflow.create({
        data: {
          workspaceId: ctx.workspaceId, name: body.data.name, description: body.data.description ?? template?.description ?? '', createdById: ctx.user.id, templateId: template?.id ?? null,
          versions: { create: { version: 1, graph: shape.data as Prisma.InputJsonValue, valid: !hasErrors(issues), createdById: ctx.user.id, note: template ? `From the “${template.name}” template` : 'Created' } }
        }
      });
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'workflow.created', targetType: 'workflow', targetId: w.id, ip: req.ip });
      res.status(201).json(view(await find(ctx, w.id), ctx));
    } catch (err) { next(err); }
  });

  r.get('/workflows/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      res.set('Cache-Control', 'private, no-store');
      res.json(view(await find(ctx, req.params.id), ctx));
    } catch (err) { next(err); }
  });

  r.patch('/workflows/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const body = Meta.partial().extend({ projectId: z.string().max(60).nullable().optional() }).strict().safeParse(req.body ?? {});
      if (!body.success) return next(badRequest(body.error.issues[0]?.message ?? 'Invalid request'));
      const w = await find(ctx, req.params.id);
      if (body.data.projectId && !(await accessibleProjectIds(db(), { workspaceId: ctx.workspaceId, userId: ctx.user.id, role: ctx.workspaceRole })).includes(body.data.projectId)) {
        return next(notFound('Project not found'));
      }
      await db().workflow.update({ where: { id: w.id }, data: body.data });
      res.json(view(await find(ctx, w.id), ctx));
    } catch (err) { next(err); }
  });

  r.delete('/workflows/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const w = await find(ctx, req.params.id);
      if (w.createdById !== ctx.user.id && !canManage(ctx.workspaceRole)) return next(new HttpError('FORBIDDEN', 'Only the person who created this workflow, or a workspace admin, can delete it.'));
      // Soft delete: past runs keep their history and still show which workflow they ran.
      await db().workflow.update({ where: { id: w.id }, data: { deletedAt: new Date() } });
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'workflow.deleted', targetType: 'workflow', targetId: w.id, ip: req.ip });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  r.get('/workflows/:id/versions', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const w = await find(ctx, req.params.id);
      const rows = await db().workflowVersion.findMany({ where: { workflowId: w.id }, orderBy: { version: 'desc' }, take: 100, include: { createdBy: { select: { name: true } } } });
      res.json(rows.map(v => ({ version: v.version, valid: v.valid, note: v.note, createdBy: v.createdBy?.name ?? null, createdAt: v.createdAt.getTime(), steps: (v.graph as { nodes?: unknown[] }).nodes?.length ?? 0 })));
    } catch (err) { next(err); }
  });

  r.get('/workflows/:id/versions/:version', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const w = await find(ctx, req.params.id);
      const v = await db().workflowVersion.findUnique({ where: { workflowId_version: { workflowId: w.id, version: Number(req.params.version) || 0 } } });
      if (!v) return next(notFound('Version not found'));
      res.json({ version: v.version, graph: v.graph, valid: v.valid, note: v.note, createdAt: v.createdAt.getTime(), issues: validateGraph(v.graph, ctxOf()).issues });
    } catch (err) { next(err); }
  });

  // Saving creates a new version. A graph with errors can be saved (as a draft that cannot run).
  r.post('/workflows/:id/versions', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const body = SaveBody.safeParse(req.body ?? {});
      if (!body.success) return next(badRequest('Send { graph, note?, baseVersion? }'));
      const shape = GraphSchema.safeParse(body.data.graph);
      if (!shape.success) return next(badRequest('The graph is malformed.', { issues: shape.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) }));
      const { issues } = validateGraph(shape.data, ctxOf());
      const w = await find(ctx, req.params.id);
      const latest = w.versions[0]?.version ?? 0;
      // Optimistic concurrency: refuse to silently overwrite someone else's newer save.
      if (body.data.baseVersion !== undefined && body.data.baseVersion !== latest) {
        return next(new HttpError('CONFLICT', `Someone saved version ${latest} after you opened version ${body.data.baseVersion}. Reload to see their changes.`, { latest }));
      }
      try {
        await db().$transaction([
          db().workflowVersion.create({ data: { workflowId: w.id, version: latest + 1, graph: shape.data as Prisma.InputJsonValue, valid: !hasErrors(issues), note: body.data.note ?? null, createdById: ctx.user.id } }),
          db().workflow.update({ where: { id: w.id }, data: { updatedAt: new Date() } })
        ]);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return next(new HttpError('CONFLICT', 'Someone saved at the same moment. Reload to see their changes.'));
        throw err;
      }
      res.status(201).json({ version: latest + 1, valid: !hasErrors(issues), issues });
    } catch (err) { next(err); }
  });

  r.post('/workflows/:id/runs', limiter.middleware(), async (req, res, next) => {
    try {
      if (!orchestrator) return next(unavailable(deps.orchestrationReason ?? 'Running workflows is not available on this server.'));
      const ctx = authOf(res)!;
      const body = RunBody.safeParse(req.body ?? {});
      if (!body.success) return next(badRequest(body.error.issues[0]?.message ?? 'Invalid request'));
      const rawKey = req.get('Idempotency-Key');
      if (rawKey !== undefined && !IdempotencyKey.safeParse(rawKey).success) return next(badRequest('Idempotency-Key must be 8-100 letters, digits or _ . : -'));
      const w = await find(ctx, req.params.id);
      const v = body.data.version
        ? await db().workflowVersion.findUnique({ where: { workflowId_version: { workflowId: w.id, version: body.data.version } } })
        : w.versions[0];
      if (!v) return next(notFound('Version not found'));
      const { issues } = validateGraph(v.graph, ctxOf());
      if (hasErrors(issues)) return next(badRequest(`Version ${v.version} has errors and cannot run. Fix them in the studio and save.`, { issues: issues.filter((i: GraphIssue) => i.severity === 'error') }));
      if (rawKey) {
        const existing = await db().orchestration.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: ctx.workspaceId, idempotencyKey: rawKey } }, select: { id: true } });
        if (existing) return res.status(200).json({ id: existing.id, created: false });
      }
      const active = await db().orchestration.count({ where: { workspaceId: ctx.workspaceId, userId: ctx.user.id, status: { in: ['PLANNING', 'RUNNING', 'PAUSED', 'SYNTHESIZING'] } } });
      if (active >= MAX_ACTIVE_PER_USER) return next(new HttpError('RATE_LIMITED', `You already have ${MAX_ACTIVE_PER_USER} runs in progress. Wait for one to finish or cancel one.`));
      // Each model-calling step is a model call: charge them up front.
      const modelSteps = (v.graph as { nodes: Array<{ kind: string }> }).nodes.filter(n => n.kind === 'agent' || n.kind === 'llm').length;
      if (modelSteps > 1 && !limiter.charge(req.ip ?? 'unknown', modelSteps - 1)) return limiter.tooMany(res);
      const started = await orchestrator.start({ userId: ctx.user.id, workspaceId: ctx.workspaceId }, body.data.input, rawKey ?? null, { workflowId: w.id, workflowVersionId: v.id, projectId: w.projectId });
      if (started.created) await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'workflow.run', targetType: 'workflow', targetId: w.id, metadata: { version: v.version, orchestrationId: started.id }, ip: req.ip });
      res.status(started.created ? 202 : 200).json(started);
    } catch (err) { next(err); }
  });

  r.get('/workflows/:id/runs', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const w = await find(ctx, req.params.id);
      const rows = await db().orchestration.findMany({
        where: { workflowId: w.id, workspaceId: ctx.workspaceId, ...(canManage(ctx.workspaceRole) ? {} : { userId: ctx.user.id }) },
        orderBy: { createdAt: 'desc' }, take: 30,
        include: { user: { select: { name: true } }, ...workflowInclude, tasks: { select: { status: true } } }
      });
      res.set('Cache-Control', 'private, no-store');
      res.json(rows.map(o => summary(o, ctx)));
    } catch (err) { next(err); }
  });

  return r;
}
