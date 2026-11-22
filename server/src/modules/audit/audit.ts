import type { Db } from '../../db/client.js';
import { Prisma } from '../../db/client.js';
import type { Logger } from '../../lib/logger.js';

export interface AuditEntry {
  workspaceId?: string | null;
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Appends an audit record. Auditing must never break the action it records, so a failed write is logged
 * (loudly) instead of thrown.
 */
export async function audit(db: Db, log: Logger, e: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        workspaceId: e.workspaceId ?? null, actorId: e.actorId ?? null, action: e.action,
        targetType: e.targetType, targetId: e.targetId, ip: e.ip ?? null,
        metadata: e.metadata ? (e.metadata as Prisma.InputJsonValue) : undefined
      }
    });
  } catch (err) {
    log.error({ action: e.action, err: err instanceof Error ? err.message : String(err) }, 'audit write failed');
  }
}
