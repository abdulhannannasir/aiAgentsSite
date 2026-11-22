import type { Sample } from './demoRun';

/**
 * The recorded run the hero replays the first time it scrolls into view. It follows the real /research workflow
 * (same three agents, roles and step labels as workflows.js) so what plays is what a live run looks like.
 *
 * It contains no statistics or sources on purpose: it is hand-written, not model output, and it is always
 * labelled "Sample run" in the UI. A live run replaces it with a genuine one.
 */
export const RESEARCH_SAMPLE: Sample = {
  workflowId: 'research',
  task: 'Remote-first vs office-first for a 12-person startup',
  steps: [
    {
      id: 'gather',
      agentName: 'Market Research Agent',
      agentIcon: '🔎',
      role: 'Researcher',
      label: 'Collect key facts, angles and open questions',
      text: [
        '- Remote-first widens the hiring pool and trims office costs; office-first speeds up onboarding and informal learning',
        '- Hybrid is the usual middle ground, but without written norms it splits the team into two classes',
        '- Variables that matter: role mix, time-zone spread, seniority, how much work is exploratory',
        '- Open questions: what must the team decide together every week? where do handoffs break today?'
      ].join('\n')
    },
    {
      id: 'synthesize',
      agentName: 'Data Analyst Agent',
      agentIcon: '📊',
      role: 'Synthesizer',
      label: 'Structure the findings into a draft',
      text: [
        'Draft outline',
        '1. Summary: no universal winner; it depends on how much work needs fast, in-person back-and-forth',
        '2. Findings: hiring reach vs onboarding speed, cost vs cohesion, autonomy vs oversight',
        '3. Risks: unwritten rules, time-zone sprawl, proximity bias',
        '4. Next step: pilot one model for a quarter and measure two things'
      ].join('\n')
    },
    {
      id: 'review',
      agentName: 'AI Content Writer',
      agentIcon: '✍️',
      role: 'Reviewer',
      label: 'Check structure and formatting, write the final brief',
      text: [
        '## Remote-first vs office-first',
        '',
        '**Bottom line:** at 12 people there is no universal winner. Choose by how much of your work needs fast, in-person back-and-forth.',
        '',
        '- **Remote-first** widens hiring and trims overhead, but onboarding takes deliberate effort.',
        '- **Office-first** speeds up onboarding and decisions, but narrows who you can hire.',
        '- **Hybrid** only works with written norms, otherwise it splits the team in two.',
        '',
        '**Next step:** pilot one model for a quarter and track time-to-decision and new-hire ramp time.',
        '',
        '_To verify: check any productivity claim against your own data._'
      ].join('\n')
    }
  ]
};

/**
 * One-line example tasks per built-in workflow, so Run works with a single click. A workflow that isn't listed
 * starts with an empty field. The research example is the one the recorded sample was made for.
 */
export const EXAMPLE_TASKS: Record<string, string> = {
  research: RESEARCH_SAMPLE.task,
  'code-review': 'for (var i = 0; i < items.length; i++) { total += items[i].price * qty }',
  'legal-draft': 'a mutual NDA between two small software companies',
  brainstorm: 'names for a weekly podcast about AI agents'
};
