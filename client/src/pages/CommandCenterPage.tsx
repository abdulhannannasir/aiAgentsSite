import { useEffect, useMemo, useState } from 'react';
import { Activity, Bot, CheckCircle2, MessagesSquare, Sparkles, Wand2, Workflow as WorkflowIcon, XCircle } from 'lucide-react';
import { AgentAvatar, CUSTOM_GRADIENT } from '../components/AgentAvatar';
import { LinkButton } from '../components/ui/Button';
import { Badge, Card, CardTitle, EmptyState, PageHeader, Stat, StatusDot } from '../components/ui/Display';
import { pageHref } from '../lib/route';
import { formatDuration, recentActivity, sessionStats, timeAgo } from '../lib/sessionStats';
import { SERVICE_LABEL, type ServiceKey } from '../app/nav';
import { useWorkspace } from '../app/workspace';

const SERVICES: Array<{ key: ServiceKey; enables: string }> = [
  { key: 'database', enables: 'accounts, saved conversations, projects' },
  { key: 'auth', enables: 'sign-in and workspaces' },
  { key: 'email', enables: 'verification and password-reset email' },
  { key: 'redis', enables: 'durable background runs' },
  { key: 'storage', enables: 'file uploads' }
];

/** Re-render every few seconds while something is running, so elapsed times stay current. */
function useTicker(active: boolean, ms = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setTick(n => n + 1), ms);
    return () => window.clearInterval(t);
  }, [active, ms]);
}

export default function CommandCenterPage() {
  const ws = useWorkspace();
  const { threads, streamingKeys } = ws.chat;
  const stats = useMemo(() => sessionStats(threads), [threads]);
  const activity = useMemo(() => recentActivity(threads), [threads]);
  useTicker(streamingKeys.length > 0 || activity.length > 0, streamingKeys.length ? 1000 : 15000);

  const nameOf = (key: string) => {
    if (key.startsWith('custom:')) {
      const c = ws.customAgents.find(a => `custom:${a.id}` === key);
      return { name: c?.name ?? 'Deleted custom agent', icon: c?.icon ?? '🤖', gradient: CUSTOM_GRADIENT };
    }
    const a = ws.agents.find(x => x.id === key);
    return { name: a?.name ?? key, icon: a?.icon ?? '🤖', gradient: a?.gradient ?? CUSTOM_GRADIENT };
  };
  const workflowName = (id?: string) => ws.workflows.find(w => w.id === id)?.name ?? id;

  const running = streamingKeys.map(key => {
    const last = threads[key]?.at(-1);
    const startedAt = last?.trace?.find(s => s.startedAt)?.startedAt ?? last?.createdAt ?? Date.now();
    const activeStep = last?.trace?.find(s => s.status === 'active');
    return { key, ...nameOf(key), startedAt, step: activeStep ? `${activeStep.role}: ${activeStep.label}` : 'Generating the reply', workflow: workflowName(last?.workflowId) };
  });

  const providerLine = ws.meta
    ? ws.mode === 'live'
      ? `${ws.meta.provider === 'gemini' ? 'Google Gemini' : 'OpenAI'} · ${ws.meta.providers[ws.meta.provider as 'openai' | 'gemini']?.model ?? ''}`
      : 'No model key on the server — canned replies'
    : 'Checking…';

  return (
    <div>
      <PageHeader
        title="Command Center"
        description="Your AI workforce at a glance. Figures below come from this browser session; saved history and team-wide metrics arrive once accounts and execution records are enabled."
        actions={<>
          <LinkButton href={pageHref('chat')} variant="primary" icon={<MessagesSquare size={15} aria-hidden />}>Start a chat</LinkButton>
          <LinkButton href={pageHref('workflows')} icon={<WorkflowIcon size={15} aria-hidden />}>Run a workflow</LinkButton>
          <LinkButton href={pageHref('builder')} icon={<Wand2 size={15} aria-hidden />}>Build an agent</LinkButton>
        </>}
      />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Agents" value={ws.agents.length + ws.customAgents.length} icon={<Bot size={16} />} hint={`${ws.agents.length} built-in · ${ws.customAgents.length} yours`} />
        <Stat label="Running now" value={streamingKeys.length} icon={<Activity size={16} />} hint={streamingKeys.length ? 'Streaming replies' : 'All agents idle'} />
        <Stat label="Workflows" value={ws.workflows.length} icon={<WorkflowIcon size={16} />} hint={`${stats.workflowRuns} run${stats.workflowRuns === 1 ? '' : 's'} this session`} />
        <Stat label="AI mode" value={ws.mode === 'live' ? 'Live' : ws.mode === 'demo' ? 'Demo' : '—'} icon={<Sparkles size={16} />} hint={providerLine} />
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card as="section" className="lg:col-span-2" aria-labelledby="cc-live">
          <CardTitle id="cc-live">Live agents</CardTitle>
          {running.length === 0 ? (
            <EmptyState icon={<Activity size={20} />} title="No agent is working right now">
              Send a message or run a workflow and it shows up here while it streams.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="cc-running">
              {running.map(r => (
                <li key={r.key} className="flex items-center gap-3 rounded-xl border border-line-strong bg-accent/5 p-3">
                  <AgentAvatar icon={r.icon} gradient={r.gradient} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-sm font-semibold">{r.name}{r.workflow ? <span className="text-muted"> · {r.workflow}</span> : null}</p>
                    <p className="truncate text-xs text-muted">{r.step}</p>
                  </div>
                  <StatusDot tone="accent" label={formatDuration(Date.now() - r.startedAt)} pulse />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card as="section" aria-labelledby="cc-session">
          <CardTitle id="cc-session">This session</CardTitle>
          <dl className="grid grid-cols-2 gap-3 text-sm" data-testid="cc-session">
            {[
              ['Messages sent', stats.messagesSent],
              ['Replies', stats.replies],
              ['Completed', stats.completed],
              ['Failed', stats.failed],
              ['Agents used', stats.agentsUsed],
              ['Avg. reply', stats.avgReplyMs === null ? '—' : formatDuration(stats.avgReplyMs)]
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-line px-3 py-2">
                <dt className="text-[11px] text-muted">{label}</dt>
                <dd className="font-display text-lg font-bold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">Counted in this tab only. Refreshing the page starts a new session.</p>
        </Card>

        <Card as="section" className="lg:col-span-2" aria-labelledby="cc-activity">
          <CardTitle id="cc-activity">Recent activity</CardTitle>
          {activity.length === 0 ? (
            <EmptyState icon={<MessagesSquare size={20} />} title="Nothing yet" action={<LinkButton href={pageHref('discover')} size="sm">Find an agent</LinkButton>}>
              Your replies and workflow runs from this session will be listed here.
            </EmptyState>
          ) : (
            <ol className="flex flex-col divide-y divide-line" data-testid="cc-activity">
              {activity.map(e => {
                const who = nameOf(e.threadKey);
                return (
                  <li key={e.id} className="flex items-center gap-3 py-2.5">
                    <AgentAvatar icon={who.icon} gradient={who.gradient} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm"><span className="font-semibold">{who.name}</span>{e.kind === 'workflow' && <span className="text-muted"> · {workflowName(e.workflowId)}</span>}</p>
                      <p className="truncate text-xs text-muted">{e.preview || '—'}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {e.status === 'done' ? <Badge tone="success"><CheckCircle2 size={10} aria-hidden /> Done</Badge>
                        : e.status === 'error' ? <Badge tone="danger"><XCircle size={10} aria-hidden /> Failed</Badge>
                        : <Badge tone="accent">Running</Badge>}
                      <span className="text-[11px] text-muted">{timeAgo(e.at)}{e.durationMs !== null && e.status !== 'streaming' ? ` · ${formatDuration(e.durationMs)}` : ''}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <Card as="section" aria-labelledby="cc-services">
          <CardTitle id="cc-services">Platform services</CardTitle>
          {ws.meta ? (
            <ul className="flex flex-col gap-2.5" data-testid="cc-services">
              {SERVICES.map(s => {
                const on = ws.meta!.features[s.key];
                return (
                  <li key={s.key} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{SERVICE_LABEL[s.key].replace(/ \(.*\)$/, '')}</p>
                      <p className="text-xs text-muted">Enables {s.enables}</p>
                    </div>
                    <Badge tone={on ? 'success' : 'neutral'}>{on ? 'Configured' : 'Not configured'}</Badge>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-muted">Service status is unavailable from this server.</p>}
        </Card>
      </div>
    </div>
  );
}
