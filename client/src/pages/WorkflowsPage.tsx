import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Play, Plus, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { AgentAvatar, workflowIcon } from '../components/AgentAvatar';
import { Button, LinkButton } from '../components/ui/Button';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton, type Tone } from '../components/ui/Display';
import { useToast } from '../components/Toast';
import { useWorkspace } from '../app/workspace';
import { authHref, studioHref } from '../lib/route';
import { timeAgo } from '../lib/sessionStats';
import { studio, type Template, type WorkflowSummary } from '../lib/studio';
import type { OrchestrationStatus } from '../lib/orchestrations';

const RUN_TONE: Record<OrchestrationStatus, Tone> = { PLANNING: 'accent', RUNNING: 'accent', PAUSED: 'warning', SYNTHESIZING: 'accent', COMPLETED: 'success', FAILED: 'danger', CANCELLED: 'neutral' };
const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** Workflows built in the visual studio (signed in, with a database). */
function StudioSection() {
  const ws = useWorkspace();
  const { toast } = useToast();
  const [rows, setRows] = useState<WorkflowSummary[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const signedIn = ws.account.status === 'signed-in';

  const load = useCallback(() => {
    if (!signedIn) return;
    Promise.all([studio.list(), studio.templates()]).then(([w, t]) => { setRows(w); setTemplates(t); setError(null); })
      .catch(err => setError(errText(err, 'Could not load your workflows.')));
  }, [signedIn]);
  useEffect(load, [load, ws.account.me?.workspace?.id]);

  const create = async (body: { name: string; templateId?: string }, tag: string) => {
    setBusy(tag);
    try { const w = await studio.create(body); location.hash = studioHref(w.id); }
    catch (err) { toast(errText(err, 'Could not create the workflow.'), 'error'); }
    finally { setBusy(null); }
  };
  const remove = async (w: WorkflowSummary) => {
    if (!window.confirm(`Delete “${w.name}”? Its past runs stay in the history.`)) return;
    try { await studio.remove(w.id); toast('Workflow deleted', 'success'); load(); }
    catch (err) { toast(errText(err, 'Could not delete it.'), 'error'); }
  };

  const heading = (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="font-display text-lg font-bold">Your workflows</h2>
        <p className="text-sm text-muted">Build workflows visually: branches, parallel steps, tools, approvals and delays. Saved per workspace with every version kept.</p>
      </div>
      {signedIn && <Button variant="primary" icon={<Plus size={14} aria-hidden />} disabled={!!busy} onClick={() => void create({ name: 'Untitled workflow' }, 'new')}>{busy === 'new' ? 'Creating…' : 'New workflow'}</Button>}
    </div>
  );

  if (ws.account.status === 'unavailable') {
    return <section className="mb-10">{heading}<EmptyState icon={<WorkflowIcon size={20} />} title="The workflow studio needs accounts">This server runs in guest mode (no database). Saved workflows need DATABASE_URL and BETTER_AUTH_SECRET.</EmptyState></section>;
  }
  if (!signedIn) {
    return <section className="mb-10">{heading}<EmptyState icon={<WorkflowIcon size={20} />} title="Sign in to build your own workflows" action={<LinkButton href={authHref('sign-in')} variant="primary" size="sm">Sign in</LinkButton>}>Your workflows and their versions are saved to your workspace.</EmptyState></section>;
  }
  return (
    <section className="mb-10" aria-label="Your workflows">
      {heading}
      {error ? <ErrorState title="Could not load your workflows" onRetry={load}>{error}</ErrorState>
        : !rows ? <Skeleton className="h-32" />
        : rows.length > 0 && (
          <Card padded={false} className="mb-4">
            <ul className="divide-y divide-line" data-testid="studio-list">
              {rows.map(w => (
                <li key={w.id} className="flex items-center gap-3 px-4 py-3" data-studio-workflow={w.name}>
                  <a href={studioHref(w.id)} className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold hover:underline">{w.name}</span>
                    <span className="block truncate text-xs text-muted">{w.steps} steps · version {w.version ?? '—'} · updated {timeAgo(w.updatedAt)}{w.createdBy ? ` · by ${w.createdBy}` : ''}</span>
                  </a>
                  {!w.valid && <Badge tone="warning">Draft</Badge>}
                  {w.lastRun && <Badge tone={RUN_TONE[w.lastRun.status]}>Last run {w.lastRun.status.toLowerCase()}</Badge>}
                  <Button size="sm" variant="ghost" icon={<Trash2 size={13} aria-hidden />} aria-label={`Delete ${w.name}`} onClick={() => void remove(w)} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      {templates.length > 0 && (
        <>
          <h3 className="mb-2 text-sm font-semibold">{rows?.length ? 'Start from a template' : 'Start from a template, or create an empty workflow'}</h3>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="templates">
            {templates.map(t => (
              <Card as="li" key={t.id} className="flex flex-col gap-2" data-template={t.id}>
                <p className="font-semibold">{t.name}</p>
                <p className="flex-1 text-xs text-muted">{t.description}</p>
                <p className="text-[11px] text-muted">{t.graph.nodes.length} steps{t.graph.nodes.some(n => n.kind === 'condition') ? ' · branches' : ''}{t.graph.nodes.some(n => n.kind === 'approval') ? ' · approval' : ''}</p>
                <Button size="sm" className="self-start" disabled={!!busy} onClick={() => void create({ name: t.name, templateId: t.id }, t.id)} aria-label={`Use the ${t.name} template`}>{busy === t.id ? 'Creating…' : 'Use template'}</Button>
              </Card>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default function WorkflowsPage() {
  const ws = useWorkspace();
  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Teams of agents that hand work to each other. Build your own in the visual studio, or run the built-in chat workflows."
      />
      <StudioSection />
      <h2 className="font-display text-lg font-bold">Chat workflows</h2>
      <p className="mb-3 text-sm text-muted">Every step is a separate model call made as a different agent, and sees the output of the steps before it. You can also start one by typing / in any chat.</p>
      {ws.loading && !ws.workflows.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : !ws.workflows.length ? (
        <EmptyState title="No workflows available">The server did not return any workflows.</EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="workflow-list">
          {ws.workflows.map(w => {
            const Icon = workflowIcon(w.icon);
            return (
              <Card as="li" key={w.id} data-workflow={w.id} className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-accent/10 text-accent"><Icon size={20} /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-base font-bold">{w.name}</h3>
                    <p className="text-sm text-muted">{w.description}</p>
                  </div>
                  <code className="shrink-0 rounded-md bg-hover px-1.5 py-0.5 font-mono text-xs">{w.command}</code>
                </div>
                <ol aria-label={`${w.name} steps`} className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  {w.steps.map((s, i) => (
                    <li key={s.id} className="flex items-center gap-2 sm:flex-1">
                      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line p-2.5">
                        <AgentAvatar icon={s.agentIcon} gradient={s.agentGradient} size={30} />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold">{i + 1}. {s.role}</p>
                          <p className="truncate text-[11px] text-muted" title={s.label}>{s.agentName}</p>
                        </div>
                      </div>
                      {i < w.steps.length - 1 && <ArrowRight size={14} aria-hidden className="hidden shrink-0 text-muted sm:block" />}
                    </li>
                  ))}
                </ol>
                <Button variant="primary" icon={<Play size={14} aria-hidden />} className="self-start" onClick={() => ws.startWorkflow(w)} aria-label={`Run ${w.name}`}>Run workflow</Button>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
