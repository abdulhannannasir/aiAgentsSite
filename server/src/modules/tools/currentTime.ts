import { z } from 'zod';
import { ToolError, type ToolDefinition } from './types.js';

export const currentTimeTool: ToolDefinition<{ timezone?: string }> = {
  id: 'current_time',
  label: 'Current date and time',
  description: 'Returns the current date and time, in UTC and optionally in an IANA time zone such as "Asia/Karachi". Use it whenever the answer depends on today\'s date.',
  parameters: { type: 'object', properties: { timezone: { type: 'string', description: 'IANA time zone, e.g. "Europe/London" (optional)' } } },
  input: z.object({ timezone: z.string().max(64).optional() }),
  timeoutMs: 1000,
  untrustedOutput: false,
  availability: { available: true },
  async run({ timezone }, ) {
    const now = new Date();
    const lines = [`UTC: ${now.toISOString()}`];
    if (timezone) {
      let local: string;
      try {
        local = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, dateStyle: 'full', timeStyle: 'long' }).format(now);
      } catch {
        throw new ToolError(`Unknown time zone "${timezone}". Use an IANA name such as "Asia/Karachi".`);
      }
      lines.push(`${timezone}: ${local}`);
    }
    return lines.join('\n');
  }
};
