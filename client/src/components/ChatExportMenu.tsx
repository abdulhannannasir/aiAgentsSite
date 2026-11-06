import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ClipboardCopy, FileDown, Share2 } from 'lucide-react';

interface Props {
  disabled: boolean;
  onCopy: () => void;
  onDownload: () => void;
}

interface Item { id: string; icon: ReactNode; label: string; hint: string; run: () => void }

/** "Export" action menu for a chat thread: copy as Markdown, or download a .md file. */
export function ChatExportMenu({ disabled, onCopy, onDownload }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const items: Item[] = [
    { id: 'copy', icon: <ClipboardCopy size={15} />, label: 'Copy as Markdown', hint: 'To your clipboard', run: onCopy },
    { id: 'download', icon: <FileDown size={15} />, label: 'Download .md', hint: 'Markdown file', run: onDownload }
  ];

  const close = (returnFocus = true) => { setOpen(false); if (returnFocus) button.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="glass flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition enabled:hover:bg-hover disabled:opacity-40"
      >
        <Share2 size={14} aria-hidden /> <span className="hidden sm:inline">Export</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menu}
            role="menu"
            aria-label="Export chat"
            onKeyDown={onMenuKey}
            initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.13 }}
            className="glass bg-glass-strong absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl p-1 shadow-float"
          >
            {items.map(item => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => { item.run(); close(false); }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-hover focus-visible:bg-hover"
              >
                <span className="text-accent">{item.icon}</span>
                <span>
                  <span className="block font-medium">{item.label}</span>
                  <span className="block text-[11px] text-muted">{item.hint}</span>
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
