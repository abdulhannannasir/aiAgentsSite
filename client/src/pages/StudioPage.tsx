import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, addEdge, applyEdgeChanges, applyNodeChanges, useReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import clsx from 'clsx';
import {
  AlertTriangle, ArrowLeft, Bot, Brackets, CheckCircle2, Clock, ExternalLink, FileOutput, GitBranch, GitMerge, History, Lock, MessageSquareText, Pause,
  Play, PlayCircle, Save, ShieldCheck, Sparkles, Square, Trash2, Type, Wrench, XCircle, type LucideIcon
} from 'lucide-react';
import { Button, LinkButton } from '../components/ui/Button';
import { Badge, EmptyState, ErrorState, Skeleton, Spinner, type Tone } from '../components/ui/Display';
import { Field, Input, Select, Textarea } from '../components/ui/Form';
import { Drawer } from '../components/ui/Overlay';
import { Markdown } from '../components/Markdown';
import { useToast } from '../components/Toast';
import { useWorkspace } from '../app/workspace';
import { ancestors, validateGraph, type GraphIssue, type NodeTypeInfo } from '../../../server/src/modules/studio/graph';
import { isActive, orchestrations, type OrchestrationStatus, type OrchestrationSummary, type OrchestrationTaskStatus, type OrchestrationView } from '../lib/orchestrations';
import { orchestrationHref, pageHref, studioHref } from '../lib/route';
import { timeAgo } from '../lib/sessionStats';
import { defaultConfig, nextNodeId, studio, type Graph, type StudioCatalog, type VersionSummary, type WorkflowDetail } from '../lib/studio';
import { ApprovalControls } from './OrchestratorPage';

// ------------------------------------------------------------------ model

interface StepData extends Record<string, unknown> {
  kind: string;
  label: string;
  config: Record<string, unknown>;
  // Display-only (derived each render, never saved):
  summary?: string;
  issue?: 'error' | 'warning';
  runStatus?: OrchestrationTaskStatus;
}
type StepNodeT = Node<StepData, 'step'>;

const ICONS: Record<string, LucideIcon> = {
  input: PlayCircle, agent: Bot, llm: Sparkles, tool: Wrench, condition: GitBranch, template: Type, merge: GitMerge, extract: Brackets,
  approval: ShieldCheck, delay: Clock, output: FileOutput, knowledge: Lock, integration: Lock, webhook_trigger: Lock, schedule_trigger: Lock, code: Lock
};
const OPERATOR_LABEL: Record<string, string> = {
  contains: 'contains', not_contains: 'does not contain', equals: 'equals', not_equals: 'does not equal', matches: 'matches pattern',
  is_empty: 'is empty', not_empty: 'is not empty', longer_than: 'is longer than (characters)'
};
/** Argument names of the tools a Tool step can call. */
const TOOL_ARGS: Record<string, string[]> = { calculator: ['expression'], current_time: ['timezone'], url_fetch: ['url'], web_search: ['query'] };
const STATUS_TONE: Record<OrchestrationTaskStatus, Tone> = {
  PENDING: 'neutral', WAITING_APPROVAL: 'warning', QUEUED: 'neutral', RUNNING: 'accent', SUCCEEDED: 'success', FAILED: 'danger', SKIPPED: 'neutral', CANCELLED: 'neutral'
};
const STATUS_LABEL: Record<OrchestrationTaskStatus, string> = {
  PENDING: 'Waiting', WAITING_APPROVAL: 'Needs approval', QUEUED: 'Queued', RUNNING: 'Running', SUCCEEDED: 'Done', FAILED: 'Failed', SKIPPED: 'Skipped', CANCELLED: 'Cancelled'
};
const RUN_TONE: Record<OrchestrationStatus, Tone> = { PLANNING: 'accent', RUNNING: 'accent', PAUSED: 'warning', SYNTHESIZING: 'accent', COMPLETED: 'success', FAILED: 'danger', CANCELLED: 'neutral' };
const RUN_LABEL: Record<OrchestrationStatus, string> = { PLANNING: 'Starting', RUNNING: 'Running', PAUSED: 'Paused', SYNTHESIZING: 'Finishing', COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled' };

const toFlow = (g: Graph): { nodes: StepNodeT[]; edges: Edge[] } => ({
  nodes: g.nodes.map(n => ({ id: n.id, type: 'step', position: n.position, data: { kind: n.kind, label: n.label, config: n.config } })),
  edges: g.edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, ...(e.sourceHandle && { label: e.sourceHandle }) }))
});
const toGraph = (nodes: StepNodeT[], edges: Edge[]): Graph => ({
  nodes: nodes.map(n => ({ id: n.id, kind: n.data.kind, label: n.data.label, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, config: n.data.config })),
  edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, ...(e.sourceHandle === 'true' || e.sourceHandle === 'false' ? { sourceHandle: e.sourceHandle } : {}) }))
});
const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

// ------------------------------------------------------------------ canvas node

const StepNode = memo(function StepNode({ data, selected }: NodeProps<StepNodeT>) {
  const Icon = ICONS[data.kind] ?? Wrench;
  const run = data.runStatus;
  return (
    <div
      className={clsx(
        'w-48 rounded-xl border bg-surface px-3 py-2.5 text-left shadow-sm transition',
        selected ? 'border-accent ring-2 ring-accent/40' : data.issue === 'error' ? 'border-rose-500/70' : 'border-line-strong',
        run === 'RUNNING' && 'ring-2 ring-accent/60', run === 'SUCCEEDED' && 'border-emerald-500/70', run === 'FAILED' && 'border-rose-500',
        (run === 'SKIPPED' || run === 'CANCELLED') && 'opacity-50'
      )}
      data-node={data.label} data-kind={data.kind} data-run-status={run ?? ''}
    >
      {data.kind !== 'input' && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-surface !bg-muted" />}
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><Icon size={15} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight">{data.label}</p>
          <p className="truncate text-[11px] text-muted">{data.summary}</p>
        </div>
        {data.issue === 'error' && <AlertTriangle size={14} className="shrink-0 text-rose-500" aria-label="Has errors" />}
        {data.issue === 'warning' && !run && <AlertTriangle size={14} className="shrink-0 text-amber-500" aria-label="Has warnings" />}
      </div>
      {run && <div className="mt-2"><Badge tone={STATUS_TONE[run]}>{run === 'RUNNING' && <Spinner size={9} label="" />}{STATUS_LABEL[run]}</Badge></div>}
      {data.kind === 'condition' ? (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: '35%' }} className="!h-3 !w-3 !border-2 !border-surface !bg-emerald-500" />
          <span className="pointer-events-none absolute -right-9 top-[35%] -translate-y-1/2 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">true</span>
          <Handle id="false" type="source" position={Position.Right} style={{ top: '72%' }} className="!h-3 !w-3 !border-2 !border-surface !bg-rose-500" />
          <span className="pointer-events-none absolute -right-9 top-[72%] -translate-y-1/2 text-[10px] font-semibold text-rose-600 dark:text-rose-400">false</span>
        </>
      ) : data.kind !== 'output' && <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-surface !bg-accent" />}
    </div>
  );
});
const NODE_TYPES = { step: StepNode };

// ------------------------------------------------------------------ inspector

function TemplateField({ label, hint, value, onChange, vars, rows = 4 }: { label: string; hint?: ReactNode; value: string; onChange: (v: string) => void; vars: string[]; rows?: number }) {
  return (
    <Field label={label} hint={hint}>
      {p => (
        <div className="flex flex-col gap-1.5">
          <Textarea {...p} rows={rows} value={value} onChange={e => onChange(e.target.value)} className="font-mono text-xs" />
          {vars.length > 0 && (
            <div className="flex flex-wrap gap-1" aria-label={`Insert a variable into ${label}`}>
              {vars.map(v => (
                <button key={v} type="button" onClick={() => onChange(`${value}${value && !value.endsWith(' ') && !value.endsWith('\n') ? ' ' : ''}{{${v}}}`)}
                  className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted transition hover:bg-hover hover:text-fg">{`{{${v}}}`}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}

function Inspector({ node, catalog, vars, issues, onChange, onDelete }: {
  node: StepNodeT; catalog: StudioCatalog; vars: string[]; issues: GraphIssue[];
  onChange: (patch: { label?: string; config?: Record<string, unknown> }) => void; onDelete: () => void;
}) {
  const { kind, label, config: c } = node.data;
  const set = (k: string, v: unknown) => onChange({ config: { ...c, [k]: v } });
  const type = catalog.nodeTypes.find(t => t.kind === kind);
  const agent = catalog.agents.find(a => a.id === c.agentId);
  const toolInfo = (id: string) => catalog.tools.find(t => t.id === id);
  const external = (id: string) => catalog.context.tools.find(t => t.id === id)?.external;
  const categories = [...new Set(catalog.agents.map(a => a.category))];
  const str = (k: string) => String(c[k] ?? '');

  return (
    <div className="flex flex-col gap-4 text-sm" data-testid="inspector">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{type?.label ?? kind}</p>
          <p className="text-xs text-muted">{type?.description}</p>
        </div>
        <Button size="sm" variant="ghost" icon={<Trash2 size={13} aria-hidden />} onClick={onDelete} aria-label={`Delete step ${label}`}>Delete</Button>
      </div>
      {issues.length > 0 && (
        <ul className="flex flex-col gap-1">
          {issues.map((i, n) => <li key={n} className={clsx('text-xs', i.severity === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400')}>{i.message}</li>)}
        </ul>
      )}
      <Field label="Name">{p => <Input {...p} value={label} maxLength={60} onChange={e => onChange({ label: e.target.value })} />}</Field>
      <p className="-mt-2 text-xs text-muted">Later steps use its result as <code className="font-mono">{`{{${node.id}}}`}</code></p>

      {kind === 'input' && <p className="text-xs text-muted">Its value is the text you type when you run the workflow, available everywhere as <code className="font-mono">{'{{input}}'}</code>.</p>}

      {kind === 'agent' && (
        <>
          <Field label="Agent">
            {p => (
              <Select {...p} value={str('agentId')} onChange={e => onChange({ config: { ...c, agentId: e.target.value, tools: [] } })}>
                {categories.map(cat => (
                  <optgroup key={cat} label={cat}>
                    {catalog.agents.filter(a => a.category === cat).map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          {agent && agent.tools.length > 0 && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-xs font-medium">Tools this step may use</legend>
              {agent.tools.map(t => {
                const info = toolInfo(t);
                const on = (c.tools as string[] | undefined ?? []).includes(t);
                return (
                  <label key={t} className={clsx('flex items-start gap-2 text-xs', !info?.available && 'opacity-60')}>
                    <input type="checkbox" disabled={!info?.available} checked={on} className="mt-0.5"
                      onChange={e => set('tools', e.target.checked ? [...(c.tools as string[] ?? []), t] : (c.tools as string[] ?? []).filter(x => x !== t))} />
                    <span>{info?.label ?? t}{!info?.available ? ` (not available here${info?.reason ? `: ${info.reason}` : ''})` : external(t) ? ' (asks for approval in each run)' : ''}</span>
                  </label>
                );
              })}
            </fieldset>
          )}
          <TemplateField label="Prompt" value={str('prompt')} onChange={v => set('prompt', v)} vars={vars} rows={6}
            hint="Leave empty to give the agent the run input plus the results of the steps connected into it." />
        </>
      )}

      {kind === 'llm' && (
        <>
          <Field label="Instructions (system prompt)">{p => <Textarea {...p} rows={3} value={str('system')} onChange={e => set('system', e.target.value)} placeholder="You are a careful, helpful assistant." />}</Field>
          <TemplateField label="Prompt" value={str('prompt')} onChange={v => set('prompt', v)} vars={vars} rows={6} />
          <Field label="Temperature" hint="0 = focused and repeatable, 2 = very varied.">
            {p => <Input {...p} type="number" min={0} max={2} step={0.1} value={Number(c.temperature ?? 0.7)} onChange={e => set('temperature', Math.max(0, Math.min(2, Number(e.target.value) || 0)))} />}
          </Field>
        </>
      )}

      {kind === 'tool' && (
        <>
          <Field label="Tool">
            {p => (
              <Select {...p} value={str('toolId')} onChange={e => onChange({ config: { ...c, toolId: e.target.value, args: Object.fromEntries((TOOL_ARGS[e.target.value] ?? []).map(a => [a, '{{input}}'])) } })}>
                {catalog.tools.filter(t => TOOL_ARGS[t.id]).map(t => <option key={t.id} value={t.id} disabled={!t.available}>{t.label}{t.available ? '' : ' (not available here)'}</option>)}
              </Select>
            )}
          </Field>
          {external(str('toolId')) && <p className="text-xs text-amber-600 dark:text-amber-400">This tool reaches outside the server, so each run asks for approval before this step.</p>}
          {(TOOL_ARGS[str('toolId')] ?? []).map(arg => (
            <TemplateField key={arg} label={arg} rows={2} vars={vars} value={String((c.args as Record<string, string> | undefined)?.[arg] ?? '')}
              onChange={v => set('args', { ...(c.args as Record<string, string> ?? {}), [arg]: v })} />
          ))}
        </>
      )}

      {kind === 'condition' && (
        <>
          <TemplateField label="Value to check" value={str('source')} onChange={v => set('source', v)} vars={vars} rows={2} hint="Empty = the result of the step connected into it." />
          <Field label="Check">{p => <Select {...p} value={str('operator')} onChange={e => set('operator', e.target.value)}>{Object.entries(OPERATOR_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          {!['is_empty', 'not_empty'].includes(str('operator')) && <Field label={str('operator') === 'matches' ? 'Pattern (regular expression)' : str('operator') === 'longer_than' ? 'Characters' : 'Text'}>{p => <Input {...p} value={str('value')} onChange={e => set('value', e.target.value)} />}</Field>}
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!c.caseSensitive} onChange={e => set('caseSensitive', e.target.checked)} /> Case sensitive</label>
          <p className="text-xs text-muted">Connect the green handle for “true” and the red one for “false”. Steps on the branch not taken are skipped.</p>
        </>
      )}

      {kind === 'template' && <TemplateField label="Text" value={str('text')} onChange={v => set('text', v)} vars={vars} rows={8} />}

      {kind === 'merge' && (
        <>
          <Field label="Continue when">
            {p => <Select {...p} value={str('join')} onChange={e => set('join', e.target.value)}><option value="all">every input has a result</option><option value="any">the inputs that ran are done (after branches)</option></Select>}
          </Field>
          <Field label="Separator">{p => <Input {...p} value={str('separator').replace(/\n/g, '\\n')} onChange={e => set('separator', e.target.value.replace(/\\n/g, '\n'))} />}</Field>
        </>
      )}

      {kind === 'extract' && (
        <>
          <TemplateField label="JSON to read" value={str('source')} onChange={v => set('source', v)} vars={vars} rows={2} hint="Empty = the result of the step connected into it." />
          <Field label="Field path" hint="Dotted path, e.g. items.0.name">{p => <Input {...p} value={str('path')} onChange={e => set('path', e.target.value)} className="font-mono" />}</Field>
        </>
      )}

      {kind === 'approval' && <TemplateField label="Message for the approver" value={str('message')} onChange={v => set('message', v)} vars={vars} rows={4} hint="Shown with the Approve / Reject buttons. Rejecting skips every step after this one." />}

      {kind === 'delay' && <Field label="Wait (seconds)">{p => <Input {...p} type="number" min={1} max={3600} value={Number(c.seconds ?? 10)} onChange={e => set('seconds', Math.max(1, Math.min(3600, Math.round(Number(e.target.value) || 1))))} />}</Field>}

      {kind === 'output' && <TemplateField label="Result" value={str('template')} onChange={v => set('template', v)} vars={vars} rows={6} hint="Empty = the result of the step connected into it." />}
    </div>
  );
}

// ------------------------------------------------------------------ run panel

function RunPanel({ run, selected, onChanged, onClose }: { run: OrchestrationView; selected: string | null; onChanged: () => void; onClose: () => void }) {
  const { toast } = useToast();
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); toast(done, 'success'); onChanged(); } catch (err) { toast(errText(err, 'That did not work.'), 'error'); }
  };
  const task = selected ? run.taskList.find(t => t.nodeId === selected) : null;
  const waiting = run.taskList.filter(t => t.approval?.status === 'PENDING');
  return (
    <div className="flex flex-col gap-4 text-sm" data-testid="run-panel" data-status={run.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={RUN_TONE[run.status]}>{isActive(run.status) && run.status !== 'PAUSED' && <Spinner size={10} label="" />}{RUN_LABEL[run.status]}</Badge>
        <Button size="sm" variant="ghost" onClick={onClose}>Back to editing</Button>
      </div>
      <p className="text-xs text-muted">Input: <span className="text-fg">{run.goal.length > 160 ? `${run.goal.slice(0, 160)}…` : run.goal}</span></p>
      {run.canManage && isActive(run.status) && (
        <div className="flex flex-wrap gap-2">
          {run.status === 'RUNNING' && <Button size="sm" icon={<Pause size={13} aria-hidden />} onClick={() => void act(() => orchestrations.pause(run.id), 'Paused: running steps finish, no new ones start')}>Pause</Button>}
          {run.status === 'PAUSED' && <Button size="sm" variant="primary" icon={<Play size={13} aria-hidden />} onClick={() => void act(() => orchestrations.resume(run.id), 'Resumed')}>Resume</Button>}
          <Button size="sm" variant="danger" icon={<Square size={12} aria-hidden />} onClick={() => void act(() => orchestrations.cancel(run.id), 'Run cancelled')}>Cancel</Button>
        </div>
      )}
      {waiting.map(t => (
        <div key={t.key} className="flex flex-col gap-2 rounded-lg border border-amber-400/40 bg-amber-400/5 p-2.5">
          <p className="text-xs font-semibold">{t.title}</p>
          <div className="max-h-40 overflow-auto text-xs"><Markdown text={t.approval!.reason} /></div>
          <ApprovalControls a={t.approval!} onDone={onChanged} />
        </div>
      ))}
      {run.error && run.status !== 'CANCELLED' && <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">{run.error}</p>}
      {task ? (
        <section className="flex flex-col gap-2" aria-label="Selected step result">
          <div className="flex items-center justify-between gap-2"><p className="font-semibold">{task.title}</p><Badge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Badge></div>
          {task.error && <p className="text-xs text-muted">{task.error}</p>}
          {task.output ? <div className="max-h-72 overflow-auto rounded-lg border border-line p-2.5 text-xs"><Markdown text={task.output} /></div> : <p className="text-xs text-muted">No result (yet).</p>}
        </section>
      ) : <p className="text-xs text-muted">Select a step on the canvas to see its result.</p>}
      {run.output && (
        <section aria-label="Workflow result" data-testid="run-output">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Result</p>
          <div className="max-h-80 overflow-auto rounded-lg border border-line p-2.5 text-xs"><Markdown text={run.output} /></div>
        </section>
      )}
      <a href={orchestrationHref(run.id)} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">Full run details <ExternalLink size={11} aria-hidden /></a>
    </div>
  );
}

// ------------------------------------------------------------------ editor

function Editor({ workflow, catalog, runId, onReload }: { workflow: WorkflowDetail; catalog: StudioCatalog; runId: string | null; onReload: () => void }) {
  const { toast } = useToast();
  const ws = useWorkspace();
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const initial = useMemo(() => toFlow(workflow.version?.graph ?? { nodes: [], edges: [] }), [workflow]);
  const [nodes, setNodes] = useState<StepNodeT[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [baseVersion, setBaseVersion] = useState<number | undefined>(workflow.version?.version);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState(workflow.name);
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<'versions' | 'runs' | 'run-input' | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [run, setRun] = useState<OrchestrationView | null>(null);

  const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const { issues } = useMemo(() => validateGraph(graph, catalog.context), [graph, catalog]);
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  // Unsaved work: warn before the tab closes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // Run overlay: follow the selected run.
  const loadRun = useCallback(() => {
    if (!runId) { setRun(null); return; }
    orchestrations.get(runId).then(setRun).catch(err => { toast(errText(err, 'Could not load the run.'), 'error'); setRun(null); });
  }, [runId, toast]);
  useEffect(loadRun, [loadRun]);
  useEffect(() => {
    if (!run || !isActive(run.status)) return;
    const t = window.setInterval(loadRun, 1500);
    return () => window.clearInterval(t);
  }, [run, loadRun]);

  const summaryOf = useCallback((n: StepNodeT): string => {
    const c = n.data.config;
    switch (n.data.kind) {
      case 'agent': return catalog.agents.find(a => a.id === c.agentId)?.name ?? 'Choose an agent';
      case 'tool': return catalog.tools.find(t => t.id === c.toolId)?.label ?? String(c.toolId ?? '');
      case 'condition': return `${OPERATOR_LABEL[String(c.operator)] ?? ''} ${['is_empty', 'not_empty'].includes(String(c.operator)) ? '' : `“${String(c.value ?? '')}”`}`.trim();
      case 'delay': return `Wait ${String(c.seconds ?? '')} s`;
      case 'merge': return c.join === 'any' ? 'Whichever branches ran' : 'All inputs';
      case 'extract': return `Field ${String(c.path ?? '')}`;
      default: return catalog.nodeTypes.find(t => t.kind === n.data.kind)?.label ?? n.data.kind;
    }
  }, [catalog]);

  const runStatus = useMemo(() => new Map(run?.taskList.map(t => [t.nodeId ?? '', t.status]) ?? []), [run]);
  const display = useMemo(() => nodes.map(n => {
    const mine = issues.filter(i => i.nodeId === n.id);
    return {
      ...n,
      data: {
        ...n.data, summary: summaryOf(n),
        issue: mine.some(i => i.severity === 'error') ? 'error' as const : mine.length ? 'warning' as const : undefined,
        runStatus: run ? runStatus.get(n.id) : undefined
      }
    };
  }), [nodes, issues, summaryOf, run, runStatus]);

  const change = () => setDirty(true);
  const onNodesChange = useCallback((changes: NodeChange<StepNodeT>[]) => {
    setNodes(ns => applyNodeChanges(changes, ns));
    if (changes.some(c => c.type !== 'select' && c.type !== 'dimensions')) setDirty(true);
    for (const c of changes) if (c.type === 'remove' && c.id === selected) setSelected(null);
  }, [selected]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges(es => applyEdgeChanges(changes, es));
    if (changes.some(c => c.type !== 'select')) setDirty(true);
  }, []);
  const onConnect = useCallback((c: Connection) => {
    setEdges(es => addEdge({ ...c, id: `${c.source}-${c.sourceHandle ? `${c.sourceHandle}-` : ''}${c.target}-${Date.now().toString(36)}`, ...(c.sourceHandle && { label: c.sourceHandle }) }, es));
    setDirty(true);
  }, []);

  const addNode = (type: NodeTypeInfo, position?: { x: number; y: number }) => {
    if (!type.available) return;
    const id = nextNodeId(type.kind, nodes.map(n => n.id));
    const rect = wrapper.current?.getBoundingClientRect();
    const pos = position ?? flow.screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 600) / 2 - 96, y: (rect?.top ?? 0) + (rect?.height ?? 400) / 2 - 30 });
    setNodes(ns => [...ns.map(n => ({ ...n, selected: false })), { id, type: 'step', position: pos, selected: true, data: { kind: type.kind, label: type.label, config: defaultConfig(type.kind) } }]);
    setSelected(id);
    change();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('application/agentverse-node');
    const type = catalog.nodeTypes.find(t => t.kind === kind);
    if (type) addNode(type, flow.screenToFlowPosition({ x: e.clientX - 96, y: e.clientY - 30 }));
  };
  const patchNode = (id: string, patch: { label?: string; config?: Record<string, unknown> }) => {
    setNodes(ns => ns.map(n => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    change();
  };
  const deleteNode = (id: string) => {
    setNodes(ns => ns.filter(n => n.id !== id));
    setEdges(es => es.filter(e => e.source !== id && e.target !== id));
    setSelected(null);
    change();
  };
  const focusNode = (id?: string) => {
    if (!id) return;
    setSelected(id);
    setNodes(ns => ns.map(n => ({ ...n, selected: n.id === id })));
    const n = nodes.find(x => x.id === id);
    if (n) void flow.setCenter(n.position.x + 96, n.position.y + 30, { zoom: 1.1, duration: 300 });
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await studio.save(workflow.id, graph, baseVersion);
      setBaseVersion(r.version);
      setDirty(false);
      toast(r.valid ? `Saved version ${r.version}` : `Saved version ${r.version} as a draft: fix the errors before running it`, r.valid ? 'success' : 'info');
    } catch (err) { toast(errText(err, 'Could not save.'), 'error'); }
    finally { setSaving(false); }
  };
  const rename = async () => {
    const next = name.trim();
    if (!next || next === workflow.name) { setName(workflow.name); return; }
    try { await studio.rename(workflow.id, { name: next }); toast('Renamed', 'success'); } catch (err) { toast(errText(err, 'Could not rename.'), 'error'); setName(workflow.name); }
  };

  const sel = selected ? nodes.find(n => n.id === selected) ?? null : null;
  const upstream = sel ? ['input', ...[...ancestors(sel.id, edges)].filter(id => nodes.find(n => n.id === id)?.data.kind !== 'input')] : [];
  const groups = [...new Set(catalog.nodeTypes.map(t => t.group))];
  const runDisabledReason = dirty ? 'Save your changes first.' : errors.length ? 'Fix the errors first.' : null;

  return (
    <div className="flex flex-col gap-3" data-testid="studio">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <LinkButton href={pageHref('workflows')} size="sm" variant="ghost" icon={<ArrowLeft size={14} aria-hidden />} onClick={e => { if (dirty && !window.confirm('Leave without saving your changes?')) e.preventDefault(); }}>Workflows</LinkButton>
        <div className="w-full max-w-xs"><Input aria-label="Workflow name" value={name} maxLength={80} onChange={e => setName(e.target.value)} onBlur={() => void rename()} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className="h-9 font-semibold" /></div>
        <span className="text-xs text-muted" data-testid="save-state">{dirty ? 'Unsaved changes' : baseVersion ? `Version ${baseVersion} · saved` : 'Not saved'}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setIssuesOpen(o => !o)} aria-expanded={issuesOpen} data-testid="issues-toggle"
            className={clsx('inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition', errors.length ? 'border-rose-500/50 text-rose-600 dark:text-rose-400' : 'border-line text-muted hover:bg-hover')}>
            {errors.length ? <XCircle size={14} aria-hidden /> : <CheckCircle2 size={14} aria-hidden className="text-emerald-500" />}
            {errors.length ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : 'No errors'}{warnings.length ? ` · ${warnings.length} note${warnings.length > 1 ? 's' : ''}` : ''}
          </button>
          <Button size="sm" icon={<History size={14} aria-hidden />} onClick={() => setPanel('versions')}>Versions</Button>
          <Button size="sm" icon={<MessageSquareText size={14} aria-hidden />} onClick={() => setPanel('runs')}>Runs</Button>
          <Button size="sm" icon={<Save size={14} aria-hidden />} onClick={() => void save()} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save'}</Button>
          <Button size="sm" variant="primary" icon={<Play size={14} aria-hidden />} disabled={!!runDisabledReason || !ws.meta?.orchestration?.available} title={runDisabledReason ?? undefined} onClick={() => setPanel('run-input')}>Run</Button>
        </div>
      </div>
      {!ws.meta?.orchestration?.available && <p className="text-xs text-muted">Runs are not available on this server: {ws.meta?.orchestration?.reason ?? 'orchestration is not configured.'} You can still build and save workflows.</p>}
      {issuesOpen && (
        <ul className="flex max-h-40 flex-col gap-1 overflow-auto rounded-xl border border-line p-2 text-xs" data-testid="issues">
          {issues.length === 0 ? <li className="text-muted">Everything checks out.</li> : issues.map((i, n) => (
            <li key={n}>
              <button type="button" onClick={() => focusNode(i.nodeId)} className={clsx('text-left hover:underline', i.severity === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400')}>
                {i.severity === 'error' ? 'Error' : 'Note'}: {i.message}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 lg:grid-cols-[150px_minmax(0,1fr)_300px]">
        {/* palette */}
        <aside aria-label="Steps you can add" className="flex gap-3 overflow-x-auto lg:flex-col lg:overflow-visible">
          {groups.map(g => (
            <div key={g} className="flex shrink-0 flex-col gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{g}</p>
              {catalog.nodeTypes.filter(t => t.group === g).map(t => {
                const Icon = ICONS[t.kind] ?? Wrench;
                return (
                  <button key={t.kind} type="button" disabled={!t.available} draggable={t.available}
                    onDragStart={e => { e.dataTransfer.setData('application/agentverse-node', t.kind); e.dataTransfer.effectAllowed = 'move'; }}
                    onClick={() => addNode(t)} title={t.available ? t.description : `${t.description} — ${t.reason}`}
                    aria-label={t.available ? `Add ${t.label}` : `${t.label} (not available yet: ${t.reason})`}
                    className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-left text-xs transition enabled:hover:border-accent/60 enabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50">
                    <Icon size={13} aria-hidden className="shrink-0 text-accent" />
                    <span className="truncate">{t.label}</span>
                    {!t.available && <span className="ml-auto rounded border border-line px-1 text-[9px] uppercase text-muted">Soon</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {/* canvas */}
        <div ref={wrapper} className="h-[calc(100dvh-240px)] min-h-[440px] overflow-hidden rounded-xl border border-line bg-[var(--code-bg)]" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
          <ReactFlow<StepNodeT, Edge>
            nodes={display} edges={edges} nodeTypes={NODE_TYPES} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onSelectionChange={({ nodes: s }) => setSelected(s[0]?.id ?? null)} onPaneClick={() => setSelected(null)}
            isValidConnection={c => c.source !== c.target && nodes.find(n => n.id === c.target)?.data.kind !== 'input'}
            deleteKeyCode={['Delete', 'Backspace']} fitView fitViewOptions={{ padding: 0.12, minZoom: 0.5, maxZoom: 1 }} minZoom={0.2} maxZoom={2}
            colorMode={ws.theme === 'dark' ? 'dark' : 'light'} proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: 'smoothstep' }}
          >
            <Background gap={20} size={1} />
            <MiniMap pannable zoomable style={{ width: 120, height: 80 }} className="!hidden xl:!block" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* inspector / run panel */}
        <aside aria-label={run ? 'Run' : 'Step settings'} className="min-h-[200px] overflow-y-auto lg:max-h-[calc(100dvh-240px)] rounded-xl border border-line p-3">
          {run ? <RunPanel run={run} selected={selected} onChanged={loadRun} onClose={() => { location.hash = studioHref(workflow.id); }} />
            : sel ? <Inspector key={sel.id} node={sel} catalog={catalog} vars={upstream} issues={issues.filter(i => i.nodeId === sel.id)} onChange={p => patchNode(sel.id, p)} onDelete={() => deleteNode(sel.id)} />
            : (
              <div className="flex flex-col gap-2 text-xs text-muted">
                <p className="text-sm font-semibold text-fg">Build the workflow</p>
                <p>Click or drag a step from the left onto the canvas, then drag from a step's right handle to the next step's left handle.</p>
                <p>Select a step to change its settings. Delete removes the selected step or connection.</p>
                <p>Every run starts at the Manual input and ends at an Output. Use <code className="font-mono">{'{{input}}'}</code> and <code className="font-mono">{'{{step_id}}'}</code> in prompts to pass results along.</p>
              </div>
            )}
        </aside>
      </div>

      <Drawer open={panel === 'versions'} onClose={() => setPanel(null)} title="Versions" width="w-[420px]">
        <VersionsList workflowId={workflow.id} onLoad={g => { const f = toFlow(g.graph); setNodes(f.nodes); setEdges(f.edges); setDirty(g.version !== baseVersion); setSelected(null); setPanel(null); toast(`Loaded version ${g.version}${g.version !== baseVersion ? '. Save to make it the latest version.' : ''}`, 'info'); void flow.fitView({ padding: 0.2 }); }} />
      </Drawer>
      <Drawer open={panel === 'runs'} onClose={() => setPanel(null)} title="Runs" width="w-[420px]">
        <RunsList workflowId={workflow.id} onOpen={id => { setPanel(null); location.hash = studioHref(workflow.id, id); }} />
      </Drawer>
      <Drawer open={panel === 'run-input'} onClose={() => setPanel(null)} title={`Run ${workflow.name}`} width="w-[460px]">
        <RunForm workflowId={workflow.id} version={baseVersion} onStarted={id => { setPanel(null); onReload(); location.hash = studioHref(workflow.id, id); }} />
      </Drawer>
    </div>
  );
}

function VersionsList({ workflowId, onLoad }: { workflowId: string; onLoad: (v: { version: number; graph: Graph }) => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<VersionSummary[] | null>(null);
  useEffect(() => { studio.versions(workflowId).then(setRows).catch(err => toast(errText(err, 'Could not load versions.'), 'error')); }, [workflowId, toast]);
  if (!rows) return <div className="p-4"><Skeleton className="h-32" /></div>;
  return (
    <ul className="divide-y divide-line" data-testid="versions">
      {rows.map(v => (
        <li key={v.version} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium">Version {v.version} {!v.valid && <Badge tone="warning">Draft</Badge>}</p>
            <p className="truncate text-xs text-muted">{v.steps} steps · {v.createdBy ?? 'someone'} · {timeAgo(v.createdAt)}{v.note ? ` · ${v.note}` : ''}</p>
          </div>
          <Button size="sm" onClick={() => { studio.version(workflowId, v.version).then(onLoad).catch(err => toast(errText(err, 'Could not load it.'), 'error')); }}>Load</Button>
        </li>
      ))}
    </ul>
  );
}

function RunsList({ workflowId, onOpen }: { workflowId: string; onOpen: (id: string) => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<OrchestrationSummary[] | null>(null);
  useEffect(() => { studio.runs(workflowId).then(setRows).catch(err => toast(errText(err, 'Could not load runs.'), 'error')); }, [workflowId, toast]);
  if (!rows) return <div className="p-4"><Skeleton className="h-32" /></div>;
  if (!rows.length) return <p className="p-4 text-sm text-muted">No runs yet.</p>;
  return (
    <ul className="divide-y divide-line" data-testid="runs">
      {rows.map(r => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-hover">
            <span className="min-w-0"><span className="block truncate">{r.goal}</span><span className="block text-xs text-muted">v{r.workflow?.version ?? '?'} · {timeAgo(r.createdAt)}</span></span>
            <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge>
          </button>
        </li>
      ))}
    </ul>
  );
}

function RunForm({ workflowId, version, onStarted }: { workflowId: string; version?: number; onStarted: (id: string) => void }) {
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());
  const start = async () => {
    if (!input.trim()) return toast('Type the input for this run.', 'error');
    setBusy(true);
    try { const r = await studio.run(workflowId, input.trim(), key.current); onStarted(r.id); }
    catch (err) { toast(errText(err, 'Could not start the run.'), 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-muted">Runs version {version ?? '—'}. The text becomes <code className="font-mono">{'{{input}}'}</code>.</p>
      <Field label="Input">{p => <Textarea {...p} rows={5} maxLength={4000} value={input} onChange={e => { setInput(e.target.value); key.current = newKey(); }} autoFocus />}</Field>
      <Button variant="primary" icon={<Play size={14} aria-hidden />} disabled={busy} onClick={() => void start()}>{busy ? 'Starting…' : 'Start run'}</Button>
    </div>
  );
}

// ------------------------------------------------------------------ page

export default function StudioPage({ workflowId, runId }: { workflowId: string; runId?: string }) {
  const ws = useWorkspace();
  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [catalog, setCatalog] = useState<StudioCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([studio.get(workflowId), studio.catalog()]).then(([w, c]) => { setWorkflow(w); setCatalog(c); setError(null); })
      .catch(err => setError(errText(err, 'Could not load this workflow.')));
  }, [workflowId]);
  useEffect(load, [load]);
  if (ws.account.status !== 'signed-in') return <EmptyState title="Sign in to use the workflow studio">Workflows are saved to your workspace.</EmptyState>;
  if (error) return <ErrorState title="Could not load this workflow" onRetry={load}>{error}</ErrorState>;
  if (!workflow || !catalog) return <Skeleton className="h-[70dvh]" />;
  return (
    <ReactFlowProvider>
      {/* Keyed by version so "reload" after a save from elsewhere starts clean. */}
      <Editor key={`${workflow.id}`} workflow={workflow} catalog={catalog} runId={runId ?? null} onReload={() => undefined} />
    </ReactFlowProvider>
  );
}
