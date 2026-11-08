import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, streamChat, type ChatRequest } from '../lib/api';
import { EMPTY_RUN, applyEvent, foldTimeline, playTimeline, settleRun, type RunView, type TimedEvent } from '../lib/demoRun';
import type { ServerEvent } from '../types';

export type RunPhase = 'idle' | 'running' | 'done' | 'failed';
/** 'sample' is the recorded replay, 'live' is a real request to the server. */
export type RunSource = 'sample' | 'live';

export interface DemoRun {
  source: RunSource | null;
  phase: RunPhase;
  view: RunView;
}

const IDLE: DemoRun = { source: null, phase: 'idle', view: EMPTY_RUN };

const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection and try again.';

/**
 * State for the hero console. At most one run exists at a time: starting anything cancels what was running, and
 * unmounting cancels too, so a replay or a request can never write into a console that has gone away.
 */
export function useDemoRun() {
  const [run, setRun] = useState<DemoRun>(IDLE);
  const ctrl = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    ctrl.current?.abort();
    ctrl.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const begin = useCallback((source: RunSource) => {
    cancel();
    const c = new AbortController();
    ctrl.current = c;
    setRun({ source, phase: 'running', view: EMPTY_RUN });
    return c;
  }, [cancel]);

  const feed = useCallback((e: ServerEvent) => setRun(r => ({ ...r, view: applyEvent(r.view, e, Date.now()) })), []);

  /** Replays the recorded sample in real time. */
  const playSample = useCallback(async (timeline: TimedEvent[]) => {
    const c = begin('sample');
    await playTimeline(timeline, feed, c.signal);
    if (c.signal.aborted) return;
    ctrl.current = null;
    setRun(r => ({ ...r, phase: 'done' }));
  }, [begin, feed]);

  /** Shows the finished sample immediately (reduced motion, or the visitor skipped the replay). */
  const showSample = useCallback((timeline: TimedEvent[]) => {
    cancel();
    setRun({ source: 'sample', phase: 'done', view: foldTimeline(timeline) });
  }, [cancel]);

  /** Sends the task to the server and streams the real run into the console. */
  const runLive = useCallback(async (request: ChatRequest) => {
    const c = begin('live');
    let serverError: string | null = null;
    try {
      await streamChat(request, c.signal, e => {
        if (e.type === 'error') serverError = e.content;
        feed(e);
      });
      if (c.signal.aborted) return;
      setRun(r => ({ ...r, ...settleRun(r.view, serverError, Date.now()) }));
    } catch (err) {
      if (c.signal.aborted) return; // stopped by the visitor, or the console went away
      setRun(r => ({ ...r, ...settleRun(r.view, errorMessage(err), Date.now()) }));
    } finally {
      if (ctrl.current === c) ctrl.current = null;
    }
  }, [begin, feed]);

  /** Aborts whatever is running and returns the console to its resting state. */
  const reset = useCallback(() => {
    cancel();
    setRun(IDLE);
  }, [cancel]);

  return { run, playSample, showSample, runLive, reset };
}
