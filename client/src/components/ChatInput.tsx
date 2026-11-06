import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Square, X } from 'lucide-react';
import { SlashCommandMenu } from './SlashCommandMenu';
import { workflowIcon } from './AgentAvatar';
import { rankBy } from '../lib/search';
import type { Workflow } from '../types';

interface Props {
  value: string;
  onChange: (value: string) => void;
  workflow: Workflow | null;
  onWorkflowChange: (workflow: Workflow | null) => void;
  workflows: Workflow[];
  onSend: () => void;
  onStop: () => void;
  sending: boolean;
  agentName: string;
  inputRef: RefObject<HTMLTextAreaElement>;
}

export function ChatInput({ value, onChange, workflow, onWorkflowChange, workflows, onSend, onStop, sending, agentName, inputRef }: Props) {
  const listId = useId();
  const [active, setActive] = useState(0);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const caretToEnd = useRef(false);

  // "/" followed by word characters, and nothing else yet, opens the workflow menu.
  const slash = !workflow ? /^\/([\w-]*)$/.exec(value) : null;
  const query = slash?.[1] ?? '';
  const matches = useMemo(() => rankBy(workflows, query, w => `${w.command.slice(1)} ${w.name}`), [workflows, query]);
  const menuOpen = !!slash && dismissedFor !== value;
  useEffect(() => setActive(0), [query]);

  // grow with the text, up to a limit
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    if (caretToEnd.current) {
      el.setSelectionRange(el.value.length, el.value.length);
      caretToEnd.current = false;
    }
  }, [value, inputRef]);

  const select = (w: Workflow) => {
    onWorkflowChange(w);
    caretToEnd.current = true;
    onChange(w.promptStarter);
    setDismissedFor(null);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (menuOpen && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); select(matches[Math.min(active, matches.length - 1)]); return; }
    }
    if (menuOpen && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissedFor(value); return; }
    if (e.key === 'Backspace' && workflow && value === '') { onWorkflowChange(null); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sending && value.trim()) onSend();
    }
  };

  const canSend = !!value.trim() && !sending;
  const WfIcon = workflow ? workflowIcon(workflow.icon) : null;

  return (
    <div className="border-t border-line bg-black/5 p-3 dark:bg-black/25 sm:p-4">
      <div className="relative mx-auto max-w-4xl">
        <SlashCommandMenu open={menuOpen} workflows={matches} activeIndex={active} listId={listId} onSelect={select} onHover={setActive} />

        <AnimatePresence initial={false}>
          {workflow && WfIcon && (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden" data-testid="workflow-chip"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs">
                <WfIcon size={14} className="text-accent" aria-hidden />
                <span className="font-semibold">{workflow.name}</span>
                <span className="font-mono text-muted">{workflow.command}</span>
                <span className="flex items-center gap-1 text-muted" aria-label={`Team: ${workflow.steps.map(s => `${s.role} ${s.agentName}`).join(', ')}`}>
                  {workflow.steps.map((s, i) => (
                    <span key={s.id} className="flex items-center gap-1" title={`${s.role}: ${s.agentName}`}>
                      {i > 0 && <span aria-hidden>→</span>}
                      <span className="rounded-full border border-line bg-[var(--glass-strong)] px-1.5 py-0.5">{s.agentIcon} {s.role}</span>
                    </span>
                  ))}
                </span>
                <button type="button" onClick={() => onWorkflowChange(null)} aria-label="Remove workflow" className="ml-auto rounded-md p-1 text-muted transition hover:bg-hover hover:text-fg">
                  <X size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="glass relative flex items-end gap-2 rounded-2xl px-3 py-2 transition focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            maxLength={4000}
            onChange={e => { setDismissedFor(null); onChange(e.target.value); }}
            onKeyDown={onKeyDown}
            placeholder={workflow ? `Describe the task for the ${workflow.name} team…` : `Message ${agentName}… type / for workflows`}
            aria-label="Message"
            role="combobox"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={menuOpen && matches.length ? `${listId}-opt-${active}` : undefined}
            className="max-h-[200px] min-h-[28px] flex-1 resize-none bg-transparent py-1.5 text-base outline-none placeholder:text-muted focus-visible:outline-none"
          />
          {sending ? (
            <button type="button" onClick={onStop} aria-label="Stop generating" className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/90 text-white transition hover:bg-rose-500 active:scale-95">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button type="button" onClick={onSend} disabled={!canSend} aria-label="Send message" className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition enabled:hover:brightness-110 enabled:active:scale-95 disabled:opacity-40">
              <Send size={16} />
            </button>
          )}
        </div>
        <p className="mt-1.5 hidden text-[11px] text-muted sm:block">
          <kbd>/</kbd> workflows · <kbd>Enter</kbd> send · <kbd>Shift</kbd> + <kbd>Enter</kbd> new line
        </p>
      </div>
    </div>
  );
}
