import { useLayoutEffect, useRef, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, MessageSquarePlus, Sparkles } from 'lucide-react';
import { AgentAvatar, workflowIcon } from './AgentAvatar';
import { ChatExportMenu } from './ChatExportMenu';
import { ChatInput } from './ChatInput';
import { MessageBubble } from './MessageBubble';
import { StatusChip } from './fx/AgentStatus';
import { CollabGraph } from './fx/CollabGraph';
import { useStreamActivity } from '../hooks/useStreamActivity';
import { MOD } from '../lib/platform';
import type { ActiveAgent, Message, Workflow } from '../types';

interface Props {
  agent: ActiveAgent | null;
  messages: Message[];
  streaming: boolean;
  workflows: Workflow[];
  value: string;
  workflow: Workflow | null;
  onValueChange: (value: string) => void;
  onWorkflowChange: (workflow: Workflow | null) => void;
  onSend: () => void;
  onStop: () => void;
  onNewChat: () => void;
  onBack: () => void;
  onCopyChat: () => void;
  onDownloadChat: () => void;
  inputRef: RefObject<HTMLTextAreaElement>;
}

export function ChatWindow(p: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const last = p.messages[p.messages.length - 1];
  const tail = `${p.messages.length}:${last?.content.length ?? 0}:${last?.trace?.map(s => s.output.length + s.status).join('') ?? ''}`;
  // Real throughput of the running reply (final text plus every intermediate step), for the waveform.
  const streamedChars = (last?.content.length ?? 0) + (last?.trace?.reduce((n, s) => n + s.output.length, 0) ?? 0);
  const level = useStreamActivity(streamedChars, p.streaming);
  const team = p.streaming && last?.role === 'assistant' && (last.trace?.length ?? 0) > 1 ? last.trace : undefined;

  // Follow the conversation, but don't yank the view if the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom || last?.role === 'user') el.scrollTop = el.scrollHeight;
  }, [tail, last?.role]);

  if (!p.agent) {
    return (
      <div className="glass flex h-full min-h-[320px] flex-col items-center justify-center rounded-2xl px-6 py-12 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full border border-line-strong bg-accent/10 text-4xl shadow-glow-cyan">👋</div>
        <h2 className="font-display text-2xl font-bold">Select an AI agent</h2>
        <p className="mt-2 max-w-sm text-sm text-muted">Pick one on the left, or press <kbd>{MOD}</kbd> <kbd>K</kbd> to search. Type <kbd>/</kbd> in any chat to run a multi-agent workflow.</p>
      </div>
    );
  }

  const { agent } = p;
  return (
    <section aria-label={`Chat with ${agent.name}`} className="glass flex h-[78dvh] min-h-[420px] flex-col overflow-hidden rounded-2xl shadow-float lg:h-full">
      <header className="flex items-center gap-3 border-b border-line px-3 py-3 sm:px-5">
        <button type="button" onClick={p.onBack} aria-label="Back to agents" className="rounded-lg p-1.5 text-muted transition hover:bg-hover hover:text-fg lg:hidden">
          <ArrowLeft size={18} />
        </button>
        <AgentAvatar icon={agent.icon} gradient={agent.gradient} size={42} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-base font-bold leading-tight">{agent.name}</h2>
          <p className="truncate text-xs text-muted">{agent.subtitle}</p>
        </div>
        {/* Real state: Active only while this agent is generating a reply. */}
        <StatusChip status={p.streaming ? 'active' : 'idle'} className="hidden sm:inline-flex" />
        <button type="button" onClick={p.onNewChat} className="glass flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition hover:bg-hover" aria-label="New chat" title={`New chat (${MOD}+N or Alt+N)`}>
          <MessageSquarePlus size={14} aria-hidden /> <span className="hidden sm:inline">New chat</span>
        </button>
        <ChatExportMenu disabled={p.messages.length === 0} onCopy={p.onCopyChat} onDownload={p.onDownloadChat} />
      </header>

      {/* While a team of agents is working, show who is handing off to whom, live. */}
      <AnimatePresence initial={false}>
        {team && (
          <motion.div key="collab" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden border-b border-line bg-hover/30" data-testid="collab-strip">
            <div className="px-3 py-2">
              <CollabGraph compact steps={team.map(s => ({ id: s.id, icon: s.agentIcon, role: s.role, name: s.agentName, status: s.status }))} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={scroller} className="no-scrollbar flex-1 space-y-5 overflow-y-auto p-4 sm:p-6" data-testid="messages" aria-live="polite">
        {p.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <p className="max-w-sm text-sm text-muted">Say hello to {agent.name}, or hand a bigger job to a team of agents:</p>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {p.workflows.map(w => {
                const Icon = workflowIcon(w.icon);
                return (
                  <button key={w.id} type="button" onClick={() => { p.onWorkflowChange(w); p.onValueChange(w.promptStarter); p.inputRef.current?.focus(); }}
                    className="glass flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition hover:border-neon-cyan/50 hover:bg-hover active:scale-95">
                    <Icon size={14} className="text-accent" aria-hidden /> <span className="font-mono">{w.command}</span>
                    <Sparkles size={12} className="text-muted" aria-hidden />
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          p.messages.map(m => <MessageBubble key={m.id} message={m} agent={agent} />)
        )}
      </div>

      <ChatInput
        value={p.value} onChange={p.onValueChange}
        workflow={p.workflow} onWorkflowChange={p.onWorkflowChange} workflows={p.workflows}
        onSend={p.onSend} onStop={p.onStop} sending={p.streaming} level={level}
        agentName={agent.name} inputRef={p.inputRef}
      />
    </section>
  );
}
