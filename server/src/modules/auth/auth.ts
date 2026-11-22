import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { admin, organization } from 'better-auth/plugins';
import { adminAc, userAc } from 'better-auth/plugins/admin/access';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import type { Logger } from '../../lib/logger.js';
import { audit } from '../audit/audit.js';
import type { Mailer } from '../mail/mailer.js';

/** A short, unique, URL-safe slug for a new personal workspace. */
const workspaceSlug = (name: string) =>
  `${name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'workspace'}-${randomUUID().slice(0, 8)}`;

/** Creates a workspace with `userId` as its owner. Used for the personal workspace every new account gets. */
export async function createWorkspaceFor(db: Db, userId: string, name: string) {
  return db.organization.create({
    data: {
      id: randomUUID(), name: name.slice(0, 80), slug: workspaceSlug(name),
      members: { create: { id: randomUUID(), userId, role: 'owner' } }
    }
  });
}

/**
 * Better Auth with email + password, email verification, password reset, database sessions (httpOnly cookies),
 * the organization plugin (workspaces with owner / admin / member roles) and the admin plugin (platform roles).
 */
export function createAuth(cfg: AppConfig, db: Db, mailer: Mailer, log: Logger) {
  if (!cfg.auth.secret) throw new Error('createAuth needs BETTER_AUTH_SECRET');

  return betterAuth({
    appName: 'AgentVerse',
    baseURL: cfg.auth.baseUrl,
    basePath: '/api/auth',
    secret: cfg.auth.secret,
    database: prismaAdapter(db, { provider: 'postgresql' }),
    trustedOrigins: [cfg.auth.baseUrl, ...cfg.corsOrigins],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: cfg.auth.requireEmailVerification,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await mailer.send({
          to: user.email,
          subject: 'Reset your AgentVerse password',
          text: `Hi ${user.name},\n\nSomeone asked to reset the password for this AgentVerse account. To choose a new password, open:\n\n${url}\n\nThe link works for one hour. If it wasn't you, ignore this email; your password stays the same.`
        });
      }
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.send({
          to: user.email,
          subject: 'Confirm your AgentVerse email',
          text: `Hi ${user.name},\n\nWelcome to AgentVerse. Confirm your email address by opening:\n\n${url}\n\nThe link works for 24 hours.`
        });
      }
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // a week
      updateAge: 60 * 60 * 24      // refreshed at most daily while in use
    },
    rateLimit: { enabled: cfg.env !== 'test', window: 60, max: 60 },
    advanced: {
      // Better Auth turns origin/CSRF checks off by itself under test runners. Pin them on, so the tests exercise
      // exactly what runs in production.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      useSecureCookies: cfg.env === 'production',
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] }
    },
    databaseHooks: {
      user: {
        create: {
          // Every account starts with its own workspace, so there is always somewhere to keep data.
          after: async user => {
            const ws = await createWorkspaceFor(db, user.id, `${user.name.split(' ')[0] || 'My'}'s workspace`);
            await audit(db, log, { workspaceId: ws.id, actorId: user.id, action: 'user.signed_up', targetType: 'user', targetId: user.id });
          }
        }
      },
      session: {
        create: {
          // Open each new session in the user's first workspace.
          before: async session => {
            if (session.activeOrganizationId) return;
            const first = await db.member.findFirst({ where: { userId: session.userId }, orderBy: { createdAt: 'asc' }, select: { organizationId: true } });
            return { data: { ...session, activeOrganizationId: first?.organizationId ?? null } };
          },
          after: async session => {
            await audit(db, log, { workspaceId: (session.activeOrganizationId as string | null) ?? null, actorId: session.userId, action: 'session.created', ip: session.ipAddress ?? null });
          }
        }
      }
    },
    plugins: [
      organization({ allowUserToCreateOrganization: true, creatorRole: 'owner', membershipLimit: 100, organizationLimit: 20 }),
      // Platform roles. superadmin has the admin permissions today; it is kept distinct so later phases can
      // reserve platform-wide operations (billing overrides, abuse handling) for it.
      admin({ roles: { user: userAc, admin: adminAc, superadmin: adminAc }, defaultRole: 'user', adminRoles: ['admin', 'superadmin'] })
    ]
  });
}

export type Auth = ReturnType<typeof createAuth>;
