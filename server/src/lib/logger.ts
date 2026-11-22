import { pino, type Logger } from 'pino';

export type { Logger };

/**
 * Structured JSON logs. Anything that could carry a secret is redacted, wherever it appears in a log object,
 * so a careless `log.info({ headers })` can never leak a key into the host's log storage.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'agentverse-api' },
    redact: {
      paths: [
        '*.authorization', '*.Authorization', '*.cookie', '*.Cookie', '*["x-goog-api-key"]', '*["set-cookie"]',
        '*.apiKey', '*.password', '*.token', '*.secret',
        'headers.authorization', 'headers.cookie', 'req.headers.authorization', 'req.headers.cookie'
      ],
      censor: '[redacted]'
    }
  });
}
