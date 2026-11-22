import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ProviderId } from '../contracts.js';

/**
 * Tiny .env loader (no extra dependency). Real environment variables always win, so hosts that inject
 * variables (Vercel, Railway, Docker) are never overridden by a stray file.
 */
export function loadDotEnv(file = path.resolve(process.cwd(), '.env'), env: NodeJS.ProcessEnv = process.env): void {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return; // no .env file: fine
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(blankToUndefined, z.string().optional());
const num = (fallback: number) => z.preprocess(blankToUndefined, z.coerce.number().finite().nonnegative().default(fallback));
const stripSlash = (s: string) => s.replace(/\/+$/, '');

const EnvSchema = z.object({
  NODE_ENV: z.preprocess(blankToUndefined, z.enum(['development', 'production', 'test']).default('development')),
  PORT: num(3000),
  LOG_LEVEL: z.preprocess(blankToUndefined, z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional()),

  // Comma-separated origins allowed to call the API from another site. Empty = same-origin only.
  CORS_ORIGINS: optionalString,
  // How many proxies sit in front of the app (Render / Railway / Vercel: 1). Used for client IPs.
  TRUST_PROXY: num(1),

  LLM_PROVIDER: z.preprocess(v => (typeof v === 'string' ? v.toLowerCase() : v), z.preprocess(blankToUndefined, z.enum(['openai', 'gemini', 'demo']).optional())),

  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: z.preprocess(blankToUndefined, z.string().default('gpt-4o-mini')),
  // Models agents may be pinned to (comma-separated). Default: just OPENAI_MODEL.
  OPENAI_MODELS: optionalString,
  OPENAI_BASE_URL: z.preprocess(blankToUndefined, z.string().url().default('https://api.openai.com/v1')).transform(stripSlash),

  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.preprocess(blankToUndefined, z.string().default('gemini-flash-latest')),
  GEMINI_BASE_URL: z.preprocess(blankToUndefined, z.string().url().default('https://generativelanguage.googleapis.com/v1beta')).transform(stripSlash),
  // Unset = default backups; set to an empty string = no backups.
  GEMINI_FALLBACK_MODELS: z.string().optional(),
  // Models agents may be pinned to (comma-separated). Default: GEMINI_MODEL and its backups.
  GEMINI_MODELS: optionalString,
  GEMINI_RETRY_DELAY_MS: num(400),
  GEMINI_TIMEOUT_MS: num(8000),
  GEMINI_DEADLINE_MS: num(16000),
  GEMINI_IDLE_MS: num(30000),

  // Tools. Web search uses the Tavily Search API; without a key the tool is listed as awaiting configuration.
  TAVILY_API_KEY: optionalString,
  TAVILY_BASE_URL: z.preprocess(blankToUndefined, z.string().url().optional()),

  RATE_LIMIT_MAX: num(20),
  RATE_LIMIT_WINDOW_MS: num(60_000),

  // Later phases. Only their presence is reported (GET /api/v1/meta); values are never exposed.
  DATABASE_URL: optionalString,
  // 32+ random characters. Signs session cookies and tokens.
  BETTER_AUTH_SECRET: z.preprocess(blankToUndefined, z.string().min(32, 'must be at least 32 characters (e.g. `openssl rand -base64 32`)').optional()),
  // The public URL of the app (used in email links and as a trusted origin). Default: http://localhost:<PORT>
  BETTER_AUTH_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  // true/false. Default: required when email delivery (SMTP_URL) is configured, otherwise not.
  REQUIRE_EMAIL_VERIFICATION: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional()),
  SMTP_URL: z.preprocess(blankToUndefined, z.string().regex(/^smtps?:\/\//, 'must start with smtp:// or smtps://').optional()),
  MAIL_FROM: z.preprocess(blankToUndefined, z.string().default('AgentVerse <no-reply@localhost>')),
  REDIS_URL: z.preprocess(blankToUndefined, z.string().regex(/^rediss?:\/\//, 'must start with redis:// or rediss://').optional()),
  // Object storage for project files (Phase 7): any S3-compatible service, e.g. Cloudflare R2.
  S3_BUCKET: optionalString,
  // R2: https://<account id>.r2.cloudflarestorage.com. Empty = AWS S3.
  S3_ENDPOINT: z.preprocess(blankToUndefined, z.string().url().optional()).transform(v => (v ? stripSlash(v) : v)),
  S3_REGION: z.preprocess(blankToUndefined, z.string().default('auto')),
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional()),
  // Without S3: files are kept in this directory (NODE_ENV=development default: ./data/uploads; never use on serverless hosts).
  STORAGE_DIR: optionalString,
  MAX_UPLOAD_MB: num(10),
  // Embeddings for semantic memory search. Default: the provider whose key is set (OpenAI first). none = keyword search only.
  EMBEDDING_PROVIDER: z.preprocess(v => (typeof v === 'string' ? v.toLowerCase() : v), z.preprocess(blankToUndefined, z.enum(['openai', 'gemini', 'none']).optional())),
  OPENAI_EMBEDDING_MODEL: z.preprocess(blankToUndefined, z.string().default('text-embedding-3-small')),
  GEMINI_EMBEDDING_MODEL: z.preprocess(blankToUndefined, z.string().default('gemini-embedding-001')),

  // Orchestration (Phase 5). Whether this process also consumes orchestration jobs. Default: on, except on
  // serverless hosts (Vercel), where a separate `npm run worker` process must do it.
  ORCHESTRATION_WORKER: z.preprocess(blankToUndefined, z.enum(['on', 'off']).optional()),
  ORCHESTRATION_CONCURRENCY: num(2),
  WORKER_CONCURRENCY: num(4),
  ORCHESTRATION_RETRY_BASE_MS: num(2000),
  // Set by Vercel on its build and runtime.
  VERCEL: optionalString
});

export interface GeminiConfig {
  apiKey: string | null;
  model: string;
  /** Raw GEMINI_MODELS: models agents may be pinned to. */
  selectableModels?: string;
  /** Primary model first, then the backups, without duplicates. */
  models: string[];
  baseUrl: string;
  attemptsPerModel: number;
  retryDelayMs: number;
  timeoutMs: number;
  deadlineMs: number;
  idleMs: number;
}

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  port: number;
  logLevel: string;
  corsOrigins: string[];
  trustProxy: number;
  provider: ProviderId;
  openai: { apiKey: string | null; model: string; baseUrl: string; models?: string };
  tools: { tavilyApiKey: string | null; tavilyBaseUrl?: string };
  gemini: GeminiConfig;
  limits: {
    maxMessageChars: number;
    maxHistoryMessages: number;
    maxHistoryChars: number;
    maxSystemPromptChars: number;
    maxStepContextChars: number;
    rateLimit: { windowMs: number; max: number };
  };
  features: { database: boolean; auth: boolean; email: boolean; redis: boolean; storage: boolean };
  databaseUrl: string | null;
  auth: {
    secret: string | null;
    baseUrl: string;
    requireEmailVerification: boolean;
  };
  mail: { smtpUrl: string | null; from: string };
  redisUrl: string | null;
  storage: {
    /** s3 (S3_BUCKET + keys), local (STORAGE_DIR, or ./data/uploads outside production), or null (files unavailable). */
    driver: 's3' | 'local' | null;
    s3: { bucket: string; endpoint?: string; region: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean } | null;
    dir: string | null;
    maxUploadBytes: number;
  };
  embeddings: { provider: 'openai' | 'gemini' | null; model: string | null; apiKey: string | null; baseUrl: string | null };
  orchestration: {
    /** This process consumes orchestration jobs. */
    worker: boolean;
    /** Running on a serverless host: work cannot continue after a response, so a queue (Redis) is required. */
    serverless: boolean;
    concurrencyPerRun: number;
    workerConcurrency: number;
    retryBaseMs: number;
  };
}

export class ConfigError extends Error {
  constructor(public issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Which provider answers chat. By default it follows whichever key is set (OpenAI first if both are).
 * LLM_PROVIDER forces one; forcing a provider whose key is missing gives demo, as before.
 */
function pickProvider(want: ProviderId | undefined, openaiKey?: string, geminiKey?: string): ProviderId {
  if (want === 'demo') return 'demo';
  if (want === 'openai') return openaiKey ? 'openai' : 'demo';
  if (want === 'gemini') return geminiKey ? 'gemini' : 'demo';
  return openaiKey ? 'openai' : geminiKey ? 'gemini' : 'demo';
}

/** Parses and validates the environment. Throws ConfigError with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  const e = parsed.data;
  // Partial S3 settings are a mistake worth stopping for (files would silently go somewhere else).
  const s3Parts = [e.S3_BUCKET, e.S3_ACCESS_KEY_ID, e.S3_SECRET_ACCESS_KEY];
  if (s3Parts.some(Boolean) && !s3Parts.every(Boolean)) {
    throw new ConfigError(['S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together (or none of them).']);
  }
  const embedProvider = e.EMBEDDING_PROVIDER === 'none' ? null
    : e.EMBEDDING_PROVIDER === 'openai' ? (e.OPENAI_API_KEY ? 'openai' : null)
    : e.EMBEDDING_PROVIDER === 'gemini' ? (e.GEMINI_API_KEY ? 'gemini' : null)
    : e.OPENAI_API_KEY ? 'openai' : e.GEMINI_API_KEY ? 'gemini' : null;
  const storageDir = e.STORAGE_DIR ?? (e.NODE_ENV === 'development' && !e.VERCEL ? path.resolve(process.cwd(), 'data/uploads') : null);
  const fallbacks = (e.GEMINI_FALLBACK_MODELS ?? 'gemini-flash-lite-latest,gemini-2.5-flash')
    .split(',').map(s => s.trim()).filter(Boolean);

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    corsOrigins: (e.CORS_ORIGINS ?? '').split(',').map(s => stripSlash(s.trim())).filter(Boolean),
    trustProxy: e.TRUST_PROXY,
    provider: pickProvider(e.LLM_PROVIDER, e.OPENAI_API_KEY, e.GEMINI_API_KEY),
    openai: { apiKey: e.OPENAI_API_KEY ?? null, model: e.OPENAI_MODEL, baseUrl: e.OPENAI_BASE_URL, models: e.OPENAI_MODELS },
    tools: { tavilyApiKey: e.TAVILY_API_KEY ?? null, tavilyBaseUrl: e.TAVILY_BASE_URL },
    gemini: {
      apiKey: e.GEMINI_API_KEY ?? null,
      model: e.GEMINI_MODEL,
      selectableModels: e.GEMINI_MODELS,
      models: [e.GEMINI_MODEL, ...fallbacks.filter(m => m !== e.GEMINI_MODEL)],
      baseUrl: e.GEMINI_BASE_URL,
      attemptsPerModel: 2,
      retryDelayMs: e.GEMINI_RETRY_DELAY_MS,
      timeoutMs: e.GEMINI_TIMEOUT_MS,
      deadlineMs: e.GEMINI_DEADLINE_MS,
      idleMs: e.GEMINI_IDLE_MS
    },
    limits: {
      maxMessageChars: 4000,
      maxHistoryMessages: 20,
      maxHistoryChars: 8000,
      maxSystemPromptChars: 4000,
      maxStepContextChars: 6000,
      rateLimit: { windowMs: e.RATE_LIMIT_WINDOW_MS, max: e.RATE_LIMIT_MAX }
    },
    features: {
      database: !!e.DATABASE_URL,
      auth: !!e.DATABASE_URL && !!e.BETTER_AUTH_SECRET,
      email: !!e.SMTP_URL,
      redis: !!e.REDIS_URL,
      storage: !!e.S3_BUCKET || !!storageDir
    },
    databaseUrl: e.DATABASE_URL ?? null,
    auth: {
      secret: e.BETTER_AUTH_SECRET ?? null,
      baseUrl: stripSlash(e.BETTER_AUTH_URL ?? `http://localhost:${e.PORT}`),
      requireEmailVerification: e.REQUIRE_EMAIL_VERIFICATION ? e.REQUIRE_EMAIL_VERIFICATION === 'true' : !!e.SMTP_URL
    },
    mail: { smtpUrl: e.SMTP_URL ?? null, from: e.MAIL_FROM },
    redisUrl: e.REDIS_URL ?? null,
    storage: {
      driver: e.S3_BUCKET ? 's3' : storageDir ? 'local' : null,
      s3: e.S3_BUCKET ? {
        bucket: e.S3_BUCKET, endpoint: e.S3_ENDPOINT, region: e.S3_REGION, accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
        forcePathStyle: e.S3_FORCE_PATH_STYLE === 'true'
      } : null,
      dir: e.S3_BUCKET ? null : storageDir,
      maxUploadBytes: Math.max(1, Math.min(100, e.MAX_UPLOAD_MB)) * 1024 * 1024
    },
    embeddings: {
      provider: embedProvider,
      model: embedProvider === 'openai' ? e.OPENAI_EMBEDDING_MODEL : embedProvider === 'gemini' ? e.GEMINI_EMBEDDING_MODEL : null,
      apiKey: embedProvider === 'openai' ? e.OPENAI_API_KEY! : embedProvider === 'gemini' ? e.GEMINI_API_KEY! : null,
      baseUrl: embedProvider === 'openai' ? e.OPENAI_BASE_URL : embedProvider === 'gemini' ? e.GEMINI_BASE_URL : null
    },
    orchestration: {
      worker: e.ORCHESTRATION_WORKER ? e.ORCHESTRATION_WORKER === 'on' : !e.VERCEL,
      serverless: !!e.VERCEL,
      concurrencyPerRun: Math.max(1, Math.min(6, Math.floor(e.ORCHESTRATION_CONCURRENCY))),
      workerConcurrency: Math.max(1, Math.min(32, Math.floor(e.WORKER_CONCURRENCY))),
      retryBaseMs: e.ORCHESTRATION_RETRY_BASE_MS
    }
  };
}
