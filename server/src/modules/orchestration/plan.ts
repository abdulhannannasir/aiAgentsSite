import { z } from 'zod';
import { AGENTS, findAgent } from '../agents/registry.js';
import type { ToolRegistry } from '../tools/registry.js';

/** A plan has at most this many tasks: enough for real decomposition, small enough to keep cost predictable. */
export const MAX_TASKS = 6;

const RawPlan = z.object({
  summary: z.string().trim().min(1).max(600),
  tasks: z.array(z.object({
    id: z.string().regex(/^T[1-9]\d?$/, 'ids are T1, T2, ...'),
    title: z.string().trim().min(1).max(120),
    agentId: z.string().min(1).max(60),
    instruction: z.string().trim().min(1).max(1200),
    dependsOn: z.array(z.string()).max(MAX_TASKS).default([]),
    tools: z.array(z.string()).max(10).default([])
  })).min(1).max(MAX_TASKS)
});

export interface PlannedTask {
  key: string;
  title: string;
  agentId: string;
  instruction: string;
  dependsOn: string[];
  /** Tools the task may use: what the planner asked for ∩ the agent's permissions ∩ what is available here. */
  tools: string[];
}

export interface Plan { summary: string; tasks: PlannedTask[] }

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanError';
  }
}

/** Pulls the first JSON object out of a model reply (models sometimes wrap it in a code fence or a sentence). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new PlanError('The planner reply contained no JSON object.');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new PlanError('The planner reply was not valid JSON.');
  }
}

/**
 * Validates a plan and makes it safe to run: known agents only, dependencies only on EARLIER tasks (so the graph
 * is always acyclic and in topological order), and tools reduced to what the agent may use and this server has.
 */
export function validatePlan(raw: unknown, tools: ToolRegistry): Plan {
  const parsed = RawPlan.safeParse(raw);
  if (!parsed.success) throw new PlanError(`Invalid plan: ${parsed.error.issues.map(i => `${i.path.join('.') || 'plan'} ${i.message}`).join('; ')}`);
  const seen = new Set<string>();
  const tasks: PlannedTask[] = [];
  for (const t of parsed.data.tasks) {
    if (seen.has(t.id)) throw new PlanError(`Invalid plan: task id ${t.id} is used twice.`);
    const agent = findAgent(t.agentId);
    if (!agent) throw new PlanError(`Invalid plan: ${t.id} uses unknown agent "${t.agentId}".`);
    for (const d of t.dependsOn) {
      if (!seen.has(d)) throw new PlanError(`Invalid plan: ${t.id} depends on ${d}, which is not an earlier task.`);
    }
    const allowed = new Set(tools.forAgent(agent.tools).map(x => x.id));
    seen.add(t.id);
    tasks.push({
      key: t.id, title: t.title, agentId: agent.id, instruction: t.instruction,
      dependsOn: [...new Set(t.dependsOn)], tools: [...new Set(t.tools)].filter(x => allowed.has(x))
    });
  }
  return { summary: parsed.data.summary, tasks };
}

/** The planner's instructions, including the agents it may assign and the tools each can use on this server. */
export function plannerPrompt(tools: ToolRegistry): string {
  const catalog = AGENTS.map(a => {
    const usable = tools.forAgent(a.tools).map(t => t.id);
    return `- ${a.id}: ${a.name}. ${a.description}${usable.length ? ` Tools: ${usable.join(', ')}.` : ''}`;
  }).join('\n');
  return `You are the planner of a multi-agent system. Break the user's goal into a small plan of tasks that specialist agents carry out.

Rules:
- Use between 1 and ${MAX_TASKS} tasks; prefer the fewest that do the job well. Simple goals need one or two tasks.
- Ids are T1, T2, ... in order. A task may only depend on EARLIER tasks, and only when it needs their output.
- Tasks without a dependency between them run in parallel, so do not chain tasks needlessly.
- Each task gets exactly one agent from the list below, a short title and a self-contained instruction.
- A task only sees the user's goal and the outputs of the tasks it depends on.
- List tools for a task only if it truly needs them and the agent has them. Tools that reach the internet need a person's approval before the task runs.
- Do not write the final answer: after the tasks run, their results are combined into one answer for the user.

Agents:
${catalog}

Reply with ONLY a JSON object, no prose, in this shape:
{"summary": "one or two sentences on the approach", "tasks": [{"id": "T1", "title": "...", "agentId": "...", "instruction": "...", "dependsOn": [], "tools": []}]}`;
}

/** Demo mode has no model to plan with: a fixed, clearly labelled three-task plan shows how orchestration works. */
export function demoPlan(goal: string): Plan {
  const topic = goal.replace(/\s+/g, ' ').trim().slice(0, 60);
  return {
    summary: `Demo plan (no AI provider is configured): a fixed research → analysis → draft plan for “${topic}”. With an API key the planner designs the plan for each goal.`,
    tasks: [
      { key: 'T1', title: 'Gather key facts', agentId: 'research-agent', instruction: 'List the key facts and open questions.', dependsOn: [], tools: [] },
      { key: 'T2', title: 'Identify risks and opportunities', agentId: 'data-analyst', instruction: 'List the main risks and opportunities.', dependsOn: [], tools: [] },
      { key: 'T3', title: 'Draft recommendations', agentId: 'project-manager', instruction: 'Turn the findings into recommendations.', dependsOn: ['T1', 'T2'], tools: [] }
    ]
  };
}

/** Task keys cited in an answer as [T1], [T2, T3] etc., limited to the given keys, in order of first citation. */
export function citedKeys(answer: string, keys: string[]): string[] {
  const valid = new Set(keys);
  const out: string[] = [];
  for (const m of answer.matchAll(/\[(T\d+(?:\s*,\s*T\d+)*)\]/g)) {
    for (const k of m[1].split(',').map(s => s.trim())) if (valid.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}
