import type { RequestHandler, Response } from 'express';

/**
 * In-memory sliding-window rate limiter, per instance. Best-effort only: on serverless hosts each instance has
 * its own counters, so use the host's firewall rules and a provider spending cap for hard limits.
 * (A Redis-backed store replaces this once REDIS_URL is part of the deployment — Phase 5/11.)
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private timer: NodeJS.Timeout;

  constructor(readonly windowMs: number, readonly max: number) {
    this.timer = setInterval(() => this.sweep(), 10 * 60 * 1000);
    this.timer.unref();
  }

  /** Records `cost` requests for this key, or returns false (recording nothing) if that would go over the limit. */
  charge(key: string, cost = 1, now = Date.now()): boolean {
    const hits = (this.hits.get(key) ?? []).filter(t => t > now - this.windowMs);
    if (hits.length + cost > this.max) {
      this.hits.set(key, hits);
      return false;
    }
    for (let i = 0; i < cost; i++) hits.push(now);
    this.hits.set(key, hits);
    return true;
  }

  sweep(now = Date.now()): void {
    for (const [key, hits] of this.hits) {
      if (!hits.length || hits[hits.length - 1] < now - this.windowMs) this.hits.delete(key);
    }
  }

  close(): void {
    clearInterval(this.timer);
  }

  tooMany(res: Response): void {
    res.set('Retry-After', String(Math.ceil(this.windowMs / 1000)));
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests — please wait a minute.', requestId: res.locals.requestId } });
  }

  middleware(): RequestHandler {
    return (req, res, next) => {
      if (!this.charge(req.ip ?? 'unknown', 1)) return this.tooMany(res);
      next();
    };
  }
}
