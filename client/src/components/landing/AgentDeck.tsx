import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { AgentAvatar } from '../AgentAvatar';
import { STATUS_META, StatusChip, type AgentStatus } from '../fx/AgentStatus';
import { Magnetic } from '../fx/Magnetic';
import { TiltCard } from '../fx/TiltCard';
import { SectionHeading } from './SectionHeading';
import type { Agent } from '../../types';

const CYCLE: AgentStatus[] = ['active', 'training', 'idle', 'idle', 'active', 'training'];
const ORDER: AgentStatus[] = ['active', 'training', 'idle'];

interface Props {
  agents: Agent[];
  onOpenAgent: (id: string) => void;
  onLaunch: () => void;
}

/**
 * Six real agents as floating 3D cards. The cards lean toward the cursor, light their border under it, and glow in
 * their status colour. The statuses here are a visual preview of the three states (the legend lets you try each);
 * in the workspace itself an agent shows Active only while it is actually generating a reply.
 */
export function AgentDeck({ agents, onOpenAgent, onLaunch }: Props) {
  const [forced, setForced] = useState<AgentStatus | null>(null);
  const featured = useMemo(() => [...agents].sort((a, b) => Number(b.mostUsed) - Number(a.mostUsed)).slice(0, 6), [agents]);

  return (
    <section id="agents" aria-labelledby="deck-title" className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
      <SectionHeading index="01" label="The roster" title={<span id="deck-title">{agents.length || 42} specialists. Zero setup.</span>}>
        From a Full-Stack Coding Assistant to a Contract Review Specialist, every agent ships with its own system prompt, tools and personality.
        Hover a card: they react.
      </SectionHeading>

      <div className="mt-8 flex flex-wrap items-center gap-2" role="group" aria-label="Preview an agent status">
        <span className="mr-1 font-mono text-[11px] uppercase tracking-wider text-muted">Preview state</span>
        {ORDER.map(s => (
          <button key={s} type="button" aria-pressed={forced === s} onClick={() => setForced(f => (f === s ? null : s))}
            className={`rounded-full transition ${forced === s ? 'ring-2 ring-accent' : 'opacity-80 hover:opacity-100'}`}>
            <StatusChip status={s} />
          </button>
        ))}
        {forced && <button type="button" onClick={() => setForced(null)} className="font-mono text-[11px] uppercase tracking-wider text-muted underline-offset-2 hover:underline">Reset</button>}
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-7" data-testid="agent-deck">
        {(featured.length ? featured : Array.from({ length: 6 }, () => null)).map((a, i) => {
          const status = forced ?? CYCLE[i % CYCLE.length];
          return (
            <motion.div key={a?.id ?? i} initial={{ opacity: 0, y: 36 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-8% 0px' }} transition={{ duration: 0.7, delay: (i % 3) * 0.08, ease: [0.22, 1, 0.36, 1] }}>
              {a ? (
                <TiltCard as="button" status={status} glowIdle cursorLabel="Open" onClick={() => onOpenAgent(a.id)} aria-label={`Open ${a.name} in the workspace (${STATUS_META[status].label} preview)`} data-agent-card={a.id} className="h-full">
                  <span className="block p-5">
                    <span className="flex items-start justify-between gap-3">
                      <span className="block [transform:translateZ(38px)]"><AgentAvatar icon={a.icon} gradient={a.gradient} size={52} /></span>
                      <span className="block [transform:translateZ(22px)]"><StatusChip status={status} /></span>
                    </span>
                    <span className="mt-4 block font-display text-lg font-semibold leading-snug [transform:translateZ(26px)]">{a.name}</span>
                    <span className="mt-1.5 line-clamp-2 block text-sm leading-relaxed text-muted [transform:translateZ(14px)]">{a.description}</span>
                    <span className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3 font-mono text-[11px] uppercase tracking-wider [transform:translateZ(18px)]">
                      <span className="truncate text-muted">{a.category}</span>
                      <span className="flex shrink-0 items-center gap-1 text-neon-cyan">Open <ArrowRight size={12} aria-hidden /></span>
                    </span>
                  </span>
                </TiltCard>
              ) : (
                <div className="glass h-[210px] animate-pulse rounded-2xl" aria-hidden />
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mt-10 flex justify-center">
        <Magnetic>
          <button type="button" onClick={onLaunch} className="group flex items-center gap-2 rounded-xl border border-line-strong bg-glass px-6 py-3.5 font-display text-sm font-semibold transition hover:bg-hover">
            Browse all {agents.length || 42} agents <ArrowRight size={16} aria-hidden className="transition-transform group-hover:translate-x-1" />
          </button>
        </Magnetic>
      </div>
    </section>
  );
}
