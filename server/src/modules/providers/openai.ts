import type { ProviderAdapter, ProviderEvent, ProviderRequest, ToolCall, Turn } from './types.js';
import { ProviderError, kindForStatus, readLines } from './types.js';

export interface OpenAIOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
}

type OpenAIMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toOpenAIMessages(system: string, turns: Turn[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: 'system', content: system }];
  for (const t of turns) {
    if (t.role === 'user') out.push({ role: 'user', content: t.content });
    else if (t.role === 'tool') out.push({ role: 'tool', tool_call_id: t.toolCallId, content: t.content });
    else if (t.toolCalls?.length) {
      out.push({
        role: 'assistant', content: t.content || null,
        tool_calls: t.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }))
      });
    } else out.push({ role: 'assistant', content: t.content });
  }
  return out;
}

interface Chunk {
  choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
}

/** OpenAI (or any OpenAI-compatible) chat completions, streamed, with function calling and usage reporting. */
export function createOpenAIProvider(opts: OpenAIOptions): ProviderAdapter {
  return {
    id: 'openai',
    model: opts.model,
    capabilities: { streaming: true, tools: true },
    async *run(req: ProviderRequest, signal: AbortSignal): AsyncGenerator<ProviderEvent> {
      let res: Response;
      try {
        res = await fetch(`${opts.baseUrl}/chat/completions`, {
          method: 'POST',
          signal,
          headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: opts.model,
            stream: true,
            stream_options: { include_usage: true },
            ...(req.agent.temperature != null && { temperature: req.agent.temperature }),
            messages: toOpenAIMessages(req.agent.systemPrompt, req.turns),
            ...(req.tools?.length && {
              tools: req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
              tool_choice: 'auto'
            })
          })
        });
      } catch (err) {
        if (signal.aborted) throw err;
        throw new ProviderError('network', `OpenAI network error: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new ProviderError(kindForStatus(res.status), `OpenAI responded ${res.status} ${detail.slice(0, 200)}`, res.status);
      }

      // Tool call arguments arrive in fragments keyed by `index`; assemble them, emit at the end of the stream.
      const pending = new Map<number, { id: string; name: string; args: string }>();
      let yielded = false;
      let usage: { inputTokens: number; outputTokens: number } | null = null;

      for await (const line of readLines(res.body.getReader())) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') break;
        let chunk: Chunk;
        try { chunk = JSON.parse(data) as Chunk; } catch { continue; } // ignore malformed keep-alive lines
        if (chunk.error) throw new ProviderError('unavailable', `OpenAI stream error: ${String(chunk.error.message ?? '').slice(0, 200)}`);
        if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
        const delta = chunk.choices?.[0]?.delta;
        if (typeof delta?.content === 'string' && delta.content) { yielded = true; yield { type: 'text', text: delta.content }; }
        for (const tc of delta?.tool_calls ?? []) {
          const p = pending.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) p.id = tc.id;
          if (tc.function?.name) p.name += tc.function.name;
          if (tc.function?.arguments) p.args += tc.function.arguments;
          pending.set(tc.index, p);
        }
      }

      for (const [index, p] of [...pending].sort((a, b) => a[0] - b[0])) {
        let args: Record<string, unknown> = {};
        try {
          const parsed: unknown = p.args ? JSON.parse(p.args) : {};
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
        } catch { args = { __invalid_json: p.args.slice(0, 500) }; } // the tool runner reports it back to the model
        const call: ToolCall = { id: p.id || `call_${index}`, name: p.name, args };
        yielded = true;
        yield { type: 'tool_call', call };
      }
      if (usage) yield { type: 'usage', ...usage };
      if (!yielded) throw new ProviderError('empty', 'OpenAI returned no text');
    }
  };
}
