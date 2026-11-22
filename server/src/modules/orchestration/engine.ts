import type { Db } from '../../db/client.js';
import { Prisma } from '../../db/client.js';
import type { Logger } from '../../lib/logger.js';
import { findAgent } from '../agents/registry.js';
import type { LLMService, LlmEvent } from '../providers/llm.js';
import { ProviderError, type ChatAgent, type ProviderErrorKind } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import { PlanError, citedKeys, demoPlan, extractJson, plannerPrompt, validatePlan, type Plan } from './plan.js';
import type { Job, JobQueue } from './queue.js';
import { compileGraph, evaluateCondition, extractPath, renderTemplate, type CompiledConfig, type ConditionOperator } from '../studio/graph.js';
import { graphContext } from '../studio/context.js';
import { accessibleProjectIds, assembleContext, knowledgeSearcher, type MemoryActor, type MemoryScopeT, type MemoryService, type SearchScope } from '../knowledge/memory.js';
import type { WorkspaceRole } from '../../middleware/session.js';

/** A step that cannot succeed by trying again (bad JSON, a tool refused its input, ...). Shown to the user as is. */
class StepError extends Error {}

export interface OrchestratorOptions {
  /** Tasks of one orchestration that may run at the same time. */
  concurrencyPerRun: number;
  /** First retry delay; each further retry doubles it. */
  retryBaseMs: number;
  /** How long a worker owns a task without renewing its lease. An expired lease means the worker died. */
  leaseMs: number;
  /** Hard limit for one attempt of one task. */
  taskTimeoutMs: number;
  /** How much of each dependency's output a task is given. */
  maxContextChars: number;
  /** Run the background recovery sweep (only where a worker consumes jobs). */
  recoverEveryMs: number | null;
}

export const DEFAULT_ORCHESTRATOR_OPTIONS: OrchestratorOptions = {
  concurrencyPerRun: 2, retryBaseMs: 2000, leaseMs: 120_000, taskTimeoutMs: 180_000, maxContextChars: 6000, recoverEveryMs: 30_000
};

export const MAX_ATTEMPTS = 3;
const MAX_OUTPUT_CHARS = 20_000;
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED']);
const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set(['quota', 'unavailable', 'timeout', 'network', 'empty']);

/** Tools that reach outside the server (and bring untrusted content back) need a person's approval in an autonomous run. */
export const needsApproval = (tools: ToolRegistry, toolIds: string[]) =>
  toolIds.filter(id => tools.isExternal(id));

interface Usage { modelCalls: number; inputTokens: number | null; outputTokens: number | null }
const noUsage = (): Usage => ({ modelCalls: 0, inputTokens: null, outputTokens: null });

export interface Actor { userId: string; workspaceId: string }

export interface Orchestrator {
  readonly durable: boolean;
  /** Whether this process consumes jobs. Without a worker, durable jobs wait for `npm run worker`. */
  readonly worker: boolean;
  /** Starts a planner run, or (with `workflow`) a run of a saved studio workflow version on `goal` as its input. */
  start(actor: Actor, goal: string, idempotencyKey?: string | null, extra?: { workflowId?: string; workflowVersionId?: string; projectId?: string | null }): Promise<{ id: string; created: boolean }>;
  cancel(orchestrationId: string): Promise<boolean>;
  /** No new tasks start while paused; running ones finish. */
  pause(orchestrationId: string): Promise<boolean>;
  resume(orchestrationId: string): Promise<boolean>;
  decide(approvalId: string, actor: Actor, approve: boolean, note?: string | null): Promise<'ok' | 'not_pending'>;
  retryTask(orchestrationId: string, taskKey: string): Promise<'ok' | 'not_failed'>;
  recover(): Promise<void>;
  handle(job: Job): Promise<void>;
  close(): Promise<void>;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) return resolve();
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/**
 * The orchestration engine. Every state change is a conditional update on the database row ("move from X to Y
 * only if it is still X"), so duplicate or late jobs, several workers and restarts cannot run a step twice or
 * overwrite each other. The queue only carries "look at this row now".
 *
 *   PLANNING ──plan──▶ RUNNING ──all tasks done──▶ SYNTHESIZING ──▶ COMPLETED
 *       │                 │  (a task failed for good) ──▶ FAILED ──retry task──▶ RUNNING
 *       └──── cancel at any point ──▶ CANCELLED
 *
 * Tasks: PENDING ─deps done─▶ [WAITING_APPROVAL ─approved─▶] QUEUED ─claimed─▶ RUNNING ─▶ SUCCEEDED
 *        RUNNING ─retryable error─▶ QUEUED (after backoff) … ─out of attempts / permanent error─▶ FAILED
 *        a dependency failed, or approval rejected ─▶ SKIPPED
 */
export function createOrchestrator(deps: {
  db: Db; llm: LLMService; tools: ToolRegistry; log: Logger; queue: JobQueue; worker: boolean; options?: Partial<OrchestratorOptions>;
  /** Knowledge retrieval for tasks that use the knowledge base (null without a database). */
  memory?: MemoryService | null;
}): Orchestrator {
  const { db, llm, tools, log, queue } = deps;
  const o: OrchestratorOptions = { ...DEFAULT_ORCHESTRATOR_OPTIONS, ...deps.options };
  // Work running in this process, so a cancel here stops it at once (other processes notice within one heartbeat).
  const local = new Map<string, Set<AbortController>>();
  let sweep: NodeJS.Timeout | null = null;
  let closed = false;

  const track = (orchestrationId: string, c: AbortController) => {
    let set = local.get(orchestrationId);
    if (!set) local.set(orchestrationId, (set = new Set()));
    set.add(c);
    return () => { set!.delete(c); if (!set!.size) local.delete(orchestrationId); };
  };

  const enqueueTask = (taskId: string, attempt: number, delayMs = 0) =>
    queue.add({ kind: 'task', id: taskId }, { delayMs, dedupeKey: `task:${taskId}:${attempt}` });

  /** Adds usage to the orchestration's totals and appends usage records (as it happens, so retries never double-count). */
  async function recordUsage(orch: { id: string; workspaceId: string; userId: string | null; provider: string; model: string | null }, u: Usage) {
    if (!u.modelCalls && u.inputTokens == null) return;
    await db.$executeRaw`UPDATE orchestrations SET "modelCalls" = "modelCalls" + ${u.modelCalls},
      "inputTokens" = CASE WHEN ${u.inputTokens}::int IS NULL THEN "inputTokens" ELSE COALESCE("inputTokens", 0) + ${u.inputTokens}::int END,
      "outputTokens" = CASE WHEN ${u.outputTokens}::int IS NULL THEN "outputTokens" ELSE COALESCE("outputTokens", 0) + ${u.outputTokens}::int END
      WHERE id = ${orch.id}`;
    const base = { workspaceId: orch.workspaceId, userId: orch.userId, provider: orch.provider, model: orch.model };
    const rows: Prisma.UsageRecordCreateManyInput[] = [];
    if (u.modelCalls) rows.push({ ...base, kind: 'AI_REQUEST', quantity: u.modelCalls });
    if (u.inputTokens != null) rows.push({ ...base, kind: 'INPUT_TOKENS', quantity: u.inputTokens });
    if (u.outputTokens != null) rows.push({ ...base, kind: 'OUTPUT_TOKENS', quantity: u.outputTokens });
    if (rows.length) await db.usageRecord.createMany({ data: rows });
  }

  /** Runs one model call as `agent` and collects its text, usage and tool calls. */
  async function runAgent(agent: ChatAgent, prompt: string, signal: AbortSignal, usage: Usage, useTools: boolean,
    onTool?: (ev: Extract<LlmEvent, { type: 'tool_end' }>) => void, knowledge?: (q: string) => Promise<string>): Promise<string> {
    let text = '';
    for await (const ev of llm.run({ agent, history: [{ role: 'user', content: prompt }], signal, useTools, toolContext: knowledge ? { knowledge } : undefined })) {
      if (signal.aborted) break;
      if (ev.type === 'text') text += ev.text;
      else if (ev.type === 'model_call') usage.modelCalls++;
      else if (ev.type === 'usage') { usage.inputTokens = (usage.inputTokens ?? 0) + ev.inputTokens; usage.outputTokens = (usage.outputTokens ?? 0) + ev.outputTokens; }
      else if (ev.type === 'tool_end') onTool?.(ev);
    }
    return text;
  }

  /**
   * Keeps a long step alive and watchable: renews the lease (or touches the row) and aborts the step when `stillMine`
   * says the work was cancelled or taken over elsewhere.
   */
  function heartbeat(controller: AbortController, renew: () => Promise<boolean>) {
    const t = setInterval(() => {
      renew().then(ok => { if (!ok) controller.abort(); }).catch(err => log.warn({ err: errText(err) }, 'heartbeat failed'));
    }, Math.max(50, Math.floor(o.leaseMs / 3)));
    t.unref();
    return () => clearInterval(t);
  }

  /** Model calls with retries for transient provider errors (planning and synthesis run inline in one job). */
  async function withRetries<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const retryable = !(err instanceof ProviderError) || RETRYABLE.has(err.kind);
        if (signal.aborted || !retryable || attempt >= MAX_ATTEMPTS || err instanceof PlanError) throw err;
        log.warn({ attempt, err: errText(err) }, 'orchestration model call failed; retrying');
        await sleep(o.retryBaseMs * 2 ** (attempt - 1), signal);
      }
    }
  }

  async function failOrchestration(id: string, from: 'PLANNING' | 'RUNNING' | 'SYNTHESIZING', error: string) {
    await db.orchestration.updateMany({ where: { id, status: from }, data: { status: 'FAILED', error, endedAt: new Date() } });
  }

  // ------------------------------------------------------------------ planning

  async function plan(orchestrationId: string) {
    const orch = await db.orchestration.findUnique({ where: { id: orchestrationId } });
    if (!orch || orch.status !== 'PLANNING') return;
    const controller = new AbortController();
    const untrack = track(orch.id, controller);
    const stop = heartbeat(controller, async () =>
      (await db.orchestration.updateMany({ where: { id: orch.id, status: 'PLANNING' }, data: { updatedAt: new Date() } })).count === 1);
    const usage = noUsage();
    let result: Plan;
    if (orch.workflowVersionId) {
      stop(); untrack();
      return planFromWorkflow(orch.id, orch.workflowVersionId);
    }
    try {
      if (llm.provider === 'demo') {
        result = demoPlan(orch.goal);
      } else {
        const planner: ChatAgent = { name: 'Planner', systemPrompt: plannerPrompt(tools), tools: [], temperature: 0.2 };
        result = await withRetries(controller.signal, async () => {
          const first = await runAgent(planner, `Goal:\n${orch.goal}`, controller.signal, usage, false);
          try {
            return validatePlan(extractJson(first), tools);
          } catch (err) {
            if (!(err instanceof PlanError) || controller.signal.aborted) throw err;
            // One repair attempt: show the planner what was wrong with its plan.
            log.info({ orchestrationId: orch.id, err: err.message }, 'plan rejected; asking the planner to fix it');
            const fixed = await runAgent(planner,
              `Goal:\n${orch.goal}\n\nYour previous plan was rejected: ${err.message}\nPrevious reply:\n${first.slice(0, 4000)}\n\nReply with ONLY the corrected JSON object.`,
              controller.signal, usage, false);
            return validatePlan(extractJson(fixed), tools);
          }
        });
      }
    } catch (err) {
      stop(); untrack();
      await recordUsage(orch, usage);
      if (controller.signal.aborted) return;
      log.error({ orchestrationId: orch.id, err: errText(err) }, 'planning failed');
      const why = err instanceof ProviderError ? err.userMessage : err instanceof PlanError ? 'The planner did not produce a valid plan. Try rephrasing the goal.' : 'Planning failed unexpectedly.';
      await failOrchestration(orch.id, 'PLANNING', why);
      return;
    }
    stop(); untrack();
    await recordUsage(orch, usage);
    // Write the plan only if the orchestration is still planning (it may have been cancelled meanwhile).
    const saved = await db.$transaction(async tx => {
      const moved = await tx.orchestration.updateMany({ where: { id: orch.id, status: 'PLANNING' }, data: { status: 'RUNNING', planSummary: result.summary } });
      if (moved.count !== 1) return false;
      await tx.orchestrationTask.createMany({
        data: result.tasks.map(t => ({ orchestrationId: orch.id, key: t.key, title: t.title, agentId: t.agentId, instruction: t.instruction, tools: t.tools, dependsOn: t.dependsOn, maxAttempts: MAX_ATTEMPTS }))
      });
      return true;
    });
    if (saved) await advance(orch.id);
  }

  /** Studio runs: the plan is the saved graph, compiled into tasks (no model call). */
  async function planFromWorkflow(orchestrationId: string, versionId: string) {
    const version = await db.workflowVersion.findUnique({ where: { id: versionId } });
    let compiled;
    try {
      if (!version) throw new Error('The workflow version no longer exists.');
      compiled = compileGraph(version.graph, graphContext(tools));
    } catch (err) {
      // The graph was valid when saved; this only happens if this server has fewer agents or tools now.
      log.warn({ orchestrationId, err: errText(err) }, 'workflow could not be compiled');
      await failOrchestration(orchestrationId, 'PLANNING', `${errText(err)} Open the workflow in the studio to fix it.`.slice(0, 2000));
      return;
    }
    const saved = await db.$transaction(async tx => {
      const moved = await tx.orchestration.updateMany({ where: { id: orchestrationId, status: 'PLANNING' }, data: { status: 'RUNNING', planSummary: `Workflow version ${version!.version}` } });
      if (moved.count !== 1) return false;
      await tx.orchestrationTask.createMany({
        data: compiled.map(t => ({
          orchestrationId, key: t.key, title: t.title, kind: t.kind, nodeId: t.nodeId, config: t.config as unknown as Prisma.InputJsonValue,
          agentId: t.agentId, instruction: t.instruction, tools: t.tools, dependsOn: t.dependsOn, maxAttempts: t.kind === 'agent' || t.kind === 'llm' ? MAX_ATTEMPTS : 1
        }))
      });
      return true;
    });
    if (saved) await advance(orchestrationId);
  }

  // ------------------------------------------------------------------ scheduling

  /**
   * The scheduler: skips tasks whose dependencies failed, asks for approval where a task's tools need it, queues
   * ready tasks up to the concurrency limit, and moves the orchestration on when every task has finished.
   * Serialised per orchestration with a transaction-scoped advisory lock.
   */
  async function advance(orchestrationId: string) {
    const jobs: Array<() => Promise<void>> = [];
    await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orchestrationId}))`;
      const orch = await tx.orchestration.findUnique({ where: { id: orchestrationId }, include: { tasks: { include: { approval: true }, orderBy: { createdAt: 'asc' } } } });
      if (!orch || orch.status !== 'RUNNING') return;
      const status = new Map(orch.tasks.map(t => [t.key, t.status as string]));
      let active = orch.tasks.filter(t => t.status === 'QUEUED' || t.status === 'RUNNING').length;

      const output = new Map(orch.tasks.map(t => [t.key, t.output]));
      const title = new Map(orch.tasks.map(t => [t.key, t.title]));
      for (const t of [...orch.tasks].sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)))) {
        if (t.status !== 'PENDING') continue;
        const cfg = t.config as CompiledConfig | null;
        const join = cfg?.join ?? 'all';
        // A dependency is ok (succeeded, and on the right branch if it is a condition), blocked, or still pending.
        const state = (d: string): ['ok' | 'blocked' | 'waiting', string] => {
          const s = status.get(d) ?? '';
          const branch = cfg?.branches?.[d];
          if (s === 'SUCCEEDED') return branch && output.get(d) !== branch ? ['blocked', `the condition “${title.get(d)}” took the other branch`] : ['ok', ''];
          if (['FAILED', 'SKIPPED', 'CANCELLED'].includes(s)) return ['blocked', `${d} did not complete`];
          return ['waiting', ''];
        };
        const states = t.dependsOn.map(state);
        const skip = join === 'all' ? states.find(([s]) => s === 'blocked')
          : !states.some(([s]) => s === 'waiting') && !states.some(([s]) => s === 'ok') ? states[0] : undefined;
        if (skip) {
          await tx.orchestrationTask.update({ where: { id: t.id }, data: { status: 'SKIPPED', error: `Skipped because ${skip[1]}.`, endedAt: new Date() } });
          status.set(t.key, 'SKIPPED');
          continue;
        }
        const ready = join === 'all' ? states.every(([s]) => s === 'ok') : !states.some(([s]) => s === 'waiting');
        if (!ready) continue;

        // A human gate: the Approval step itself, or a task whose tools reach outside the server.
        const gated = t.kind === 'approval' ? [] : needsApproval(tools, t.tools);
        if ((t.kind === 'approval' || gated.length) && t.approval?.status !== 'APPROVED') {
          if (!t.approval) {
            const message = String(cfg?.settings?.message ?? '').trim();
            await tx.approvalRequest.create({
              data: {
                workspaceId: orch.workspaceId, orchestrationId: orch.id, taskId: t.id, requestedById: orch.userId, tools: gated,
                reason: t.kind === 'approval'
                  ? (message ? renderTemplate(message, varsFor(orch.goal, orch.tasks, cfg)) : `“${t.title}” is waiting for your approval before the workflow continues.`).slice(0, 1000)
                  : `${t.key} “${t.title}” wants to use ${gated.join(' and ')}, which sends requests to outside services and reads untrusted content.`
              }
            });
          }
          await tx.orchestrationTask.update({ where: { id: t.id }, data: { status: 'WAITING_APPROVAL' } });
          status.set(t.key, 'WAITING_APPROVAL');
          continue;
        }
        if (active >= o.concurrencyPerRun) continue;
        const delayMs = t.kind === 'delay' ? Number(cfg?.settings?.seconds ?? 0) * 1000 : 0;
        await tx.orchestrationTask.update({ where: { id: t.id }, data: { status: 'QUEUED', runAfter: delayMs ? new Date(Date.now() + delayMs) : null } });
        status.set(t.key, 'QUEUED');
        active++;
        jobs.push(() => enqueueTask(t.id, t.attempt + 1, delayMs));
      }

      const all = [...status.values()];
      if (!all.every(s => TERMINAL.has(s))) return;
      const failed = orch.tasks.filter(t => status.get(t.key) === 'FAILED').map(t => t.key);
      if (orch.workflowVersionId && !failed.length) {
        // Studio runs: the result is what the Output steps produced (no synthesis call).
        const outputs = await tx.orchestrationTask.findMany({ where: { orchestrationId: orch.id, kind: 'output', status: 'SUCCEEDED' }, select: { key: true, output: true } });
        outputs.sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
        const result = outputs.map(x => x.output ?? '').filter(x => x.trim()).join('\n\n');
        await tx.orchestration.update({
          where: { id: orch.id },
          data: result
            ? { status: 'COMPLETED', output: result.slice(0, MAX_OUTPUT_CHARS), sources: outputs.map(x => x.key), error: null, endedAt: new Date() }
            : { status: 'FAILED', error: 'No Output step produced a result (every path to an Output was skipped or empty).', endedAt: new Date() }
        });
        return;
      }
      if (failed.length) {
        await tx.orchestration.update({ where: { id: orch.id }, data: { status: 'FAILED', endedAt: new Date(), error: `${failed.join(', ')} failed after ${MAX_ATTEMPTS} attempts or with a permanent error. Retry ${failed.length > 1 ? 'them' : 'it'} to continue.` } });
      } else if (!all.includes('SUCCEEDED')) {
        await tx.orchestration.update({ where: { id: orch.id }, data: { status: 'FAILED', endedAt: new Date(), error: 'No task completed, so there is nothing to combine.' } });
      } else {
        await tx.orchestration.update({ where: { id: orch.id }, data: { status: 'SYNTHESIZING' } });
        jobs.push(() => queue.add({ kind: 'synthesize', id: orch.id }));
      }
    });
    for (const j of jobs) await j();
  }

  // ------------------------------------------------------------------ tasks

  /**
   * What a run may read from memory: the person who started it (their own memories, the workspace, the run's project if
   * they can still see it) and, for agent tasks, that agent's memory. Null when the starter left the workspace.
   */
  async function memoryScope(orch: { workspaceId: string; userId: string | null; projectId: string | null }, agentKeys: string[] | 'all', scopes?: MemoryScopeT[]): Promise<{ scope: SearchScope; actor: MemoryActor } | null> {
    if (!deps.memory || !orch.userId) return null;
    const member = await db.member.findUnique({ where: { organizationId_userId: { organizationId: orch.workspaceId, userId: orch.userId } }, select: { role: true } });
    if (!member) return null;
    const actor: MemoryActor = { workspaceId: orch.workspaceId, userId: orch.userId, role: member.role as WorkspaceRole };
    const visible = orch.projectId ? await accessibleProjectIds(db, actor) : [];
    return { actor, scope: { workspaceId: orch.workspaceId, userId: orch.userId, projectIds: orch.projectId && visible.includes(orch.projectId) ? [orch.projectId] : [], agentKeys, scopes } };
  }
  async function knowledgeFor(orch: { workspaceId: string; userId: string | null; projectId: string | null }, agentKey: string, toolIds: string[]) {
    if (!toolIds.includes('knowledge_base') || !deps.memory) return undefined;
    const ms = await memoryScope(orch, [agentKey]);
    return ms ? knowledgeSearcher(deps.memory, ms.scope, ms.actor) : undefined;
  }

  const succeededTasks = (orchestrationId: string) =>
    db.orchestrationTask.findMany({ where: { orchestrationId, status: 'SUCCEEDED' }, select: { key: true, title: true, nodeId: true, output: true } });

  /** Template values: {{input}} is the run input; {{node_id}} the result of that (upstream) step, if it ran. */
  function varsFor(goal: string, done: Array<{ key: string; nodeId?: string | null; output: string | null; status?: string }>, cfg: CompiledConfig | null): Record<string, string> {
    const values: Record<string, string> = { input: goal };
    const byKey = new Map(done.filter(t => !t.status || t.status === 'SUCCEEDED').map(t => [t.key, t.output ?? '']));
    for (const [nodeId, key] of Object.entries(cfg?.vars ?? {})) if (byKey.has(key)) values[nodeId] = byKey.get(key)!;
    return values;
  }

  /** Steps that run without a model: they transform data, call one tool, branch, or pass their input on. */
  async function runStep(task: { id: string; orchestrationId: string; kind: string; title: string; dependsOn: string[]; tools: string[] }, cfg: CompiledConfig,
    orch: { goal: string; workspaceId: string; userId: string | null; projectId: string | null },
    signal: AbortSignal, onTool: (ev: { tool: string; ok: boolean; summary: string; durationMs: number }) => void): Promise<string> {
    const goal = orch.goal;
    const done = await succeededTasks(task.orchestrationId);
    const vars = varsFor(goal, done, cfg);
    const s = cfg.settings;
    const sep = typeof s.separator === 'string' ? s.separator : '\n\n';
    const merged = done.filter(t => task.dependsOn.includes(t.key)).sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1))).map(t => t.output ?? '').join(sep);
    const tpl = (field: string, fallback: string) => { const t = String(s[field] ?? '').trim(); return t ? renderTemplate(t, vars) : fallback; };
    switch (cfg.kind) {
      case 'input': return goal;
      case 'template': return renderTemplate(String(s.text ?? ''), vars);
      case 'merge': case 'delay': case 'approval': return merged;
      case 'output': return tpl('template', merged);
      case 'condition': {
        try { return String(evaluateCondition(tpl('source', merged), s.operator as ConditionOperator, String(s.value ?? ''), !!s.caseSensitive)); }
        catch { throw new StepError('The condition\'s pattern is not a valid regular expression.'); }
      }
      case 'extract': {
        try { return extractPath(tpl('source', merged), String(s.path)); }
        catch (err) { throw new StepError(errText(err)); }
      }
      case 'tool': {
        const def = tools.forAgent([String(s.toolId)])[0];
        if (!def) throw new StepError(`The tool ${String(s.toolId)} is not available on this server.`);
        const args = Object.fromEntries(Object.entries((s.args as Record<string, string>) ?? {}).map(([k, v]) => [k, renderTemplate(v, vars)]));
        const r = await tools.run(def, args, { signal, log });
        onTool({ tool: def.id, ok: r.ok, summary: r.summary, durationMs: r.durationMs });
        if (!r.ok) throw new StepError(`${def.label}: ${r.summary}`);
        return r.output;
      }
      case 'knowledge': {
        const query = tpl('query', merged).slice(0, 1000);
        if (!query.trim()) throw new StepError('The search query is empty.');
        const ms = await memoryScope(orch, 'all', (s.scopes as MemoryScopeT[] | undefined)?.length ? s.scopes as MemoryScopeT[] : undefined);
        if (!ms || !deps.memory) throw new StepError('Knowledge search needs the person who started the run to still be in the workspace.');
        const started = Date.now();
        const r = await deps.memory.search(ms.scope, query, { limit: Number(s.limit ?? 5), actor: ms.actor });
        const ctx = assembleContext(r.hits, o.maxContextChars);
        onTool({ tool: 'knowledge_base', ok: true, summary: `${ctx.sources.length} result${ctx.sources.length === 1 ? '' : 's'} for “${query.slice(0, 80)}”${r.semantic ? '' : ' (keyword matching only)'}`, durationMs: Date.now() - started });
        return ctx.sources.length ? ctx.text : 'No matching notes or documents were found.';
      }
      default: throw new StepError(`Unknown step type ${cfg.kind}.`);
    }
  }

  async function runTask(taskId: string) {
    const now = new Date();
    const claimed = await db.orchestrationTask.updateMany({
      where: { id: taskId, status: 'QUEUED', OR: [{ runAfter: null }, { runAfter: { lte: now } }], orchestration: { status: 'RUNNING' } },
      data: { status: 'RUNNING', attempt: { increment: 1 }, leaseUntil: new Date(now.getTime() + o.leaseMs), startedAt: now }
    });
    if (claimed.count !== 1) return; // done, cancelled, not due yet, or another worker has it
    const task = await db.orchestrationTask.findUniqueOrThrow({ where: { id: taskId }, include: { orchestration: true } });
    const orch = task.orchestration;
    const attempt = task.attempt;
    const def = findAgent(task.agentId);
    const inputs = task.dependsOn.length
      ? (await db.orchestrationTask.findMany({ where: { orchestrationId: orch.id, key: { in: task.dependsOn }, status: 'SUCCEEDED' }, select: { key: true, title: true, output: true } }))
        .sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)))
      : [];

    const controller = new AbortController();
    const untrack = track(orch.id, controller);
    const timeout = AbortSignal.timeout(o.taskTimeoutMs);
    const signal = AbortSignal.any([controller.signal, timeout]);
    const stop = heartbeat(controller, async () => (await db.orchestrationTask.updateMany({
      where: { id: task.id, status: 'RUNNING', attempt, orchestration: { status: { in: ['RUNNING', 'PAUSED'] } } },
      data: { leaseUntil: new Date(Date.now() + o.leaseMs) }
    })).count === 1);

    const usage = noUsage();
    const toolCalls: Array<{ tool: string; ok: boolean; summary: string; durationMs: number }> = [];
    let text = '';
    let error: unknown = null;
    const cfg = task.config as CompiledConfig | null;
    const onTool = (ev: { tool: string; ok: boolean; summary: string; durationMs: number }) => toolCalls.push({ tool: ev.tool, ok: ev.ok, summary: ev.summary.slice(0, 300), durationMs: ev.durationMs });
    try {
      if (cfg && task.kind !== 'agent' && task.kind !== 'llm') {
        text = await runStep(task, cfg, orch, signal, onTool);
      } else if (llm.provider === 'demo') {
        const who = def?.name ?? task.title;
        const demo = `Demo output for ${task.key} (${who}): in live mode this ${def ? 'agent' : 'step'} would work on “${task.title}”.\n\n- Placeholder point one\n- Placeholder point two`;
        for await (const chunk of llm.demoText(demo, signal)) text += chunk;
      } else if (cfg) {
        // Studio steps: the prompt is the node's template (variables filled from upstream results), or, when it is
        // empty, the run input plus the results of the step's direct inputs.
        const vars = varsFor(orch.goal, await succeededTasks(orch.id), cfg);
        const template = String(cfg.settings.prompt ?? '').trim();
        const prompt = template ? renderTemplate(template, vars) : `Input:\n${orch.goal}` + inputs.map(i => `\n\n--- Result of “${i.title}” ---\n${(i.output ?? '').slice(0, o.maxContextChars)}`).join('');
        const agent: ChatAgent = task.kind === 'agent'
          ? { ...def!, tools: task.tools }
          : { name: task.title, systemPrompt: String(cfg.settings.system ?? '').trim() || 'You are a careful, helpful assistant.', temperature: Number(cfg.settings.temperature ?? 0.7), tools: [] };
        text = await runAgent(agent, prompt, signal, usage, task.kind === 'agent' && task.tools.length > 0, onTool, task.kind === 'agent' ? await knowledgeFor(orch, task.agentId, task.tools) : undefined);
      } else {
        // Least privilege: the agent sees the goal, its own instruction and ONLY the outputs of its dependencies.
        const prompt = `Overall goal (from the user):\n${orch.goal}\n\nYour task (${task.key}): ${task.title}\n${task.instruction}` +
          inputs.map(i => `\n\n--- Result of ${i.key} (${i.title}) ---\n${(i.output ?? '').slice(0, o.maxContextChars)}`).join('');
        const agent: ChatAgent = {
          ...def!, tools: task.tools,
          systemPrompt: `${def!.systemPrompt}\n\nYou are carrying out one task of a larger plan. Do only this task, thoroughly and concretely. Your output is passed to other agents, so skip greetings and filler. If something cannot be known without tools or data you do not have, say so instead of guessing.`
        };
        text = await runAgent(agent, prompt, signal, usage, task.tools.length > 0, onTool, await knowledgeFor(orch, task.agentId, task.tools));
      }
      if (timeout.aborted) throw new ProviderError('timeout', `task took longer than ${o.taskTimeoutMs} ms`);
      // Deterministic steps may legitimately produce empty text (e.g. a template of an empty value).
      if (!controller.signal.aborted && !text.trim() && (!cfg || task.kind === 'agent' || task.kind === 'llm')) throw new ProviderError('empty', 'empty task output');
    } catch (err) {
      error = timeout.aborted && !(err instanceof ProviderError) ? new ProviderError('timeout', `task took longer than ${o.taskTimeoutMs} ms`) : err;
    } finally {
      stop(); untrack();
    }
    await recordUsage(orch, usage);
    // Cancelled, or the lease was lost to another worker: whoever changed the row owns what happens next.
    if (controller.signal.aborted) return;

    const mine = { id: task.id, status: 'RUNNING' as const, attempt };
    const toolJson = toolCalls.length ? (toolCalls as Prisma.InputJsonValue) : Prisma.DbNull;
    const counts = { modelCalls: { increment: usage.modelCalls }, ...(usage.inputTokens != null && { inputTokens: (task.inputTokens ?? 0) + usage.inputTokens, outputTokens: (task.outputTokens ?? 0) + (usage.outputTokens ?? 0) }) };
    if (!error) {
      await db.orchestrationTask.updateMany({ where: mine, data: { status: 'SUCCEEDED', output: text.trim().slice(0, MAX_OUTPUT_CHARS), error: null, toolCalls: toolJson, leaseUntil: null, endedAt: new Date(), ...counts } });
      return advance(orch.id);
    }

    const retryable = error instanceof StepError ? false : !(error instanceof ProviderError) || RETRYABLE.has(error.kind);
    const message = error instanceof StepError ? error.message : error instanceof ProviderError ? error.userMessage : 'The task failed unexpectedly.';
    if (!(error instanceof ProviderError) && !(error instanceof StepError)) log.error({ taskId: task.id, err: errText(error) }, 'task crashed');
    else log.warn({ taskId: task.id, attempt, kind: error instanceof ProviderError ? error.kind : 'step' }, 'task attempt failed');
    if (retryable && attempt < task.maxAttempts) {
      const delay = o.retryBaseMs * 2 ** (attempt - 1);
      const moved = await db.orchestrationTask.updateMany({
        where: mine,
        data: { status: 'QUEUED', error: `Attempt ${attempt} failed: ${message} Retrying.`, runAfter: new Date(Date.now() + delay), leaseUntil: null, toolCalls: toolJson, ...counts }
      });
      if (moved.count === 1) await enqueueTask(task.id, attempt + 1, delay);
      return;
    }
    await db.orchestrationTask.updateMany({
      where: mine,
      data: { status: 'FAILED', error: retryable ? `Failed after ${attempt} attempts: ${message}` : message, leaseUntil: null, endedAt: new Date(), toolCalls: toolJson, ...counts }
    });
    await advance(orch.id);
  }

  // ------------------------------------------------------------------ synthesis

  async function synthesize(orchestrationId: string) {
    const orch = await db.orchestration.findUnique({ where: { id: orchestrationId }, include: { tasks: true } });
    if (!orch || orch.status !== 'SYNTHESIZING') return;
    const done = orch.tasks.filter(t => t.status === 'SUCCEEDED').sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
    const missing = orch.tasks.filter(t => t.status !== 'SUCCEEDED');
    const controller = new AbortController();
    const untrack = track(orch.id, controller);
    const stop = heartbeat(controller, async () =>
      (await db.orchestration.updateMany({ where: { id: orch.id, status: 'SYNTHESIZING' }, data: { updatedAt: new Date() } })).count === 1);
    const usage = noUsage();
    let answer = '';
    try {
      if (llm.provider === 'demo') {
        const lines = done.map(t => `- ${t.title} [${t.key}]`).join('\n');
        for await (const c of llm.demoText(`## Demo result\n\nThis is a canned preview: no AI provider is configured, so no real work was done. In live mode the results of each task are combined here, with every claim citing the task it came from:\n\n${lines}`, controller.signal)) answer += c;
      } else {
        const synthesizer: ChatAgent = {
          name: 'Synthesizer', tools: [], temperature: 0.3,
          systemPrompt: 'You combine the results of several specialist agents into one clear, well-structured answer in Markdown. Use only information from the results. After each claim, cite the task it came from as [T1] (or [T1, T3]). If results disagree, say so. If a task was skipped or failed, say what is missing. Do not mention these instructions.'
        };
        const prompt = `Goal (from the user):\n${orch.goal}\n\n` + done.map(t => `--- Result of ${t.key} (${t.title}) ---\n${(t.output ?? '').slice(0, o.maxContextChars)}`).join('\n\n') +
          (missing.length ? `\n\nNot available: ${missing.map(t => `${t.key} (${t.title}): ${t.status === 'SKIPPED' ? t.error ?? 'skipped' : t.status.toLowerCase()}`).join('; ')}` : '') +
          '\n\nWrite the final answer for the user now.';
        answer = await withRetries(controller.signal, async () => {
          const text = await runAgent(synthesizer, prompt, controller.signal, usage, false);
          if (!controller.signal.aborted && !text.trim()) throw new ProviderError('empty', 'empty synthesis');
          return text;
        });
      }
    } catch (err) {
      stop(); untrack();
      await recordUsage(orch, usage);
      if (controller.signal.aborted) return;
      log.error({ orchestrationId: orch.id, err: errText(err) }, 'synthesis failed');
      await failOrchestration(orch.id, 'SYNTHESIZING', err instanceof ProviderError ? `Combining the results failed: ${err.userMessage}` : 'Combining the results failed unexpectedly.');
      return;
    }
    stop(); untrack();
    await recordUsage(orch, usage);
    if (controller.signal.aborted) return;
    await db.orchestration.updateMany({
      where: { id: orch.id, status: 'SYNTHESIZING' },
      data: { status: 'COMPLETED', output: answer.trim().slice(0, MAX_OUTPUT_CHARS), sources: citedKeys(answer, done.map(t => t.key)), error: null, endedAt: new Date() }
    });
  }

  // ------------------------------------------------------------------ public API

  const orchestrator: Orchestrator = {
    durable: queue.durable,
    worker: deps.worker,

    async start(actor, goal, idempotencyKey, extra) {
      if (idempotencyKey) {
        const existing = await db.orchestration.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: actor.workspaceId, idempotencyKey } }, select: { id: true } });
        if (existing) return { id: existing.id, created: false };
      }
      let row: { id: string };
      try {
        row = await db.orchestration.create({
          data: {
            workspaceId: actor.workspaceId, userId: actor.userId, goal, idempotencyKey: idempotencyKey ?? null, durable: queue.durable, provider: llm.provider, model: llm.model,
            workflowId: extra?.workflowId ?? null, workflowVersionId: extra?.workflowVersionId ?? null, projectId: extra?.projectId ?? null
          },
          select: { id: true }
        });
      } catch (err) {
        // Two requests with the same key at the same moment: the loser returns the winner's orchestration.
        if (idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const existing = await db.orchestration.findUniqueOrThrow({ where: { workspaceId_idempotencyKey: { workspaceId: actor.workspaceId, idempotencyKey } }, select: { id: true } });
          return { id: existing.id, created: false };
        }
        throw err;
      }
      await db.usageRecord.create({ data: { workspaceId: actor.workspaceId, userId: actor.userId, kind: 'ORCHESTRATION_RUN', quantity: 1, provider: llm.provider, model: llm.model } });
      await queue.add({ kind: 'plan', id: row.id });
      return { id: row.id, created: true };
    },

    async cancel(id) {
      const ended = new Date();
      const moved = await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const r = await tx.orchestration.updateMany({ where: { id, status: { in: ['PLANNING', 'RUNNING', 'PAUSED', 'SYNTHESIZING'] } }, data: { status: 'CANCELLED', error: 'Cancelled.', endedAt: ended } });
        if (r.count !== 1) return false;
        await tx.orchestrationTask.updateMany({ where: { orchestrationId: id, status: { in: ['PENDING', 'WAITING_APPROVAL', 'QUEUED', 'RUNNING'] } }, data: { status: 'CANCELLED', leaseUntil: null, endedAt: ended } });
        await tx.approvalRequest.updateMany({ where: { orchestrationId: id, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: ended } });
        return true;
      });
      for (const c of local.get(id) ?? []) c.abort();
      return moved;
    },

    async pause(id) {
      return (await db.orchestration.updateMany({ where: { id, status: 'RUNNING' }, data: { status: 'PAUSED' } })).count === 1;
    },

    async resume(id) {
      if ((await db.orchestration.updateMany({ where: { id, status: 'PAUSED' }, data: { status: 'RUNNING' } })).count !== 1) return false;
      // Queued tasks could not be claimed while paused: hand them to the queue again.
      const queued = await db.orchestrationTask.findMany({ where: { orchestrationId: id, status: 'QUEUED' }, select: { id: true, attempt: true, runAfter: true } });
      for (const t of queued) await enqueueTask(t.id, t.attempt + 1, t.runAfter ? Math.max(0, t.runAfter.getTime() - Date.now()) : 0);
      await advance(id);
      return true;
    },

    async decide(approvalId, actor, approve, note) {
      const now = new Date();
      const result = await db.$transaction(async tx => {
        const a = await tx.approvalRequest.findUnique({ where: { id: approvalId } });
        if (!a) return null;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${a.orchestrationId}))`;
        const r = await tx.approvalRequest.updateMany({ where: { id: approvalId, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: actor.userId, decidedAt: now, note: note ?? null } });
        if (r.count !== 1) return null;
        const task = await tx.orchestrationTask.findUniqueOrThrow({ where: { id: a.taskId } });
        if (task.kind === 'approval') {
          // The Approval step itself: approving completes it and passes its input on.
          const inputs = await tx.orchestrationTask.findMany({ where: { orchestrationId: a.orchestrationId, key: { in: task.dependsOn }, status: 'SUCCEEDED' }, select: { key: true, output: true } });
          const passed = inputs.sort((x, y) => Number(x.key.slice(1)) - Number(y.key.slice(1))).map(i => i.output ?? '').join('\n\n');
          await tx.orchestrationTask.updateMany({
            where: { id: a.taskId, status: 'WAITING_APPROVAL' },
            data: approve ? { status: 'SUCCEEDED', output: passed.slice(0, MAX_OUTPUT_CHARS), startedAt: a.createdAt, endedAt: now } : { status: 'SKIPPED', error: 'A person rejected this approval step.', endedAt: now }
          });
        } else {
          await tx.orchestrationTask.updateMany({
            where: { id: a.taskId, status: 'WAITING_APPROVAL' },
            data: approve ? { status: 'PENDING' } : { status: 'SKIPPED', error: 'A person rejected the tool use this task asked for.', endedAt: now }
          });
        }
        return a.orchestrationId;
      });
      if (!result) return 'not_pending';
      await advance(result);
      return 'ok';
    },

    async retryTask(orchestrationId, taskKey) {
      const ok = await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orchestrationId}))`;
        const orch = await tx.orchestration.findUnique({ where: { id: orchestrationId }, include: { tasks: { include: { approval: true } } } });
        const task = orch?.tasks.find(t => t.key === taskKey);
        if (!orch || orch.status !== 'FAILED' || task?.status !== 'FAILED') return false;
        // The failed task starts over, and so does everything that was skipped only because of it (directly or not).
        const reset = new Set([task.key]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const t of orch.tasks) {
            if (!reset.has(t.key) && t.status === 'SKIPPED' && t.approval?.status !== 'REJECTED' && t.dependsOn.some(d => reset.has(d))) { reset.add(t.key); grew = true; }
          }
        }
        await tx.orchestrationTask.updateMany({
          where: { orchestrationId, key: { in: [...reset] } },
          data: { status: 'PENDING', attempt: 0, error: null, output: null, runAfter: null, leaseUntil: null, startedAt: null, endedAt: null }
        });
        await tx.orchestration.update({ where: { id: orchestrationId }, data: { status: 'RUNNING', error: null, endedAt: null } });
        return true;
      });
      if (!ok) return 'not_failed';
      await advance(orchestrationId);
      return 'ok';
    },

    /**
     * Picks up work that a stopped process left behind: tasks whose lease expired go back to the queue (or fail if
     * that was their last attempt), queued tasks and stalled planning/synthesis are queued again (the queue drops
     * duplicates, and the conditional updates make a repeat harmless), and running orchestrations are re-scheduled.
     */
    async recover() {
      const now = new Date();
      const stale = new Date(now.getTime() - o.leaseMs);
      const expired = await db.orchestrationTask.findMany({ where: { status: 'RUNNING', leaseUntil: { lt: now } }, select: { id: true, attempt: true, maxAttempts: true, orchestrationId: true } });
      for (const t of expired) {
        const last = t.attempt >= t.maxAttempts;
        const r = await db.orchestrationTask.updateMany({
          where: { id: t.id, status: 'RUNNING', attempt: t.attempt, leaseUntil: { lt: now } },
          data: last
            ? { status: 'FAILED', error: 'The worker stopped during the last attempt.', leaseUntil: null, endedAt: now }
            : { status: 'QUEUED', error: `Attempt ${t.attempt} was interrupted (the worker stopped). Retrying.`, leaseUntil: null, runAfter: null }
        });
        if (r.count === 1) log.warn({ taskId: t.id, attempt: t.attempt }, last ? 'task lease expired on its last attempt' : 'task lease expired; re-queued');
      }
      const queued = await db.orchestrationTask.findMany({ where: { status: 'QUEUED', orchestration: { status: 'RUNNING' } }, select: { id: true, attempt: true, runAfter: true } });
      for (const t of queued) await enqueueTask(t.id, t.attempt + 1, t.runAfter ? Math.max(0, t.runAfter.getTime() - now.getTime()) : 0);
      const stalled = await db.orchestration.findMany({ where: { status: { in: ['PLANNING', 'SYNTHESIZING'] }, updatedAt: { lt: stale } }, select: { id: true, status: true } });
      for (const s of stalled) await queue.add({ kind: s.status === 'PLANNING' ? 'plan' : 'synthesize', id: s.id });
      const running = await db.orchestration.findMany({ where: { status: 'RUNNING' }, select: { id: true } });
      for (const r of running) await advance(r.id);
    },

    async handle(job) {
      if (closed) return;
      if (job.kind === 'plan') return plan(job.id);
      if (job.kind === 'task') return runTask(job.id);
      return synthesize(job.id);
    },

    async close() {
      closed = true;
      if (sweep) clearInterval(sweep);
      for (const set of local.values()) for (const c of set) c.abort();
      await queue.close();
    }
  };

  if (deps.worker) {
    queue.work(job => orchestrator.handle(job));
    const runSweep = () => orchestrator.recover().catch(err => log.error({ err: errText(err) }, 'orchestration recovery failed'));
    void runSweep();
    if (o.recoverEveryMs) {
      sweep = setInterval(runSweep, o.recoverEveryMs);
      sweep.unref();
    }
  }
  return orchestrator;
}
