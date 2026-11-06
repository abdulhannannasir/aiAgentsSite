import { Search } from 'lucide-react';
import { Magnetic } from '../fx/Magnetic';
import { MOD } from '../../lib/platform';

const LINKS = [
  { id: 'agents', label: 'Agents' },
  { id: 'story', label: 'How it works' },
  { id: 'features', label: 'Features' },
  { id: 'architecture', label: 'Architecture' }
];

export const scrollToSection = (id: string) => {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
};

export function LandingNav({ onLaunch, onOpenPalette }: { onLaunch: () => void; onOpenPalette: () => void }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-5">
      <nav aria-label="Primary" className="glass mx-auto flex max-w-7xl items-center gap-2 rounded-2xl px-3 py-2 sm:gap-4 sm:px-4">
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="AgentVerse, back to top" className="flex items-center gap-2.5">
          <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong bg-gradient-to-br from-neon-cyan/30 to-neon-violet/30 text-lg">🤖</span>
          <span className="font-display text-lg font-bold tracking-tight">Agent<span className="text-neon-cyan">Verse</span></span>
        </button>

        <ul className="ml-4 hidden items-center gap-1 md:flex">
          {LINKS.map(l => (
            <li key={l.id}>
              <button type="button" onClick={() => scrollToSection(l.id)} className="rounded-lg px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-muted transition hover:bg-hover hover:text-fg">{l.label}</button>
            </li>
          ))}
        </ul>

        <button type="button" onClick={onOpenPalette} aria-label="Open command palette" data-testid="landing-palette"
          className="ml-auto flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm text-muted transition hover:bg-hover hover:text-fg">
          <Search size={14} aria-hidden />
          <span className="hidden items-center gap-1 sm:flex"><kbd>{MOD}</kbd><kbd>K</kbd></span>
        </button>
        <Magnetic>
          <button type="button" onClick={onLaunch} className="neo rounded-lg bg-accent px-4 py-2 font-display text-xs font-bold uppercase tracking-wide text-on-accent">
            Launch
          </button>
        </Magnetic>
      </nav>
    </header>
  );
}
