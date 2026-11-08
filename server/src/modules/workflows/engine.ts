import type { ChatEvent, PublicWorkflow } from '../../contracts.js';
import type { Logger } from '../../lib/logger.js';
import { findAgent, type AgentDefinition } from '../agents/registry.js';
import type { LLMService } from '../providers/llm.js';
import { WORKFLOWS, type WorkflowDefinition, type WorkflowStepDefinition } from './definitions.js';

/** Fails fast at startup if a workflow points at an agent that does not exist. */
export function validateWorkflows(workflows: WorkflowDefinition[] = WORKFLOWS): void {
  for (const w of workflows) {
    for (const s of w.steps) {
      if (!findAgent(s.agentId)) throw new Error(`Workflow "${w.id}" uses unknown agent "${s.agentId}"`);
    }
  }
}

export function toPublicWorkflow(w: WorkflowDefinition): PublicWorkflow {
  return {
    id: w.id, command: w.command, name: w.name, description: w.description, icon: w.icon, promptStarter: w.promptStarter,
    steps: w.steps.map(s => {
      const a = findAgent(s.agentId)!;
      return { id: s.id, agentId: a.id, agentName: a.name, agentIcon: a.icon, agentGradient: a.gradient, role: s.role, label: s.label };
    })
  };
}

export const findWorkflow = (id: string) => WORKFLOWS.find(w => w.id === id);

interface StepOutput { role: string; agentName: string; text: string }

/** What each step is given: the user's task plus the (trimmed) output of every step before it. */
export function buildStepPrompt(task: string, outputs: StepOutput[], maxChars: number): string {
  return `Task from the user:\n${task}` + outputs.map(o =>
    `\n\n--- Output from the ${o.role} (${o.agentName}) ---\n${o.text.trim().slice(0, maxChars)}`
  ).join('');
}

function demoStepText(workflow: WorkflowDefinition, step: WorkflowStepDefinition, agent: AgentDefinition, task: string, isFinal: boolean): string {
  const topic = task.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (isFinal) {
    return `## ${workflow.name} (demo preview)\n\nThis is a canned preview of the final ${step.role} output for “${topic}”. In live mode the ${agent.name} polishes the earlier steps into the real result.\n\n- The steps above show how work is handed from agent to agent\n- Set \`GEMINI_API_KEY\` or \`OPENAI_API_KEY\` on the server to get real answers`;
  }
  return `Demo output: in live mode the ${step.role} (${agent.name}) would ${step.label.charAt(0).toLowerCase()}${step.label.slice(1)} for “${topic}”.\n\n- Placeholder point one\n- Placeholder point two\n- Placeholder point three`;
}

/**
 * Runs a workflow as real, sequential model calls and yields progress events:
 *   plan        the full list of steps, all pending
 *   step        a step became active / complete / error
 *   step_delta  text produced by an intermediate step (shown in the client's thought stream)
 *   stream      text of the FINAL step, which is the answer
 * A failing step stops the run with an honest error; it is never replaced by canned text.
 */
export async function* runWorkflow(
  workflow: WorkflowDefinition, task: string, signal: AbortSignal,
  deps: { llm: LLMService; log: Logger; maxStepContextChars: number }
): AsyncGenerator<ChatEvent> {
  const steps = workflow.steps.map(s => ({ ...s, agent: findAgent(s.agentId)! }));
  yield {
    type: 'plan', workflowId: workflow.id,
    steps: steps.map(s => ({ id: s.id, agentName: s.agent.name, agentIcon: s.agent.icon, role: s.role, label: s.label, status: 'pending' }))
  };

  const outputs: StepOutput[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const isFinal = i === steps.length - 1;
    yield { type: 'step', id: s.id, status: 'active' };

    const stepAgent = {
      ...s.agent, tools: [], temperature: undefined,
      systemPrompt: `${s.agent.systemPrompt}\n\nYou are working as the ${s.role} in a multi-agent workflow ("${workflow.name}"). ${s.instruction}`
    };
    let text = '';
    try {
      const source = deps.llm.provider === 'demo'
        ? deps.llm.demoText(demoStepText(workflow, s, s.agent, task, isFinal), signal)
        : deps.llm.complete(stepAgent, [{ role: 'user', content: buildStepPrompt(task, outputs, deps.maxStepContextChars) }], signal, { strict: true });
      for await (const chunk of source) {
        if (signal.aborted) return;
        text += chunk;
        yield isFinal ? { type: 'stream', content: chunk } : { type: 'step_delta', id: s.id, content: chunk };
      }
      if (!text.trim()) throw new Error('empty step output');
    } catch (err) {
      if (signal.aborted) return;
      deps.log.error({ workflow: workflow.id, step: s.id, err: err instanceof Error ? err.message : String(err) }, 'workflow step failed');
      yield { type: 'step', id: s.id, status: 'error', error: 'This step failed.' };
      yield { type: 'error', content: `The ${s.role} step failed, so the workflow stopped. Please try again.` };
      return;
    }
    outputs.push({ role: s.role, agentName: s.agent.name, text });
    yield { type: 'step', id: s.id, status: 'complete' };
  }
}
