import type { z } from 'zod';
import type { Logger } from '../../lib/logger.js';

export interface ToolContext {
  signal: AbortSignal;
  log: Logger;
}

export interface ToolAvailability {
  available: boolean;
  /** Why not, in words a user understands (e.g. which setting is missing, or which phase builds it). */
  reason?: string;
}

/**
 * A tool an agent may be allowed to use. `run` returns plain text for the model; anything it fetched from outside
 * is untrusted data and is labelled as such by the runner, never treated as instructions.
 */
export interface ToolDefinition<I = unknown> {
  id: string;
  label: string;
  description: string;
  /** JSON Schema for the arguments, in the subset OpenAI and Gemini both accept. */
  parameters: Record<string, unknown>;
  input: z.ZodType<I>;
  timeoutMs: number;
  /** True when its output comes from outside the server (web pages, search results). */
  untrustedOutput: boolean;
  availability: ToolAvailability;
  run(input: I, ctx: ToolContext): Promise<string>;
}

/** A tool's own failure, with a message the model (and user) may see. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}
