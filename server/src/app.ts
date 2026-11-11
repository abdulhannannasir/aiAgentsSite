import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import type { AppConfig } from './config/env.js';
import { createLogger, type Logger } from './lib/logger.js';
import { apiNotFound, corsPolicy, errorHandler, requestContext, securityHeaders } from './middleware/http.js';
import { RateLimiter } from './middleware/rateLimit.js';
import { attachAuth, originGuard } from './middleware/session.js';
import { toNodeHandler } from 'better-auth/node';
import { unavailable } from './lib/errors.js';
import { customAgentsRouter } from './modules/agents/customAgents.js';
import { marketplaceRouter } from './modules/agents/marketplace.js';
import { executionsRouter } from './modules/executions/routes.js';
import { conversationsRouter } from './modules/chat/conversations.js';
import { accountRouter } from './modules/workspaces/routes.js';
import { createPlatform, type Platform } from './platform.js';
import { createLLMService, type LLMService } from './modules/providers/llm.js';
import { createToolRegistry, type ToolRegistry, type ToolRegistryOptions } from './modules/tools/registry.js';
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
  tools: ToolRegistry;
  platform: Platform;
  /** Stops timers and closes the database pool so tests and graceful shutdown leave nothing running. */
  close: () => Promise<void>;
}

export interface AppOptions {
  logger?: Logger;
  /** Override the demo typing delay (tests use 0). */
  demoDelay?: () => number;
  /** Directory with the built front end. Defaults to <repo>/public. */
  staticDir?: string | null;
  /** Tests: tool options (e.g. let url_fetch reach the local mock server). */
  tools?: Partial<ToolRegistryOptions>;
}

/** Builds the Express app. Used by server.js (local / Docker / Railway), the Vercel function and the tests. */
export function createApp(cfg: AppConfig, opts: AppOptions = {}): AppContext {
  validateWorkflows();
  const log = opts.logger ?? createLogger(cfg.logLevel);
  const tools = createToolRegistry({ tavilyApiKey: cfg.tools.tavilyApiKey, tavilyBaseUrl: cfg.tools.tavilyBaseUrl, ...opts.tools });
  const llm = createLLMService(cfg, log, tools, { demoDelay: opts.demoDelay });
  const limiter = new RateLimiter(cfg.limits.rateLimit.windowMs, cfg.limits.rateLimit.max);
  const platform = createPlatform(cfg, log);

  const app = express();
  app.set('trust proxy', cfg.trustProxy); // Render / Railway / Fly / Vercel sit behind one proxy
  app.disable('x-powered-by');
  app.use(requestContext(log));
  app.use(securityHeaders(cfg));
  app.use('/api', corsPolicy(cfg));
  // Better Auth parses its own request bodies, so it is mounted before express.json().
  app.all('/api/auth/*', platform.auth
    ? toNodeHandler(platform.auth)
    : (_req, _res, next) => next(unavailable('Accounts are not enabled on this server (DATABASE_URL and BETTER_AUTH_SECRET are required).')));
  // History (up to 20 x 8000 chars, some multi-byte) rides along with each chat request.
  app.use(express.json({ limit: '1mb' }));

  const staticDir = opts.staticDir === undefined ? path.join(ROOT, 'public') : opts.staticDir;
  if (staticDir) app.use(express.static(staticDir));

  app.get('/healthz', (_req, res) => res.type('text').send('ok'));

  app.use('/api', originGuard([cfg.auth.baseUrl, ...cfg.corsOrigins]), attachAuth(platform, log));
  const api = v1Router({ cfg, log, llm, tools, limiter, version: readVersion(), platform });
  app.use('/api/v1', accountRouter(platform, log));
  app.use('/api/v1/custom-agents', customAgentsRouter(platform, log, llm));
  app.use('/api/v1/conversations', conversationsRouter(platform, log));
  app.use('/api/v1/marketplace', marketplaceRouter(platform, log));
  app.use('/api/v1/executions', executionsRouter(platform, log));
  app.use('/api/v1', api);
  app.use('/api', api); // unversioned aliases, kept for existing clients
  app.use('/api', apiNotFound);
  app.use(errorHandler(log));

  return { app, cfg, log, llm, tools, platform, close: async () => { limiter.close(); await platform.close(); } };
}
