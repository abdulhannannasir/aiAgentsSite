import { TOOL_IDS, type AgentDraft, type ToolId } from '../types';

export const AGENT_FILE_SCHEMA = 'agentverse.agent';
export const AGENT_FILE_VERSION = 1;
export const MAX_AGENT_FILE_BYTES = 100_000;
export const LIMITS = { name: 60, description: 200, systemPrompt: 4000, icon: 8 } as const;

export const EMPTY_DRAFT: AgentDraft = { name: '', description: '', icon: '🤖', systemPrompt: '', temperature: 0.7, tools: [] };

const TOOL_SET: ReadonlySet<string> = new Set(TOOL_IDS);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const clean = (s: string) => s.replace(CONTROL_CHARS, '');

/** Packages an agent's configuration as pretty-printed JSON, ready to download. */
export function serializeAgent(draft: AgentDraft, exportedAt: Date = new Date()): string {
  return JSON.stringify(
    {
      schema: AGENT_FILE_SCHEMA,
      version: AGENT_FILE_VERSION,
      exportedAt: exportedAt.toISOString(),
      agent: {
        name: draft.name,
        description: draft.description,
        icon: draft.icon,
        systemPrompt: draft.systemPrompt,
        temperature: draft.temperature,
        tools: draft.tools
      }
    },
    null,
    2
  );
}

export function agentFileName(name: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${slug || 'agent'}.agentverse.json`;
}

export type ParseResult = { ok: true; draft: AgentDraft; warnings: string[] } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parses and validates an exported agent file. Never throws: every problem comes back as a
 * human-readable `error`. Accepts either the full export wrapper or a bare agent object.
 */
export function parseAgentFile(text: string): ParseResult {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'The file is empty.' };
  if (text.length > MAX_AGENT_FILE_BYTES) {
    return { ok: false, error: `The file is too large (max ${Math.round(MAX_AGENT_FILE_BYTES / 1000)} KB).` };
  }

  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    return { ok: false, error: `This is not valid JSON${err instanceof SyntaxError ? ` (${err.message})` : ''}.` };
  }
  if (!isRecord(data)) return { ok: false, error: 'Expected a JSON object describing an agent.' };

  const warnings: string[] = [];
  let agent: unknown = data;
  if ('schema' in data || 'agent' in data) {
    if (data.schema !== AGENT_FILE_SCHEMA) return { ok: false, error: `This file is not an AgentVerse agent export (schema "${String(data.schema)}").` };
    if (typeof data.version === 'number' && data.version > AGENT_FILE_VERSION) {
      return { ok: false, error: `This file was made by a newer version of AgentVerse (format v${data.version}).` };
    }
    agent = data.agent;
  }
  if (!isRecord(agent)) return { ok: false, error: 'The file has no "agent" object.' };

  if (typeof agent.name !== 'string' || !clean(agent.name).trim()) return { ok: false, error: 'The agent needs a "name".' };
  if (typeof agent.systemPrompt !== 'string' || !clean(agent.systemPrompt).trim()) return { ok: false, error: 'The agent needs a "systemPrompt".' };

  const name = clean(agent.name).trim();
  const systemPrompt = clean(agent.systemPrompt).trim();
  if (name.length > LIMITS.name) return { ok: false, error: `The name is too long (max ${LIMITS.name} characters).` };
  if (systemPrompt.length > LIMITS.systemPrompt) return { ok: false, error: `The system prompt is too long (max ${LIMITS.systemPrompt} characters).` };

  let temperature = EMPTY_DRAFT.temperature;
  if (agent.temperature !== undefined) {
    if (typeof agent.temperature !== 'number' || !Number.isFinite(agent.temperature) || agent.temperature < 0 || agent.temperature > 2) {
      return { ok: false, error: 'The temperature must be a number between 0 and 2.' };
    }
    temperature = Math.round(agent.temperature * 100) / 100;
  }

  let tools: ToolId[] = [];
  if (agent.tools !== undefined) {
    if (!Array.isArray(agent.tools)) return { ok: false, error: '"tools" must be a list.' };
    const strings = agent.tools.filter((t): t is string => typeof t === 'string');
    tools = [...new Set(strings.filter((t): t is ToolId => TOOL_SET.has(t)))];
    const unknown = [...new Set(strings.filter(t => !TOOL_SET.has(t)))];
    if (unknown.length) warnings.push(`Ignored unknown tools: ${unknown.slice(0, 5).join(', ')}.`);
  }

  const description = typeof agent.description === 'string' ? clean(agent.description).trim().slice(0, LIMITS.description) : '';
  const rawIcon = typeof agent.icon === 'string' ? clean(agent.icon).trim() : '';
  const icon = rawIcon && rawIcon.length <= LIMITS.icon ? rawIcon : EMPTY_DRAFT.icon;
  if (rawIcon.length > LIMITS.icon) warnings.push('The icon was not a short emoji, so the default was used.');

  return { ok: true, draft: { name, description, icon, systemPrompt, temperature, tools }, warnings };
}

/** Field-level errors for the creator form. An empty object means the draft is valid. */
export function validateDraft(draft: AgentDraft): Partial<Record<keyof AgentDraft, string>> {
  const errors: Partial<Record<keyof AgentDraft, string>> = {};
  if (!draft.name.trim()) errors.name = 'Give your agent a name.';
  else if (draft.name.trim().length > LIMITS.name) errors.name = `Keep the name under ${LIMITS.name} characters.`;
  if (!draft.systemPrompt.trim()) errors.systemPrompt = 'Describe how the agent should behave.';
  else if (draft.systemPrompt.trim().length > LIMITS.systemPrompt) errors.systemPrompt = `Keep the prompt under ${LIMITS.systemPrompt} characters.`;
  if (draft.description.length > LIMITS.description) errors.description = `Keep the description under ${LIMITS.description} characters.`;
  if (!Number.isFinite(draft.temperature) || draft.temperature < 0 || draft.temperature > 2) errors.temperature = 'Temperature must be between 0 and 2.';
  return errors;
}

/** Type guard used when loading custom agents back from localStorage. */
export function isStoredAgent(v: unknown): v is AgentDraft & { id: string; createdAt: number; updatedAt: number } {
  if (!isRecord(v) || typeof v.id !== 'string') return false;
  const r = parseAgentFile(JSON.stringify(v));
  return r.ok && typeof v.createdAt === 'number' && typeof v.updatedAt === 'number';
}
