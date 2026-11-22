import { z } from 'zod';
import { ToolError, type ToolDefinition } from './types.js';

const Input = z.object({ query: z.string().trim().min(2).max(500) }).strict();

/**
 * Searches the caller's memory and knowledge (notes, and text from uploaded files) with permission filtering done by
 * the server. Results are labelled [K1], [K2]… with their source, and are treated as information, not instructions.
 */
export function createKnowledgeTool(): ToolDefinition<z.infer<typeof Input>> {
  return {
    id: 'knowledge_base',
    label: 'Knowledge base',
    description: 'Search the user\'s saved notes and uploaded documents (their own, their workspace\'s, the current project\'s and this agent\'s memory). Use it for facts specific to the user or their organisation. Cite results by their [K…] label.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, in natural language' } }, required: ['query'] },
    input: Input,
    timeoutMs: 20_000,
    untrustedOutput: true,
    external: false,
    needsUser: true,
    availability: { available: true },
    async run({ query }, ctx) {
      if (!ctx.knowledge) throw new ToolError('The knowledge base needs a signed-in user.');
      const text = await ctx.knowledge(query);
      return text || 'No matching notes or documents were found.';
    }
  };
}
