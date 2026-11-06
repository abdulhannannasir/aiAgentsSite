import { Modal } from './Modal';
import { MOD } from '../lib/platform';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-1.5">
    <h3 className="text-sm font-bold">{title}</h3>
    <div className="space-y-2 text-sm leading-relaxed text-muted [&_strong]:text-fg [&_code]:rounded [&_code]:bg-hover [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-fg">{children}</div>
  </section>
);

export function DocsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Documentation" description="Everything AgentVerse can do, in one page." size="lg">
      <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5" data-testid="docs">
        <Section title="Getting started">
          <p>Pick one of the 42 agents on the left and start chatting. Each agent has its own conversation, so you can switch back and forth without losing your place. Press <code>{MOD}+K</code> to search for agents and actions.</p>
        </Section>
        <Section title="Multi-agent workflows">
          <p>Type <code>/</code> in the chat box to see workflows: <strong>/research</strong>, <strong>/code-review</strong>, <strong>/legal-draft</strong> and <strong>/brainstorm</strong>. Each one runs a real pipeline of separate model calls as different agents, and every step sees the output of the steps before it. The last step writes the answer.</p>
          <p>Workflows run on the model's own knowledge. There is no live web access, so research output should be verified.</p>
        </Section>
        <Section title="Thought stream">
          <p>Every reply has a collapsible <strong>Thought stream</strong> showing which agent did what, in order, with a status for each step (Pending, Active, Complete or Failed) and the text each step produced. It is what actually happened, not a summary.</p>
        </Section>
        <Section title="Your own agents">
          <p>Use <strong>New</strong> in <em>My agents</em> to build an agent: a name, a system prompt, a temperature and tool permissions. Start from a template to avoid writing a prompt from scratch. Custom agents are saved in this browser only.</p>
          <p>Tool permissions are simulated in this demo: nothing is actually searched, run or sent.</p>
        </Section>
        <Section title="Export and import agents">
          <p><strong>Export</strong> downloads a <code>.json</code> file; <strong>Import</strong> loads one into the editor so you can review it before saving. Files look like:</p>
          <pre className="overflow-auto rounded-lg border border-line bg-[var(--code-bg)] p-3 text-xs text-fg">{`{
  "schema": "agentverse.agent",
  "version": 1,
  "agent": {
    "name": "My Agent",
    "description": "…",
    "icon": "🤖",
    "systemPrompt": "You are…",
    "temperature": 0.7,
    "tools": ["web_search"]
  }
}`}</pre>
        </Section>
        <Section title="Export a chat">
          <p>Use <strong>Export</strong> in the chat header to copy the conversation as Markdown or download it as a <code>.md</code> file. The thought stream of each reply is included.</p>
        </Section>
        <Section title="Privacy and limits">
          <p>Messages are sent to the server, which forwards them to the AI provider. Conversations and custom agents stay in your browser; nothing is stored on the server. Requests are rate limited (about 20 per minute), and a workflow counts as one request per step. Without an API key the app runs in demo mode with canned replies.</p>
        </Section>
      </div>
    </Modal>
  );
}
