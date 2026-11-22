import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_RUN, MAX_TASK_CHARS, applyEvent, buildTimeline, focusStep, foldTimeline, playTimeline, runSeconds, settleRun, taskMessage, type RunView, type TimedEvent } from './demoRun';
import { EXAMPLE_TASKS, RESEARCH_SAMPLE } from './demoScript';
import type { ServerEvent } from '../types';

const plan = (...ids: string[]): ServerEvent => ({
  type: 'plan', workflowId: 'w',
  steps: ids.map(id => ({ id, agentName: `Agent ${id}`, agentIcon: '•', role: `Role ${id}`, label: `Label ${id}`, status: 'pending' as const }))
});
const fold = (events: ServerEvent[], t0 = 1000): RunView => events.reduce((v, e, i) => applyEvent(v, e, t0 + i), EMPTY_RUN);

describe('applyEvent', () => {
  it('a plan creates pending steps with empty output and discards any earlier run', () => {
    const stale: RunView = { steps: [], answer: 'old answer', error: 'old error' };
    const v = applyEvent(stale, plan('a', 'b'), 5);
    expect(v.steps.map(s => [s.id, s.status, s.output])).toEqual([['a', 'pending', ''], ['b', 'pending', '']]);
    expect(v.answer).toBe('');
    expect(v.error).toBeNull();
  });

  it('a step event sets its status and stamps when it started and ended, leaving other steps alone', () => {
    const v = fold([plan('a', 'b'), { type: 'step', id: 'a', status: 'active' }, { type: 'step', id: 'a', status: 'complete' }, { type: 'step', id: 'b', status: 'active' }], 100);
    const [a, b] = v.steps;
    expect([a.status, a.startedAt, a.endedAt]).toEqual(['complete', 101, 102]);
    expect([b.status, b.startedAt, b.endedAt]).toEqual(['active', 103, undefined]);
  });

  it('step output streams into that step, the final step streams into the answer', () => {
    const v = fold([plan('a', 'b'), { type: 'step_delta', id: 'a', content: 'one ' }, { type: 'step_delta', id: 'a', content: 'two' }, { type: 'stream', content: 'fin' }, { type: 'stream', content: 'al' }]);
    expect(v.steps.map(s => s.output)).toEqual(['one two', '']);
    expect(v.answer).toBe('final');
  });

  it('records an error message; done changes nothing; events for unknown steps are ignored', () => {
    const base = fold([plan('a')]);
    expect(applyEvent(base, { type: 'error', content: 'nope' }, 1).error).toBe('nope');
    expect(applyEvent(base, { type: 'done', message: null }, 1)).toBe(base);
    expect(applyEvent(base, { type: 'step', id: 'zzz', status: 'active' }, 1).steps).toEqual(base.steps);
    expect(applyEvent(base, { type: 'step_delta', id: 'zzz', content: 'x' }, 1).steps).toEqual(base.steps);
  });

  it('never mutates the previous view', () => {
    const before = fold([plan('a'), { type: 'step_delta', id: 'a', content: 'x' }]);
    const snapshot = JSON.stringify(before);
    applyEvent(before, { type: 'step_delta', id: 'a', content: 'y' }, 1);
    applyEvent(before, { type: 'step', id: 'a', status: 'complete' }, 1);
    applyEvent(before, { type: 'stream', content: 'z' }, 1);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('settleRun', () => {
  const running = fold([plan('a', 'b', 'c'), { type: 'step', id: 'a', status: 'complete' }, { type: 'step', id: 'b', status: 'active' }]);

  it('a run that produced an answer and reported no error is done, untouched', () => {
    const v = { ...running, answer: 'the brief' };
    expect(settleRun(v, null, 9)).toEqual({ phase: 'done', view: v });
  });

  it('a server error fails the run: only the step that was running is marked failed, finished and unstarted steps are left as they were', () => {
    const out = settleRun({ ...running, answer: 'partial' }, 'The Synthesizer step failed.', 9);
    expect(out.phase).toBe('failed');
    expect(out.view.error).toBe('The Synthesizer step failed.');
    expect(out.view.steps.map(s => s.status)).toEqual(['complete', 'error', 'pending']);
    expect(out.view.steps[1].endedAt).toBe(9);
  });

  it('no answer is a failure with an honest message, never a blank success', () => {
    const out = settleRun(running, null, 9);
    expect(out.phase).toBe('failed');
    expect(out.view.error).toMatch(/empty reply/);
    expect(settleRun({ ...running, answer: '  \n ' }, null, 9).phase).toBe('failed');
  });
});

describe('runSeconds / focusStep', () => {
  it('measures from the first start to the last end, ignoring unfinished steps; null when nothing has run', () => {
    const v = fold([plan('a', 'b'), { type: 'step', id: 'a', status: 'active' }, { type: 'step', id: 'a', status: 'complete' }, { type: 'step', id: 'b', status: 'active' }], 0);
    expect(runSeconds(v.steps)).toBeCloseTo(0.001, 5); // a: started at 1ms, ended at 2ms
    expect(runSeconds(fold([plan('a')]).steps)).toBeNull();
    expect(runSeconds([])).toBeNull();
  });

  it('focuses the running step, else the latest finished one, else nothing', () => {
    const none = fold([plan('a', 'b')]);
    expect(focusStep(none.steps)).toBeUndefined();
    const mid = fold([plan('a', 'b'), { type: 'step', id: 'a', status: 'complete' }]);
    expect(focusStep(mid.steps)?.id).toBe('a');
    const live = fold([plan('a', 'b'), { type: 'step', id: 'a', status: 'complete' }, { type: 'step', id: 'b', status: 'active' }]);
    expect(focusStep(live.steps)?.id).toBe('b');
  });
});

describe('the recorded sample', () => {
  const timeline = buildTimeline(RESEARCH_SAMPLE);
  const kinds = timeline.map(t => t.event.type);

  it('is a research run with three distinct, non-empty steps and a Markdown answer', () => {
    expect(RESEARCH_SAMPLE.workflowId).toBe('research');
    expect(new Set(RESEARCH_SAMPLE.steps.map(s => s.id)).size).toBe(3);
    expect(RESEARCH_SAMPLE.steps.every(s => s.text.trim() && s.role && s.agentName && s.agentIcon && s.label)).toBe(true);
    expect(RESEARCH_SAMPLE.steps[2].text).toMatch(/^## /);
  });

  it('plays as: the plan, then each step opened, streamed and closed in order, then done', () => {
    expect(kinds[0]).toBe('plan');
    expect(kinds[kinds.length - 1]).toBe('done');
    const order = timeline.filter(t => t.event.type === 'step').map(t => t.event.type === 'step' ? `${t.event.id}:${t.event.status}` : '');
    expect(order).toEqual(['gather:active', 'gather:complete', 'synthesize:active', 'synthesize:complete', 'review:active', 'review:complete']);
  });

  it('time never goes backwards', () => {
    for (let i = 1; i < timeline.length; i++) expect(timeline[i].at).toBeGreaterThanOrEqual(timeline[i - 1].at);
  });

  it('only the last step streams as the answer; earlier steps stream as step output', () => {
    expect(timeline.filter(t => t.event.type === 'stream').length).toBeGreaterThan(5);
    expect(timeline.filter(t => t.event.type === 'step_delta').every(t => t.event.type === 'step_delta' && t.event.id !== 'review')).toBe(true);
  });

  it('replays every step\'s text exactly, nothing lost or added by chunking', () => {
    const v = foldTimeline(timeline);
    expect(v.steps.slice(0, 2).map(s => s.output)).toEqual(RESEARCH_SAMPLE.steps.slice(0, 2).map(s => s.text));
    expect(v.answer).toBe(RESEARCH_SAMPLE.steps[2].text);
  });

  it('folds to a finished run: every step complete, no error, a measurable duration', () => {
    const v = foldTimeline(timeline);
    expect(v.steps.map(s => s.status)).toEqual(['complete', 'complete', 'complete']);
    expect(v.error).toBeNull();
    expect(settleRun(v, null, 0).phase).toBe('done');
    const secs = runSeconds(v.steps) ?? 0;
    expect(secs).toBeGreaterThan(3); // long enough to read as work…
    expect(secs).toBeLessThan(10); // …short enough that a visitor doesn't wait for it
  });

  it('honours the pacing options', () => {
    const slow = buildTimeline(RESEARCH_SAMPLE, { charMs: 10, gapMs: 600 });
    expect(slow[slow.length - 1].at).toBeGreaterThan(timeline[timeline.length - 1].at * 1.5);
  });

  it('starts the visitor\'s field with the sample\'s own task, and has an example for each built-in workflow', () => {
    expect(EXAMPLE_TASKS.research).toBe(RESEARCH_SAMPLE.task);
    for (const id of ['research', 'code-review', 'legal-draft', 'brainstorm']) expect(EXAMPLE_TASKS[id]?.trim().length).toBeGreaterThan(5);
    expect(Math.max(...Object.values(EXAMPLE_TASKS).map(t => t.length))).toBeLessThanOrEqual(MAX_TASK_CHARS);
  });
});

describe('playTimeline', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const e = (n: number): ServerEvent => ({ type: 'stream', content: String(n) });
  const tl: TimedEvent[] = [{ at: 0, event: e(0) }, { at: 100, event: e(1) }, { at: 100, event: e(2) }, { at: 300, event: e(3) }];
  const collect = () => { const got: string[] = []; return { got, on: (x: ServerEvent) => { if (x.type === 'stream') got.push(x.content); } }; };

  it('delivers each event at its scheduled time, in order, then resolves', async () => {
    const { got, on } = collect();
    let done = false;
    const p = playTimeline(tl, on, new AbortController().signal).then(() => { done = true; });
    expect(got).toEqual(['0']);
    await vi.advanceTimersByTimeAsync(99);
    expect(got).toEqual(['0']);
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toEqual(['0', '1', '2']); // two events due together arrive together
    await vi.advanceTimersByTimeAsync(199);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(got).toEqual(['0', '1', '2', '3']);
    expect(done).toBe(true);
  });

  it('a late timer (throttled background tab) catches up on everything that is due in one go', async () => {
    const { got, on } = collect();
    const p = playTimeline(tl, on, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(got).toEqual(['0', '1', '2', '3']);
  });

  it('stops delivering and resolves as soon as it is aborted, leaving no timer behind', async () => {
    const { got, on } = collect();
    const ctrl = new AbortController();
    const p = playTimeline(tl, on, ctrl.signal);
    await vi.advanceTimersByTimeAsync(100);
    ctrl.abort();
    await p;
    await vi.advanceTimersByTimeAsync(1000);
    expect(got).toEqual(['0', '1', '2']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an already-aborted signal delivers nothing and resolves', async () => {
    const { got, on } = collect();
    const ctrl = new AbortController();
    ctrl.abort();
    await playTimeline(tl, on, ctrl.signal);
    expect(got).toEqual([]);
  });
});

describe('taskMessage', () => {
  it('is the workflow\'s starter followed by the trimmed task, capped at the console limit', () => {
    expect(taskMessage({ promptStarter: 'Research this topic in depth: ' }, '  solar roofs \n')).toBe('Research this topic in depth: solar roofs');
    const long = taskMessage({ promptStarter: '> ' }, 'x'.repeat(MAX_TASK_CHARS + 50));
    expect(long).toBe('> ' + 'x'.repeat(MAX_TASK_CHARS));
  });
});
