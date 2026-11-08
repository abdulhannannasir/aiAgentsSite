import { createApp, type AppContext } from './app.js';
import { ConfigError, loadConfig, loadDotEnv } from './config/env.js';

loadDotEnv();

let ctx: AppContext;
try {
  ctx = createApp(loadConfig());
} catch (err) {
  // Configuration problems are listed in full so a deploy log says exactly what to fix.
  console.error(err instanceof ConfigError ? err.message : err);
  throw err;
}

/** The Express app built from process.env. Vercel's function and server.js both use this instance. */
export const app = ctx.app;

/** Listens on PORT and shuts down cleanly on SIGTERM/SIGINT (Render, Railway, Docker). */
export function start(): void {
  const { cfg, log, llm } = ctx;
  const server = ctx.app.listen(cfg.port, () => {
    log.info({ port: cfg.port, provider: llm.provider, model: llm.model }, `AgentVerse running at http://localhost:${cfg.port}`);
    log.info(llm.provider === 'demo' ? 'Mode: DEMO (instant canned replies, no API key needed)' : `Mode: LIVE AI (${llm.provider}${cfg.provider === 'gemini' ? `, ${cfg.gemini.models.join(' -> ')}` : `, ${llm.model}`})`);
  });
  const shutdown = (signal: string) => {
    log.info({ signal }, 'shutting down');
    server.close(() => { void ctx.close().finally(() => process.exit(0)); });
    // Open SSE streams keep the server alive; don't wait for them forever.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => shutdown(sig));
}
