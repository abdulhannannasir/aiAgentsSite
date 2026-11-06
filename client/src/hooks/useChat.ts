import { useCallback, useRef, useState } from 'react';
import { ApiError, streamChat, type ChatRequest } from '../lib/api';
import type { ActiveAgent, CustomAgent, Message, ServerEvent, TraceStep, Workflow } from '../types';

const MAX_HISTORY = 20;
const HISTORY_ENTRY_CHARS = 8000;

const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

const pending = (s: Workflow['steps'][number]): TraceStep => ({ id: s.id, agentName: s.agentName, agentIcon: s.agentIcon, role: s.role, label: s.label, status: 'pending', output: '' });

export interface SendOptions {
  agent: ActiveAgent;
  customAgent?: CustomAgent;
  workflow?: Workflow | null;
  text: string;
}

/**
 * Chat state for every agent at once: one thread per agent, each streaming independently, so switching
 * agents mid-reply never mixes conversations. The server is stateless, so each request carries the history.
 */
export function useChat() {
  const [threads, setThreads] = useState<Record<string, Message[]>>({});
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const controllers = useRef(new Map<string, AbortController>());
  const [streamingKeys, setStreamingKeys] = useState<string[]>([]);

  const setStreaming = (key: string, on: boolean) => setStreamingKeys(keys => (on ? (keys.includes(key) ? keys : [...keys, key]) : keys.filter(k => k !== key)));

  const patchReply = useCallback((key: string, id: string, fn: (m: Message) => Message) => {
    setThreads(t => ({ ...t, [key]: (t[key] ?? []).map(m => (m.id === id ? fn(m) : m)) }));
  }, []);

  const send = useCallback(async ({ agent, customAgent, workflow, text }: SendOptions) => {
    const key = agent.key;
    if (controllers.current.has(key)) return;

    const history = (threadsRef.current[key] ?? [])
      .filter(m => m.status === 'done' && m.content.trim())
      .slice(-MAX_HISTORY)
      .map(m => ({ role: m.role, content: m.content.slice(0, HISTORY_ENTRY_CHARS) }));

    const now = Date.now();
    const replyId = uid();
    const userMsg: Message = { id: uid(), role: 'user', content: text, createdAt: now, status: 'done' };
    const reply: Message = {
      id: replyId, role: 'assistant', content: '', createdAt: now, status: 'streaming', workflowId: workflow?.id,
      trace: workflow
        ? workflow.steps.map(pending)
        : [{ id: 'respond', agentName: agent.name, agentIcon: agent.icon, role: 'Responder', label: 'Generate the reply', status: 'active', output: '', startedAt: now }]
    };
    setThreads(t => ({ ...t, [key]: [...(t[key] ?? []), userMsg, reply] }));

    const ctrl = new AbortController();
    controllers.current.set(key, ctrl);
    setStreaming(key, true);

    const request: ChatRequest = { message: text, history };
    if (workflow) request.workflowId = workflow.id;
    else if (customAgent) request.agent = { name: customAgent.name, description: customAgent.description, systemPrompt: customAgent.systemPrompt, temperature: customAgent.temperature, tools: customAgent.tools };
    else request.agentId = agent.key;

    let serverError: string | null = null;
    const onEvent = (e: ServerEvent) => {
      switch (e.type) {
        case 'plan':
          patchReply(key, replyId, m => ({ ...m, trace: e.steps.map(s => ({ ...s, output: '' })) }));
          break;
        case 'step':
          patchReply(key, replyId, m => ({
            ...m,
            trace: m.trace?.map(s => s.id !== e.id ? s : {
              ...s, status: e.status, error: e.error,
              startedAt: e.status === 'active' ? Date.now() : s.startedAt,
              endedAt: e.status === 'complete' || e.status === 'error' ? Date.now() : s.endedAt
            })
          }));
          break;
        case 'step_delta':
          patchReply(key, replyId, m => ({ ...m, trace: m.trace?.map(s => (s.id === e.id ? { ...s, output: s.output + e.content } : s)) }));
          break;
        case 'stream':
          patchReply(key, replyId, m => ({ ...m, content: m.content + e.content }));
          break;
        case 'error':
          serverError = e.content;
          break;
        case 'done':
          break;
      }
    };

    try {
      await streamChat(request, ctrl.signal, onEvent);
      patchReply(key, replyId, m => {
        const failed = serverError !== null || !m.content.trim();
        const end = Date.now();
        return {
          ...m,
          status: failed ? 'error' : 'done',
          error: failed ? serverError ?? 'The agent returned an empty reply. Please try again.' : undefined,
          trace: m.trace?.map(s => s.id === 'respond' && !workflow
            ? { ...s, status: failed ? 'error' : 'complete', endedAt: end }
            : s.status === 'active' ? { ...s, status: 'error', endedAt: end } : s)
        };
      });
    } catch (err) {
      const stopped = err instanceof DOMException && err.name === 'AbortError';
      const message = stopped ? 'Stopped.' : err instanceof ApiError ? err.message : 'Could not reach the server. Check your connection and try again.';
      patchReply(key, replyId, m => ({
        ...m,
        // a stopped reply keeps whatever text had arrived
        status: stopped && m.content.trim() ? 'done' : 'error',
        error: stopped && m.content.trim() ? undefined : message,
        trace: m.trace?.map(s => (s.status === 'active' || s.status === 'pending' ? { ...s, status: 'error', endedAt: Date.now() } : s))
      }));
    } finally {
      controllers.current.delete(key);
      setStreaming(key, false);
    }
  }, [patchReply]);

  const stop = useCallback((key: string) => controllers.current.get(key)?.abort(), []);

  const clear = useCallback((key: string) => {
    controllers.current.get(key)?.abort();
    setThreads(t => ({ ...t, [key]: [] }));
  }, []);

  return { threads, streamingKeys, send, stop, clear };
}
