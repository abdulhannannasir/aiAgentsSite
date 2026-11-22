/**
 * Executions running in THIS process, so a cancel request can stop them. (Phase 5 moves long work to a queue; a
 * cancel for a run on another instance then goes through Redis.)
 */
export interface RunningExecution { controller: AbortController; workspaceId: string; userId: string }

const running = new Map<string, RunningExecution>();

export const runningExecutions = {
  add(id: string, r: RunningExecution) { running.set(id, r); },
  remove(id: string) { running.delete(id); },
  get(id: string) { return running.get(id); },
  /** Cancels the run if it is here. Returns false when it is not running in this process. */
  cancel(id: string): boolean {
    const r = running.get(id);
    if (!r) return false;
    r.controller.abort(new Error('cancelled'));
    return true;
  }
};
