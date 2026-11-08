import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, loadDotEnv } from '../src/config/env.js';

describe('loadConfig', () => {
  it('defaults to demo mode with the documented limits', () => {
    const cfg = loadConfig({});
    expect(cfg.provider).toBe('demo');
    expect(cfg.port).toBe(3000);
    expect(cfg.limits.rateLimit).toEqual({ windowMs: 60_000, max: 20 });
    expect(cfg.gemini.models).toEqual(['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash']);
    expect(cfg.features).toEqual({ database: false, auth: false, email: false, redis: false, storage: false });
  });

  it('follows whichever key is set, OpenAI first, and LLM_PROVIDER can force one', () => {
    expect(loadConfig({ GEMINI_API_KEY: 'g' }).provider).toBe('gemini');
    expect(loadConfig({ OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' }).provider).toBe('openai');
    expect(loadConfig({ OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g', LLM_PROVIDER: 'gemini' }).provider).toBe('gemini');
    expect(loadConfig({ OPENAI_API_KEY: 'o', LLM_PROVIDER: 'DEMO' }).provider).toBe('demo');
    // forcing a provider without its key gives demo, never a broken live mode
    expect(loadConfig({ LLM_PROVIDER: 'openai' }).provider).toBe('demo');
  });

  it('treats blank values as unset', () => {
    const cfg = loadConfig({ OPENAI_API_KEY: '', PORT: '', OPENAI_MODEL: ' ' });
    expect(cfg.provider).toBe('demo');
    expect(cfg.port).toBe(3000);
    expect(cfg.openai.model).toBe('gpt-4o-mini');
  });

  it('parses backups (empty string = none) and drops a duplicate of the primary', () => {
    expect(loadConfig({ GEMINI_FALLBACK_MODELS: '' }).gemini.models).toEqual(['gemini-flash-latest']);
    expect(loadConfig({ GEMINI_MODEL: 'a', GEMINI_FALLBACK_MODELS: 'b, a ,c' }).gemini.models).toEqual(['a', 'b', 'c']);
  });

  it('strips trailing slashes from base URLs and CORS origins', () => {
    const cfg = loadConfig({ OPENAI_BASE_URL: 'https://x.test/v1/', CORS_ORIGINS: 'https://a.test/, https://b.test' });
    expect(cfg.openai.baseUrl).toBe('https://x.test/v1');
    expect(cfg.corsOrigins).toEqual(['https://a.test', 'https://b.test']);
  });

  it('lists every invalid value at once', () => {
    let err: unknown;
    try { loadConfig({ PORT: 'abc', OPENAI_BASE_URL: 'not a url', LLM_PROVIDER: 'claude' }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConfigError);
    const issues = (err as ConfigError).issues.join('\n');
    expect(issues).toMatch(/PORT/);
    expect(issues).toMatch(/OPENAI_BASE_URL/);
    expect(issues).toMatch(/LLM_PROVIDER/);
  });

  it('reports configured features without exposing values', () => {
    const cfg = loadConfig({ DATABASE_URL: 'postgres://x', BETTER_AUTH_SECRET: 's', REDIS_URL: 'redis://x' });
    expect(cfg.features).toMatchObject({ database: true, auth: true, redis: true, email: false, storage: false });
  });
});

describe('loadDotEnv', () => {
  it('reads KEY=value lines, strips quotes, and never overrides real variables', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'av-env-')), '.env');
    fs.writeFileSync(file, 'A=1\nB="two words"\n# comment\nC=from-file\n');
    const env: NodeJS.ProcessEnv = { C: 'real' };
    loadDotEnv(file, env);
    expect(env).toEqual({ A: '1', B: 'two words', C: 'real' });
  });

  it('is a no-op when the file does not exist', () => {
    const env: NodeJS.ProcessEnv = {};
    loadDotEnv('/nonexistent/.env', env);
    expect(env).toEqual({});
  });
});
