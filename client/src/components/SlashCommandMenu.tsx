import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { workflowIcon } from './AgentAvatar';
import type { Workflow } from '../types';

interface Props {
  open: boolean;
  workflows: Workflow[];
  activeIndex: number;
  listId: string;
  onSelect: (workflow: Workflow) => void;
  onHover: (index: number) => void;
}

/** Floating autocomplete of multi-agent workflows, shown above the composer when the user types "/". */
export function SlashCommandMenu({ open, workflows, activeIndex, listId, onSelect, onHover }: Props) {
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [activeIndex, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98 }}
          transition={{ duration: 0.14 }}
          className="glass bg-glass-strong absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl shadow-float"
        >
          <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Multi-agent workflows</div>
          {workflows.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">No workflow matches. Keep typing, or press Esc.</p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Workflows" className="max-h-64 overflow-y-auto py-1">
              {workflows.map((w, i) => {
                const Icon = workflowIcon(w.icon);
                const active = i === activeIndex;
                return (
                  <li
                    key={w.id}
                    ref={active ? activeRef : undefined}
                    id={`${listId}-opt-${i}`}
                    role="option"
                    aria-selected={active}
                    data-testid="slash-option"
                    onMouseEnter={() => onHover(i)}
                    onMouseDown={e => { e.preventDefault(); onSelect(w); }}
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${active ? 'bg-accent/10' : ''}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"><Icon size={16} aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="font-mono text-sm font-semibold">{w.command}</span>
                        <span className="truncate text-sm">{w.name}</span>
                      </span>
                      <span className="block truncate text-xs text-muted">{w.description}</span>
                    </span>
                    <span className="flex -space-x-1.5" title={w.steps.map(s => `${s.role}: ${s.agentName}`).join(' → ')} aria-label={`Team: ${w.steps.map(s => s.agentName).join(', ')}`}>
                      {w.steps.map(s => (
                        <span key={s.id} className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-[var(--glass-strong)] text-xs">{s.agentIcon}</span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[11px] text-muted">
            <span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
            <span><kbd>Enter</kbd> select</span>
            <span><kbd>Esc</kbd> dismiss</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
