import { describe, expect, it } from 'vitest';
import { NAV } from '../app/nav';
import { PAGE_IDS, pageHref, parseRoute, parseView } from './route';
import { formatDuration, recentActivity, sessionStats, timeAgo } from './sessionStats';
import type { Message } from '../types';

describe('parseRoute', () => {
  it('keeps the original two screens', () => {
    expect(parseRoute('')).toEqual({ view: 'landing', page: 'chat', unknown: false });
    expect(parseRoute('#/')).toEqual({ view: 'landing', page: 'chat', unknown: false });
    expect(parseRoute('#/app')).toEqual({ view: 'app', page: 'chat', unknown: false });
    expect(parseRoute('#/app/')).toEqual({ view: 'app', page: 'chat', unknown: false });
    expect(parseView('#/app?x=1')).toBe('app');
    expect(parseView('#/apple')).toBe('landing');
  });

  it('parses every app page and flags unknown ones', () => {
    for (const id of PAGE_IDS) expect(parseRoute(pageHref(id))).toEqual({ view: 'app', page: id, unknown: false });
    expect(parseRoute('#/app/Discover')).toMatchObject({ page: 'discover' });
    expect(parseRoute('#/app/nope')).toEqual({ view: 'app', page: 'chat', unknown: true });
  });

  it('parses auth screens with their hash query', () => {
    expect(parseRoute('#/auth/sign-in')).toMatchObject({ view: 'auth', authPage: 'sign-in', unknown: false });
    expect(parseRoute('#/auth/verified?error=INVALID_TOKEN')).toMatchObject({ view: 'auth', authPage: 'verified', params: { error: 'INVALID_TOKEN' } });
    expect(parseRoute('#/auth/nope')).toMatchObject({ view: 'auth', unknown: true });
  });

  it('chat stays at plain #/app', () => {
    expect(pageHref('chat')).toBe('#/app');
    expect(pageHref('settings')).toBe('#/app/settings');
  });
});

describe('navigation model', () => {
  it('has exactly one nav item per page, and planned pages say which phase builds them', () => {
    expect(NAV.map(n => n.id).sort()).toEqual([...PAGE_IDS].sort());
    for (const n of NAV.filter(x => x.status === 'planned')) {
      expect(n.phase).toBeGreaterThan(1);
      expect(n.capabilities?.length).toBeGreaterThan(0);
    }
  });
});

const msg = (over: Partial<Message>): Message => ({ id: Math.random().toString(36), role: 'assistant', content: '', createdAt: 0, status: 'done', ...over });

describe('sessionStats', () => {
  it('is all zeros for an empty session', () => {
    expect(sessionStats({})).toEqual({ messagesSent: 0, replies: 0, completed: 0, failed: 0, running: 0, workflowRuns: 0, agentsUsed: 0, avgReplyMs: null });
  });

  it('counts replies by status, workflows, agents used and timed durations', () => {
    const threads = {
      a: [msg({ role: 'user', content: 'q1' }), msg({ trace: [{ id: 'r', agentName: '', agentIcon: '', role: '', label: '', status: 'complete', output: '', startedAt: 1000, endedAt: 3000 }] }),
        msg({ role: 'user', content: 'q2' }), msg({ status: 'error' })],
      b: [msg({ role: 'user', content: 'q3' }), msg({ status: 'streaming', workflowId: 'research' })],
      c: []
    };
    expect(sessionStats(threads)).toEqual({ messagesSent: 3, replies: 3, completed: 1, failed: 1, running: 1, workflowRuns: 1, agentsUsed: 2, avgReplyMs: 2000 });
  });
});

describe('recentActivity', () => {
  it('lists replies newest first with the prompt that caused them', () => {
    const threads = {
      a: [msg({ role: 'user', content: 'first   question', createdAt: 1 }), msg({ createdAt: 2 })],
      b: [msg({ role: 'user', content: 'second', createdAt: 5 }), msg({ createdAt: 6, workflowId: 'brainstorm', status: 'error' })]
    };
    const list = recentActivity(threads);
    expect(list.map(e => [e.threadKey, e.kind, e.status, e.preview])).toEqual([
      ['b', 'workflow', 'error', 'second'],
      ['a', 'chat', 'done', 'first question']
    ]);
    expect(recentActivity(threads, 1)).toHaveLength(1);
  });
});

describe('formatting', () => {
  it('formats durations and relative times', () => {
    expect(formatDuration(420)).toBe('420 ms');
    expect(formatDuration(2500)).toBe('2.5 s');
    expect(formatDuration(125_000)).toBe('2 m 5 s');
    expect(timeAgo(1000, 1000)).toBe('just now');
    expect(timeAgo(0, 30_000)).toBe('30s ago');
    expect(timeAgo(0, 5 * 60_000)).toBe('5m ago');
    expect(timeAgo(0, 3 * 3600_000)).toBe('3h ago');
  });
});
