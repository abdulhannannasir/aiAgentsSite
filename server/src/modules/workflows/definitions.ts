// Multi-agent workflows. Each one is a real pipeline: every step is a separate model call made as one
// of the registered agents (plus a role instruction), and each step sees the user's task and the output
// of the steps before it. The last step's output is the answer; earlier outputs are shown in the
// client's "Thought stream". Nothing here pretends to have tools the app doesn't have: there is no
// live web access, so research steps rely on the model's own knowledge and say so.

export interface WorkflowStepDefinition {
  id: string;
  agentId: string;
  role: string;
  label: string;
  instruction: string;
  final?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  command: string;
  name: string;
  description: string;
  icon: string;
  promptStarter: string;
  steps: WorkflowStepDefinition[];
}

const HONESTY = 'You have no live web or tool access; rely on well-established knowledge and clearly flag anything that should be verified.';

export const WORKFLOWS: WorkflowDefinition[] = [
  {
    id: 'research',
    command: '/research',
    name: 'Deep Research Brief',
    description: 'Researcher, synthesizer and editor turn a topic into a structured brief.',
    icon: 'search',
    promptStarter: 'Research this topic in depth: ',
    steps: [
      { id: 'gather', agentId: 'research-agent', role: 'Researcher', label: 'Collect key facts, angles and open questions',
        instruction: `List the key facts, figures, trends, stakeholders, competing viewpoints and open questions about the topic. Be concrete. ${HONESTY} Output a compact bullet list, no preamble.` },
      { id: 'synthesize', agentId: 'data-analyst', role: 'Synthesizer', label: 'Structure the findings into a draft',
        instruction: 'Turn the research into a structured draft: executive summary, key findings, a comparison table if it helps, risks and unknowns, and recommended next steps. Keep every claim traceable to the research above; do not add new facts.' },
      { id: 'review', agentId: 'content-writer', role: 'Reviewer', label: 'Check structure and formatting, write the final brief', final: true,
        instruction: 'Review the draft for clarity, structure, accuracy of tone and formatting. Fix problems and output ONLY the final brief in clean Markdown with headings. Keep any "to verify" flags.' }
    ]
  },
  {
    id: 'code-review',
    command: '/code-review',
    name: 'Code Review',
    description: 'Bug and security pass, fixes with code, then a prioritised action list.',
    icon: 'code',
    promptStarter: 'Review this code:\n',
    steps: [
      { id: 'analyze', agentId: 'coding-assistant', role: 'Reviewer', label: 'Find bugs, security issues and performance problems',
        instruction: 'Review the code or description above. List concrete problems: correctness bugs, security issues, performance, readability. Reference the relevant lines or snippets. Do not rewrite the code yet.' },
      { id: 'fix', agentId: 'coding-assistant', role: 'Fixer', label: 'Propose fixes with corrected code',
        instruction: 'For each problem found, propose a specific fix and show the corrected code in fenced code blocks. Keep changes minimal and explain each in one line.' },
      { id: 'prioritize', agentId: 'project-manager', role: 'Prioritizer', label: 'Rank the work and write the summary', final: true,
        instruction: 'Write the final review in Markdown: a 2-3 line verdict, then a prioritised action list (Critical / Important / Nice to have) with the fixes from above, and suggested tests. Keep the code blocks.' }
    ]
  },
  {
    id: 'legal-draft',
    command: '/legal-draft',
    name: 'Legal Drafting',
    description: 'Considerations, a first draft, then a compliance and risk check.',
    icon: 'scale',
    promptStarter: 'Draft a legal document or clause for: ',
    steps: [
      { id: 'considerations', agentId: 'legal-researcher', role: 'Researcher', label: 'Identify legal considerations and key terms',
        instruction: `Identify the legal considerations, standard terms, jurisdiction questions and common pitfalls for this request. ${HONESTY} State assumptions explicitly. This is not legal advice.` },
      { id: 'draft', agentId: 'contract-specialist', role: 'Drafter', label: 'Write a first draft',
        instruction: 'Write a clear first draft of the document or clause, using placeholders like [PARTY A] and [JURISDICTION] where facts are missing. Add short drafting notes where choices matter.' },
      { id: 'compliance', agentId: 'compliance-officer', role: 'Compliance Checker', label: 'Check risks and compliance, finalise', final: true,
        instruction: 'Review the draft for compliance, risk and missing protections. Output the final version in Markdown, followed by a short "Risks and open points" list. End with: "This is a draft for discussion, not legal advice; have a qualified lawyer review it."' }
    ]
  },
  {
    id: 'brainstorm',
    command: '/brainstorm',
    name: 'Brainstorm',
    description: 'Wide idea generation, a critical pass, then a shortlist with next steps.',
    icon: 'lightbulb',
    promptStarter: 'Brainstorm ideas for: ',
    steps: [
      { id: 'ideate', agentId: 'content-writer', role: 'Idea Generator', label: 'Generate a wide range of ideas',
        instruction: 'Generate 10 distinct ideas, mixing safe and bold. One line each, numbered. No evaluation yet.' },
      { id: 'critique', agentId: 'research-agent', role: 'Critic', label: 'Stress-test the ideas',
        instruction: 'Evaluate each idea briefly: strengths, risks, effort (low/medium/high) and who it is for. Group similar ideas. Be candid.' },
      { id: 'shortlist', agentId: 'ceo-assistant', role: 'Strategist', label: 'Pick the top three and plan next steps', final: true,
        instruction: 'Pick the three strongest ideas and explain why in Markdown. For each give the first three concrete next steps and one metric to watch. Mention which ideas you would drop and why.' }
    ]
  }
];
