import { useCallback, useEffect, useState } from 'react';
import { Activity as ActivityIcon, RefreshCw, Square, Wrench } from 'lucide-react';
import { Button, LinkButton } from '../components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton, type Tone } from '../components/ui/Display';
import { Segmented } from '../components/ui/Form';
import { Drawer } from '../components/ui/Overlay';
import { useToast } from '../components/Toast';
import { executions, formatTokens, type ExecutionDetail, type ExecutionStatus, type ExecutionSummary } from '../lib/executions';
import { authHref } from '../lib/route';
import { formatDuration, timeAgo } from '../lib/sessionStats';
import { toolLabel } from '../lib/tools';
import { useWorkspace } from '../app/workspace';

type Filter = 'all' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
const TONE: Record<ExecutionStatus, Tone> = {
  QUEUED: 'neutral', RUNNING: 'accent', WAITING_INPUT: 'warning', WAITING_APPROVAL: 'warning', COMPLETED: 'success', FAILED: 'danger', CANCELLED: 'neutral'
};
const LABEL: Record<ExecutionStatus, string> = {
  QUEUED: 'Queued', RUNNING: 'Running', WAITING_INPUT: 'Waiting for input', WAITING_APPROVAL: 'Waiting for approval', COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled'
};
const StatusBadge = ({ s }: { s: ExecutionStatus }) => <Badge tone={TONE[s]}>{LABEL[s]}</Badge>;

function Detail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { toast } = useToast();
  const [d, setD] = useState<ExecutionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { executions.get(id).then(setD).catch(err => setError(err instanceof Error ? err.message : 'Could not load this run.')); }, [id]);
  useEffect(load, [load]);
  if (error) return <div className="p-4"><ErrorState title="Could not load this run" onRetry={() => { setError(null); load(); }}>{error}</ErrorState></div>;
  if (!d) return <div className="p-4"><Skeleton className="h-40" /></div>;
  const cancel = async () => {
    try { await executions.cancel(d.id); toast('Run cancelled', 'success'); load(); onChanged(); }
    catch (err) { toast(err instanceof Error ? err.message : 'Could not cancel.', 'error'); }
  };
  return (
    <div className="flex flex-col gap-4 p-4 text-sm" data-testid="execution-detail">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge s={d.status} />
        {d.workflowId && <Badge tone="violet">Workflow · {d.workflowId}</Badge>}
        {d.status === 'RUNNING' && d.running && <Button size="sm" variant="danger" icon={<Square size={12} aria-hidden />} onClick={() => void cancel()}>Cancel run</Button>}
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="text-xs text-muted">Agent</dt><dd>{d.agentName}{d.agentVersion ? ` · v${d.agentVersion}` : ''}</dd></div>
        <div><dt className="text-xs text-muted">Model</dt><dd>{d.provider === 'demo' ? 'Demo (no model)' : `${d.provider} · ${d.model ?? '—'}`}</dd></div>
        <div><dt className="text-xs text-muted">Model calls</dt><dd>{d.modelCalls}</dd></div>
        <div><dt className="text-xs text-muted">Tokens</dt><dd>{formatTokens(d.inputTokens, d.outputTokens)}</dd></div>
        <div><dt className="text-xs text-muted">Started</dt><dd>{d.startedAt ? new Date(d.startedAt).toLocaleString() : '—'}</dd></div>
        <div><dt className="text-xs text-muted">Duration</dt><dd>{d.startedAt && d.endedAt ? formatDuration(d.endedAt - d.startedAt) : '—'}</dd></div>
        {d.user && !d.mine && <div><dt className="text-xs text-muted">Run by</dt><dd>{d.user}</dd></div>}
      </dl>
      {d.inputTokens === null && d.provider !== 'demo' && <p className="text-xs text-muted">The provider did not report token counts for this run, so none are shown.</p>}
      <section><h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Input</h3><pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-[var(--code-bg)] p-2.5 text-xs">{d.input}</pre></section>
      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Tool calls ({d.tools.length})</h3>
        {d.tools.length === 0 ? <p className="text-xs text-muted">None.</p> : (
          <ol className="flex flex-col gap-2" data-testid="execution-tools">
            {d.tools.map(t => (
              <li key={t.id} className="rounded-lg border border-line p-2.5">
                <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 font-medium"><Wrench size={13} aria-hidden /> {toolLabel(t.tool)}</span><Badge tone={t.status === 'SUCCEEDED' ? 'success' : 'danger'}>{t.status === 'SUCCEEDED' ? 'OK' : 'Failed'} · {formatDuration(t.durationMs)}</Badge></div>
                <p className="mt-1 truncate font-mono text-[11px] text-muted">{JSON.stringify(t.input)}</p>
                <p className="mt-1 text-xs">{t.summary}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
      {d.error && <section><h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Error</h3><p className="text-rose-600 dark:text-rose-400">{d.error}</p></section>}
      {d.output && <section><h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Output</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-[var(--code-bg)] p-2.5 text-xs">{d.output}</pre></section>}
    </div>
  );
}

export default function ActivityPage() {
  const ws = useWorkspace();
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<ExecutionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const signedIn = ws.account.status === 'signed-in';

  const load = useCallback(() => {
    if (!signedIn) return;
    executions.list(filter === 'all' ? undefined : filter).then(r => { setRows(r); setError(null); }).catch(err => setError(err instanceof Error ? err.message : 'Could not load activity.'));
  }, [signedIn, filter]);
  useEffect(load, [load, ws.account.me?.workspace?.id]);
  // Refresh while something is running, and when a reply in this tab finishes.
  const anyRunning = rows?.some(r => r.status === 'RUNNING') ?? false;
  useEffect(() => {
    if (!anyRunning) return;
    const t = window.setInterval(load, 3000);
    return () => window.clearInterval(t);
  }, [anyRunning, load]);
  useEffect(() => { if (ws.chat.streamingKeys.length === 0) load(); }, [ws.chat.streamingKeys.length, load]);

  const header = <PageHeader title="Activity" description="Every agent run in this workspace: what ran, on which model, with which tools, how long it took and how it ended." actions={signedIn ? <Button icon={<RefreshCw size={14} aria-hidden />} onClick={load}>Refresh</Button> : undefined} />;

  if (ws.account.status === 'unavailable') {
    return <div>{header}<EmptyState icon={<ActivityIcon size={20} />} title="Activity is recorded for accounts">This server runs in guest mode (no database), so runs are not stored. The Command Center shows this tab's session.</EmptyState></div>;
  }
  if (!signedIn) {
    return <div>{header}<EmptyState icon={<ActivityIcon size={20} />} title="Sign in to see your run history" action={<LinkButton href={authHref('sign-in')} variant="primary" size="sm">Sign in</LinkButton>}>Signed-in runs are saved with their model, tokens, tool calls and timing.</EmptyState></div>;
  }

  return (
    <div>
      {header}
      <div className="mb-4">
        <Segmented<Filter> label="Filter by status" value={filter} onChange={setFilter}
          options={[{ value: 'all', label: 'All' }, { value: 'RUNNING', label: 'Running' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'FAILED', label: 'Failed' }, { value: 'CANCELLED', label: 'Cancelled' }]} />
      </div>
      {error ? <ErrorState title="Could not load activity" onRetry={load}>{error}</ErrorState>
        : !rows ? <Skeleton className="h-48" />
        : rows.length === 0 ? <EmptyState icon={<ActivityIcon size={20} />} title={filter === 'all' ? 'No runs yet' : 'Nothing with this status'}>Runs appear here as soon as you chat with an agent or run a workflow.</EmptyState>
        : (
          <Card padded={false}>
            <ul className="divide-y divide-line" data-testid="execution-list">
              {rows.map(r => (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpenId(r.id)} className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition hover:bg-hover sm:flex-row sm:items-center sm:gap-4" data-execution={r.id} data-status={r.status}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{r.agentName}{r.workflowId && <span className="font-normal text-muted"> · workflow</span>}{!r.mine && r.user && <span className="font-normal text-muted"> · {r.user}</span>}</span>
                      <span className="block truncate text-xs text-muted">{r.input}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted sm:justify-end">
                      <span>{r.provider === 'demo' ? 'Demo' : r.model}</span>
                      {r.toolCalls > 0 && <span className="flex items-center gap-1"><Wrench size={11} aria-hidden />{r.toolCalls}</span>}
                      <span>{formatTokens(r.inputTokens, r.outputTokens)}</span>
                      <span>{r.durationMs !== null ? formatDuration(r.durationMs) : '—'}</span>
                      <span>{timeAgo(r.createdAt)}</span>
                      <StatusBadge s={r.status} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      <Drawer open={!!openId} onClose={() => setOpenId(null)} title="Run details" width="w-[480px]">
        {openId && <Detail key={openId} id={openId} onChanged={load} />}
      </Drawer>
    </div>
  );
}
