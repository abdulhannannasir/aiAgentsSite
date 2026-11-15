import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { ArrowRight, Play, RotateCcw, Square } from 'lucide-react';
import { CollabGraph, type GraphStep } from '../fx/CollabGraph';
import { Markdown } from '../Markdown';
import { useDemoRun } from '../../hooks/useDemoRun';
import { MAX_TASK_CHARS, buildTimeline, focusStep, runSeconds, taskMessage } from '../../lib/demoRun';
import { EXAMPLE_TASKS, RESEARCH_SAMPLE } from '../../lib/demoScript';
import { prefersReducedMotion } from '../../lib/platform';
import type { StepStatus, Workflow } from '../../types';

const SAMPLE_TIMELINE = buildTimeline(RESEARCH_SAMPLE);
const pendingGraph = (steps: Array<{ id: string; agentIcon: string; role: string; agentName: string }>): GraphStep[] =>
  steps.map(s => ({ id: s.id, icon: s.agentIcon, role: s.role, name: s.agentName, status: 'pending' as StepStatus }));
const SAMPLE_GRAPH = pendingGraph(RESEARCH_SAMPLE.steps);

interface Props {
  workflows: Workflow[];
  onLaunch: () => void;
  className?: string;
}

/**
 * The hero's live demonstration: a console that runs a real multi-agent workflow and shows the handoffs and the
 * streamed output as they happen.
 *
 *  - It never calls the API on its own. The first time it scrolls into view it replays a recorded sample (labelled
 *    "Sample run"), so every visitor sees something move without spending the server's quota.
 *  - Typing a task and pressing Run sends it through POST /api/chat, the same stream the workspace uses (labelled "Live").
 *    A server without an API key answers with its own canned, self-describing "demo preview" text; nothing extra is needed here.
 *  - Reduced motion: no replay; the finished sample is shown at once.
 */
export function HeroDemo({ workflows, onLaunch, className }: Props) {
  const { run, playSample, showSample, runLive, reset } = useDemoRun();
  const [wfId, setWfId] = useState(RESEARCH_SAMPLE.workflowId);
  const [task, setTask] = useState(RESEARCH_SAMPLE.task);
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // Set as soon as the visitor touches the console, so the first-view replay never starts under their hands.
  const autoplayUsed = useRef(false);

  const workflow = workflows.find(w => w.id === wfId) ?? workflows[0];
  const canSample = wfId === RESEARCH_SAMPLE.workflowId;
  const running = run.phase === 'running';

  // First-view replay.
  useEffect(() => {
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      autoplayUsed.current = true;
      showSample(SAMPLE_TIMELINE);
      return;
    }
    const el = root.current;
    if (!el) return;
    let timer: number | undefined;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || autoplayUsed.current) return;
      io.disconnect();
      timer = window.setTimeout(() => {
        if (autoplayUsed.current) return;
        autoplayUsed.current = true;
        void playSample(SAMPLE_TIMELINE);
      }, 900);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); window.clearTimeout(timer); };
  }, [playSample, showSample]);

  const { view } = run;
  const focus = focusStep(view.steps);
  const last = view.steps[view.steps.length - 1];
  const hasAnswer = view.answer.length > 0;
  const idleSteps = useMemo(() => (workflow ? pendingGraph(workflow.steps) : SAMPLE_GRAPH), [workflow]);
  const graph: GraphStep[] = view.steps.length
    ? view.steps.map(s => ({ id: s.id, icon: s.agentIcon, role: s.role, name: s.agentName, status: s.status }))
    : idleSteps;

  // Keep the newest words in view while text streams in, then return to the top so the finished brief reads from its headline.
  useEffect(() => {
    if (running && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [running, view.answer, focus?.output]);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && run.phase === 'done') body.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    wasRunning.current = running;
  }, [running, run.phase]);

  const active = view.steps.find(s => s.status === 'active');
  const secs = runSeconds(view.steps);
  const took = secs === null ? '' : ` in ${secs.toFixed(1)}s`;
  const status =
    run.phase === 'idle' ? 'Ready. Press Run to send your task through the agents.'
    : running ? (active ? `${active.role} is working.` : 'Starting.')
    : run.phase === 'failed' ? 'The run failed.'
    : run.source === 'sample' ? `Sample finished${took}. Now try your own task above.`
    : `Finished: ${view.steps.length} agents${took}.`;

  const badge =
    run.phase === 'idle' ? { text: 'Ready', cls: 'border-line text-muted bg-hover', pulse: false }
    : run.phase === 'failed' ? { text: 'Failed', cls: 'border-rose-400/50 text-rose-300 bg-rose-500/10', pulse: false }
    : run.source === 'sample' ? { text: 'Sample run', cls: 'border-neon-violet/40 text-neon-violet bg-neon-violet/12', pulse: running }
    : { text: 'Live', cls: 'border-neon-cyan/40 text-neon-cyan bg-neon-cyan/12', pulse: running };

  const claim = () => { autoplayUsed.current = true; };

  const choose = (w: Workflow) => {
    claim();
    reset();
    setWfId(w.id);
    setTask(EXAMPLE_TASKS[w.id] ?? '');
  };

  const start = () => {
    claim();
    if (running || !workflow || !task.trim()) return;
    void runLive({ message: taskMessage(workflow, task), history: [], workflowId: workflow.id });
  };
  const submit = (e: FormEvent) => { e.preventDefault(); start(); };

  // Clicking into the field mid-replay skips to the end rather than leaving a half-played sample on screen.
  const onTaskFocus = () => {
    claim();
    if (run.source === 'sample' && running) showSample(SAMPLE_TIMELINE);
  };

  const chain = (workflow?.steps ?? RESEARCH_SAMPLE.steps).map(s => s.role).join(' → ');

  return (
    <section ref={root} aria-labelledby="hero-demo-title" data-testid="hero-demo" data-phase={run.phase} data-source={run.source ?? 'none'}
      className={clsx('relative overflow-hidden rounded-2xl border border-line-strong bg-glass-strong shadow-float', className)}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-neon-cyan to-transparent" />
      <h2 id="hero-demo-title" className="sr-only">Live demonstration: a team of AI agents working on a task</h2>

      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span aria-hidden className="flex gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-rose-400/80" /><i className="h-2.5 w-2.5 rounded-full bg-amber-400/80" /><i className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" /></span>
        <span className="ml-1 min-w-0 truncate font-mono text-[11px] text-muted">{workflow ? `${workflow.command} · ${workflow.name}` : '/research · Deep Research Brief'}</span>
        <span data-testid="hero-demo-badge" className={clsx('ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider', badge.cls)}>
          <span aria-hidden className={clsx('h-1.5 w-1.5 rounded-full bg-current', badge.pulse && 'animate-pulse')} />
          {badge.text}
        </span>
      </div>

      <div role="group" aria-label="Choose a workflow" className="no-scrollbar flex min-h-[38px] gap-1.5 overflow-x-auto px-4 py-1.5">
        {workflows.map(w => (
          <button key={w.id} type="button" aria-pressed={w.id === wfId} onClick={() => choose(w)}
            className={clsx('shrink-0 rounded-full border px-2.5 py-1 font-mono text-[11px] transition', w.id === wfId ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan' : 'border-line text-muted hover:text-fg')}>
            {w.command}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="px-4 pt-1.5">
        <label htmlFor="hero-demo-task" className="sr-only">Task for the agents</label>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-hover/40 py-1.5 pl-3 pr-1.5 transition focus-within:ring-2 focus-within:ring-accent/60">
          <span aria-hidden className="shrink-0 font-mono text-xs text-neon-cyan">&gt;</span>
          <input id="hero-demo-task" data-testid="hero-demo-task" type="text" value={task} maxLength={MAX_TASK_CHARS} disabled={!workflow || (running && run.source === 'live')} autoComplete="off" spellCheck={false}
            placeholder={workflow ? 'Describe your task' : 'Connecting to the server…'}
            onFocus={onTaskFocus} onChange={e => setTask(e.target.value)}
            className="min-w-0 flex-1 truncate bg-transparent py-1 font-mono text-[12.5px] outline-none placeholder:text-muted focus-visible:outline-none disabled:opacity-70" />
          {running ? (
            // Distinct keys matter: with the same DOM node, React would turn this type="button" into the Run button's
            // type="submit" mid-click, and the browser would then submit the form, restarting the run Stop just cancelled.
            <button key="stop" type="button" onClick={e => { e.preventDefault(); claim(); reset(); }} data-testid="hero-demo-stop"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line-strong bg-glass px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide transition hover:bg-hover">
              <Square size={11} aria-hidden fill="currentColor" /> Stop
            </button>
          ) : (
            <button key="run" type="submit" disabled={!workflow || !task.trim()} data-testid="hero-demo-run" title={workflow ? undefined : 'Waiting for the server'}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
              <Play size={11} aria-hidden fill="currentColor" /> Run
            </button>
          )}
        </div>
      </form>

      <div className="px-4 pt-3"><CollabGraph compact steps={graph} /></div>

      <div className="mx-4 mt-1 overflow-hidden rounded-xl border border-line bg-[var(--code-bg)]">
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-muted">
          {run.phase === 'idle' || !focus ? (
            <span className="truncate normal-case tracking-normal">{chain}</span>
          ) : hasAnswer && last ? (
            <span className="truncate"><span aria-hidden>{last.agentIcon}</span> {last.role} · final answer</span>
          ) : (
            <span className="truncate"><span aria-hidden>{focus.agentIcon}</span> {focus.role} · {focus.agentName}</span>
          )}
          {running && <span aria-hidden className="ml-auto animate-caret-blink text-neon-cyan">▍</span>}
        </div>
        <div ref={body} tabIndex={0} role="region" aria-label="Agent output" data-testid="hero-demo-output" className="h-[136px] overflow-y-auto px-3 py-2.5 [@media(max-height:800px)]:h-[116px]">
          {run.phase === 'failed' ? (
            <p role="alert" className="text-xs leading-relaxed text-rose-300">{view.error}</p>
          ) : hasAnswer ? (
            <Markdown text={view.answer} streaming={running} className="text-[12.5px] leading-relaxed [&_h2]:mb-1.5 [&_h2]:mt-0 [&_h2]:text-sm [&_p]:my-1.5 [&_ul]:my-1.5" />
          ) : focus?.output ? (
            <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-muted">{focus.output}</pre>
          ) : (
            <p className="text-xs leading-relaxed text-muted">
              {running ? 'Waiting for the first words…' : 'Each step is a separate model call, and each reads what the steps before it wrote. Run it to watch the handoffs.'}
            </p>
          )}
        </div>
      </div>

      <div className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
        <p role="status" data-testid="hero-demo-status" className="min-w-0 flex-1 text-[11.5px] leading-snug text-muted">{status}</p>
        {run.phase === 'idle' && canSample && (
          <button type="button" onClick={() => { claim(); void playSample(SAMPLE_TIMELINE); }} className="flex items-center gap-1 font-mono text-[11px] text-neon-cyan hover:underline">
            <Play size={10} aria-hidden fill="currentColor" /> Watch a sample
          </button>
        )}
        {run.phase === 'done' && run.source === 'sample' && canSample && (
          <button type="button" onClick={() => { claim(); void playSample(SAMPLE_TIMELINE); }} className="flex items-center gap-1 font-mono text-[11px] text-neon-cyan hover:underline">
            <RotateCcw size={10} aria-hidden /> Replay
          </button>
        )}
        {run.phase === 'failed' && (
          <button type="button" onClick={start} className="flex items-center gap-1 font-mono text-[11px] text-neon-cyan hover:underline">
            <RotateCcw size={10} aria-hidden /> Try again
          </button>
        )}
        {run.phase === 'done' && (
          <button type="button" onClick={onLaunch} className="flex items-center gap-1 font-mono text-[11px] text-neon-cyan hover:underline">
            Continue in the workspace <ArrowRight size={11} aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}
