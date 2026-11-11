import type { ApiErrorCode } from '../contracts.js';

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  FEATURE_UNAVAILABLE: 503,
  INTERNAL: 500
};

/** An error that is safe to show the client. Anything else becomes a generic 500 with details only in the logs. */
export class HttpError extends Error {
  readonly status: number;
  constructor(public readonly code: ApiErrorCode, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = STATUS[code];
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError('VALIDATION_ERROR', message, details);
export const notFound = (message = 'Not found') => new HttpError('NOT_FOUND', message);
export const unavailable = (message: string) => new HttpError('FEATURE_UNAVAILABLE', message);
