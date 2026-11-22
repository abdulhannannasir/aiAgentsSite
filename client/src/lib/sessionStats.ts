import type { Message } from '../types';

export interface SessionStats {
  messagesSent: number;
  replies: number;
  completed: number;
  failed: number;
  running: number;
  workflowRuns: number;
  agentsUsed: number;
  /** Mean reply duration in ms over completed replies whose steps were timed; null when nothing is timed yet. */
  avgReplyMs: number | null;
}

export interface ActivityEntry {
  id: string;
  threadKey: string;
  kind: 'chat' | 'workflow';
  status: Message['status'];
  at: number;
  preview: string;
  workflowId?: string;
  durationMs: number | null;
}

const durationOf = (m: Message): number | null => {
  const starts = (m.trace ?? []).map(s => s.startedAt).filter((n): n is number => typeof n === 'number');
  const ends = (m.trace ?? []).map(s => s.endedAt).filter((n): n is number => typeof n === 'number');
  if (!starts.length || !ends.length) return null;
  return Math.max(0, Math.max(...ends) - Math.min(...starts));
};

/** Real numbers for this browser session, computed from the chat threads (nothing is estimated or invented). */
export function sessionStats(threads: Record<string, Message[]>): SessionStats {
  let messagesSent = 0, replies = 0, completed = 0, failed = 0, running = 0, workflowRuns = 0, agentsUsed = 0;
  let timedTotal = 0, timedCount = 0;
  for (const messages of Object.values(threads)) {
    if (messages.some(m => m.role === 'user')) agentsUsed++;
    for (const m of messages) {
      if (m.role === 'user') { messagesSent++; continue; }
      replies++;
      if (m.workflowId) workflowRuns++;
      if (m.status === 'done') {
        completed++;
        const d = durationOf(m);
        if (d !== null) { timedTotal += d; timedCount++; }
      } else if (m.status === 'error') failed++;
      else running++;
    }
  }
  return { messagesSent, replies, completed, failed, running, workflowRuns, agentsUsed, avgReplyMs: timedCount ? Math.round(timedTotal / timedCount) : null };
}

/** The newest assistant replies across every thread, newest first. */
export function recentActivity(threads: Record<string, Message[]>, limit = 8): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const [threadKey, messages] of Object.entries(threads)) {
    messages.forEach((m, i) => {
      if (m.role !== 'assistant') return;
      const prompt = messages[i - 1]?.role === 'user' ? messages[i - 1].content : '';
      entries.push({
        id: m.id, threadKey, kind: m.workflowId ? 'workflow' : 'chat', status: m.status, at: m.createdAt,
        preview: prompt.replace(/\s+/g, ' ').trim().slice(0, 120), workflowId: m.workflowId, durationMs: durationOf(m)
      });
    });
  }
  return entries.sort((a, b) => b.at - a.at).slice(0, limit);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`;
}

export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}
