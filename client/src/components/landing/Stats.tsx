import { useMemo, useRef } from 'react';
import { gsap, ScrollTrigger, useParallax, useScrollFx } from '../../hooks/useScrollFx';
import { AGENT_TEMPLATES } from '../../lib/templates';
import type { Agent, Workflow } from '../../types';

interface Props { agents: Agent[]; workflows: Workflow[] }

/** Real numbers only: everything here is counted from the live agent registry, workflow list and template gallery. */
export function Stats({ agents, workflows }: Props) {
  const root = useRef<HTMLElement>(null);
  const categories = useMemo(() => [...new Set(agents.map(a => a.category))], [agents]);
  const stats = [
    { n: agents.length || 42, label: 'Pre-built agents', hint: 'each with its own system prompt and tools' },
    { n: categories.length || 8, label: 'Categories', hint: 'from engineering to legal' },
    { n: workflows.length || 4, label: 'Multi-agent workflows', hint: 'research, code review, legal, brainstorm' },
    { n: AGENT_TEMPLATES.length, label: 'Agent templates', hint: 'one click to a custom agent' }
  ];

  // Count up when scrolled into view. The final number is always in the DOM for screen readers and reduced motion.
  useScrollFx(root, ({ motion }) => {
    if (!root.current) return;
    root.current.querySelectorAll<HTMLElement>('[data-count]').forEach(el => {
      const target = Number(el.dataset.count);
      if (!motion) { el.textContent = String(target); return; }
      el.textContent = '0';
      const o = { v: 0 };
      ScrollTrigger.create({
        trigger: el, start: 'top 88%', once: true,
        onEnter: () => { gsap.to(o, { v: target, duration: 1.8, ease: 'power3.out', onUpdate: () => { el.textContent = String(Math.round(o.v)); } }); }
      });
    });
  }, [stats.map(s => s.n).join(',')]);
  useParallax(root);

  const loop = categories.length ? categories : ['Coding', 'Research', 'Legal', 'Marketing', 'Support', 'Finance', 'HR', 'Product'];
  return (
    <section ref={root} id="stats" aria-label="AgentVerse by the numbers" className="relative overflow-hidden py-24 sm:py-28">
      <div aria-hidden data-parallax="0.3" className="pointer-events-none absolute -left-32 top-10 h-96 w-96 rounded-full bg-neon-violet/10 blur-[100px]" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-4">
          {stats.map(s => (
            <div key={s.label} className="border-t border-line-strong pt-5">
              <dt className="order-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{s.label}</dt>
              <dd className="mt-3 font-display text-[clamp(3rem,7vw,5.5rem)] font-bold leading-none tracking-tight text-neon-cyan text-glow">
                <span aria-hidden data-count={s.n}>{s.n}</span>
                <span className="sr-only">{s.n}</span>
                <span className="mt-3 block font-sans text-sm font-normal normal-case tracking-normal text-muted [text-shadow:none]">{s.hint}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Category ticker: decorative, so hidden from assistive tech; paused on hover; still when motion is reduced. */}
      <div aria-hidden className="relative mt-20 overflow-hidden border-y border-line py-4 [mask-image:linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]">
        <div className="flex w-max animate-marquee gap-10 whitespace-nowrap font-display text-2xl font-semibold uppercase tracking-wide text-fg/30 hover:[animation-play-state:paused]">
          {[...loop, ...loop].map((c, i) => <span key={i} className="flex items-center gap-10">{c}<span className="text-neon-violet/60">◆</span></span>)}
        </div>
      </div>
    </section>
  );
}
