import { ArrowRight, Play } from 'lucide-react';
import { AgentAvatar, workflowIcon } from '../components/AgentAvatar';
import { Button } from '../components/ui/Button';
import { Card, EmptyState, PageHeader, Skeleton } from '../components/ui/Display';
import { useWorkspace } from '../app/workspace';

export default function WorkflowsPage() {
  const ws = useWorkspace();
  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Teams of agents that hand work to each other. Every step is a separate model call made as a different agent, and sees the output of the steps before it. You can also start one by typing / in any chat."
      />
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
                    <h2 className="font-display text-base font-bold">{w.name}</h2>
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
      <p className="mt-6 text-xs text-muted">A visual editor for building your own workflows (branches, parallel steps, approvals) is planned for Phase 6 of the roadmap.</p>
    </div>
  );
}
