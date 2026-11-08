import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { HttpError, badRequest, notFound } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { authOf, canManage, requireAuth, type AuthContext } from '../../middleware/session.js';
import type { Platform } from '../../platform.js';
import { audit } from '../audit/audit.js';
import { TOOL_NAMES } from '../chat/schema.js';

export const MAX_AGENTS_PER_WORKSPACE = 200;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (s: string) => s.replace(CONTROL, '').trim();

/** The same limits the browser's agent builder and agent files use (client/src/lib/agentFile.ts). */
export const AgentDraftSchema = z.object({
  name: z.string().transform(clean).pipe(z.string().min(1, 'Name is required').max(60, 'Name is too long (max 60)')),
  description: z.string().transform(clean).pipe(z.string().max(200, 'Description is too long (max 200)')).default(''),
  icon: z.string().transform(clean).pipe(z.string().min(1).max(8)).default('🤖'),
  systemPrompt: z.string().transform(clean).pipe(z.string().min(1, 'System prompt is required').max(4000, 'System prompt is too long (max 4000)')),
  temperature: z.number().finite().min(0).max(2).default(0.7),
  tools: z.array(z.string()).max(20).default([]).transform(t => [...new Set(t.filter(x => TOOL_NAMES.has(x)))]),
  visibility: z.enum(['PRIVATE', 'WORKSPACE']).default('WORKSPACE')
});
export type AgentDraftInput = z.infer<typeof AgentDraftSchema>;

/** What the API returns for a custom agent (the browser's CustomAgent shape plus server metadata). */
export interface CustomAgentDto {
  id: string;
  name: string;
  description: string;
  icon: string;
  systemPrompt: string;
  temperature: number;
  tools: string[];
  visibility: 'PRIVATE' | 'WORKSPACE';
  version: number;
  versionId: string;
  createdById: string | null;
  createdByName: string | null;
  canEdit: boolean;
  createdAt: number;
  updatedAt: number;
}

const withLatest = { versions: { orderBy: { version: 'desc' as const }, take: 1 }, createdBy: { select: { name: true } } };
type AgentRow = NonNullable<Awaited<ReturnType<Db['agent']['findFirst']>>> & {
  versions: Array<{ id: string; version: number; name: string; description: string; icon: string; systemPrompt: string; temperature: number; tools: string[] }>;
  createdBy: { name: string } | null;
};

const toDto = (a: AgentRow, ctx: AuthContext): CustomAgentDto => {
  const v = a.versions[0];
  return {
    id: a.id, name: v.name, description: v.description, icon: v.icon, systemPrompt: v.systemPrompt, temperature: v.temperature, tools: v.tools,
    visibility: a.visibility, version: v.version, versionId: v.id, createdById: a.createdById, createdByName: a.createdBy?.name ?? null,
    canEdit: a.createdById === ctx.user.id || canManage(ctx.workspaceRole),
    createdAt: a.createdAt.getTime(), updatedAt: a.updatedAt.getTime()
  };
};

/** Agents this member may see: every WORKSPACE agent, plus their own PRIVATE ones. */
const visibleTo = (ctx: AuthContext) => ({
  workspaceId: ctx.workspaceId,
  OR: [{ visibility: 'WORKSPACE' as const }, { createdById: ctx.user.id }]
});

/** Loads one agent the caller may see, with its newest version. Anything else is a 404 (no existence leaks). */
export async function findVisibleAgent(db: Db, ctx: AuthContext, id: string) {
  const a = await db.agent.findFirst({ where: { id, ...visibleTo(ctx) }, include: withLatest });
  return a as AgentRow | null;
}

export function customAgentsRouter(platform: Platform, log: Logger): Router {
  const r = Router();
  r.use(requireAuth(platform));
  const db = () => platform.db!;

  const create = async (ctx: AuthContext, d: AgentDraftInput) => db().agent.create({
    data: {
      workspaceId: ctx.workspaceId, createdById: ctx.user.id, visibility: d.visibility, currentVersion: 1,
      versions: { create: { version: 1, name: d.name, description: d.description, icon: d.icon, systemPrompt: d.systemPrompt, temperature: d.temperature, tools: d.tools, createdById: ctx.user.id } }
    },
    include: withLatest
  }) as Promise<AgentRow>;

  r.get('/', async (_req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const rows = await db().agent.findMany({ where: visibleTo(ctx), include: withLatest, orderBy: { createdAt: 'asc' } });
      res.json((rows as AgentRow[]).map(a => toDto(a, ctx)));
    } catch (err) { next(err); }
  });

  r.get('/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const a = await findVisibleAgent(db(), ctx, req.params.id);
      if (!a) return next(notFound('Agent not found'));
      res.json(toDto(a, ctx));
    } catch (err) { next(err); }
  });

  r.get('/:id/versions', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      if (!(await findVisibleAgent(db(), ctx, req.params.id))) return next(notFound('Agent not found'));
      const versions = await db().agentVersion.findMany({ where: { agentId: req.params.id }, orderBy: { version: 'desc' }, include: { createdBy: { select: { name: true } } } });
      res.json(versions.map(v => ({ id: v.id, version: v.version, name: v.name, createdAt: v.createdAt.getTime(), createdByName: v.createdBy?.name ?? null })));
    } catch (err) { next(err); }
  });

  r.post('/', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const parsed = AgentDraftSchema.safeParse(req.body);
      if (!parsed.success) return next(badRequest(parsed.error.issues[0].message, parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))));
      if (await db().agent.count({ where: { workspaceId: ctx.workspaceId } }) >= MAX_AGENTS_PER_WORKSPACE) {
        return next(badRequest(`A workspace can hold up to ${MAX_AGENTS_PER_WORKSPACE} custom agents.`));
      }
      const a = await create(ctx, parsed.data);
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'agent.created', targetType: 'agent', targetId: a.id, ip: req.ip });
      res.status(201).json(toDto(a, ctx));
    } catch (err) { next(err); }
  });

  // Bulk import (e.g. the agents a guest built in this browser before signing in). All or nothing.
  const ImportBody = z.object({ agents: z.array(z.unknown()).min(1).max(30) });
  r.post('/import', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const body = ImportBody.safeParse(req.body);
      if (!body.success) return next(badRequest('Send { agents: [...] } with 1 to 30 agents.'));
      const drafts: AgentDraftInput[] = [];
      for (const [i, raw] of body.data.agents.entries()) {
        const p = AgentDraftSchema.safeParse(raw);
        if (!p.success) return next(badRequest(`Agent ${i + 1}: ${p.error.issues[0].message}`));
        drafts.push(p.data);
      }
      const existing = await db().agent.count({ where: { workspaceId: ctx.workspaceId } });
      if (existing + drafts.length > MAX_AGENTS_PER_WORKSPACE) return next(badRequest(`That would exceed ${MAX_AGENTS_PER_WORKSPACE} custom agents in this workspace.`));
      const created = await db().$transaction(drafts.map(d => db().agent.create({
        data: {
          workspaceId: ctx.workspaceId, createdById: ctx.user.id, visibility: d.visibility, currentVersion: 1,
          versions: { create: { version: 1, name: d.name, description: d.description, icon: d.icon, systemPrompt: d.systemPrompt, temperature: d.temperature, tools: d.tools, createdById: ctx.user.id } }
        },
        include: withLatest
      })));
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'agent.imported', metadata: { count: created.length }, ip: req.ip });
      res.status(201).json((created as AgentRow[]).map(a => toDto(a, ctx)));
    } catch (err) { next(err); }
  });

  // An edit creates a new immutable version, so past executions stay traceable to the configuration they used.
  r.patch('/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const a = await findVisibleAgent(db(), ctx, req.params.id);
      if (!a) return next(notFound('Agent not found'));
      if (!(a.createdById === ctx.user.id || canManage(ctx.workspaceRole))) return next(new HttpError('FORBIDDEN', 'Only the agent\'s creator or a workspace admin can edit it.'));
      const latest = a.versions[0];
      const merged = AgentDraftSchema.safeParse({
        name: latest.name, description: latest.description, icon: latest.icon, systemPrompt: latest.systemPrompt,
        temperature: latest.temperature, tools: latest.tools, visibility: a.visibility, ...(req.body ?? {})
      });
      if (!merged.success) return next(badRequest(merged.error.issues[0].message));
      const d = merged.data;
      const configChanged = d.name !== latest.name || d.description !== latest.description || d.icon !== latest.icon || d.systemPrompt !== latest.systemPrompt
        || d.temperature !== latest.temperature || d.tools.join() !== latest.tools.join();
      const next_ = latest.version + 1;
      const updated = await db().agent.update({
        where: { id: a.id },
        data: {
          visibility: d.visibility,
          ...(configChanged && {
            currentVersion: next_,
            versions: { create: { version: next_, name: d.name, description: d.description, icon: d.icon, systemPrompt: d.systemPrompt, temperature: d.temperature, tools: d.tools, createdById: ctx.user.id } }
          })
        },
        include: withLatest
      }) as AgentRow;
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'agent.updated', targetType: 'agent', targetId: a.id, metadata: { version: updated.versions[0].version }, ip: req.ip });
      res.json(toDto(updated, ctx));
    } catch (err) { next(err); }
  });

  r.delete('/:id', async (req, res, next) => {
    try {
      const ctx = authOf(res)!;
      const a = await findVisibleAgent(db(), ctx, req.params.id);
      if (!a) return next(notFound('Agent not found'));
      if (!(a.createdById === ctx.user.id || canManage(ctx.workspaceRole))) return next(new HttpError('FORBIDDEN', 'Only the agent\'s creator or a workspace admin can delete it.'));
      await db().agent.delete({ where: { id: a.id } });
      await audit(db(), log, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, action: 'agent.deleted', targetType: 'agent', targetId: a.id, metadata: { name: a.versions[0].name }, ip: req.ip });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return r;
}
