import type { ToolId } from '../types';

export const TOOL_LABEL: Record<ToolId, string> = {
  web_search: 'Web search', url_fetch: 'Read web pages', calculator: 'Calculator', current_time: 'Date & time',
  code_interpreter: 'Code interpreter', file_reader: 'File reader', ticket_system: 'Ticket system',
  email_sender: 'Email sender', knowledge_base: 'Knowledge base'
};
export const toolLabel = (id: string) => TOOL_LABEL[id as ToolId] ?? id;

/** GET /api/v1/tools: every tool, and why any is unavailable on this server. */
export interface ToolInfo { id: string; label: string; description: string; available: boolean; reason?: string }

/** GET /api/v1/models: providers configured here and the models agents may be pinned to. */
export interface ModelCatalog {
  default: { provider: 'openai' | 'gemini'; model: string } | null;
  providers: Array<{ id: 'openai' | 'gemini'; label: string; configured: boolean; models: Array<{ id: string; isDefault: boolean }> }>;
}

const getJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
};
export const fetchTools = () => getJson<ToolInfo[]>('/api/v1/tools');
export const fetchModels = () => getJson<ModelCatalog>('/api/v1/models');
