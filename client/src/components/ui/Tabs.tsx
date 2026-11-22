import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import clsx from 'clsx';

export interface TabDef<T extends string> {
  id: T;
  label: ReactNode;
  count?: number;
}

/**
 * WAI-ARIA tabs with automatic activation: arrow keys / Home / End move between tabs, only the selected tab is
 * in the Tab order. Render the panel yourself with `tabPanelProps(id, selectedTab)`.
 */
export function Tabs<T extends string>({ id: base, label, tabs, value, onChange }: { id: string; label: string; tabs: TabDef<T>[]; value: T; onChange: (id: T) => void }) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.findIndex(t => t.id === value);
    const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current.get(tabs[next].id)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map(t => {
        const selected = t.id === value;
        return (
          <button
            key={t.id} ref={el => { if (el) refs.current.set(t.id, el); }}
            type="button" role="tab" id={`${base}-${t.id}`} aria-selected={selected} aria-controls={`${base}-${t.id}-panel`} tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={clsx('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition', selected ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}
          >
            {t.label}
            {t.count !== undefined && <span className="rounded-full bg-hover px-1.5 font-mono text-[10px] tabular-nums">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export const tabPanelProps = (tabsBaseId: string, id: string) => ({ role: 'tabpanel', id: `${tabsBaseId}-${id}-panel`, 'aria-labelledby': `${tabsBaseId}-${id}`, tabIndex: 0 });

/** A simple, horizontally scrollable data table. */
export function Table({ caption, columns, rows, empty }: { caption: string; columns: Array<{ key: string; label: string; className?: string }>; rows: Array<Record<string, ReactNode> & { key: string }>; empty?: ReactNode }) {
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[480px] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-hover font-mono text-[11px] uppercase tracking-wider text-muted">
          <tr>{columns.map(c => <th key={c.key} scope="col" className={clsx('px-3 py-2 font-medium', c.className)}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-t border-line">
              {columns.map(c => <td key={c.key} className={clsx('px-3 py-2 align-top', c.className)}>{r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
