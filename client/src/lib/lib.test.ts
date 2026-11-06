import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, MAX_AGENT_FILE_BYTES, agentFileName, parseAgentFile, serializeAgent, validateDraft } from './agentFile';
import { chatToMarkdown, chatFileName } from './chatExport';
import { readSSE } from './sse';
import { rankBy, scoreMatch } from './search';
import { AGENT_TEMPLATES } from './templates';
import type { AgentDraft, Message } from '../types';

const draft: AgentDraft = { name: 'Pirate Bot', description: 'Talks like a pirate', icon: '🏴‍☠️', systemPrompt: 'Talk like a pirate.', temperature: 0.9, tools: ['web_search', 'calculator'] };

describe('agent file export / import', () => {
  it('round-trips an agent exactly', () => {
    const r = parseAgentFile(serializeAgent(draft));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.draft).toEqual(draft); expect(r.warnings).toEqual([]); }
  });
  it('exports a clean, versioned wrapper', () => {
    const j = JSON.parse(serializeAgent(draft, new Date('2026-01-02T03:04:05Z')));
    expect(j).toMatchObject({ schema: 'agentverse.agent', version: 1, exportedAt: '2026-01-02T03:04:05.000Z' });
    expect(Object.keys(j.agent).sort()).toEqual(['description', 'icon', 'name', 'systemPrompt', 'temperature', 'tools']);
  });
  it('accepts a bare agent object too', () => {
    const r = parseAgentFile(JSON.stringify({ name: 'A', systemPrompt: 'B' }));
    expect(r.ok && r.draft.temperature).toBe(EMPTY_DRAFT.temperature);
  });
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['{not json', 'not valid JSON'],
    ['[1,2]', 'JSON object'],
    ['"str"', 'JSON object'],
    [JSON.stringify({ schema: 'something.else', agent: {} }), 'not an AgentVerse agent export'],
    [JSON.stringify({ schema: 'agentverse.agent', version: 99, agent: { name: 'a', systemPrompt: 'b' } }), 'newer version'],
    [JSON.stringify({ schema: 'agentverse.agent', version: 1 }), 'no "agent"'],
    [JSON.stringify({ name: '', systemPrompt: 'x' }), 'needs a "name"'],
    [JSON.stringify({ name: 'x' }), 'systemPrompt'],
    [JSON.stringify({ name: 'x'.repeat(61), systemPrompt: 'y' }), 'name is too long'],
    [JSON.stringify({ name: 'x', systemPrompt: 'y'.repeat(4001) }), 'prompt is too long'],
    [JSON.stringify({ name: 'x', systemPrompt: 'y', temperature: 5 }), 'between 0 and 2'],
    [JSON.stringify({ name: 'x', systemPrompt: 'y', temperature: 'hot' }), 'between 0 and 2'],
    [JSON.stringify({ name: 'x', systemPrompt: 'y', tools: 'web_search' }), '"tools" must be a list']
  ])('rejects bad input with a clear message: %s', (input, expected) => {
    const r = parseAgentFile(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain(expected.toLowerCase());
  });
  it('rejects oversize files before parsing', () => {
    const r = parseAgentFile('x'.repeat(MAX_AGENT_FILE_BYTES + 1));
    expect(!r.ok && r.error).toMatch(/too large/);
  });
  it('drops unknown tools with a warning, keeps known ones, removes duplicates', () => {
    const r = parseAgentFile(JSON.stringify({ name: 'x', systemPrompt: 'y', tools: ['web_search', 'web_search', 'rm_rf', 7, 'calculator'] }));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.draft.tools).toEqual(['web_search', 'calculator']); expect(r.warnings[0]).toContain('rm_rf'); }
  });
  it('strips control characters and a BOM; falls back for a bad icon', () => {
    const r = parseAgentFile('﻿' + JSON.stringify({ name: 'Bo\u0000b', systemPrompt: 'Hi\u0007 there', icon: 'way too long icon text' }));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.draft.name).toBe('Bob'); expect(r.draft.systemPrompt).toBe('Hi there'); expect(r.draft.icon).toBe(EMPTY_DRAFT.icon); expect(r.warnings.length).toBe(1); }
  });
  it('treats HTML in fields as plain text (never interpreted here)', () => {
    const r = parseAgentFile(JSON.stringify({ name: '<img src=x onerror=alert(1)>', systemPrompt: '<script>1</script>' }));
    expect(r.ok && r.draft.name).toBe('<img src=x onerror=alert(1)>');
  });
  it('builds safe file names', () => {
    expect(agentFileName('Legal & Regulatory Advisor!')).toBe('legal-regulatory-advisor.agentverse.json');
    expect(agentFileName('???')).toBe('agent.agentverse.json');
    expect(agentFileName('../../etc/passwd')).toBe('etc-passwd.agentverse.json');
  });
  it('validates the creator form', () => {
    expect(validateDraft(draft)).toEqual({});
    expect(Object.keys(validateDraft({ ...EMPTY_DRAFT })).sort()).toEqual(['name', 'systemPrompt']);
    expect(validateDraft({ ...draft, temperature: 3 }).temperature).toBeTruthy();
  });
  it('ships valid templates', () => {
    expect(AGENT_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const t of AGENT_TEMPLATES) expect(validateDraft(t.draft)).toEqual({});
    for (const t of AGENT_TEMPLATES) expect(parseAgentFile(serializeAgent(t.draft)).ok).toBe(true);
  });
});

describe('chat export', () => {
  const msgs: Message[] = [
    { id: '1', role: 'user', content: 'What is 2+2?', createdAt: 0, status: 'done' },
    { id: '2', role: 'assistant', content: 'It is **4**.', createdAt: 0, status: 'done', trace: [
      { id: 'a', agentName: 'Data Analyst', agentIcon: '📊', role: 'Synthesizer', label: 'Do the maths', status: 'complete', output: '' }] },
    { id: '3', role: 'assistant', content: '', createdAt: 0, status: 'streaming' },
    { id: '4', role: 'assistant', content: '', createdAt: 0, status: 'error', error: 'Too many requests' }
  ];
  const md = chatToMarkdown({ agentName: 'Helper', messages: msgs, exportedAt: new Date('2026-03-04T05:06:07Z') });
  it('formats a readable Markdown document', () => {
    expect(md).toContain('# Chat with Helper');
    expect(md).toContain('_Exported 2026-03-04 05:06 UTC from AgentVerse_');
    expect(md).toContain('### You\n\nWhat is 2+2?');
    expect(md).toContain('### Helper\n\nIt is **4**.');
  });
  it('includes the thought stream and failed replies, skips empty streaming placeholders', () => {
    expect(md).toContain('<summary>Thought stream (1 step)</summary>');
    expect(md).toContain('1. **Synthesizer** (Data Analyst) - Do the maths - _done_');
    expect(md).toContain('> ⚠️ Too many requests');
    expect((md.match(/### Helper/g) ?? []).length).toBe(2); // reply + failed reply, not the empty placeholder
  });
  it('has no runs of blank lines and ends with one newline', () => {
    expect(md).not.toMatch(/\n{3,}/);
    expect(md.endsWith('\n') && !md.endsWith('\n\n')).toBe(true);
  });
  it('names files by agent and date', () => {
    expect(chatFileName('Full-Stack Coding Assistant', new Date('2026-03-04T05:06:07Z'))).toBe('chat-full-stack-coding-assistant-2026-03-04.md');
  });
});

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { chunks.forEach(x => c.enqueue(enc.encode(x))); c.close(); } });
}

describe('SSE parser', () => {
  it('parses events split across chunks, CRLF and a final event with no trailing blank line', async () => {
    const got: unknown[] = [];
    await readSSE(streamOf(['data: {"a":1}\n\nda', 'ta: {"b"', ':2}\r\n\r\ndata: {"c":3}']), e => got.push(e));
    expect(got).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
  it('skips malformed events and non-data lines without stopping', async () => {
    const got: unknown[] = [];
    await readSSE(streamOf([': keep-alive\n\ndata: {oops\n\nevent: x\ndata: {"ok":true}\n\n']), e => got.push(e));
    expect(got).toEqual([{ ok: true }]);
  });
  it('handles multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: {"t":"héllo 🌍"}\n\n');
    const got: unknown[] = [];
    const s = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 13)); c.enqueue(bytes.slice(13)); c.close(); } });
    await readSSE(s, e => got.push(e));
    expect(got).toEqual([{ t: 'héllo 🌍' }]);
  });
});

describe('fuzzy search', () => {
  it('ranks prefix > word start > substring > subsequence, and requires every term', () => {
    expect(scoreMatch('res', 'research')).toBeGreaterThan(scoreMatch('res', 'deep research'));
    expect(scoreMatch('res', 'deep research')).toBeGreaterThan(scoreMatch('res', 'prestige'));
    expect(scoreMatch('res', 'prestige')).toBeGreaterThan(scoreMatch('rsh', 'research'));
    expect(scoreMatch('switch cod', 'Switch to Coding Assistant')).toBeGreaterThan(0);
    expect(scoreMatch('switch zzz', 'Switch to Coding Assistant')).toBe(0);
    expect(scoreMatch('', 'anything')).toBeGreaterThan(0);
  });
  it('is not confused by regex characters', () => {
    expect(scoreMatch('(.*', 'a (.* b')).toBeGreaterThan(0);
    expect(() => scoreMatch('[', 'x')).not.toThrow();
  });
  it('rankBy keeps order for ties and filters non-matches', () => {
    const items = ['/brainstorm', '/code-review', '/research'];
    expect(rankBy(items, '', s => s)).toEqual(items);
    expect(rankBy(items, 're', s => s)[0]).toBe('/research');
    expect(rankBy(items, 'zzz', s => s)).toEqual([]);
  });
});
