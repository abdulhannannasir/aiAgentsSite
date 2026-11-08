import { z } from 'zod';
import type { AppConfig } from '../../config/env.js';
import type { HistoryMessage } from '../../contracts.js';
import type { ChatAgent } from '../providers/types.js';

/** Tool permission names an agent may carry. They are labels until the Phase 4 tool registry exists. */
export const TOOL_NAMES = new Set(['web_search', 'calculator', 'code_interpreter', 'file_reader', 'ticket_system', 'email_sender', 'knowledge_base']);

/**
 * Chat is stateless for guests: the browser keeps the conversation and sends the recent turns with each request.
 * Returns a cleaned array (newest `maxMessages`, empty turns dropped, long turns truncated), or null if malformed.
 */
export function parseHistory(raw: unknown, limits: AppConfig['limits']): HistoryMessage[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const history: HistoryMessage[] = [];
  for (const m of raw.slice(-limits.maxHistoryMessages)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    if (!m.content.trim()) continue; // empty turns would make the model API reject the request
    history.push({ role: m.role, content: m.content.slice(0, limits.maxHistoryChars) });
  }
  return history;
}

/**
 * A user-defined agent sent along with a chat request. Returns null if anything is malformed or out of range
 * (the client validates too, but the server never trusts it). Unknown tool names are dropped.
 */
export function parseCustomAgent(raw: unknown, maxSystemPromptChars: number): ChatAgent | null {
  const schema = z.object({
    name: z.string().transform(s => s.trim()).pipe(z.string().min(1).max(60)),
    systemPrompt: z.string().transform(s => s.trim()).pipe(z.string().min(1).max(maxSystemPromptChars)),
    temperature: z.number().finite().min(0).max(2).optional(),
    description: z.unknown().optional(),
    tools: z.unknown().optional()
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  const a = parsed.data;
  return {
    name: a.name,
    systemPrompt: a.systemPrompt,
    temperature: a.temperature,
    description: typeof a.description === 'string' ? a.description.slice(0, 200) : '',
    tools: Array.isArray(a.tools) ? a.tools.filter((t): t is string => typeof t === 'string' && TOOL_NAMES.has(t)) : [],
    greeting: `I'm ${a.name}. How can I help?`
  };
}
