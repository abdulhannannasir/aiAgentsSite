import { BookOpen, Keyboard, Moon, Plus, Search, Sun } from 'lucide-react';
import { Magnetic } from './fx/Magnetic';
import { MOD } from '../lib/platform';
import type { Theme } from '../types';

interface Props {
  agentCount: number;
  mode: 'live' | 'demo' | null;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
  onOpenDocs: () => void;
  onCreateAgent: () => void;
  onHome: () => void;
}

const icon = 'flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-fg active:scale-95';

export function Navbar(p: Props) {
  return (
    <header className="glass sticky top-0 z-30 border-x-0 border-t-0">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-6">
        <button type="button" onClick={p.onHome} aria-label="AgentVerse home" title="Back to the home page" className="flex min-w-0 items-center gap-3 rounded-xl text-left">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-gradient-to-br from-neon-cyan/30 to-neon-violet/30 text-xl">🤖</span>
          <span className="min-w-0">
            <span className="block font-display text-lg font-bold leading-tight tracking-tight">Agent<span className="text-neon-cyan">Verse</span></span>
            <span className="hidden truncate font-mono text-[11px] uppercase tracking-wider text-muted sm:block">{p.agentCount || 42} agents · workflows · builder</span>
          </span>
        </button>

        <button type="button" onClick={p.onOpenPalette} aria-label="Open command palette" data-testid="palette-button"
          className="glass ml-auto flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted transition hover:bg-hover hover:text-fg sm:ml-6 sm:w-72 md:w-80">
          <Search size={15} aria-hidden />
          <span className="hidden flex-1 text-left sm:block">Search or run a command…</span>
          <span className="hidden items-center gap-1 sm:flex"><kbd>{MOD}</kbd><kbd>K</kbd></span>
        </button>

        <div className="flex items-center gap-0.5 sm:ml-auto sm:gap-1">
          {p.mode && (
            <span data-testid="mode-badge" className="mr-1 hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-muted md:flex">
              <span className={`h-2 w-2 rounded-full ${p.mode === 'live' ? 'animate-pulse bg-neon-cyan shadow-[0_0_8px_rgb(var(--neon-cyan))]' : 'bg-amber-500'}`} />
              {p.mode === 'live' ? 'Live AI' : 'Demo mode'}
            </span>
          )}
          <Magnetic strength={0.25} radius={40}>
            <button type="button" onClick={p.onCreateAgent} className="neo hidden h-9 items-center gap-1.5 rounded-lg bg-accent px-3 font-display text-xs font-bold uppercase tracking-wide text-on-accent md:flex" aria-label="Create a new agent">
              <Plus size={15} aria-hidden /> New agent
            </button>
          </Magnetic>
          <button type="button" onClick={p.onOpenShortcuts} className={icon} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"><Keyboard size={18} /></button>
          <button type="button" onClick={p.onOpenDocs} className={icon} aria-label="Open documentation" title="Documentation"><BookOpen size={18} /></button>
          <button type="button" onClick={p.onToggleTheme} className={icon} aria-label={`Switch to ${p.theme === 'dark' ? 'light' : 'dark'} theme`} title="Toggle theme">
            {p.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </div>
    </header>
  );
}
