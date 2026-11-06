import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, ChevronDown, Clock, Loader2, Workflow } from 'lucide-react';
import type { StepStatus, TraceStep } from '../types';

const BADGE: Record<StepStatus, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-hover text-muted' },
  active: { label: 'Active', cls: 'bg-accent/15 text-accent' },
  complete: { label: 'Complete', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  error: { label: 'Failed', cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' }
};

export function StatusBadge({ status }: { status: StepStatus }) {
  const { label, cls } = BADGE[status];
  const Icon = status === 'complete' ? Check : status === 'error' ? AlertTriangle : status === 'active' ? Loader2 : Clock;
  return (
    <span data-status={status} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      <Icon size={11} className={status === 'active' ? 'animate-spin' : ''} aria-hidden />
      {label}
    </span>
  );
}

const seconds = (s: TraceStep) => (s.startedAt && s.endedAt ? `${Math.max(0.1, (s.endedAt - s.startedAt) / 1000).toFixed(1)}s` : null);

function StepOutput({ text, live }: { text: string; live: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (live && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text, live]);
  return (
    <pre ref={ref} className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-[var(--code-bg)] p-2.5 font-sans text-xs leading-relaxed text-muted">
      {text}
      {live && <span className="animate-caret-blink">▍</span>}
    </pre>
  );
}

interface Props {
  steps: TraceStep[];
  running: boolean;
}

/**
 * Collapsible view of what the agents actually did for a reply: each step, who ran it, its status and its
 * output. Open while the reply is running, collapsed afterwards unless the user toggled it.
 */
export function ThoughtStream({ steps, running }: Props) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const [stepOpen, setStepOpen] = useState<Record<string, boolean>>({});
  const open = toggled ?? running;

  const done = steps.filter(s => s.status === 'complete').length;
  const failed = steps.some(s => s.status === 'error');
  const overall: StepStatus = failed ? 'error' : running ? 'active' : done === steps.length ? 'complete' : 'pending';
  const panelId = `thought-${steps.map(s => s.id).join('-')}`;

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-line bg-hover/40" data-testid="thought-stream">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setToggled(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-hover"
      >
        <Workflow size={14} className="text-accent" aria-hidden />
        <span className="font-semibold">Thought stream</span>
        <span className="text-muted">{done}/{steps.length} step{steps.length === 1 ? '' : 's'}</span>
        <span className="ml-auto"><StatusBadge status={overall} /></span>
        <ChevronDown size={14} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <ol className="space-y-0 px-3 pb-3 pt-1">
              {steps.map((s, i) => {
                const hasOutput = s.output.trim().length > 0;
                const isOpen = stepOpen[s.id] ?? s.status === 'active';
                return (
                  <li key={s.id} data-testid="thought-step" data-step={s.id} data-status={s.status} className="relative pl-7">
                    {i < steps.length - 1 && <span aria-hidden className="absolute left-[9px] top-6 h-[calc(100%-8px)] w-px bg-line" />}
                    <span aria-hidden className={`absolute left-0 top-1.5 flex h-[19px] w-[19px] items-center justify-center rounded-full border text-[11px] ${s.status === 'active' ? 'border-accent bg-accent/10' : 'border-line bg-[var(--glass-strong)]'}`}>
                      {s.agentIcon}
                    </span>
                    <div className="py-1.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs font-semibold">{s.role}</span>
                        <span className="text-[11px] text-muted">{s.agentName}</span>
                        <StatusBadge status={s.status} />
                        {seconds(s) && <span className="text-[11px] text-muted">{seconds(s)}</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">{s.label}</p>
                      {s.error && <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-400">{s.error}</p>}
                      {hasOutput && (
                        <>
                          <button
                            type="button"
                            onClick={() => setStepOpen(o => ({ ...o, [s.id]: !isOpen }))}
                            aria-expanded={isOpen}
                            className="mt-1 text-[11px] font-medium text-accent hover:underline"
                          >
                            {isOpen ? 'Hide output' : `Show output (${s.output.length.toLocaleString()} chars)`}
                          </button>
                          {isOpen && <StepOutput text={s.output} live={s.status === 'active'} />}
                        </>
                      )}
                      {!hasOutput && s.status === 'complete' && i === steps.length - 1 && steps.length > 1 && (
                        <p className="mt-1 text-[11px] text-muted">Final answer is the reply below.</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
