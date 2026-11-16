// A process that only runs orchestration jobs from Redis (no HTTP server). Run it next to the API on a long-running
// host (e.g. a second Railway service with the same environment):  npm run worker
// The API can then run anywhere, including serverless hosts, and only queues work.
import { ConfigError, loadConfig, loadDotEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createPlatform } from './platform.js';
import { setupOrchestration } from './modules/orchestration/setup.js';
import { createLLMService } from './modules/providers/llm.js';
import { createToolRegistry } from './modules/tools/registry.js';

loadDotEnv();

let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
const log = createLogger(cfg.logLevel);
if (!cfg.redisUrl) {
  log.fatal('The worker needs REDIS_URL. Without Redis, the API server runs orchestration jobs itself (not durable).');
  process.exit(1);
}

const tools = createToolRegistry({ tavilyApiKey: cfg.tools.tavilyApiKey, tavilyBaseUrl: cfg.tools.tavilyBaseUrl });
const llm = createLLMService(cfg, log, tools);
const platform = createPlatform(cfg, log);
const { orchestrator, status } = setupOrchestration(cfg, platform, llm, tools, log, { worker: true });
if (!orchestrator) {
  log.fatal({ reason: status.reason }, 'orchestration is not available with this configuration');
  process.exit(1);
}
log.info({ provider: llm.provider, model: llm.model, concurrency: cfg.orchestration.workerConcurrency }, 'orchestration worker started');

const shutdown = (signal: string) => {
  log.info({ signal }, 'worker shutting down');
  // Running jobs are abandoned; their leases expire and another worker (or this one after a restart) picks them up.
  void orchestrator.close().then(() => platform.close()).finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
};
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => shutdown(sig));
