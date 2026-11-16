import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Network, Play, RefreshCw, RotateCcw, ShieldAlert, Square, Wrench, X } from 'lucide-react';
import { Button, LinkButton } from '../components/ui/Button';
import { Badge, Card, CardTitle, EmptyState, ErrorState, PageHeader, Skeleton, Spinner, type Tone } from '../components/ui/Display';
import { Field, Textarea } from '../components/ui/Form';
import { Markdown } from '../components/Markdown';
import { useToast } from '../components/Toast';
import { useWorkspace } from '../app/workspace';
import { formatTokens } from '../lib/executions';
import {
  isActive, orchestrations, stagesOf,
  type ApprovalView, type OrchestrationStatus, type OrchestrationSummary, type OrchestrationTaskStatus, type OrchestrationTaskView, type OrchestrationView
} from '../lib/orchestrations';
import { authHref, orchestrationHref } from '../lib/route';
import { formatDuration, timeAgo } from '../lib/sessionStats';
import { toolLabel } from '../lib/tools';

const RUN_TONE: Record<OrchestrationStatus, Tone> = { PLANNING: 'accent', RUNNING: 'accent', SYNTHESIZING: 'accent', COMPLETED: 'success', FAILED: 'danger', CANCELLED: 'neutral' };
const RUN_LABEL: Record<OrchestrationStatus, string> = { PLANNING: 'Planning', RUNNING: 'Running', SYNTHESIZING: 'Combining results', COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled' };
const TASK_TONE: Record<OrchestrationTaskStatus, Tone> = {
  PENDING: 'neutral', WAITING_APPROVAL: 'warning', QUEUED: 'neutral', RUNNING: 'accent', SUCCEEDED: 'success', FAILED: 'danger', SKIPPED: 'neutral', CANCELLED: 'neutral'
};
const TASK_LABEL: Record<OrchestrationTaskStatus, string> = {
  PENDING: 'Waiting for inputs', WAITING_APPROVAL: 'Needs approval', QUEUED: 'Queued', RUNNING: 'Running', SUCCEEDED: 'Done', FAILED: 'Failed', SKIPPED: 'Skipped', CANCELLED: 'Cancelled'
};
const EXAMPLES = [
  'Compare PostgreSQL and MongoDB for a small B2B SaaS and recommend one',
  'Plan a product launch for a budgeting app: positioning, launch-week content and risks',
  'Draft a remote-work policy for a 20-person startup and check it for compliance gaps'
];

const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

function usePoll(fn: () => void, active: boolean, ms: number) {
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(fn, ms);
    return () => window.clearInterval(t);
  }, [fn, active, ms]);
}

// ------------------------------------------------------------------ approvals

function ApprovalControls({ a, onDone }: { a: ApprovalView; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const decide = async (d: 'approve' | 'reject') => {
    setBusy(d);
    try {
      await orchestrations.decide(a.id, d);
      toast(d === 'approve' ? `${a.taskKey} approved: it will run now` : `${a.taskKey} rejected: it will be skipped`, 'success');
      onDone();
    } catch (err) { toast(errText(err, 'Could not record the decision.'), 'error'); }
    finally { setBusy(null); }
  };
  if (!a.canDecide) return <p className="text-xs text-muted">Waiting for the person who started it, or a workspace admin, to decide.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="primary" icon={<Check size={13} aria-hidden />} disabled={!!busy} onClick={() => void decide('approve')}>{busy === 'approve' ? 'Approving…' : `Approve ${a.taskKey}`}</Button>
      <Button size="sm" variant="secondary" icon={<X size={13} aria-hidden />} disabled={!!busy} onClick={() => void decide('reject')}>{busy === 'reject' ? 'Rejecting…' : 'Reject'}</Button>
    </div>
  );
}

function ApprovalsInbox({ items, onChanged }: { items: ApprovalView[]; onChanged: () => void }) {
  if (!items.length) return null;
  return (
    <Card className="mb-6 border-amber-400/40" data-testid="approvals-inbox">
      <CardTitle>Waiting for your approval ({items.length})</CardTitle>
      <ul className="flex flex-col gap-3">
        {items.map(a => (
          <li key={a.id} className="flex flex-col gap-2 rounded-lg border border-line p-3 text-sm" data-approval={a.id}>
            <p className="flex items-start gap-2"><ShieldAlert size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden /><span>{a.reason}</span></p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <a className="text-xs text-accent underline-offset-2 hover:underline" href={orchestrationHref(a.orchestrationId)}>Open the run</a>
              <ApprovalControls a={a} onDone={onChanged} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ one run

function TaskCard({ t, run, onChanged }: { t: OrchestrationTaskView; run: OrchestrationView; onChanged: () => void }) {
  const { toast } = useToast();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try { await orchestrations.retryTask(run.id, t.key); toast(`${t.key} queued again`, 'success'); onChanged(); }
    catch (err) { toast(errText(err, 'Could not retry.'), 'error'); }
    finally { setRetrying(false); }
  };
  return (
    <li id={`task-${t.key}`} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 text-sm" data-task={t.key} data-status={t.status}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold"><span className="mr-1.5 font-mono text-xs text-muted">{t.key}</span>{t.title}</p>
          <p className="truncate text-xs text-muted"><span aria-hidden>{t.agentIcon}</span> {t.agentName}</p>
        </div>
        <Badge tone={TASK_TONE[t.status]}>{t.status === 'RUNNING' && <Spinner size={10} label="" />}{TASK_LABEL[t.status]}</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px] text-muted">
        {t.dependsOn.length > 0 && <span>Uses {t.dependsOn.join(', ')}</span>}
        {t.tools.map(tool => <span key={tool} className="inline-flex items-center gap-1 rounded-md border border-line px-1.5"><Wrench size={10} aria-hidden />{toolLabel(tool)}</span>)}
        {t.attempt > 1 && <span>Attempt {t.attempt} of {t.maxAttempts}</span>}
        {t.endedAt && t.startedAt && t.status === 'SUCCEEDED' && <span>{formatDuration(t.endedAt - t.startedAt)}</span>}
      </div>
      {t.error && <p className={t.status === 'FAILED' ? 'text-xs text-rose-600 dark:text-rose-400' : 'text-xs text-muted'}>{t.error}</p>}
      {t.approval?.status === 'PENDING' && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-400/40 bg-amber-400/5 p-2.5">
          <p className="text-xs">{t.approval.reason}</p>
          <ApprovalControls a={t.approval} onDone={onChanged} />
        </div>
      )}
      {t.approval && t.approval.status !== 'PENDING' && (
        <p className="text-[11px] text-muted">Tool use {t.approval.status.toLowerCase()}{t.approval.decidedBy ? ` by ${t.approval.decidedBy}` : ''}.</p>
      )}
      {t.status === 'FAILED' && run.status === 'FAILED' && run.canManage && (
        <Button size="sm" icon={<RotateCcw size={13} aria-hidden />} disabled={retrying} onClick={() => void retry()}>{retrying ? 'Retrying…' : `Retry ${t.key}`}</Button>
      )}
      {t.toolCalls.length > 0 && (
        <ul className="flex flex-col gap-1 text-[11px]">
          {t.toolCalls.map((c, i) => <li key={i} className="truncate"><Badge tone={c.ok ? 'success' : 'danger'}>{toolLabel(c.tool)}</Badge> <span className="text-muted">{c.summary}</span></li>)}
        </ul>
      )}
      {t.output && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-accent">Show result</summary>
          <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-line p-2.5 text-xs"><Markdown text={t.output} /></div>
        </details>
      )}
    </li>
  );
}

function RunView({ id }: { id: string }) {
  const { toast } = useToast();
  const [run, setRun] = useState<OrchestrationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const load = useCallback(() => {
    orchestrations.get(id).then(r => { setRun(r); setError(null); }).catch(err => setError(errText(err, 'Could not load this orchestration.')));
  }, [id]);
  useEffect(load, [load]);
  usePoll(load, !!run && isActive(run.status), 1500);

  if (error && !run) return <ErrorState title="Could not load this orchestration" onRetry={load}>{error}</ErrorState>;
  if (!run) return <Skeleton className="h-64" />;
  const cancel = async () => {
    setCancelling(true);
    try { await orchestrations.cancel(run.id); toast('Orchestration cancelled', 'success'); load(); }
    catch (err) { toast(errText(err, 'Could not cancel.'), 'error'); }
    finally { setCancelling(false); }
  };
  const stages = stagesOf(run.taskList);
  const duration = run.endedAt ? formatDuration(run.endedAt - run.createdAt) : null;
  const jump = (key: string) => document.getElementById(`task-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return (
    <div className="flex flex-col gap-5" data-testid="orchestration" data-status={run.status}>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Goal</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{run.goal}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={RUN_TONE[run.status]}>{isActive(run.status) && <Spinner size={10} label="" />}{RUN_LABEL[run.status]}</Badge>
            {run.provider === 'demo' && <Badge tone="warning">Demo</Badge>}
            {isActive(run.status) && run.canManage && <Button size="sm" variant="danger" icon={<Square size={12} aria-hidden />} disabled={cancelling} onClick={() => void cancel()}>Cancel</Button>}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-muted">Model</dt><dd>{run.provider === 'demo' ? 'Demo (no model)' : `${run.provider} · ${run.model ?? '—'}`}</dd></div>
          <div><dt className="text-xs text-muted">Model calls</dt><dd>{run.modelCalls}</dd></div>
          <div><dt className="text-xs text-muted">Tokens</dt><dd>{formatTokens(run.inputTokens, run.outputTokens)}</dd></div>
          <div><dt className="text-xs text-muted">{duration ? 'Took' : 'Started'}</dt><dd>{duration ?? timeAgo(run.createdAt)}</dd></div>
        </dl>
        {!run.durable && isActive(run.status) && <p className="mt-3 text-xs text-muted">This server runs jobs in-process (no Redis): a restart interrupts running tasks, which are then re-run from where the plan stood.</p>}
        {run.error && run.status !== 'CANCELLED' && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400" role="alert">{run.error}</p>}
      </Card>

      {run.status === 'PLANNING' ? (
        <Card><p className="flex items-center gap-2 text-sm"><Spinner size={14} label="" /> The planner is breaking the goal into tasks…</p></Card>
      ) : run.taskList.length > 0 && (
        <section aria-label="Plan">
          <h2 className="mb-1 text-sm font-semibold">Plan</h2>
          {run.planSummary && <p className="mb-3 text-sm text-muted">{run.planSummary}</p>}
          <div className="flex flex-col gap-4">
            {stages.map((stage, i) => (
              <div key={i}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Stage {i + 1}{stage.length > 1 ? ' · runs in parallel' : ''}</p>
                <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {stage.map(t => <TaskCard key={t.key} t={t} run={run} onChanged={load} />)}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}

      {run.status === 'SYNTHESIZING' && <Card><p className="flex items-center gap-2 text-sm"><Spinner size={14} label="" /> Combining the results into one answer…</p></Card>}
      {run.output && (
        <Card data-testid="orchestration-answer">
          <CardTitle>Answer</CardTitle>
          <div className="text-sm"><Markdown text={run.output} /></div>
          <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
            {run.sources.length ? (
              <p className="flex flex-wrap items-center gap-1.5">Sources:
                {run.sources.map(k => {
                  const t = run.taskList.find(x => x.key === k);
                  return <button key={k} type="button" onClick={() => jump(k)} className="rounded-md border border-line px-1.5 py-0.5 hover:bg-hover">{k}{t ? ` · ${t.title}` : ''}</button>;
                })}
              </p>
            ) : <p>The answer does not cite any task, so its claims could not be traced to a result.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ list + new

function Home() {
  const { toast } = useToast();
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [runs, setRuns] = useState<OrchestrationSummary[] | null>(null);
  const [approvals, setApprovals] = useState<ApprovalView[]>([]);
  const [error, setError] = useState<string | null>(null);
  // One key per goal: re-submitting the same goal (double click, retry after a network error) cannot start it twice.
  const key = useRef(newKey());

  const load = useCallback(() => {
    Promise.all([orchestrations.list(), orchestrations.approvals()])
      .then(([r, a]) => { setRuns(r); setApprovals(a); setError(null); })
      .catch(err => setError(errText(err, 'Could not load orchestrations.')));
  }, []);
  useEffect(load, [load]);
  usePoll(load, !!runs?.some(r => isActive(r.status)), 3000);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (goal.trim().length < 3) return setFormError('Describe the goal in a few words.');
    setBusy(true); setFormError(null);
    try {
      const r = await orchestrations.start(goal.trim(), key.current);
      key.current = newKey();
      setGoal('');
      location.hash = orchestrationHref(r.id);
    } catch (err) {
      setFormError(errText(err, 'Could not start.'));
      toast(errText(err, 'Could not start.'), 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card as="section">
        <form onSubmit={e => void submit(e)} className="flex flex-col gap-3">
          <Field label="Goal" hint="A planner splits it into up to 6 tasks for the best-suited agents. Independent tasks run in parallel; then the results are combined into one answer that cites each task." error={formError ?? undefined}>
            {p => <Textarea {...p} rows={3} maxLength={4000} value={goal} placeholder="What should the agents work on?" onChange={e => { setGoal(e.target.value); key.current = newKey(); }} />}
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map(x => <button key={x} type="button" onClick={() => { setGoal(x); key.current = newKey(); }} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted transition hover:bg-hover hover:text-fg">{x.split(' ').slice(0, 5).join(' ')}…</button>)}
            </div>
            <Button type="submit" variant="primary" icon={<Play size={14} aria-hidden />} disabled={busy}>{busy ? 'Starting…' : 'Start'}</Button>
          </div>
        </form>
      </Card>

      <ApprovalsInbox items={approvals} onChanged={load} />

      <section aria-label="Recent orchestrations">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent</h2>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={13} aria-hidden />} onClick={load}>Refresh</Button>
        </div>
        {error ? <ErrorState title="Could not load orchestrations" onRetry={load}>{error}</ErrorState>
          : !runs ? <Skeleton className="h-32" />
          : runs.length === 0 ? <EmptyState icon={<Network size={20} />} title="No orchestrations yet">Start one above. Each run, its plan and every task's result are kept here.</EmptyState>
          : (
            <Card padded={false}>
              <ul className="divide-y divide-line" data-testid="orchestration-list">
                {runs.map(r => (
                  <li key={r.id}>
                    <a href={orchestrationHref(r.id)} className="flex flex-col gap-1.5 px-4 py-3 transition hover:bg-hover sm:flex-row sm:items-center sm:gap-4" data-orchestration={r.id} data-status={r.status}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.goal}</span>
                        <span className="block text-xs text-muted">{r.tasks.total ? `${r.tasks.done} of ${r.tasks.total} tasks done` : 'Planning'}{!r.mine && r.user ? ` · ${r.user}` : ''}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        {r.tasks.waitingApproval > 0 && <Badge tone="warning">{r.tasks.waitingApproval} awaiting approval</Badge>}
                        <span>{timeAgo(r.createdAt)}</span>
                        <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
      </section>
    </div>
  );
}

export default function OrchestratorPage({ orchestrationId }: { orchestrationId?: string }) {
  const ws = useWorkspace();
  const signedIn = ws.account.status === 'signed-in';
  const o = ws.meta?.orchestration;
  const header = (
    <PageHeader
      title="Orchestrator"
      description="Give the agents a goal. A planner breaks it into tasks, assigns each to a specialist, runs independent ones in parallel, asks you before any task reaches the internet, and combines the results with sources."
      actions={orchestrationId ? <LinkButton href={orchestrationHref()} icon={<ArrowLeft size={14} aria-hidden />}>All orchestrations</LinkButton> : undefined}
    />
  );
  if (ws.account.status === 'unavailable') {
    return <div>{header}<EmptyState icon={<Network size={20} />} title="Orchestration needs accounts">This server runs in guest mode (no database). Runs, plans and approvals are stored per workspace, so orchestration needs DATABASE_URL and BETTER_AUTH_SECRET.</EmptyState></div>;
  }
  if (!signedIn) {
    return <div>{header}<EmptyState icon={<Network size={20} />} title="Sign in to orchestrate agents" action={<LinkButton href={authHref('sign-in')} variant="primary" size="sm">Sign in</LinkButton>}>Orchestrations run in the background and are saved to your workspace.</EmptyState></div>;
  }
  if (o && !o.available) {
    return <div>{header}<EmptyState icon={<Network size={20} />} title="Orchestration is not available on this server">{o.reason}</EmptyState></div>;
  }
  return (
    <div>
      {header}
      {o && !o.durable && !orchestrationId && <p className="-mt-2 mb-4 text-xs text-muted">Jobs run inside the API server here (no REDIS_URL), so they are not durable: a restart interrupts running tasks, which are then re-run.</p>}
      {orchestrationId ? <RunView key={orchestrationId} id={orchestrationId} /> : <Home />}
    </div>
  );
}
