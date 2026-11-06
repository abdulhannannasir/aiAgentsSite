import { motion } from 'framer-motion';
import { ArrowRight, BookOpen, Keyboard } from 'lucide-react';
import { Magnetic } from '../fx/Magnetic';
import { HoloText } from './HoloText';

interface Props {
  mode: 'live' | 'demo' | null;
  onLaunch: () => void;
  onOpenBuilder: () => void;
  onOpenDocs: () => void;
  onOpenShortcuts: () => void;
}

export function CtaFooter({ mode, onLaunch, onOpenBuilder, onOpenDocs, onOpenShortcuts }: Props) {
  return (
    <>
      <section aria-labelledby="cta-title" className="relative mx-auto max-w-5xl px-5 pb-24 pt-8 text-center sm:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="glass bg-glass-strong relative overflow-hidden rounded-[2rem] px-6 py-16 sm:px-12">
          <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 opacity-40" />
          <h2 id="cta-title" className="relative font-display text-[clamp(2rem,5vw,3.8rem)] font-bold leading-[1.02] tracking-tight">
            Ready to run <HoloText text="your own swarm?" />
          </h2>
          <p className="relative mx-auto mt-4 max-w-lg text-muted">
            {mode === 'live' ? 'Live AI is on: every agent answers with a real model.' : 'Demo mode is on: explore everything without an API key.'} Nothing to install, no account.
          </p>
          <div className="relative mt-9 flex flex-wrap items-center justify-center gap-4">
            <Magnetic>
              <button type="button" onClick={onLaunch} data-testid="cta-launch" className="neo group flex items-center gap-2 rounded-xl bg-accent px-7 py-4 font-display text-sm font-bold uppercase tracking-wide text-on-accent">
                Launch workspace <ArrowRight size={16} aria-hidden className="transition-transform group-hover:translate-x-1" />
              </button>
            </Magnetic>
            <Magnetic>
              <button type="button" onClick={onOpenBuilder} className="rounded-xl border border-line-strong bg-glass px-7 py-4 font-display text-sm font-semibold transition hover:bg-hover">Build an agent</button>
            </Magnetic>
          </div>
        </motion.div>
      </section>

      <footer className="relative border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-muted sm:px-8">
          <p className="font-display"><span className="font-bold text-fg">Agent<span className="text-neon-cyan">Verse</span></span> · React, Three.js, GSAP, Express</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onOpenDocs} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition hover:bg-hover hover:text-fg"><BookOpen size={14} aria-hidden /> Docs</button>
            <button type="button" onClick={onOpenShortcuts} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition hover:bg-hover hover:text-fg"><Keyboard size={14} aria-hidden /> Shortcuts</button>
          </div>
        </div>
      </footer>
    </>
  );
}
