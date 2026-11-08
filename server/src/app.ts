import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import type { AppConfig } from './config/env.js';
import { createLogger, type Logger } from './lib/logger.js';
import { apiNotFound, corsPolicy, errorHandler, requestContext, securityHeaders } from './middleware/http.js';
import { RateLimiter } from './middleware/rateLimit.js';
import { createLLMService, type LLMService } from './modules/providers/llm.js';
import { validateWorkflows } from './modules/workflows/engine.js';
import { v1Router } from './routes/v1.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readVersion(): string {
  try {
    return (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface AppContext {
  app: Express;
  cfg: AppConfig;
  log: Logger;
  llm: LLMService;
  /** Stops timers (rate limiter sweep) so tests and graceful shutdown leave nothing running. */
  close: () => void;
}

export interface AppOptions {
  logger?: Logger;
  /** Override the demo typing delay (tests use 0). */
  demoDelay?: () => number;
  /** Directory with the built front end. Defaults to <repo>/public. */
  staticDir?: string | null;
}

/** Builds the Express app. Used by server.js (local / Docker / Railway), the Vercel function and the tests. */
export function createApp(cfg: AppConfig, opts: AppOptions = {}): AppContext {
  validateWorkflows();
  const log = opts.logger ?? createLogger(cfg.logLevel);
  const llm = createLLMService(cfg, log, { demoDelay: opts.demoDelay });
  const limiter = new RateLimiter(cfg.limits.rateLimit.windowMs, cfg.limits.rateLimit.max);

  const app = express();
  app.set('trust proxy', cfg.trustProxy); // Render / Railway / Fly / Vercel sit behind one proxy
  app.disable('x-powered-by');
  app.use(requestContext(log));
  app.use(securityHeaders(cfg));
  app.use('/api', corsPolicy(cfg));
  // History (up to 20 x 8000 chars, some multi-byte) rides along with each chat request.
  app.use(express.json({ limit: '1mb' }));

  const staticDir = opts.staticDir === undefined ? path.join(ROOT, 'public') : opts.staticDir;
  if (staticDir) app.use(express.static(staticDir));

  app.get('/healthz', (_req, res) => res.type('text').send('ok'));

  const api = v1Router({ cfg, log, llm, limiter, version: readVersion() });
  app.use('/api/v1', api);
  app.use('/api', api); // unversioned aliases, kept for existing clients
  app.use('/api', apiNotFound);
  app.use(errorHandler(log));

  return { app, cfg, log, llm, close: () => limiter.close() };
}
