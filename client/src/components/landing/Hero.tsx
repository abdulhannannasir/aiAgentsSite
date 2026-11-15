import { motion, type Variants } from 'framer-motion';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { HeroOrb } from '../fx/HeroOrb';
import { Magnetic } from '../fx/Magnetic';
import { HeroDemo } from './HeroDemo';
import { HoloText } from './HoloText';
import { MOD } from '../../lib/platform';
import type { Workflow } from '../../types';

const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.1, delayChildren: 0.15 } } };
const item: Variants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(8px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } }
};

// Floating agent tags around the orb. They label the roles the real workflows use; they are decoration, not live status.
const TAGS = [
  { label: 'Researcher', icon: '🔎', cls: 'left-[-2%] top-[18%]', delay: '0s' },
  { label: 'Synthesizer', icon: '📊', cls: 'right-[-4%] top-[30%]', delay: '-2s' },
  { label: 'Reviewer', icon: '✍️', cls: 'left-[-7%] top-[47%]', delay: '-4s' },
  { label: 'Coder', icon: '💻', cls: 'right-[-1%] top-[55%]', delay: '-1s' }
];

interface Props {
  agentCount: number;
  workflows: Workflow[];
  mode: 'live' | 'demo' | null;
  onLaunch: () => void;
  onSeeHow: () => void;
}

export function Hero({ agentCount, workflows, mode, onLaunch, onSeeHow }: Props) {
  const workflowCount = workflows.length;
  return (
    <section id="top" aria-labelledby="hero-title" className="relative flex min-h-[100svh] items-center overflow-hidden pb-20 pt-28 lg:[@media(max-height:800px)]:pb-12 lg:[@media(max-height:800px)]:pt-[88px]">
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative mx-auto grid w-full max-w-7xl items-center gap-8 px-5 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-4">
        <motion.div variants={container} initial="hidden" animate="show" className="min-w-0">
          <motion.p variants={item} className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-glass px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-neon-cyan">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-neon-cyan" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-neon-cyan" />
            </span>
            {mode === 'live' ? 'Live AI' : 'Demo mode'} · {agentCount || 42} agents · {workflowCount || 4} workflows
          </motion.p>

          <motion.h1 id="hero-title" variants={item} className="mt-6 font-display text-[clamp(2.7rem,7.2vw,5.8rem)] font-bold leading-[0.96] tracking-tight">
            Command a <HoloText text="swarm of AI agents" />
          </motion.h1>

          <motion.p variants={item} className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            Pick from {agentCount || 42} specialists, chain them into multi-agent workflows you can watch think, or forge your own with a
            system-prompt builder. One workspace, one keyboard shortcut away.
          </motion.p>

          <motion.div variants={item} className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-4">
            <Magnetic>
              <button type="button" onClick={onLaunch} data-testid="hero-launch"
                className="neo group flex items-center gap-2 rounded-xl bg-accent px-6 py-3.5 font-display text-sm font-bold uppercase tracking-wide text-on-accent">
                Launch workspace <ArrowRight size={16} aria-hidden className="transition-transform group-hover:translate-x-1" />
              </button>
            </Magnetic>
            <Magnetic>
              <button type="button" onClick={onSeeHow} className="rounded-xl border border-line-strong bg-glass px-6 py-3.5 font-display text-sm font-semibold transition hover:bg-hover">
                See how it works
              </button>
            </Magnetic>
            <span className="hidden items-center gap-1.5 font-mono text-xs text-muted sm:flex"><kbd>{MOD}</kbd><kbd>K</kbd> anywhere to search</span>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
          className="relative mx-auto w-full min-w-0 max-w-[560px]"
        >
          {/* The orb floats above the console and is tucked behind its top edge, so its centre stays free to hover and click.
              On screens under 800px tall the orb zone shrinks so the whole console still fits above the fold. */}
          <div className="relative z-0 mx-auto -mb-14 w-[200px] sm:w-[260px] lg:absolute lg:-top-[84px] lg:right-[-3%] lg:mb-0 lg:w-[380px] lg:[@media(max-height:800px)]:-top-[72px] lg:[@media(max-height:800px)]:w-[320px]">
            <HeroOrb />
            {TAGS.map(t => (
              <div key={t.label} aria-hidden className={`absolute ${t.cls} hidden animate-float items-center gap-1.5 rounded-lg border border-line-strong bg-glass-strong px-2.5 py-1.5 font-mono text-[11px] font-medium shadow-glow-cyan lg:flex`} style={{ animationDelay: t.delay }}>
                <span>{t.icon}</span>{t.label}
              </div>
            ))}
          </div>
          <HeroDemo workflows={workflows} onLaunch={onLaunch} className="relative z-10 lg:mt-[190px] lg:[@media(max-height:800px)]:mt-[130px]" />
        </motion.div>
      </div>

      <button type="button" onClick={onSeeHow} aria-label="Scroll to the next section" className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted transition hover:text-fg md:flex">
        Scroll <ChevronDown size={16} className="animate-float" aria-hidden />
      </button>
    </section>
  );
}
