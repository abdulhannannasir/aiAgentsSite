import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { Modal } from './Modal';
import { rankBy } from '../lib/search';
import type { Command } from '../types';

const MAX_RESULTS = 60;

function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const activeRef = useRef<HTMLLIElement>(null);

  const results = useMemo(
    () => rankBy(commands, query, c => `${c.label} ${c.group} ${c.keywords ?? ''}`).slice(0, MAX_RESULTS),
    [commands, query]
  );
  useEffect(() => setActive(0), [query]);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    // let the dialog finish closing (and give focus back) before the command moves focus elsewhere
    window.setTimeout(c.run, 0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (results.length ? (i + 1) % results.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (results.length ? (i - 1 + results.length) % results.length : 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(0, results.length - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[active]); }
  };

  // Group headers only while browsing; a search shows one ranked list.
  let lastGroup = '';

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search size={18} className="shrink-0 text-muted" aria-hidden />
        <input
          data-autofocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search agents, workflows and actions…"
          aria-label="Search commands"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted focus-visible:outline-none"
        />
        <kbd>Esc</kbd>
      </div>

      <ul id={listId} role="listbox" aria-label="Commands" className="max-h-[52vh] overflow-y-auto p-2">
        {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">No results for “{query}”</li>}
        {results.map((c, i) => {
          const header = !query && c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          const isActive = i === active;
          return (
            <li key={c.id} ref={isActive ? activeRef : undefined} role="presentation">
              {header && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{header}</div>}
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isActive}
                data-testid="palette-item"
                onMouseMove={() => setActive(i)}
                onClick={() => run(c)}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${isActive ? 'bg-accent/10' : ''}`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isActive ? 'bg-accent text-white' : 'bg-hover text-muted'}`}>{c.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.label}</span>
                  {c.hint && <span className="block truncate text-xs text-muted">{c.hint}</span>}
                </span>
                {query && <span className="hidden shrink-0 text-[11px] text-muted sm:block">{c.group}</span>}
                {c.shortcut && <kbd>{c.shortcut}</kbd>}
                {isActive && <CornerDownLeft size={14} className="shrink-0 text-muted" aria-hidden />}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-[11px] text-muted">
        <span className="flex gap-3"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> run</span></span>
        <span aria-live="polite">{results.length} result{results.length === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}

export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  return (
    <Modal open={open} onClose={onClose} title="Command palette" placement="top" size="lg" bare>
      {open && <Palette commands={commands} onClose={onClose} />}
    </Modal>
  );
}
