import type { AppConfig } from './config/env.js';
import { createDb, type Db } from './db/client.js';
import type { Logger } from './lib/logger.js';
import { createAuth, type Auth } from './modules/auth/auth.js';
import { createMailer, type Mailer } from './modules/mail/mailer.js';
import { createEmbedder } from './modules/knowledge/embeddings.js';
import { createMemoryService, type MemoryService } from './modules/knowledge/memory.js';
import { createStorage, type Storage } from './modules/storage/storage.js';

/**
 * Optional platform services. The app runs without any of them (guest mode, exactly like before Phase 2);
 * each one switches on when its configuration is present.
 */
export interface Platform {
  db: Db | null;
  auth: Auth | null;
  mailer: Mailer;
  /** Memory and knowledge retrieval (needs the database). */
  memory: MemoryService | null;
  /** Object storage for project files (S3/R2, or a local directory). */
  storage: Storage | null;
  close: () => Promise<void>;
}

export function createPlatform(cfg: AppConfig, log: Logger, overrides: Partial<Pick<Platform, 'db'>> = {}): Platform {
  const db = overrides.db ?? (cfg.databaseUrl ? createDb(cfg.databaseUrl) : null);
  const mailer = createMailer(cfg, log);
  const auth = db && cfg.auth.secret ? createAuth(cfg, db, mailer, log) : null;
  if (cfg.databaseUrl && !cfg.auth.secret) log.warn('DATABASE_URL is set but BETTER_AUTH_SECRET is not: accounts stay disabled');
  if (auth && !mailer.configured) {
    log.warn(cfg.env === 'production'
      ? 'SMTP_URL is not set: verification and password-reset emails cannot be sent'
      : 'SMTP_URL is not set: verification and password-reset emails are logged here instead of sent');
  }
  const memory = db ? createMemoryService({ db, embedder: createEmbedder(cfg, log), log }) : null;
  const storage = createStorage(cfg);
  return {
    db, auth, mailer, memory, storage,
    close: async () => { if (db && !overrides.db) await db.$disconnect(); }
  };
}
