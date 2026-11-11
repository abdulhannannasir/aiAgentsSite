import { z } from 'zod';
import { ToolError, type ToolDefinition } from './types.js';

export interface WebSearchOptions {
  /** Tavily API key (TAVILY_API_KEY). Without it the tool is listed as awaiting configuration and never offered. */
  apiKey: string | null;
  baseUrl?: string;
}

interface TavilyResponse { results?: Array<{ title?: string; url?: string; content?: string }>; answer?: string }

/** Web search through the Tavily Search API. */
export function createWebSearchTool(opts: WebSearchOptions): ToolDefinition<{ query: string; max_results?: number }> {
  const baseUrl = (opts.baseUrl ?? 'https://api.tavily.com').replace(/\/+$/, '');
  return {
    id: 'web_search',
    label: 'Web search',
    description: 'Searches the web and returns the top results (title, URL and a snippet). Use it for current events, prices, or facts you are not sure about, then cite the URLs you used.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for' },
        max_results: { type: 'integer', description: 'How many results, 1 to 8 (default 5)' }
      },
      required: ['query']
    },
    input: z.object({ query: z.string().min(1).max(400), max_results: z.number().int().min(1).max(8).optional() }),
    timeoutMs: 15_000,
    untrustedOutput: true,
    availability: opts.apiKey ? { available: true } : { available: false, reason: 'Awaiting configuration: set TAVILY_API_KEY on the server.' },
    async run({ query, max_results }, ctx) {
      if (!opts.apiKey) throw new ToolError('Web search is not configured on this server.');
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/search`, {
          method: 'POST', signal: ctx.signal,
          headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, max_results: max_results ?? 5, search_depth: 'basic' })
        });
      } catch {
        throw new ToolError('The search service could not be reached.');
      }
      if (!res.ok) throw new ToolError(res.status === 401 || res.status === 403 ? 'The search service rejected the server\'s API key.' : `The search service answered HTTP ${res.status}.`);
      const data = (await res.json().catch(() => ({}))) as TavilyResponse;
      const results = (data.results ?? []).slice(0, max_results ?? 5);
      if (!results.length) return `No results for "${query}".`;
      return results.map((r, i) => `${i + 1}. ${r.title ?? '(untitled)'}\n   ${r.url ?? ''}\n   ${(r.content ?? '').replace(/\s+/g, ' ').slice(0, 500)}`).join('\n\n');
    }
  };
}
