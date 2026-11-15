import type { ServerEvent, TraceStep, Workflow } from '../types';

/*
 * Logic behind the hero's live demonstration. Kept free of React so it can be unit-tested.
 *
 * A run is described by the same events the server streams from POST /api/chat. A *live* run feeds the real
 * stream into `applyEvent`; the recorded *sample* replays a scripted list of the same events, so both are
 * drawn by exactly the same UI and can't drift apart.
 */

/** Everything the console shows about one run. */
export interface RunView {
  steps: TraceStep[];
  /** Streamed text of the final step: the answer. */
  answer: string;
  error: string | null;
}

export const EMPTY_RUN: RunView = { steps: [], answer: '', error: null };

/** Folds one server event into the run view. `now` is injected so the result is deterministic in tests. */
export function applyEvent(view: RunView, e: ServerEvent, now: number): RunView {
  switch (e.type) {
    case 'plan':
      return { steps: e.steps.map(s => ({ ...s, output: '' })), answer: '', error: null };
    case 'step':
      return {
        ...view,
        steps: view.steps.map(s => (s.id !== e.id ? s : {
          ...s,
          status: e.status,
          error: e.error,
          startedAt: e.status === 'active' ? now : s.startedAt,
          endedAt: e.status === 'complete' || e.status === 'error' ? now : s.endedAt
        }))
      };
    case 'step_delta':
      return { ...view, steps: view.steps.map(s => (s.id === e.id ? { ...s, output: s.output + e.content } : s)) };
    case 'stream':
      return { ...view, answer: view.answer + e.content };
    case 'error':
      return { ...view, error: e.content };
    case 'done':
      return view;
  }
}

export type RunOutcome = { phase: 'done' | 'failed'; view: RunView };

/**
 * Closes a run once its stream has ended. A run that reported an error, or produced no answer, failed. Only the
 * step that was running is marked failed; steps that never started stay pending, because they never ran. This is
 * how the workspace's chat shows a workflow the server stopped.
 */
export function settleRun(view: RunView, serverError: string | null, now: number): RunOutcome {
  if (serverError === null && view.answer.trim()) return { phase: 'done', view };
  return {
    phase: 'failed',
    view: {
      ...view,
      error: serverError ?? 'The agents returned an empty reply. Please try again.',
      steps: view.steps.map(s => (s.status === 'active' ? { ...s, status: 'error', endedAt: now } : s))
    }
  };
}

/** Wall-clock span of a finished run in seconds, or null if no step has both a start and an end. */
export function runSeconds(steps: TraceStep[]): number | null {
  const starts = steps.map(s => s.startedAt).filter((t): t is number => typeof t === 'number');
  const ends = steps.map(s => s.endedAt).filter((t): t is number => typeof t === 'number');
  if (!starts.length || !ends.length) return null;
  return Math.max(0, Math.max(...ends) - Math.min(...starts)) / 1000;
}

/** The step to show output for: the one running now, else the most recently finished one. */
export function focusStep(steps: TraceStep[]): TraceStep | undefined {
  return steps.find(s => s.status === 'active') ?? [...steps].reverse().find(s => s.status === 'complete' || s.status === 'error');
}

/* ---- recorded sample ----------------------------------------------------------------------------------------- */

export interface SampleStep {
  id: string;
  agentName: string;
  agentIcon: string;
  role: string;
  label: string;
  /** What this step "says". The last step's text becomes the answer. */
  text: string;
}

export interface Sample {
  workflowId: string;
  /** The task the sample was recorded for (what the input shows until the visitor changes it). */
  task: string;
  steps: SampleStep[];
}

export interface TimedEvent {
  /** Milliseconds after the start of playback. */
  at: number;
  event: ServerEvent;
}

export interface TimelineOptions {
  /** Delay per streamed character. */
  charMs?: number;
  /** Pause before a step starts. */
  gapMs?: number;
}

/** Turns a sample into the timed sequence of events the server would have streamed for it. */
export function buildTimeline(sample: Sample, { charMs = 4, gapMs = 300 }: TimelineOptions = {}): TimedEvent[] {
  const out: TimedEvent[] = [];
  let t = 0;
  out.push({ at: t, event: { type: 'plan', workflowId: sample.workflowId, steps: sample.steps.map(({ text: _text, ...s }) => ({ ...s, status: 'pending' as const })) } });
  sample.steps.forEach((s, i) => {
    const isFinal = i === sample.steps.length - 1;
    t += gapMs;
    out.push({ at: t, event: { type: 'step', id: s.id, status: 'active' } });
    for (const chunk of s.text.match(/\S+\s*/g) ?? []) {
      t += chunk.length * charMs;
      out.push({ at: t, event: isFinal ? { type: 'stream', content: chunk } : { type: 'step_delta', id: s.id, content: chunk } });
    }
    t += 120;
    out.push({ at: t, event: { type: 'step', id: s.id, status: 'complete' } });
  });
  out.push({ at: t, event: { type: 'done', message: null } });
  return out;
}

/** The finished state of a timeline, computed at once (reduced motion: no replay, just the result). */
export function foldTimeline(timeline: TimedEvent[]): RunView {
  return timeline.reduce((view, { at, event }) => applyEvent(view, event, at), EMPTY_RUN);
}

/**
 * Replays a timeline in real time. Events that are due together are delivered together, so a throttled
 * background tab catches up in one go instead of drifting. Resolves when finished, or as soon as `signal` aborts.
 */
export function playTimeline(timeline: TimedEvent[], onEvent: (e: ServerEvent) => void, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const start = Date.now();
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const tick = () => {
      if (signal.aborted) return finish();
      const elapsed = Date.now() - start;
      while (i < timeline.length && timeline[i].at <= elapsed) onEvent(timeline[i++].event);
      if (i >= timeline.length) return finish();
      timer = setTimeout(tick, Math.max(0, timeline[i].at - elapsed));
    };
    signal.addEventListener('abort', finish, { once: true });
    tick();
  });
}

/* ---- the visitor's own task ---------------------------------------------------------------------------------- */

/** Longest task the console accepts. The server allows far more; a hero demo should stay short and cheap. */
export const MAX_TASK_CHARS = 280;

/** The message the server receives: the workflow's starter ("Research this topic in depth: ") plus the visitor's task. */
export function taskMessage(workflow: Pick<Workflow, 'promptStarter'>, task: string): string {
  return `${workflow.promptStarter}${task.trim().slice(0, MAX_TASK_CHARS)}`;
}
