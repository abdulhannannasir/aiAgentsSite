import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { AgentAvatar } from '../AgentAvatar';
import { CollabGraph, type GraphStep } from '../fx/CollabGraph';
import { StatusChip, type AgentStatus } from '../fx/AgentStatus';
import { gsap, ScrollTrigger, useMatchMedia, useScrollFx } from '../../hooks/useScrollFx';
import { SectionHeading } from './SectionHeading';
import type { Agent, Workflow } from '../../types';

interface Props { agents: Agent[]; workflows: Workflow[] }

const FALLBACK_STEPS = [
  { id: 'a', agentIcon: '🔎', role: 'Researcher', agentName: 'Research Agent' },
  { id: 'b', agentIcon: '📊', role: 'Synthesizer', agentName: 'Data Analyst' },
  { id: 'c', agentIcon: '✍️', role: 'Reviewer', agentName: 'Content Writer' }
];

/* ----- the three visuals ----------------------------------------------------------------------------------------- */

function AgentsVisual({ agents }: { agents: Agent[] }) {
  const list = agents.slice(0, 3);
  const status: AgentStatus[] = ['active', 'training', 'idle'];
  return (
    <div className="relative h-full w-full">
      <span aria-hidden data-depth="0.6" className="pointer-events-none absolute -left-2 top-2 select-none font-display text-[15rem] font-bold leading-none text-transparent [-webkit-text-stroke:1px_rgb(var(--neon-cyan)/0.28)]">{agents.length || 42}</span>
      {(list.length ? list : [null, null, null]).map((a, i) => (
        <div key={a?.id ?? i} data-depth={0.5 + i * 0.5}
          className="glass bg-glass-strong absolute w-[78%] rounded-2xl p-4 shadow-float"
          style={{ top: `${6 + i * 29}%`, left: `${4 + i * 14}%`, transform: `rotate(${-4 + i * 3}deg)` }}>
          <div className="flex items-center gap-3">
            {a ? <AgentAvatar icon={a.icon} gradient={a.gradient} size={42} /> : <div className="h-[42px] w-[42px] rounded-xl bg-hover" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-display font-semibold">{a?.name ?? 'Agent'}</p>
              <p className="truncate font-mono text-[11px] uppercase tracking-wider text-muted">{a?.category ?? 'Category'}</p>
            </div>
            <StatusChip status={status[i]} />
          </div>
        </div>
      ))}
    </div>
  );
}

function FlowVisual({ workflow, running }: { workflow?: Workflow; running: boolean }) {
  const steps = workflow?.steps ?? FALLBACK_STEPS.map(s => ({ ...s, agentId: s.id, agentGradient: '', label: '' }));
  // Loop a preview: each tick one more step finishes and the next goes active, then it resets.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick(t => (t + 1) % (steps.length + 2)), 1400);
    return () => window.clearInterval(id);
  }, [running, steps.length]);
  const graph: GraphStep[] = steps.map((s, i) => ({
    id: s.id, icon: s.agentIcon, role: s.role, name: s.agentName,
    status: tick > steps.length ? 'pending' : i < tick ? 'complete' : i === tick && tick < steps.length ? 'active' : tick >= steps.length ? 'complete' : 'pending'
  }));
  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <div data-depth="0.5" className="glass bg-glass-strong rounded-2xl p-6 shadow-float">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-wider text-muted">{workflow ? `${workflow.command} · ${workflow.name}` : 'Workflow'} · preview</p>
        <CollabGraph steps={graph} />
      </div>
      <div data-depth="1.1" className="glass ml-auto w-[88%] rounded-xl p-4 font-mono text-xs leading-relaxed text-muted">
        <span className="text-neon-cyan">▸</span> each step is a separate model call<br />
        <span className="text-neon-violet">▸</span> step N reads the output of steps 1…N-1<br />
        <span className="text-neon-magenta">▸</span> a failed step stops the run
      </div>
    </div>
  );
}

function ForgeVisual() {
  const k = 'text-neon-violet', s = 'text-emerald-300', n = 'text-amber-300', p = 'text-muted';
  return (
    <div className="relative h-full w-full">
      <div data-depth="0.5" className="glass bg-glass-strong absolute inset-x-0 top-[4%] rounded-2xl p-5 font-mono text-[12.5px] leading-[1.75] shadow-float">
        <div className="mb-3 flex items-center gap-1.5" aria-hidden><i className="h-2.5 w-2.5 rounded-full bg-rose-400/80" /><i className="h-2.5 w-2.5 rounded-full bg-amber-400/80" /><i className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" /><span className="ml-2 text-[11px] text-muted">legal-reviewer.agent.json</span></div>
        <pre className="overflow-x-auto whitespace-pre"><code>
          <span className={p}>{'{'}</span>{'\n'}
          {'  '}<span className={k}>"schema"</span><span className={p}>: </span><span className={s}>"agentverse.agent"</span><span className={p}>,</span>{'\n'}
          {'  '}<span className={k}>"agent"</span><span className={p}>: {'{'}</span>{'\n'}
          {'    '}<span className={k}>"name"</span><span className={p}>: </span><span className={s}>"Legal Reviewer"</span><span className={p}>,</span>{'\n'}
          {'    '}<span className={k}>"systemPrompt"</span><span className={p}>: </span><span className={s}>"You are a careful…"</span><span className={p}>,</span>{'\n'}
          {'    '}<span className={k}>"temperature"</span><span className={p}>: </span><span className={n}>0.3</span><span className={p}>,</span>{'\n'}
          {'    '}<span className={k}>"tools"</span><span className={p}>: [</span><span className={s}>"knowledge_base"</span><span className={p}>]</span>{'\n'}
          {'  '}<span className={p}>{'}'}</span>{'\n'}
          <span className={p}>{'}'}</span><span className="animate-caret-blink text-neon-cyan">▍</span>
        </code></pre>
      </div>
      <div data-depth="1.2" className="glass bg-glass-strong absolute bottom-[4%] right-0 flex items-center gap-3 rounded-xl px-4 py-3 shadow-float">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted">Temperature</span>
        <span className="relative h-1.5 w-28 rounded-full bg-hover"><span className="absolute inset-y-0 left-0 w-[15%] rounded-full bg-gradient-to-r from-neon-cyan to-neon-violet" /></span>
        <span className="font-mono text-xs text-neon-cyan">0.3</span>
      </div>
    </div>
  );
}

/* ----- the section ----------------------------------------------------------------------------------------------- */

export function Story({ agents, workflows }: Props) {
  const pinned = useMatchMedia('(min-width: 1024px) and (prefers-reduced-motion: no-preference)');
  const categories = useMemo(() => new Set(agents.map(a => a.category)).size, [agents]);
  const root = useRef<HTMLElement>(null);
  const pinEl = useRef<HTMLDivElement>(null);
  const trigger = useRef<ScrollTrigger | null>(null);
  const [active, setActive] = useState(0);
  const featuredFlow = workflows.find(w => w.id === 'research') ?? workflows[0];

  const STEPS = [
    { n: '01', title: 'Pick a specialist', body: `${agents.length || 42} agents across ${categories || 8} categories, from a Full-Stack Coding Assistant to a Contract Review Specialist. Each one has its own system prompt, tools and personality.` },
    { n: '02', title: 'Chain them into a workflow', body: 'Type / in any chat and run Research, Code review, Legal draft or Brainstorm. A team of agents hands the work along, and you can watch every step think in the Thought stream.' },
    { n: '03', title: 'Forge your own', body: 'Write a system prompt, set the temperature, choose tools, or start from one of four templates. Export the agent as JSON and import it anywhere.' }
  ];
  const visual = (i: number) => (i === 0 ? <AgentsVisual agents={agents} /> : i === 1 ? <FlowVisual workflow={featuredFlow} running={!pinned || active === 1} /> : <ForgeVisual />);

  // Pinned, scrubbed storytelling (desktop, motion allowed): scrolling cross-fades the copy and visuals, and the
  // depth layers inside each visual drift at different speeds.
  useScrollFx(root, ({ motion, desktop }) => {
    if (!motion || !desktop || !root.current || !pinEl.current) return;
    const copies = gsap.utils.toArray<HTMLElement>('[data-copy]', root.current);
    const visuals = gsap.utils.toArray<HTMLElement>('[data-visual]', root.current);
    if (copies.length < 3 || visuals.length < 3) return;
    gsap.set([...copies.slice(1), ...visuals.slice(1)], { autoAlpha: 0 });

    const tl = gsap.timeline({
      defaults: { ease: 'power2.inOut' },
      // The timeline's own onUpdate runs on every scrubbed frame, so the tab always matches what is on screen
      // (a ScrollTrigger onUpdate fires only on scroll events, and would lag the smoothed scrub).
      onUpdate: () => { const t = tl.time(); setActive(t < 0.6 ? 0 : t < 1.6 ? 1 : 2); },
      scrollTrigger: { trigger: root.current, start: 'top top', end: '+=300%', pin: pinEl.current, scrub: 0.7, anticipatePin: 1 }
    });
    for (let i = 1; i < 3; i++) {
      tl.to(copies[i - 1], { autoAlpha: 0, y: -30, duration: 0.4 }, i - 0.35)
        .fromTo(copies[i], { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.5 }, i - 0.2)
        .to(visuals[i - 1], { autoAlpha: 0, scale: 0.94, duration: 0.4 }, i - 0.35)
        .fromTo(visuals[i], { autoAlpha: 0, scale: 1.06 }, { autoAlpha: 1, scale: 1, duration: 0.5 }, i - 0.2);
    }
    tl.to({}, { duration: 0.3 }); // hold the last step for a beat
    visuals.forEach(v => v.querySelectorAll<HTMLElement>('[data-depth]').forEach(el => {
      const d = parseFloat(el.dataset.depth || '0.5');
      tl.fromTo(el, { yPercent: 7 * d }, { yPercent: -7 * d, ease: 'none', duration: tl.duration() }, 0);
    }));
    trigger.current = tl.scrollTrigger ?? null;
  }, [pinned, agents.length]);

  const jump = (i: number) => {
    const st = trigger.current;
    if (!st) return;
    const dur = 2.3;
    window.scrollTo({ top: st.start + (st.end - st.start) * (i / dur), behavior: 'smooth' });
  };

  if (!pinned) {
    // Phones, tablets and reduced motion: three stacked cards, no pinning or scroll hijack.
    return (
      <section id="story" ref={root} aria-labelledby="story-title" className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8">
        <SectionHeading index="02" label="How it works" title={<span id="story-title">Three moves from idea to swarm.</span>} />
        <div className="mt-10 space-y-8">
          {STEPS.map((s, i) => (
            <motion.article key={s.n} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-10% 0px' }} transition={{ duration: 0.6 }} className="glass rounded-3xl p-6">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-neon-cyan">Step {s.n}</p>
              <h3 className="mt-2 font-display text-2xl font-bold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              <div className="relative mt-6 h-[300px] overflow-hidden">{visual(i)}</div>
            </motion.article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section id="story" ref={root} aria-labelledby="story-title" className="relative">
      <div ref={pinEl} className="relative flex min-h-screen items-center overflow-hidden">
        <div aria-hidden data-testid="story-glow" className="pointer-events-none absolute left-1/2 top-1/2 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-neon-violet/10 blur-[110px]" />
        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-14 px-8 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-neon-cyan"><span className="text-muted">[02]</span> How it works</p>
            <h2 id="story-title" className="mt-3 font-display text-[clamp(2rem,4.2vw,3.2rem)] font-bold leading-[1.02] tracking-tight">Three moves from idea to swarm.</h2>

            <ol className="mt-8 flex gap-3" aria-label="Steps">
              {STEPS.map((s, i) => (
                <li key={s.n}>
                  <button type="button" onClick={() => jump(i)} aria-current={active === i ? 'step' : undefined} data-testid={`story-tab-${i}`}
                    className={clsx('rounded-lg border px-3 py-1.5 font-mono text-xs transition', active === i ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan' : 'border-line text-muted hover:text-fg')}>
                    {s.n}
                  </button>
                </li>
              ))}
            </ol>

            <div className="relative mt-7 h-[230px]">
              {STEPS.map((s, i) => (
                <div key={s.n} data-copy data-testid={`story-copy-${i}`} className="absolute inset-0">
                  <h3 className="font-display text-3xl font-bold leading-tight">{s.title}</h3>
                  <p className="mt-3 max-w-md text-base leading-relaxed text-muted">{s.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative h-[480px]" style={{ perspective: 1200 }}>
            {STEPS.map((s, i) => (
              <div key={s.n} data-visual data-testid={`story-visual-${i}`} className="absolute inset-0">{visual(i)}</div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
