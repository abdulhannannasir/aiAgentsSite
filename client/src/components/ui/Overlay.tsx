import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

/* ------------------------------------------------------------------ Drawer */

function DrawerPanel({ title, side, onClose, children, width }: { title: string; side: 'left' | 'right'; onClose: () => void; children: ReactNode; width: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const from = side === 'left' ? '-100%' : '100%';
  return (
    <div className="fixed inset-0 z-[65]">
      <motion.div aria-hidden className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose} />
      <motion.div
        ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        initial={{ x: from }} animate={{ x: 0 }} exit={{ x: from }} transition={{ type: 'spring', stiffness: 420, damping: 40 }}
        className={clsx('glass bg-glass-strong absolute inset-y-0 flex max-w-[92vw] flex-col shadow-float', width, side === 'left' ? 'left-0 border-y-0 border-l-0' : 'right-0 border-y-0 border-r-0')}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={titleId} className="truncate font-display text-base font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted transition hover:bg-hover hover:text-fg"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </motion.div>
    </div>
  );
}

/** A side panel dialog (focus trapped, Esc and backdrop close it). */
export function Drawer({ open, onClose, title, side = 'right', width = 'w-[420px]', children }: { open: boolean; onClose: () => void; title: string; side?: 'left' | 'right'; width?: string; children: ReactNode }) {
  return createPortal(
    <AnimatePresence>{open && <DrawerPanel key="drawer" title={title} side={side} onClose={onClose} width={width}>{children}</DrawerPanel>}</AnimatePresence>,
    document.body
  );
}

/* ------------------------------------------------------------------ Menu */

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  hint?: string;
}

/**
 * A dropdown menu: button with aria-haspopup, role="menu" list, arrow keys / Home / End to move, Esc or a click
 * outside to close, focus returns to the button.
 */
export function Menu({ label, trigger, items, header, align = 'right', triggerClassName }: { label: string; trigger: ReactNode; items: MenuItem[]; header?: ReactNode; align?: 'left' | 'right'; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const enabled = useCallback(() => Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not([aria-disabled=true])') ?? []), []);
  const close = useCallback((refocus = true) => { setOpen(false); if (refocus) button.current?.focus(); }, []);

  useEffect(() => {
    if (!open) return;
    enabled()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, enabled, close]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const items = enabled();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === 'Tab') close(false);
  };

  return (
    <div className="relative">
      <button
        ref={button} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
        className={triggerClassName ?? 'flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-fg'}
      >
        {trigger}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={list} id={menuId} role="menu" aria-label={label} onKeyDown={onKeyDown}
            initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }}
            className={clsx('glass bg-glass-strong absolute top-full z-50 mt-2 w-64 overflow-hidden rounded-xl py-1 shadow-float', align === 'right' ? 'right-0' : 'left-0')}
          >
            {header && <div className="border-b border-line px-3 py-2.5">{header}</div>}
            {items.map(item => (
              <button
                key={item.id} type="button" role="menuitem" tabIndex={-1} aria-disabled={item.disabled || undefined} title={item.hint}
                onClick={() => { if (item.disabled) return; close(false); item.onSelect?.(); }}
                className={clsx('flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm outline-none transition', item.disabled ? 'cursor-not-allowed text-muted/70' : 'hover:bg-hover focus:bg-hover')}
              >
                {item.icon && <span aria-hidden className="text-muted">{item.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {item.hint && <span className="block truncate text-[11px] text-muted">{item.hint}</span>}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ Popover */

/** A non-modal panel anchored to a button (e.g. notifications). Esc / outside click closes it. */
export function Popover({ label, trigger, children, triggerClassName }: { label: string; trigger: ReactNode; children: ReactNode; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="relative">
      <button ref={button} type="button" aria-label={label} title={label} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(o => !o)}
        className={triggerClassName ?? 'flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-fg'}>
        {trigger}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div ref={panel} id={id} role="region" aria-label={label} tabIndex={-1}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
            className="glass bg-glass-strong absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl p-4 shadow-float outline-none">
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ Tooltip */

/** A hover/focus tooltip. The trigger keeps its own accessible name; the tip adds a description. */
export function Tooltip({ tip, children, side = 'top' }: { tip: string; children: ReactNode; side?: 'top' | 'right' }) {
  const id = useId();
  return (
    <span className="group/tip relative inline-flex" aria-describedby={id}>
      {children}
      <span id={id} role="tooltip"
        className={clsx('pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-line bg-glass-strong px-2 py-1 text-xs text-fg opacity-0 shadow-float transition group-focus-within/tip:opacity-100 group-hover/tip:opacity-100',
          side === 'top' ? 'bottom-full left-1/2 mb-2 -translate-x-1/2' : 'left-full top-1/2 ml-2 -translate-y-1/2')}>
        {tip}
      </span>
    </span>
  );
}
