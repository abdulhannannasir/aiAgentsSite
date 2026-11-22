import { WORKFLOWS } from '../workflows/definitions.js';
import type { Graph } from './graph.js';

export interface WorkflowTemplate { id: string; name: string; description: string; graph: Graph }

type N = Graph['nodes'][number];
const node = (id: string, kind: string, label: string, col: number, row: number, config: Record<string, unknown> = {}): N =>
  ({ id, kind, label, position: { x: col * 240, y: row * 120 }, config });
const edge = (source: string, target: string, sourceHandle?: 'true' | 'false') =>
  ({ id: `${source}-${sourceHandle ? `${sourceHandle}-` : ''}${target}`, source, target, ...(sourceHandle && { sourceHandle }) });

/** The four chat workflows, as graphs: each step sees the task and every earlier step's output, like the originals. */
const fromBuiltIn: WorkflowTemplate[] = WORKFLOWS.map(w => {
  const nodes: N[] = [node('input', 'input', 'Task', 0, 1)];
  const edges: Graph['edges'] = [];
  let prev = 'input';
  w.steps.forEach((s, i) => {
    const earlier = w.steps.slice(0, i).map(e => `\n\n--- Output from the ${e.role} ---\n{{${e.id}}}`).join('');
    nodes.push(node(s.id, 'agent', s.role, i + 1, 1, {
      agentId: s.agentId, tools: [],
      prompt: `Task from the user:\n{{input}}${earlier}\n\nYou are the ${s.role} in this workflow. ${s.instruction}`
    }));
    edges.push(edge(prev, s.id));
    prev = s.id;
  });
  nodes.push(node('result', 'output', 'Result', w.steps.length + 1, 1, { template: `{{${prev}}}` }));
  edges.push(edge(prev, 'result'));
  return { id: w.id, name: w.name, description: w.description, graph: { nodes, edges } };
});

const triage: WorkflowTemplate = {
  id: 'support-triage',
  name: 'Support triage',
  description: 'Classifies a message, then a bug goes to engineering for a bug report and anything else gets a support reply.',
  graph: {
    nodes: [
      node('message', 'input', 'Customer message', 0, 1),
      node('classify', 'llm', 'Classify', 1, 1, { system: 'You classify customer messages.', prompt: 'Is this message reporting a software bug? Answer with exactly one word: BUG or OTHER.\n\nMessage:\n{{input}}', temperature: 0 }),
      node('is_bug', 'condition', 'Is it a bug?', 2, 1, { source: '{{classify}}', operator: 'contains', value: 'bug', caseSensitive: false }),
      node('bug_report', 'agent', 'Write bug report', 3, 0, { agentId: 'coding-assistant', tools: [], prompt: 'Turn this customer message into a bug report: summary, steps to reproduce, expected vs actual, severity.\n\n{{input}}' }),
      node('reply', 'agent', 'Draft reply', 3, 2, { agentId: 'customer-support', tools: [], prompt: 'Write a friendly, concise reply to this customer message.\n\n{{input}}' }),
      node('merge', 'merge', 'Either branch', 4, 1, { join: 'any', separator: '\n\n' }),
      node('result', 'output', 'Result', 5, 1, { template: '' })
    ],
    edges: [edge('message', 'classify'), edge('classify', 'is_bug'), edge('is_bug', 'bug_report', 'true'), edge('is_bug', 'reply', 'false'), edge('bug_report', 'merge'), edge('reply', 'merge'), edge('merge', 'result')]
  }
};

const reviewed: WorkflowTemplate = {
  id: 'reviewed-post',
  name: 'Reviewed blog post',
  description: 'Drafts a post, waits for a person to approve the draft, then polishes it for search.',
  graph: {
    nodes: [
      node('topic', 'input', 'Topic', 0, 1),
      node('draft', 'agent', 'Draft', 1, 1, { agentId: 'content-writer', tools: [], prompt: 'Write a 500-word blog post about:\n{{input}}' }),
      node('review', 'approval', 'Approve draft', 2, 1, { message: 'Review the draft before it is polished:\n\n{{draft}}' }),
      node('polish', 'agent', 'SEO polish', 3, 1, { agentId: 'seo-specialist', tools: [], prompt: 'Improve this post for search without changing its meaning. Add a title and meta description at the top.\n\n{{draft}}' }),
      node('result', 'output', 'Post', 4, 1, { template: '{{polish}}' })
    ],
    edges: [edge('topic', 'draft'), edge('draft', 'review'), edge('review', 'polish'), edge('polish', 'result')]
  }
};

export const TEMPLATES: WorkflowTemplate[] = [...fromBuiltIn, triage, reviewed];

/** A new, empty workflow: a Manual input connected to an Output. */
export const STARTER: Graph = {
  nodes: [node('input', 'input', 'Input', 0, 1), node('result', 'output', 'Result', 2, 1, { template: '' })],
  edges: [edge('input', 'result')]
};
