import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import type { ChatEvent, HealthResponse, MetaResponse } from '../contracts.js';
import { badRequest, notFound } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { openSse } from '../lib/sse.js';
import type { RateLimiter } from '../middleware/rateLimit.js';
import { AGENTS, PUBLIC_AGENTS, findAgent } from '../modules/agents/registry.js';
import { parseCustomAgent, parseHistory } from '../modules/chat/schema.js';
import type { LLMService } from '../modules/providers/llm.js';
import type { ChatAgent } from '../modules/providers/types.js';
import { WORKFLOWS } from '../modules/workflows/definitions.js';
import { findWorkflow, runWorkflow, toPublicWorkflow } from '../modules/workflows/engine.js';

export interface RouteDeps {
  cfg: AppConfig;
  log: Logger;
  llm: LLMService;
  limiter: RateLimiter;
  version: string;
}

export function v1Router({ cfg, log, llm, limiter, version }: RouteDeps): Router {
  const r = Router();
  const publicWorkflows = WORKFLOWS.map(toPublicWorkflow);
  const mode = llm.provider === 'demo' ? 'demo' : 'live';

  r.get('/health', (_req, res) => {
    const body: HealthResponse = { ok: true, mode, provider: llm.provider, agents: AGENTS.length };
    res.json(body);
  });

  r.get('/meta', (_req, res) => {
    const body: MetaResponse = {
      version, mode, provider: llm.provider,
      providers: {
        openai: { configured: !!cfg.openai.apiKey, model: cfg.openai.apiKey ? cfg.openai.model : null },
        gemini: { configured: !!cfg.gemini.apiKey, model: cfg.gemini.apiKey ? cfg.gemini.model : null }
      },
      features: cfg.features
    };
    res.json(body);
  });

  r.get('/agents', (_req, res) => res.json(PUBLIC_AGENTS));
  r.get('/agents/:id', (req, res, next) => {
    const agent = PUBLIC_AGENTS.find(a => a.id === req.params.id);
    if (!agent) return next(notFound());
    res.json(agent);
  });

  r.get('/workflows', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(publicWorkflows);
  });

  r.post('/chat', limiter.middleware(), async (req, res, next) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { message, agentId, workflowId } = body;
    const { limits } = cfg;
    if (typeof message !== 'string' || !message.trim()) return next(badRequest('Missing or invalid fields'));
    if (message.length > limits.maxMessageChars) return next(badRequest(`Message too long (max ${limits.maxMessageChars} characters)`));
    const history = parseHistory(body.history, limits);
    if (!history) return next(badRequest('Invalid history'));

    // Three ways to choose who answers: a multi-agent workflow, a user-defined agent, or a built-in agent.
    let workflow = null;
    let agent: ChatAgent | null = null;
    if (workflowId !== undefined) {
      workflow = typeof workflowId === 'string' ? findWorkflow(workflowId) : undefined;
      if (!workflow) return next(notFound('Workflow not found'));
      // A workflow is several model calls, so charge the rate limiter for the extra ones too.
      if (!limiter.charge(req.ip ?? 'unknown', workflow.steps.length - 1)) return limiter.tooMany(res);
    } else if (body.agent !== undefined) {
      agent = parseCustomAgent(body.agent, limits.maxSystemPromptChars);
      if (!agent) return next(badRequest('Invalid agent'));
    } else {
      if (typeof agentId !== 'string') return next(badRequest('Missing or invalid fields'));
      agent = findAgent(agentId) ?? null;
      if (!agent) return next(notFound('Agent not found'));
    }

    const messages = [...history, { role: 'user' as const, content: message }];
    const sse = openSse<ChatEvent>(res);
    let answer = '';
    try {
      if (workflow) {
        for await (const evt of runWorkflow(workflow, message, sse.signal, { llm, log, maxStepContextChars: limits.maxStepContextChars })) {
          if (evt.type === 'stream') answer += evt.content;
          sse.send(evt);
        }
      } else {
        for await (const chunk of llm.complete(agent!, messages, sse.signal)) {
          answer += chunk;
          sse.send({ type: 'stream', content: chunk });
        }
      }
    } catch (err) {
      log.error({ requestId: res.locals.requestId, err: err instanceof Error ? err.message : String(err) }, 'chat error');
      sse.send({ type: 'error', content: 'The AI service had a problem. Please try again.' });
    }

    if (sse.signal.aborted) return;
    sse.send({ type: 'done', message: answer ? { role: 'assistant', content: answer } : null });
    sse.end();
  });

  return r;
}
