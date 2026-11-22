import { describe, expect, it } from 'vitest';
import { compileGraph, evaluateCondition, extractPath, renderTemplate, templateVars, topoOrder, validateGraph, type Graph, type GraphContext } from '../src/modules/studio/graph.js';
import { STARTER, TEMPLATES } from '../src/modules/studio/templates.js';
import { graphContext } from '../src/modules/studio/context.js';
import { createToolRegistry } from '../src/modules/tools/registry.js';

const ctx: GraphContext = graphContext(createToolRegistry());
type Node = Graph['nodes'][number];
const n = (id: string, kind: string, config: Record<string, unknown> = {}, label = id): Node => ({ id, kind, label, position: { x: 0, y: 0 }, config });
const e = (source: string, target: string, sourceHandle?: 'true' | 'false') => ({ id: `${source}-${target}-${sourceHandle ?? ''}`, source, target, ...(sourceHandle && { sourceHandle }) });
const errors = (g: unknown) => validateGraph(g, ctx).issues.filter(i => i.severity === 'error').map(i => i.message);
const warnings = (g: unknown) => validateGraph(g, ctx).issues.filter(i => i.severity === 'warning').map(i => i.message);

describe('graph validation', () => {
  it('accepts every template and the starter graph', () => {
    for (const t of TEMPLATES) expect(errors(t.graph), t.id).toEqual([]);
    expect(errors(STARTER)).toEqual([]);
    expect(TEMPLATES.map(t => t.id)).toEqual(['research', 'code-review', 'legal-draft', 'brainstorm', 'support-triage', 'reviewed-post']);
  });

  it('requires exactly one input, an output, and no loops', () => {
    expect(errors({ nodes: [], edges: [] })).toEqual([expect.stringContaining('empty')]);
    expect(errors({ nodes: [n('a', 'template', { text: 'x' })], edges: [] })).toEqual(expect.arrayContaining([expect.stringContaining('Add a Manual input'), expect.stringContaining('Add an Output')]));
    expect(errors({ nodes: [n('i', 'input'), n('j', 'input'), n('o', 'output')], edges: [e('i', 'o'), e('j', 'o')] })).toContain('Use exactly one Manual input.');
    const loop = { nodes: [n('i', 'input'), n('a', 'template', { text: '{{input}}' }), n('b', 'template', { text: 'x' }), n('o', 'output')], edges: [e('i', 'a'), e('a', 'b'), e('b', 'a'), e('b', 'o')] };
    expect(errors(loop)).toContain('The connections form a loop. Workflows must flow in one direction.');
  });

  it('flags disconnected steps, self-loops, duplicate ids and unknown or planned kinds', () => {
    const g = {
      nodes: [n('i', 'input'), n('a', 'template', { text: 'x' }, 'A'), n('o', 'output'), n('o', 'output'), n('k', 'integration', {}, 'Act'), n('z', 'mystery', {}, 'Z')],
      edges: [e('i', 'o'), e('o', 'o'), e('i', 'k'), e('i', 'z')]
    };
    const errs = errors(g);
    expect(errs).toEqual(expect.arrayContaining([
      'Two steps use the id "o".', '"A" has no incoming connection.', '"o" is connected to itself.',
      '"Act": Integration action is not available yet. Needs connected integrations (Phase 8).', '"Z" has an unknown type "mystery".'
    ]));
  });

  it('checks node settings, agents, tool permissions and availability', () => {
    const g = {
      nodes: [
        n('i', 'input'),
        n('a', 'agent', { agentId: 'nope', prompt: 'x' }, 'A'),
        n('b', 'agent', { agentId: 'translator', prompt: 'x', tools: ['url_fetch'] }, 'B'),
        n('c', 'agent', { agentId: 'coding-assistant', prompt: 'x', tools: ['code_interpreter'] }, 'C'),
        n('t', 'tool', { toolId: 'web_search', args: { query: '{{input}}' } }, 'T'),
        n('d', 'delay', { seconds: 0 }, 'D'),
        n('o', 'output')
      ],
      edges: ['a', 'b', 'c', 't', 'd'].flatMap(x => [e('i', x), e(x, 'o')])
    };
    expect(errors(g)).toEqual(expect.arrayContaining([
      '"A": choose an agent.', '"B": Language Translator is not permitted to use url_fetch.',
      '"C": the tool code_interpreter is not available on this server.', '"T": the tool web_search is not available on this server.',
      '"D": seconds Too small: expected number to be >=1'
    ]));
  });

  it('warns that outward tools ask for approval', () => {
    const g = { nodes: [n('i', 'input'), n('f', 'tool', { toolId: 'url_fetch', args: { url: '{{input}}' } }, 'Fetch'), n('o', 'output')], edges: [e('i', 'f'), e('f', 'o')] };
    expect(errors(g)).toEqual([]);
    expect(warnings(g)).toEqual(['"Fetch" reaches outside the server, so each run asks for approval before this step.']);
  });

  it('only lets variables refer to the input and upstream steps', () => {
    const g = {
      nodes: [n('i', 'input'), n('a', 'template', { text: '{{input}} {{b}}' }, 'A'), n('b', 'template', { text: '{{a}} {{ghost}}' }, 'B'), n('o', 'output', { template: '{{a}} {{b}}' })],
      edges: [e('i', 'a'), e('a', 'b'), e('b', 'o')]
    };
    expect(errors(g)).toEqual([
      '"A" text: {{b}} is not upstream of this step, so its result is not available yet.',
      '"B" text: {{ghost}} is not a step in this workflow.'
    ]);
  });

  it('requires condition branches to use the true/false handles', () => {
    const base = [n('i', 'input'), n('c', 'condition', { operator: 'contains', value: 'x' }, 'C'), n('o', 'output')];
    expect(errors({ nodes: base, edges: [e('i', 'c'), e('c', 'o')] })).toEqual(expect.arrayContaining([expect.stringContaining('must start at its true or false handle')]));
    expect(errors({ nodes: base, edges: [e('i', 'c', 'true'), e('c', 'o', 'true')] })).toContain('Only conditions have true/false handles ("i").');
    expect(errors({ nodes: base, edges: [e('i', 'c'), e('c', 'o', 'false')] })).toEqual([]);
    const badRegex = { nodes: [n('i', 'input'), n('c', 'condition', { operator: 'matches', value: '(' }, 'C'), n('o', 'output')], edges: [e('i', 'c'), e('c', 'o', 'true')] };
    expect(errors(badRegex)).toEqual(['"C": the pattern is not a valid regular expression.']);
  });
});

describe('graph compilation', () => {
  it('orders tasks topologically and records branches, joins and variables', () => {
    const triage = TEMPLATES.find(t => t.id === 'support-triage')!;
    const tasks = compileGraph(triage.graph, ctx);
    expect(tasks.map(t => [t.key, t.nodeId, t.kind, t.dependsOn])).toEqual([
      ['T1', 'message', 'input', []], ['T2', 'classify', 'llm', ['T1']], ['T3', 'is_bug', 'condition', ['T2']],
      ['T4', 'bug_report', 'agent', ['T3']], ['T5', 'reply', 'agent', ['T3']], ['T6', 'merge', 'merge', ['T4', 'T5']], ['T7', 'result', 'output', ['T6']]
    ]);
    expect(tasks[3].config.branches).toEqual({ T3: 'true' });
    expect(tasks[4].config.branches).toEqual({ T3: 'false' });
    expect(tasks[5].config.join).toBe('any');
    expect(tasks[6].config.join).toBe('any');
    expect(tasks[3]).toMatchObject({ agentId: 'coding-assistant', tools: [] });
    expect(tasks[0].config.vars).toMatchObject({ message: 'T1', classify: 'T2', result: 'T7' });
  });

  it('refuses to compile a graph with errors', () => {
    expect(() => compileGraph({ nodes: [], edges: [] }, ctx)).toThrow('Invalid workflow');
  });

  it('keeps a stable order among independent steps', () => {
    expect(topoOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ source: 'c', target: 'a' }])).toEqual(['b', 'c', 'a']);
  });
});

describe('runtime helpers', () => {
  it('renders templates and lists variables', () => {
    expect(renderTemplate('Hi {{ input }}, {{a}}{{missing}}!', { input: 'you', a: 'A' })).toBe('Hi you, A!');
    expect(templateVars('{{a}} {{ b }} {{a}} {{Not}}')).toEqual(['a', 'b']);
  });

  it.each([
    ['A crash on start', 'contains', 'CRASH', false, true],
    ['A crash on start', 'contains', 'CRASH', true, false],
    ['ok', 'not_contains', 'bug', false, true],
    [' BUG ', 'equals', 'bug', false, true],
    ['x', 'not_equals', 'x', false, false],
    ['order #123', 'matches', '#\\d+', false, true],
    ['   ', 'is_empty', '', false, true],
    ['text', 'not_empty', '', false, true],
    ['hello', 'longer_than', '3', false, true]
  ] as const)('condition %j %s %j', (value, op, operand, cs, expected) => {
    expect(evaluateCondition(value, op, operand, cs)).toBe(expected);
  });

  it('extracts JSON paths from fenced or plain text', () => {
    expect(extractPath('Here:\n```json\n{"items":[{"name":"Ada"}]}\n```', 'items.0.name')).toBe('Ada');
    expect(extractPath('[1, {"a": {"b": 2}}]', '1.a')).toBe('{\n  "b": 2\n}');
    expect(() => extractPath('no json', 'a')).toThrow('No JSON found');
    expect(() => extractPath('{"a":1}', 'b')).toThrow('The JSON has no "b".');
    expect(() => extractPath('{oops}', 'a')).toThrow('not valid JSON');
  });
});
