import type { ChatAgent } from './types.js';

export const DEMO_NOTE = '_Demo mode — replies are canned. Set `GEMINI_API_KEY` or `OPENAI_API_KEY` on the server for real answers._';

/**
 * The canned reply for demo mode: the agent's greeting plus a clear demo label. It deliberately does not
 * pretend to run tools (the original demo printed fake "ticket created" / "email sent" results).
 */
export function buildDemoResponse(agent: ChatAgent): string {
  const intro = agent.greeting || `Hello! I'm your ${agent.name}. ${agent.description ?? ''}`.trim();
  const tools = agent.tools.length
    ? `\n\nThis agent is set up for: ${agent.tools.map(t => `\`${t}\``).join(', ')}. Tools are not connected yet, so none were run.`
    : '';
  return `${intro}${tools}\n\n${DEMO_NOTE}`;
}

/** Streams canned text word by word, like a model would. */
export async function* streamDemoText(text: string, signal?: AbortSignal, delay = () => 20 + Math.random() * 30): AsyncGenerator<string> {
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    if (signal?.aborted) return;
    yield words[i] + (i < words.length - 1 ? ' ' : '');
    const ms = delay();
    if (ms > 0) await new Promise(r => setTimeout(r, ms));
  }
}
