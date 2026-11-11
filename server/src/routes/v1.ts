import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import type { ChatEvent, HealthResponse, MetaResponse } from '../contracts.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { openSse } from '../lib/sse.js';
import type { RateLimiter } from '../middleware/rateLimit.js';
import { authOf } from '../middleware/session.js';
import { findVisibleAgent } from '../modules/agents/customAgents.js';
import { finishRun, startRun, type Run, type TraceStepRecord } from '../modules/chat/persistence.js';
import type { Platform } from '../platform.js';
import { examplesFor } from '../modules/agents/examples.js';
import { AGENTS, PUBLIC_AGENTS, findAgent } from '../modules/agents/registry.js';
import { parseCustomAgent, parseHistory } from '../modules/chat/schema.js';
import type { LLMService } from '../modules/providers/llm.js';
import type { ToolRegistry } from '../modules/tools/registry.js';
import type { ChatAgent } from '../modules/providers/types.js';
import { WORKFLOWS } from '../modules/workflows/definitions.js';
import { addUsage, findWorkflow, newMeter, runWorkflow, toPublicWorkflow } from '../modules/workflows/engine.js';
import { runningExecutions } from '../modules/executions/running.js';
import { ProviderError } from '../modules/providers/types.js';

export interface RouteDeps {
  cfg: AppConfig;
  log: Logger;
  llm: LLMService;
  tools: ToolRegistry;
  limiter: RateLimiter;
  version: string;
  platform: Platform;
}

export function v1Router({ cfg, log, llm, tools, limiter, version, platform }: RouteDeps): Router {
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
      // "auth" means accounts actually work here (database + secret + a working auth module).
      features: { ...cfg.features, auth: !!platform.auth, email: platform.mailer.configured }
    };
    res.json(body);
  });

  // What can run here: providers and the models agents may be pinned to; tools and why any are unavailable.
  r.get('/models', (_req, res) => res.json(llm.catalog()));
  r.get('/tools', (_req, res) => res.json(tools.list()));

  r.get('/agents', (_req, res) => res.json(PUBLIC_AGENTS));
  r.get('/agents/:id', (req, res, next) => {
    const agent = PUBLIC_AGENTS.find(a => a.id === req.params.id);
    if (!agent) return next(notFound());
    // The detail view adds example prompts and the workflows the agent takes part in.
    res.json({ ...agent, examples: examplesFor(agent.id), workflows: WORKFLOWS.filter(w => w.steps.some(st => st.agentId === agent.id)).map(w => w.id) });
  });

  r.get('/workflows', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(publicWorkflows);
  });

  r.post('/chat', limiter.middleware(), async (req, res, next) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { message, agentId, workflowId } = body;
    const { limits } = cfg;
    const ctx = authOf(res);
    if (typeof message !== 'string' || !message.trim()) return next(badRequest('Missing or invalid fields'));
    if (message.length > limits.maxMessageChars) return next(badRequest(`Message too long (max ${limits.maxMessageChars} characters)`));
    let history = parseHistory(body.history, limits);
    if (!history) return next(badRequest('Invalid history'));
    for (const k of ['conversationId', 'customAgentId', 'threadKey'] as const) {
      if (body[k] !== undefined && (typeof body[k] !== 'string' || !(body[k] as string) || (body[k] as string).length > 120)) return next(badRequest(`Invalid ${k}`));
    }

    // Who answers: a multi-agent workflow, a saved custom agent (signed in), an ad-hoc custom agent, or a built-in agent.
    let workflow = null;
    let agent: ChatAgent | null = null;
    let savedAgent: { id: string; versionId: string } | null = null;
    try {
      if (workflowId !== undefined) {
        workflow = typeof workflowId === 'string' ? findWorkflow(workflowId) : undefined;
        if (!workflow) return next(notFound('Workflow not found'));
        // A workflow is several model calls, so charge the rate limiter for the extra ones too.
        if (!limiter.charge(req.ip ?? 'unknown', workflow.steps.length - 1)) return limiter.tooMany(res);
      } else if (body.customAgentId !== undefined) {
        if (!ctx || !platform.db) return next(new HttpError('UNAUTHENTICATED', 'Sign in to use saved agents.'));
        const a = await findVisibleAgent(platform.db, ctx, body.customAgentId as string);
        if (!a) return next(notFound('Agent not found'));
        const v = a.versions[0];
        agent = {
          name: v.name, description: v.description, systemPrompt: v.systemPrompt, temperature: v.temperature, tools: v.tools,
          provider: v.provider as ChatAgent['provider'], model: v.model, greeting: `I'm ${v.name}. How can I help?`
        };
        savedAgent = { id: a.id, versionId: v.id };
      } else if (body.agent !== undefined) {
        agent = parseCustomAgent(body.agent, limits.maxSystemPromptChars);
        if (!agent) return next(badRequest('Invalid agent'));
      } else {
        if (typeof agentId !== 'string') return next(badRequest('Missing or invalid fields'));
        agent = findAgent(agentId) ?? null;
        if (!agent) return next(notFound('Agent not found'));
      }
    } catch (err) { return next(err); }

    // Signed-in chats are saved. The thread is keyed like the browser's: a built-in agent id or "custom:<id>".
    const threadKey = savedAgent ? `custom:${savedAgent.id}`
      : typeof body.threadKey === 'string' && (findAgent(body.threadKey) || body.threadKey.startsWith('custom:')) ? body.threadKey
      : typeof agentId === 'string' && !workflow ? agentId : null;
    const persist = !!(ctx && platform.db && threadKey && (!threadKey.startsWith('custom:') || savedAgent || (workflow && await isVisibleCustomKey(threadKey))));
    // Which provider/model will actually answer (an agent may be pinned to a model; workflows use the default).
    const adapter = agent ? llm.resolve(agent) : null;
    const answeredBy = agent ? { provider: adapter?.id ?? 'demo', model: adapter?.model ?? null } : { provider: llm.provider, model: llm.model };
    let run: Run | null = null;
    if (persist) {
      try {
        run = await startRun(platform.db!, ctx!, {
          conversationId: (body.conversationId as string | undefined) ?? null, agentKey: threadKey!, agentId: savedAgent?.id, agentVersionId: savedAgent?.versionId,
          workflowId: workflow?.id, message, provider: answeredBy.provider, model: answeredBy.model, maxHistory: limits.maxHistoryMessages, maxHistoryChars: limits.maxHistoryChars
        });
        history = run.history;
      } catch (err) { return next(err); }
    }

    const messages = [...history, { role: 'user' as const, content: message }];
    const sse = openSse<ChatEvent>(res);
    // The run stops when the browser goes away, or when someone cancels it through the executions API.
    const cancel = new AbortController();
    const signal = AbortSignal.any([sse.signal, cancel.signal]);
    if (run) {
      runningExecutions.add(run.executionId, { controller: cancel, workspaceId: ctx!.workspaceId, userId: ctx!.user.id });
      sse.send({ type: 'conversation', id: run.conversationId, executionId: run.executionId });
    }
    let answer = '';
    let failure: string | null = null;
    const meter = newMeter();
    const trace = new Map<string, TraceStepRecord>();
    const toolRuns = new Map<string, { toolId: string; label: string; input: Record<string, unknown>; ok: boolean; summary: string; durationMs: number }>();
    try {
      if (workflow) {
        for await (const evt of runWorkflow(workflow, message, signal, { llm, log, maxStepContextChars: limits.maxStepContextChars, meter })) {
          if (evt.type === 'stream') answer += evt.content;
          else if (evt.type === 'plan') for (const st of evt.steps) trace.set(st.id, { ...st, output: '' });
          else if (evt.type === 'step') { const t = trace.get(evt.id); if (t) t.status = evt.status; }
          else if (evt.type === 'step_delta') { const t = trace.get(evt.id); if (t) t.output += evt.content; }
          else if (evt.type === 'error') failure = evt.content;
          sse.send(evt);
        }
      } else {
        // Each extra model call (after a tool result) counts against the caller's rate limit too.
        const allowExtraCall = () => limiter.charge(req.ip ?? 'unknown', 1);
        for await (const ev of llm.run({ agent: agent!, history: messages, signal, allowExtraCall })) {
          if (ev.type === 'text') { answer += ev.text; sse.send({ type: 'stream', content: ev.text }); }
          else if (ev.type === 'model_call') meter.modelCalls++;
          else if (ev.type === 'usage') addUsage(meter, ev.inputTokens, ev.outputTokens);
          else if (ev.type === 'tool_start') {
            toolRuns.set(ev.id, { toolId: ev.tool, label: ev.label, input: ev.input, ok: false, summary: '', durationMs: 0 });
            sse.send({ type: 'tool', id: ev.id, tool: ev.tool, label: ev.label, status: 'running', input: ev.input });
          } else if (ev.type === 'tool_end') {
            const t = toolRuns.get(ev.id);
            if (t) Object.assign(t, { ok: ev.ok, summary: ev.summary, durationMs: ev.durationMs });
            sse.send({ type: 'tool', id: ev.id, tool: ev.tool, label: t?.label ?? ev.tool, status: ev.ok ? 'done' : 'error', summary: ev.summary, durationMs: ev.durationMs });
          }
        }
      }
    } catch (err) {
      if (!signal.aborted) {
        log.error({ requestId: res.locals.requestId, err: err instanceof Error ? err.message : String(err) }, 'chat error');
        failure = err instanceof ProviderError ? err.userMessage : 'The AI service had a problem. Please try again.';
        sse.send({ type: 'error', content: failure });
      }
    }
    const cancelledByRequest = cancel.signal.aborted && !sse.signal.aborted;

    if (run) {
      runningExecutions.remove(run.executionId);
      const status = signal.aborted ? 'CANCELLED' : failure || !answer.trim() ? 'FAILED' : 'COMPLETED';
      await finishRun(platform.db!, ctx!, run, {
        status, output: answer, error: failure ?? (status === 'FAILED' ? 'The agent returned an empty reply.' : status === 'CANCELLED' ? 'Cancelled.' : null),
        trace: workflow ? [...trace.values()] : undefined, workflowId: workflow?.id, modelCalls: meter.modelCalls,
        provider: answeredBy.provider, model: answeredBy.model, inputTokens: meter.inputTokens, outputTokens: meter.outputTokens,
        tools: [...toolRuns.values()].map(({ label: _l, ...t }) => t)
      }).catch(err => log.error({ err: err instanceof Error ? err.message : String(err) }, 'saving the chat run failed'));
    }

    if (sse.signal.aborted) return;
    if (cancelledByRequest) sse.send({ type: 'error', content: 'This run was cancelled.' });
    sse.send({ type: 'done', message: answer ? { role: 'assistant', content: answer } : null });
    sse.end();

    async function isVisibleCustomKey(key: string) {
      return !!(await findVisibleAgent(platform.db!, ctx!, key.slice('custom:'.length)));
    }
  });

  return r;
}
