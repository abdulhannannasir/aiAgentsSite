import { randomUUID } from 'node:crypto';
import cors from 'cors';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import helmet from 'helmet';
import type { AppConfig } from '../config/env.js';
import { HttpError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Gives every request an id (reusing a safe incoming X-Request-Id) and logs one line when it finishes. */
export function requestContext(log: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = id;
    res.setHeader('X-Request-Id', id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (!req.path.startsWith('/api') && req.path !== '/healthz') return; // static assets: not worth a log line
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const entry = { requestId: id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) };
      if (res.statusCode >= 500) log.error(entry, 'request failed');
      else log.info(entry, 'request');
    });
    next();
  };
}

/**
 * Security headers. The CSP fits the built SPA: scripts and connections only to this origin, inline styles
 * allowed (Framer Motion and React write style attributes), data:/blob: images for the generated textures.
 */
export function securityHeaders(cfg: AppConfig): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'worker-src': ["'self'", 'blob:'],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        ...(cfg.env === 'production' ? { 'upgrade-insecure-requests': [] } : {})
      }
    },
    // The app loads nothing cross-origin that needs CORP/COEP opt-in; keep the defaults off so fonts/assets on a CDN work.
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: cfg.env === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false
  });
}

/**
 * CORS: same-origin always works (browsers don't need CORS for it). Other sites may call the API only when
 * listed in CORS_ORIGINS. Credentials are allowed for listed origins so cookie sessions (Phase 2) work there.
 */
export function corsPolicy(cfg: AppConfig): RequestHandler {
  const allowed = new Set(cfg.corsOrigins);
  return cors({
    origin: (origin, cb) => cb(null, !!origin && allowed.has(origin)),
    credentials: true,
    maxAge: 600
  });
}

/** Unknown /api routes get a JSON 404 instead of the SPA's index.html. */
export const apiNotFound: RequestHandler = (req, _res, next) => next(new HttpError('NOT_FOUND', `No API route for ${req.method} ${req.path}`));

/** One error shape for every API failure. Unexpected errors are logged with details and shown as a generic 500. */
export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const requestId = res.locals.requestId as string | undefined;
    // Malformed JSON bodies (express.json) and oversize bodies.
    const type = (err as { type?: string }).type;
    if (type === 'entity.parse.failed') err = new HttpError('VALIDATION_ERROR', 'Request body is not valid JSON');
    else if (type === 'entity.too.large') err = new HttpError('VALIDATION_ERROR', 'Request body is too large');

    if (res.headersSent) {
      log.error({ requestId, err: err instanceof Error ? err.message : String(err) }, 'error after response started');
      res.end();
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, requestId, ...(err.details !== undefined && { details: err.details }) } });
      return;
    }
    log.error({ requestId, method: req.method, path: req.path, err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err) }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.', requestId } });
  };
}
