import { Modal } from './Modal';
import { MOD } from '../lib/platform';

export const SHORTCUTS: Array<{ keys: string[][]; label: string; note?: string }> = [
  { keys: [[MOD, 'K']], label: 'Open the command palette', note: 'Switch agents, start workflows, export, change theme' },
  { keys: [['/']], label: 'Open the workflow menu', note: 'In the chat box, or anywhere to focus it' },
  { keys: [['?']], label: 'Show this cheatsheet' },
  { keys: [['Esc']], label: 'Close dialogs, menus and the command palette' },
  { keys: [[MOD, 'N'], ['Alt', 'N']], label: 'Start a new chat', note: 'Browsers often reserve ' + MOD + '+N for a new window, so Alt+N always works' },
  { keys: [['Enter']], label: 'Send the message' },
  { keys: [['Shift', 'Enter']], label: 'New line in the message' },
  { keys: [['↑'], ['↓']], label: 'Move through palette and workflow results' },
  { keys: [['Tab']], label: 'Accept the highlighted workflow' }
];

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" description="Work faster without leaving the keyboard." size="md">
      <ul className="divide-y divide-line px-5 py-2" data-testid="shortcut-list">
        {SHORTCUTS.map(s => (
          <li key={s.label} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{s.label}</p>
              {s.note && <p className="mt-0.5 text-xs text-muted">{s.note}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
              {s.keys.map((combo, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-[11px] text-muted">or</span>}
                  {combo.map((k, j) => <span key={j} className="flex items-center gap-1">{j > 0 && <span className="text-muted">+</span>}<kbd>{k}</kbd></span>)}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-5 py-3 text-xs text-muted">Tip: press <kbd>?</kbd> any time you are not typing in a text field.</p>
    </Modal>
  );
}
