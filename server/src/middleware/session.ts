import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { HttpError, unavailable } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { Platform } from '../platform.js';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

/** Who is calling, resolved from the session cookie on the server. Never taken from the request body. */
export interface AuthContext {
  user: { id: string; email: string; name: string; emailVerified: boolean; role: string };
  sessionId: string;
  workspaceId: string;
  workspaceRole: WorkspaceRole;
}

const ROLES = new Set<WorkspaceRole>(['owner', 'admin', 'member']);
const asRole = (r: string): WorkspaceRole => (ROLES.has(r as WorkspaceRole) ? (r as WorkspaceRole) : 'member');

/** res.locals.auth: the AuthContext for signed-in requests, or null for guests. */
export const authOf = (res: Response): AuthContext | null => (res.locals.auth as AuthContext | null | undefined) ?? null;

/**
 * Resolves the session (if there is a session cookie) and the active workspace membership. Guests pass through
 * with res.locals.auth = null. The active workspace must be one the user is a member of; if the session points
 * at a workspace they have left, the first remaining membership is used instead.
 */
export function attachAuth(platform: Platform, log: Logger): RequestHandler {
  return async (req, res, next) => {
    res.locals.auth = null;
    const { auth, db } = platform;
    if (!auth || !db || !req.headers.cookie?.includes('better-auth')) return next();
    try {
      const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!result) return next();
      const { user, session } = result;
      const active = (session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
      let member = active ? await db.member.findUnique({ where: { organizationId_userId: { organizationId: active, userId: user.id } } }) : null;
      if (!member) {
        member = await db.member.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
        if (member) await db.session.update({ where: { id: session.id }, data: { activeOrganizationId: member.organizationId } });
      }
      if (!member) return next(new HttpError('FORBIDDEN', 'Your account is not a member of any workspace.'));
      const ctx: AuthContext = {
        user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified, role: (user as { role?: string | null }).role ?? 'user' },
        sessionId: session.id,
        workspaceId: member.organizationId,
        workspaceRole: asRole(member.role)
      };
      res.locals.auth = ctx;
      next();
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'session lookup failed');
      next(err);
    }
  };
}

/** 503 when accounts are not configured on this server; 401 when the caller is not signed in. */
export function requireAuth(platform: Platform): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!platform.auth || !platform.db) return next(unavailable('Accounts are not enabled on this server (DATABASE_URL and BETTER_AUTH_SECRET are required).'));
    if (!authOf(res)) return next(new HttpError('UNAUTHENTICATED', 'Please sign in.'));
    next();
  };
}

/** Workspace roles that may manage content created by others. */
export const canManage = (role: WorkspaceRole) => role === 'owner' || role === 'admin';

/**
 * CSRF defence in depth for our own cookie-authenticated endpoints (Better Auth guards /api/auth itself).
 * A state-changing request that carries a session cookie must come from a trusted origin: BETTER_AUTH_URL,
 * CORS_ORIGINS, or this very host. (SameSite=Lax cookies and JSON-only bodies already block the usual
 * cross-site form posts; this makes the rule explicit.)
 */
export function originGuard(trusted: string[]): RequestHandler {
  const allowed = new Set(trusted);
  return (req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (!req.headers.cookie?.includes('better-auth')) return next();
    const origin = req.get('origin');
    const self = `${req.protocol}://${req.get('host')}`;
    if (!origin || origin === self || allowed.has(origin)) return next();
    next(new HttpError('FORBIDDEN', 'This request came from an untrusted origin.'));
  };
}
