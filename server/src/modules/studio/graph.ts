// Workflow graphs for the visual studio. Shared by the server (validation, compilation into orchestration tasks,
// runtime helpers) and the editor in the browser (live validation), so it must only depend on zod.
import { z } from 'zod';

// ------------------------------------------------------------------ node catalog

export const NODE_KINDS = ['input', 'agent', 'llm', 'tool', 'knowledge', 'condition', 'template', 'merge', 'extract', 'approval', 'delay', 'output'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
/** Kinds the palette shows but that cannot run yet; each says why. They are rejected by validation. */
export const PLANNED_KINDS = ['integration', 'webhook_trigger', 'schedule_trigger', 'code'] as const;
export type PlannedKind = (typeof PLANNED_KINDS)[number];

export interface NodeTypeInfo {
  kind: NodeKind | PlannedKind;
  label: string;
  group: 'Trigger' | 'AI' | 'Logic' | 'Data' | 'Human' | 'Output';
  description: string;
  available: boolean;
  /** For planned kinds: what is missing. */
  reason?: string;
  /** Calls a model (costs tokens). */
  usesModel?: boolean;
}

export const NODE_TYPES: NodeTypeInfo[] = [
  { kind: 'input', label: 'Manual input', group: 'Trigger', available: true, description: 'Where a run starts. Its value is the text you type when you run the workflow ({{input}}).' },
  { kind: 'agent', label: 'Agent', group: 'AI', available: true, usesModel: true, description: 'One of the built-in specialist agents works on a prompt, optionally with its tools.' },
  { kind: 'llm', label: 'Prompt', group: 'AI', available: true, usesModel: true, description: 'A model call with your own instructions and prompt.' },
  { kind: 'tool', label: 'Tool', group: 'Data', available: true, description: 'Runs one tool directly (calculator, date/time, read a web page, web search) with templated arguments.' },
  { kind: 'knowledge', label: 'Knowledge search', group: 'Data', available: true, description: 'Searches the memory and documents the person running the workflow may see (plus the workflow\'s project). Returns labelled passages ([K1]…) to pass to an agent.' },
  { kind: 'condition', label: 'Condition', group: 'Logic', available: true, description: 'Checks a value and continues on the true or the false branch; the other branch is skipped.' },
  { kind: 'template', label: 'Text template', group: 'Data', available: true, description: 'Builds text from earlier results with {{variables}}. No model call.' },
  { kind: 'merge', label: 'Merge', group: 'Logic', available: true, description: 'Joins branches: waits for all inputs, or continues with whichever branches ran.' },
  { kind: 'extract', label: 'Extract JSON field', group: 'Data', available: true, description: 'Reads a field (e.g. items.0.name) from JSON in an earlier result.' },
  { kind: 'approval', label: 'Approval', group: 'Human', available: true, description: 'Pauses the run until a person approves. Rejecting skips everything after it.' },
  { kind: 'delay', label: 'Delay', group: 'Logic', available: true, description: 'Waits a number of seconds before continuing.' },
  { kind: 'output', label: 'Output', group: 'Output', available: true, description: 'The workflow\'s result. Several outputs are joined in order.' },
  { kind: 'integration', label: 'Integration action', group: 'Data', available: false, reason: 'Needs connected integrations (Phase 8).', description: 'Act in GitHub, Google or Slack.' },
  { kind: 'webhook_trigger', label: 'Webhook trigger', group: 'Trigger', available: false, reason: 'Needs signed inbound webhooks (Phase 8).', description: 'Start a run from another service.' },
  { kind: 'schedule_trigger', label: 'Schedule trigger', group: 'Trigger', available: false, reason: 'Needs a scheduler for recurring runs (not built yet).', description: 'Start runs on a schedule.' },
  { kind: 'code', label: 'Run code', group: 'Data', available: false, reason: 'Needs an isolated sandbox; code never runs on the API server.', description: 'Run a script on the data.' }
];

export const CONDITION_OPERATORS = ['contains', 'not_contains', 'equals', 'not_equals', 'matches', 'is_empty', 'not_empty', 'longer_than'] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const LIMITS = { nodes: 25, edges: 60, prompt: 4000, template: 8000, label: 60, value: 500 } as const;

// ------------------------------------------------------------------ graph shape

const text = (max: number) => z.string().max(max);
export const NODE_ID = /^[a-z][a-z0-9_]{0,30}$/;

const configs = {
  input: z.object({}).strict(),
  agent: z.object({ agentId: z.string().min(1).max(60), prompt: text(LIMITS.prompt).default(''), tools: z.array(z.string().max(40)).max(10).default([]) }).strict(),
  llm: z.object({ system: text(LIMITS.prompt).default(''), prompt: text(LIMITS.prompt).default(''), temperature: z.number().min(0).max(2).default(0.7) }).strict(),
  tool: z.object({ toolId: z.string().min(1).max(40), args: z.record(z.string().max(60), text(2000)).default({}) }).strict(),
  knowledge: z.object({
    query: text(LIMITS.prompt).default(''),
    limit: z.number().int().min(1).max(10).default(5),
    scopes: z.array(z.enum(['USER', 'PROJECT', 'AGENT', 'WORKSPACE'])).max(4).default([])
  }).strict(),
  condition: z.object({ source: text(LIMITS.prompt).default(''), operator: z.enum(CONDITION_OPERATORS).default('contains'), value: text(LIMITS.value).default(''), caseSensitive: z.boolean().default(false) }).strict(),
  template: z.object({ text: text(LIMITS.template).default('') }).strict(),
  merge: z.object({ join: z.enum(['all', 'any']).default('all'), separator: text(200).default('\n\n') }).strict(),
  extract: z.object({ source: text(LIMITS.prompt).default(''), path: z.string().max(200).regex(/^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/, 'use a dotted path like items.0.name').default('result') }).strict(),
  approval: z.object({ message: text(LIMITS.value).default('') }).strict(),
  delay: z.object({ seconds: z.number().int().min(1).max(3600).default(10) }).strict(),
  output: z.object({ template: text(LIMITS.template).default('') }).strict()
} satisfies Record<NodeKind, z.ZodTypeAny>;

export type NodeConfig<K extends NodeKind = NodeKind> = z.output<(typeof configs)[K]>;

const GraphNode = z.object({
  id: z.string().regex(NODE_ID, 'ids are lowercase letters, digits and _ (start with a letter)'),
  kind: z.string(),
  label: z.string().trim().min(1).max(LIMITS.label),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  config: z.record(z.string(), z.unknown()).default({})
});
const GraphEdge = z.object({
  id: z.string().min(1).max(80),
  source: z.string(),
  target: z.string(),
  /** Only edges leaving a condition carry one: 'true' or 'false'. */
  sourceHandle: z.enum(['true', 'false']).nullish()
});
/** The stored graph. Saving only needs this shape; running needs `validateGraph` to find no errors. */
export const GraphSchema = z.object({
  nodes: z.array(GraphNode).max(LIMITS.nodes, `at most ${LIMITS.nodes} nodes`),
  edges: z.array(GraphEdge).max(LIMITS.edges, `at most ${LIMITS.edges} connections`)
});
export type Graph = z.output<typeof GraphSchema>;
export type GraphNodeT = Graph['nodes'][number];
export type GraphEdgeT = Graph['edges'][number];

export interface GraphIssue { severity: 'error' | 'warning'; message: string; nodeId?: string; edgeId?: string }

/** What validation needs to know about this server: which agents exist and which tools they may use here. */
export interface GraphContext {
  agents: Array<{ id: string; name: string; tools: string[] }>;
  /** Tools available on this server, and whether each reaches outside it (needs approval in a run). */
  tools: Array<{ id: string; available: boolean; external: boolean }>;
}

// ------------------------------------------------------------------ templates

const VAR = /\{\{\s*([a-z][a-z0-9_]{0,30})\s*\}\}/g;
/** Variable names a template refers to. */
export const templateVars = (t: string) => [...new Set([...t.matchAll(VAR)].map(m => m[1]))];
/** Replaces {{input}} and {{node_id}} with values; unknown or missing ones become empty. */
export const renderTemplate = (t: string, values: Record<string, string | undefined>) => t.replace(VAR, (_, name: string) => values[name] ?? '');

/** The fields of a node that are templates (validated for references). */
function templateFields(kind: NodeKind, c: Record<string, unknown>): Array<[string, string]> {
  const s = (k: string) => (typeof c[k] === 'string' ? [[k, c[k] as string] as [string, string]] : []);
  switch (kind) {
    case 'agent': case 'llm': return s('prompt');
    case 'tool': return Object.entries((c.args as Record<string, string>) ?? {}).map(([k, v]) => [`args.${k}`, v]);
    case 'condition': case 'extract': return s('source');
    case 'knowledge': return s('query');
    case 'template': return s('text');
    case 'approval': return s('message');
    case 'output': return s('template');
    default: return [];
  }
}

// ------------------------------------------------------------------ validation

const isKind = (k: string): k is NodeKind => (NODE_KINDS as readonly string[]).includes(k);

/** Topological order (Kahn). Returns null if there is a cycle. */
export function topoOrder(nodes: Array<{ id: string }>, edges: Array<{ source: string; target: string }>): string[] | null {
  const indeg = new Map(nodes.map(n => [n.id, 0]));
  const out = new Map<string, string[]>(nodes.map(n => [n.id, []]));
  for (const e of edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
    indeg.set(e.target, indeg.get(e.target)! + 1);
    out.get(e.source)!.push(e.target);
  }
  // Stable: among ready nodes keep the original order.
  const order: string[] = [];
  const ready = nodes.filter(n => indeg.get(n.id) === 0).map(n => n.id);
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const t of out.get(id)!) {
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) {
        const pos = nodes.findIndex(n => n.id === t);
        const at = ready.findIndex(r => nodes.findIndex(n => n.id === r) > pos);
        ready.splice(at < 0 ? ready.length : at, 0, t);
      }
    }
  }
  return order.length === nodes.length ? order : null;
}

/** Every node a node depends on, directly or not. */
export function ancestors(id: string, edges: Array<{ source: string; target: string }>): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of edges) if (e.target === cur && !seen.has(e.source)) { seen.add(e.source); stack.push(e.source); }
  }
  return seen;
}

/**
 * Checks a graph completely: structure (one input, at least one output, no cycles, everything connected), each
 * node's settings, branch handles, and that every {{variable}} names an upstream node. Errors block a run; warnings
 * explain behaviour (e.g. a step that will ask for approval).
 */
export function validateGraph(raw: unknown, ctx: GraphContext): { graph: Graph | null; issues: GraphIssue[] } {
  const parsed = GraphSchema.safeParse(raw);
  if (!parsed.success) {
    return { graph: null, issues: parsed.error.issues.map(i => ({ severity: 'error' as const, message: `${i.path.join('.') || 'graph'}: ${i.message}` })) };
  }
  const graph = parsed.data;
  const issues: GraphIssue[] = [];
  const err = (message: string, at: { nodeId?: string; edgeId?: string } = {}) => issues.push({ severity: 'error', message, ...at });
  const warn = (message: string, at: { nodeId?: string; edgeId?: string } = {}) => issues.push({ severity: 'warning', message, ...at });
  const byId = new Map<string, GraphNodeT>();
  for (const n of graph.nodes) {
    if (byId.has(n.id)) err(`Two steps use the id "${n.id}".`, { nodeId: n.id });
    byId.set(n.id, n);
  }
  if (!graph.nodes.length) return { graph, issues: [{ severity: 'error', message: 'The workflow is empty. Add a Manual input, some steps and an Output.' }] };

  // Edges
  const seenEdge = new Set<string>();
  for (const e of graph.edges) {
    const s = byId.get(e.source), t = byId.get(e.target);
    if (!s || !t) { err('A connection points at a step that does not exist.', { edgeId: e.id }); continue; }
    if (e.source === e.target) err(`"${s.label}" is connected to itself.`, { edgeId: e.id, nodeId: s.id });
    const key = `${e.source}>${e.target}>${e.sourceHandle ?? ''}`;
    if (seenEdge.has(key)) err(`"${s.label}" is connected to "${t.label}" twice.`, { edgeId: e.id });
    seenEdge.add(key);
    if (s.kind === 'condition' && !e.sourceHandle) err(`Connections from the condition "${s.label}" must start at its true or false handle.`, { edgeId: e.id, nodeId: s.id });
    if (s.kind !== 'condition' && e.sourceHandle) err(`Only conditions have true/false handles ("${s.label}").`, { edgeId: e.id, nodeId: s.id });
  }
  const valid = graph.edges.filter(e => byId.has(e.source) && byId.has(e.target) && e.source !== e.target);
  const incoming = (id: string) => valid.filter(e => e.target === id);
  const outgoing = (id: string) => valid.filter(e => e.source === id);

  // Structure
  const inputs = graph.nodes.filter(n => n.kind === 'input');
  if (inputs.length !== 1) err(inputs.length ? 'Use exactly one Manual input.' : 'Add a Manual input: it is where a run starts.', inputs[1] ? { nodeId: inputs[1].id } : {});
  if (!graph.nodes.some(n => n.kind === 'output')) err('Add an Output: it holds the workflow\'s result.');
  const order = topoOrder(graph.nodes, valid);
  if (!order) err('The connections form a loop. Workflows must flow in one direction.');

  const reachable = new Set<string>();
  if (inputs[0]) {
    const stack = [inputs[0].id];
    while (stack.length) { const id = stack.pop()!; if (reachable.has(id)) continue; reachable.add(id); for (const e of outgoing(id)) stack.push(e.target); }
  }

  const agents = new Map(ctx.agents.map(a => [a.id, a]));
  const tools = new Map(ctx.tools.map(t => [t.id, t]));
  for (const n of graph.nodes) {
    const at = { nodeId: n.id };
    if (!isKind(n.kind)) {
      const planned = NODE_TYPES.find(t => t.kind === n.kind);
      err(planned ? `"${n.label}": ${planned.label} is not available yet. ${planned.reason}` : `"${n.label}" has an unknown type "${n.kind}".`, at);
      continue;
    }
    const cfg = configs[n.kind].safeParse(n.config);
    if (!cfg.success) { for (const i of cfg.error.issues) err(`"${n.label}": ${i.path.join('.') || 'settings'} ${i.message}`, at); continue; }
    const c = cfg.data as Record<string, unknown>;

    if (n.kind === 'input') { if (incoming(n.id).length) err('Nothing can connect into the Manual input.', at); }
    else {
      if (!incoming(n.id).length) err(`"${n.label}" has no incoming connection.`, at);
      else if (inputs.length === 1 && !reachable.has(n.id)) err(`"${n.label}" cannot be reached from the Manual input.`, at);
    }
    if (n.kind === 'output' && outgoing(n.id).length) err(`An Output is the end of a path; "${n.label}" has outgoing connections.`, at);
    if (n.kind !== 'output' && n.kind !== 'input' && !outgoing(n.id).length) warn(`"${n.label}" leads nowhere, so its result is not used.`, at);
    if (n.kind === 'condition') {
      const handles = new Set(outgoing(n.id).map(e => e.sourceHandle));
      if (!handles.has('true') && !handles.has('false')) err(`Connect the true and/or false branch of "${n.label}".`, at);
      if (c.operator === 'matches') { try { new RegExp(String(c.value)); } catch { err(`"${n.label}": the pattern is not a valid regular expression.`, at); } }
    }
    if (n.kind === 'merge' && incoming(n.id).length < 2) warn(`"${n.label}" merges only one input.`, at);

    if (n.kind === 'agent') {
      const a = agents.get(String(c.agentId));
      if (!a) err(`"${n.label}": choose an agent.`, at);
      else {
        for (const t of c.tools as string[]) {
          if (!a.tools.includes(t)) err(`"${n.label}": ${a.name} is not permitted to use ${t}.`, at);
          else if (!tools.get(t)?.available) err(`"${n.label}": the tool ${t} is not available on this server.`, at);
        }
        const ext = (c.tools as string[]).filter(t => tools.get(t)?.external);
        if (ext.length) warn(`"${n.label}" uses ${ext.join(', ')}, so each run asks for approval before this step.`, at);
      }
      if (!String(c.prompt).trim() && incoming(n.id).length === 0) err(`"${n.label}": write a prompt.`, at);
    }
    if (n.kind === 'llm' && !String(c.prompt).trim()) err(`"${n.label}": write a prompt.`, at);
    if (n.kind === 'knowledge' && !String(c.query).trim()) err(`"${n.label}": write what to search for (e.g. {{input}}).`, at);
    if (n.kind === 'tool') {
      const t = tools.get(String(c.toolId));
      if (!t) err(`"${n.label}": unknown tool "${String(c.toolId)}".`, at);
      else if (!t.available) err(`"${n.label}": the tool ${t.id} is not available on this server.`, at);
      else if (t.external) warn(`"${n.label}" reaches outside the server, so each run asks for approval before this step.`, at);
    }

    // Variables must name the run input or an upstream step.
    const up = ancestors(n.id, valid);
    for (const [field, value] of templateFields(n.kind, c)) {
      for (const v of templateVars(value)) {
        if (v === 'input') continue;
        if (!byId.has(v)) err(`"${n.label}" ${field}: {{${v}}} is not a step in this workflow.`, at);
        else if (!up.has(v)) err(`"${n.label}" ${field}: {{${v}}} is not upstream of this step, so its result is not available yet.`, at);
      }
    }
  }
  return { graph, issues };
}

export const hasErrors = (issues: GraphIssue[]) => issues.some(i => i.severity === 'error');

// ------------------------------------------------------------------ compilation

export interface CompiledTask {
  key: string;
  nodeId: string;
  kind: NodeKind;
  title: string;
  agentId: string;
  instruction: string;
  tools: string[];
  dependsOn: string[];
  config: CompiledConfig;
}

/** What the engine stores on a task: the node's settings plus how its dependencies gate it. */
export interface CompiledConfig {
  kind: NodeKind;
  settings: Record<string, unknown>;
  /** 'all': every dependency must succeed. 'any': runs if at least one did (used after branches). */
  join: 'all' | 'any';
  /** For dependencies that are conditions: the branch this task is on (task key → 'true' | 'false'). */
  branches: Record<string, 'true' | 'false'>;
  /** Node id → task key, for template variables. */
  vars: Record<string, string>;
}

/** Turns a valid graph into engine tasks (T1… in topological order). Throws if the graph has errors. */
export function compileGraph(raw: unknown, ctx: GraphContext): CompiledTask[] {
  const { graph, issues } = validateGraph(raw, ctx);
  if (!graph || hasErrors(issues)) throw new Error(`Invalid workflow: ${issues.filter(i => i.severity === 'error').map(i => i.message).join(' ')}`);
  const order = topoOrder(graph.nodes, graph.edges)!;
  const keyOf = new Map(order.map((id, i) => [id, `T${i + 1}`]));
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const vars = Object.fromEntries(order.map(id => [id, keyOf.get(id)!]));
  return order.map(id => {
    const n = byId.get(id)!;
    const kind = n.kind as NodeKind;
    const settings = configs[kind].parse(n.config) as Record<string, unknown>;
    const inc = graph.edges.filter(e => e.target === id);
    const branches: Record<string, 'true' | 'false'> = {};
    for (const e of inc) if (e.sourceHandle) branches[keyOf.get(e.source)!] = e.sourceHandle;
    const join = kind === 'merge' ? (settings.join as 'all' | 'any') : kind === 'output' ? 'any' : 'all';
    return {
      key: keyOf.get(id)!, nodeId: id, kind, title: n.label,
      agentId: kind === 'agent' ? String(settings.agentId) : '',
      instruction: kind === 'agent' || kind === 'llm' ? String(settings.prompt) : '',
      tools: kind === 'agent' ? (settings.tools as string[]) : kind === 'tool' ? [String(settings.toolId)] : [],
      dependsOn: [...new Set(inc.map(e => keyOf.get(e.source)!))],
      config: { kind, settings, join, branches, vars }
    };
  });
}

// ------------------------------------------------------------------ runtime helpers (deterministic nodes)

export function evaluateCondition(value: string, operator: ConditionOperator, operand: string, caseSensitive = false): boolean {
  const v = caseSensitive ? value : value.toLowerCase();
  const o = caseSensitive ? operand : operand.toLowerCase();
  switch (operator) {
    case 'contains': return v.includes(o);
    case 'not_contains': return !v.includes(o);
    case 'equals': return v.trim() === o.trim();
    case 'not_equals': return v.trim() !== o.trim();
    case 'matches': return new RegExp(operand, caseSensitive ? '' : 'i').test(value);
    case 'is_empty': return !value.trim();
    case 'not_empty': return !!value.trim();
    case 'longer_than': return value.trim().length > Number(operand || 0);
  }
}

/** Finds the first JSON value in text (fenced or not) and reads a dotted path from it. */
export function extractPath(textValue: string, path: string): string {
  const fenced = textValue.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : textValue).trim();
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('No JSON found in the input.');
  const close = body[start] === '{' ? '}' : ']';
  let data: unknown;
  try { data = JSON.parse(body.slice(start, body.lastIndexOf(close) + 1)); } catch { throw new Error('The input is not valid JSON.'); }
  let cur: unknown = data;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(part in (cur as object))) throw new Error(`The JSON has no "${path}".`);
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : JSON.stringify(cur, null, 2);
}
