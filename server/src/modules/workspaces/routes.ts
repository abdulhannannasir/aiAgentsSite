import { Router } from 'express';
import { z } from 'zod';
import { badRequest, notFound } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { authOf, requireAuth } from '../../middleware/session.js';
import type { Platform } from '../../platform.js';
import { audit } from '../audit/audit.js';
import { createWorkspaceFor } from '../auth/auth.js';

export interface WorkspaceSummary { id: string; name: string; slug: string; role: string }

/** GET /me, GET/POST /workspaces, POST /workspaces/:id/activate */
export function accountRouter(platform: Platform, log: Logger): Router {
  const r = Router();
  const needAuth = requireAuth(platform);

  const memberships = async (userId: string): Promise<WorkspaceSummary[]> => {
    const rows = await platform.db!.member.findMany({ where: { userId }, include: { organization: true }, orderBy: { createdAt: 'asc' } });
    return rows.map(m => ({ id: m.organization.id, name: m.organization.name, slug: m.organization.slug, role: m.role }));
  };

  r.get('/me', needAuth, async (_req, res, next) => {
    try {
      const a = authOf(res)!;
      const workspaces = await memberships(a.user.id);
      res.json({ user: a.user, workspace: workspaces.find(w => w.id === a.workspaceId) ?? null, workspaces });
    } catch (err) { next(err); }
  });

  r.get('/workspaces', needAuth, async (_req, res, next) => {
    try { res.json(await memberships(authOf(res)!.user.id)); } catch (err) { next(err); }
  });

  const CreateBody = z.object({ name: z.string().trim().min(1, 'Name is required').max(80, 'Name is too long (max 80)') });
  r.post('/workspaces', needAuth, async (req, res, next) => {
    try {
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) return next(badRequest(parsed.error.issues[0].message));
      const a = authOf(res)!;
      const count = await platform.db!.member.count({ where: { userId: a.user.id } });
      if (count >= 20) return next(badRequest('You can belong to at most 20 workspaces.'));
      const ws = await createWorkspaceFor(platform.db!, a.user.id, parsed.data.name);
      await platform.db!.session.update({ where: { id: a.sessionId }, data: { activeOrganizationId: ws.id } });
      await audit(platform.db!, log, { workspaceId: ws.id, actorId: a.user.id, action: 'workspace.created', targetType: 'workspace', targetId: ws.id, ip: req.ip });
      res.status(201).json({ id: ws.id, name: ws.name, slug: ws.slug, role: 'owner' } satisfies WorkspaceSummary);
    } catch (err) { next(err); }
  });

  r.post('/workspaces/:id/activate', needAuth, async (req, res, next) => {
    try {
      const a = authOf(res)!;
      const member = await platform.db!.member.findUnique({ where: { organizationId_userId: { organizationId: req.params.id, userId: a.user.id } }, include: { organization: true } });
      // Not a member and "does not exist" look the same, so workspace ids can't be probed.
      if (!member) return next(notFound('Workspace not found'));
      await platform.db!.session.update({ where: { id: a.sessionId }, data: { activeOrganizationId: member.organizationId } });
      await audit(platform.db!, log, { workspaceId: member.organizationId, actorId: a.user.id, action: 'workspace.activated', ip: req.ip });
      res.json({ id: member.organization.id, name: member.organization.name, slug: member.organization.slug, role: member.role } satisfies WorkspaceSummary);
    } catch (err) { next(err); }
  });

  return r;
}
