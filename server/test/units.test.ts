import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { RateLimiter } from '../src/middleware/rateLimit.js';
import { AGENTS, PUBLIC_AGENTS } from '../src/modules/agents/registry.js';
import { parseCustomAgent, parseHistory } from '../src/modules/chat/schema.js';
import { readLines } from '../src/modules/providers/types.js';
import { WORKFLOWS } from '../src/modules/workflows/definitions.js';
import { buildStepPrompt, validateWorkflows } from '../src/modules/workflows/engine.js';

const limits = loadConfig({}).limits;

describe('parseHistory', () => {
  it('keeps the newest 20, drops empty turns and truncates long ones', () => {
    const raw = Array.from({ length: 25 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: i === 24 ? 'x'.repeat(9000) : `m${i}` }));
    raw[23].content = '   ';
    const h = parseHistory(raw, limits)!;
    expect(h).toHaveLength(19);
    expect(h[0].content).toBe('m5');
    expect(h.at(-1)!.content).toHaveLength(8000);
  });

  it('rejects anything malformed', () => {
    expect(parseHistory(undefined, limits)).toEqual([]);
    expect(parseHistory({}, limits)).toBeNull();
    expect(parseHistory([null], limits)).toBeNull();
    expect(parseHistory([{ role: 'user', content: 5 }], limits)).toBeNull();
  });
});

describe('parseCustomAgent', () => {
  it('trims, bounds and filters tools', () => {
    expect(parseCustomAgent({ name: '  A  ', systemPrompt: ' p ', tools: ['calculator', 'evil', 7], description: 'd'.repeat(300) }, 4000)).toEqual({
      name: 'A', systemPrompt: 'p', temperature: undefined, description: 'd'.repeat(200), tools: ['calculator'], greeting: "I'm A. How can I help?"
    });
  });

  it('rejects bad names, prompts and temperatures', () => {
    expect(parseCustomAgent(null, 4000)).toBeNull();
    expect(parseCustomAgent({ name: 'x'.repeat(61), systemPrompt: 'p' }, 4000)).toBeNull();
    expect(parseCustomAgent({ name: 'A', systemPrompt: '   ' }, 4000)).toBeNull();
    expect(parseCustomAgent({ name: 'A', systemPrompt: 'p', temperature: Number.NaN }, 4000)).toBeNull();
    expect(parseCustomAgent({ name: 'A', systemPrompt: 'p', temperature: '1' }, 4000)).toBeNull();
  });
});

describe('RateLimiter', () => {
  it('slides the window and never records a refused charge', () => {
    const rl = new RateLimiter(1000, 3);
    expect(rl.charge('ip', 2, 0)).toBe(true);
    expect(rl.charge('ip', 2, 10)).toBe(false);
    expect(rl.charge('ip', 1, 20)).toBe(true);
    expect(rl.charge('ip', 1, 30)).toBe(false);
    expect(rl.charge('other', 3, 30)).toBe(true);
    expect(rl.charge('ip', 3, 1100)).toBe(true); // first hits expired
    rl.sweep(5000);
    expect(rl.charge('ip', 3, 5000)).toBe(true);
    rl.close();
  });
});

describe('registry and workflows', () => {
  it('has 42 unique agents and public copies without prompts', () => {
    expect(AGENTS).toHaveLength(42);
    expect(new Set(AGENTS.map(a => a.id)).size).toBe(42);
    expect(AGENTS.every(a => a.systemPrompt && a.greeting)).toBe(true);
    expect(PUBLIC_AGENTS.every(a => !('systemPrompt' in a))).toBe(true);
  });

  it('validates that every workflow step uses a real agent', () => {
    expect(() => validateWorkflows()).not.toThrow();
    expect(() => validateWorkflows([{ ...WORKFLOWS[0], steps: [{ ...WORKFLOWS[0].steps[0], agentId: 'ghost' }] }])).toThrow(/unknown agent "ghost"/);
  });

  it('builds step prompts with trimmed earlier outputs', () => {
    const p = buildStepPrompt('task', [{ role: 'Researcher', agentName: 'R', text: '  ' + 'y'.repeat(50) }], 10);
    expect(p).toBe(`Task from the user:\ntask\n\n--- Output from the Researcher (R) ---\n${'y'.repeat(10)}`);
  });
});

describe('readLines', () => {
  it('reassembles lines split across chunks, including a final line without a newline', async () => {
    const enc = new TextEncoder();
    const chunks = ['da', 'ta: 1\nda', 'ta: 2\n', 'tail'].map(s => enc.encode(s));
    const reader = { read: async () => (chunks.length ? { value: chunks.shift(), done: false } : { done: true }) };
    const lines: string[] = [];
    for await (const l of readLines(reader)) lines.push(l);
    expect(lines).toEqual(['data: 1', 'data: 2', 'tail']);
  });
});
