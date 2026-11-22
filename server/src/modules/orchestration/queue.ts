import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Logger } from '../../lib/logger.js';

/** A unit of orchestration work. The database row it names holds all state; a job only says "look at this now". */
export interface Job {
  kind: 'plan' | 'task' | 'synthesize';
  /** Orchestration id (plan, synthesize) or task id (task). */
  id: string;
}

export type JobHandler = (job: Job) => Promise<void>;

export interface JobQueue {
  /** true when jobs survive a restart of this process (Redis). */
  readonly durable: boolean;
  /**
   * Schedules a job. Adding a job that is already waiting with the same `dedupeKey` does nothing, so callers can
   * enqueue freely (recovery sweeps, retries) without running the same work twice at once.
   */
  add(job: Job, opts?: { delayMs?: number; dedupeKey?: string }): Promise<void>;
  /** Starts consuming jobs in this process. */
  work(handler: JobHandler): void;
  close(): Promise<void>;
}

const keyOf = (job: Job, dedupeKey?: string) => dedupeKey ?? `${job.kind}:${job.id}`;

/**
 * Runs jobs inside this process (no Redis). Work in flight is lost if the process stops; the engine's recovery
 * sweep re-queues it from the database when the server starts again, so nothing is silently dropped.
 */
export function createInProcessQueue(log: Logger, concurrency: number): JobQueue {
  const waiting: Array<{ job: Job; key: string }> = [];
  const pending = new Set<string>();
  const timers = new Set<NodeJS.Timeout>();
  let handler: JobHandler | null = null;
  let running = 0;
  let closed = false;

  const pump = () => {
    while (handler && !closed && running < concurrency && waiting.length) {
      const { job, key } = waiting.shift()!;
      pending.delete(key);
      running++;
      handler(job)
        .catch(err => log.error({ job, err: err instanceof Error ? err.message : String(err) }, 'orchestration job crashed'))
        .finally(() => { running--; pump(); });
    }
  };

  const enqueue = (job: Job, key: string) => {
    if (closed || pending.has(key)) return;
    pending.add(key);
    waiting.push({ job, key });
    pump();
  };

  return {
    durable: false,
    async add(job, opts = {}) {
      const key = keyOf(job, opts.dedupeKey);
      if (!opts.delayMs) return enqueue(job, key);
      const t = setTimeout(() => { timers.delete(t); enqueue(job, key); }, opts.delayMs);
      t.unref();
      timers.add(t);
    },
    work(h) { handler = h; pump(); },
    async close() {
      closed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      waiting.length = 0;
    }
  };
}

export const QUEUE_NAME = 'agentverse-orchestration';

/** Parses a redis:// or rediss:// URL into BullMQ connection options (BullMQ needs maxRetriesPerRequest: null). */
export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    ...(u.protocol === 'rediss:' && { tls: {} }),
    maxRetriesPerRequest: null
  };
}

/**
 * Durable jobs in Redis through BullMQ. Jobs survive restarts and can be consumed by separate worker processes
 * (`npm run worker`). If a handler crashes (e.g. the database is briefly unreachable) BullMQ retries the job with
 * exponential backoff; jobs that keep failing stay in the queue's failed set (the dead-letter list) for inspection.
 * Model and tool failures are not job failures: the engine records them on the task and schedules its own retries.
 */
export function createBullQueue(redisUrl: string, log: Logger, opts: { concurrency: number; prefix?: string }): JobQueue {
  const connection = redisConnection(redisUrl);
  const prefix = opts.prefix ?? 'agentverse';
  const queue = new Queue<Job>(QUEUE_NAME, { connection, prefix });
  queue.on('error', err => log.error({ err: err.message }, 'job queue error'));
  let worker: Worker<Job> | null = null;

  return {
    durable: true,
    async add(job, o = {}) {
      // BullMQ ignores an add whose jobId already exists, which gives the dedupe behaviour. Completed jobs are
      // removed, so the same work can be queued again later (a retry or a recovery).
      await queue.add(job.kind, job, {
        jobId: keyOf(job, o.dedupeKey).replace(/:/g, '_'),
        delay: o.delayMs,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: { count: 1000 }
      });
    },
    work(handler) {
      if (worker) return;
      worker = new Worker<Job>(QUEUE_NAME, async j => handler(j.data), { connection, prefix, concurrency: opts.concurrency });
      worker.on('failed', (j, err) => log.error({ job: j?.data, attempts: j?.attemptsMade, err: err.message }, 'orchestration job failed'));
      worker.on('error', err => log.error({ err: err.message }, 'job worker error'));
    },
    async close() {
      await worker?.close();
      await queue.close();
    }
  };
}
