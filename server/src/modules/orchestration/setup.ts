import type { AppConfig } from '../../config/env.js';
import type { Logger } from '../../lib/logger.js';
import type { Platform } from '../../platform.js';
import type { LLMService } from '../providers/llm.js';
import type { ToolRegistry } from '../tools/registry.js';
import { createOrchestrator, type Orchestrator, type OrchestratorOptions } from './engine.js';
import { createBullQueue, createInProcessQueue } from './queue.js';
import { orchestrationStatus } from './routes.js';

export interface OrchestrationSetup {
  orchestrator: Orchestrator | null;
  status: { available: boolean; durable: boolean; worker: boolean; reason?: string };
}

export interface OrchestrationOverrides {
  options?: Partial<OrchestratorOptions>;
  /** Redis key prefix (tests use their own so they never touch real queues). */
  redisPrefix?: string;
  /** Force whether this process consumes jobs. */
  worker?: boolean;
}

/**
 * Picks the job transport: BullMQ when REDIS_URL is set (durable, can be consumed by separate workers), otherwise
 * jobs run in this process (not durable: a restart interrupts them and the recovery sweep re-runs them from the DB).
 */
export function setupOrchestration(cfg: AppConfig, platform: Platform, llm: LLMService, tools: ToolRegistry, log: Logger, overrides: OrchestrationOverrides = {}): OrchestrationSetup {
  const s = orchestrationStatus(cfg, platform);
  const worker = overrides.worker ?? cfg.orchestration.worker;
  if (!s.available) return { orchestrator: null, status: { available: false, durable: false, worker: false, reason: s.reason } };
  const queue = cfg.redisUrl
    ? createBullQueue(cfg.redisUrl, log, { concurrency: cfg.orchestration.workerConcurrency, prefix: overrides.redisPrefix })
    : createInProcessQueue(log, cfg.orchestration.workerConcurrency);
  const orchestrator = createOrchestrator({
    db: platform.db!, llm, tools, log, queue, worker, memory: platform.memory,
    options: { concurrencyPerRun: cfg.orchestration.concurrencyPerRun, retryBaseMs: cfg.orchestration.retryBaseMs, ...overrides.options }
  });
  if (!queue.durable) log.warn('REDIS_URL is not set: orchestration jobs run in this process and are not durable (a restart re-runs interrupted tasks)');
  else if (!worker) log.info('orchestration jobs are queued in Redis; a separate worker process (npm run worker) runs them');
  return { orchestrator, status: { available: true, durable: queue.durable, worker } };
}
