import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, useInView } from 'framer-motion';
import clsx from 'clsx';
import { ArrowRight, Command, FileJson, Play, Search, Wand2 } from 'lucide-react';
import { AgentAvatar, CUSTOM_GRADIENT } from '../AgentAvatar';
import { CollabGraph, type GraphStep } from '../fx/CollabGraph';
import { Magnetic } from '../fx/Magnetic';
import { trackSpot } from '../../lib/fx/spot';
import { MOD } from '../../lib/platform';
import { SectionHeading } from './SectionHeading';
import type { AgentDraft, Workflow } from '../../types';

/* ----- tile frame ------------------------------------------------------------------------------------------------ */

function Tile({ className, eyebrow, title, children, delay = 0 }: { className?: string; eyebrow: string; title: string; children: ReactNode; delay?: number }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 34 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-8% 0px' }} transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      onPointerMove={trackSpot} data-cursor="card"
      className={clsx('spot glass bg-glass-strong group relative flex flex-col overflow-hidden rounded-3xl p-6 transition-shadow hover:shadow-glow-cyan', className)}
    >
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-neon-cyan">{eyebrow}</p>
      <h3 className="mt-2 font-display text-xl font-bold leading-tight">{title}</h3>
      {children}
    </motion.article>
  );
}

const cta = 'neo group/btn mt-5 inline-flex items-center gap-2 self-start rounded-lg bg-accent px-4 py-2.5 font-display text-xs font-bold uppercase tracking-wide text-on-accent';

/* ----- 1. system prompt builder ---------------------------------------------------------------------------------- */

const ROLES = [
  { id: 'researcher', label: 'Researcher', icon: '🔎', line: 'You are a meticulous research analyst.' },
  { id: 'reviewer', label: 'Reviewer', icon: '🛡️', line: 'You are a rigorous reviewer who finds flaws before they ship.' },
  { id: 'coder', label: 'Coder', icon: '💻', line: 'You are a senior full-stack engineer.' },
  { id: 'writer', label: 'Writer', icon: '✍️', line: 'You are a sharp, audience-aware writer.' }
] as const;
const TONES = [
  { id: 'concise', label: 'Concise', line: 'Keep answers short and direct.' },
  { id: 'friendly', label: 'Friendly', line: 'Be warm and encouraging.' },
  { id: 'formal', label: 'Formal', line: 'Use a formal, professional register.' }
] as const;
const FORMATS = [
  { id: 'bullets', label: 'Bullets', line: 'Prefer bullet points.' },
  { id: 'table', label: 'Tables', line: 'Use tables when comparing things.' },
  { id: 'prose', label: 'Prose', line: 'Write in clear paragraphs.' }
] as const;

function Chips<T extends { id: string; label: string }>({ label, items, value, onChange }: { label: string; items: readonly T[]; value: string; onChange: (id: T['id']) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-14 font-mono text-[10px] uppercase tracking-wider text-muted">{label}</span>
      {items.map(it => (
        <button key={it.id} type="button" role="radio" aria-checked={value === it.id} onClick={() => onChange(it.id)}
          className={clsx('rounded-md border px-2.5 py-1 font-mono text-[11px] transition', value === it.id ? 'border-neon-cyan bg-neon-cyan/12 text-neon-cyan' : 'border-line text-muted hover:text-fg')}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

function PromptBuilderTile({ onOpenBuilder }: { onOpenBuilder: (d: AgentDraft) => void }) {
  const [role, setRole] = useState<(typeof ROLES)[number]['id']>('researcher');
  const [tone, setTone] = useState<(typeof TONES)[number]['id']>('concise');
  const [format, setFormat] = useState<(typeof FORMATS)[number]['id']>('bullets');
  const [temp, setTemp] = useState(0.4);
  const r = ROLES.find(x => x.id === role)!, t = TONES.find(x => x.id === tone)!, f = FORMATS.find(x => x.id === format)!;
  const prompt = [r.line, t.line, f.line, 'Say so when you are unsure, and never invent sources.'].join('\n');

  return (
    <Tile className="md:col-span-2 lg:row-span-2" eyebrow="Custom system prompts" title="Build an agent in four clicks.">
      <p className="mt-2 text-sm leading-relaxed text-muted">Choose a role, tone and format. The prompt writes itself. Fine-tune it in the full builder.</p>
      <div className="mt-5 space-y-2.5">
        <Chips label="Role" items={ROLES} value={role} onChange={setRole} />
        <Chips label="Tone" items={TONES} value={tone} onChange={setTone} />
        <Chips label="Format" items={FORMATS} value={format} onChange={setFormat} />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <label htmlFor="bento-temp" className="w-14 font-mono text-[10px] uppercase tracking-wider text-muted">Temp</label>
        <input id="bento-temp" type="range" min={0} max={2} step={0.1} value={temp} onChange={e => setTemp(Number(e.target.value))} className="h-1.5 flex-1 cursor-pointer accent-[rgb(var(--neon-cyan))]" />
        <span className="w-24 font-mono text-[11px] text-neon-cyan">{temp.toFixed(1)} · {temp < 0.5 ? 'precise' : temp < 1.2 ? 'balanced' : 'creative'}</span>
      </div>
      <div className="relative mt-5 min-h-[150px] rounded-xl border border-line bg-[var(--code-bg)] p-4 font-mono text-[12.5px] leading-[1.7]" aria-live="polite">
        <span className="absolute right-3 top-2 font-mono text-[10px] uppercase tracking-wider text-muted">system prompt</span>
        <motion.pre key={prompt} initial={{ opacity: 0.25 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} data-testid="bento-prompt" className="whitespace-pre-wrap pt-3 text-fg/90">
          {prompt}<span className="animate-caret-blink text-neon-cyan">▍</span>
        </motion.pre>
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-xl border border-line p-3" data-testid="bento-agent-preview">
        <AgentAvatar icon={r.icon} gradient={CUSTOM_GRADIENT} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display font-semibold">{r.label} Agent</span>
          <span className="block truncate text-xs text-muted">Custom agent • {t.label}, {f.label.toLowerCase()}</span>
        </span>
        <span className="rounded-full border border-neon-violet/40 bg-neon-violet/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neon-violet">temp {temp.toFixed(1)}</span>
      </div>
      <Magnetic className="mt-auto self-start pt-5">
        <button type="button" className={cta.replace('mt-5 ', '')} data-testid="bento-open-builder"
          onClick={() => onOpenBuilder({ name: `${r.label} Agent`, description: `${t.label}, ${f.label.toLowerCase()}`, icon: r.icon, systemPrompt: prompt, temperature: Math.round(temp * 10) / 10, tools: [] })}>
          <Wand2 size={14} aria-hidden /> Open in the builder <ArrowRight size={14} aria-hidden className="transition-transform group-hover/btn:translate-x-1" />
        </button>
      </Magnetic>
    </Tile>
  );
}

/* ----- 2. multi-agent orchestration ------------------------------------------------------------------------------ */

const SAMPLE: Workflow = {
  id: 'sample', command: '/research', name: 'Deep Research Brief', description: '', icon: 'search', promptStarter: '',
  steps: [
    { id: 'a', agentId: 'a', agentName: 'Research Agent', agentIcon: '🔎', agentGradient: '', role: 'Researcher', label: '' },
    { id: 'b', agentId: 'b', agentName: 'Data Analyst', agentIcon: '📊', agentGradient: '', role: 'Synthesizer', label: '' },
    { id: 'c', agentId: 'c', agentName: 'Content Writer', agentIcon: '✍️', agentGradient: '', role: 'Reviewer', label: '' }
  ]
};

function OrchestrationTile({ workflows, onRunWorkflow }: { workflows: Workflow[]; onRunWorkflow: (w: Workflow) => void }) {
  const list = workflows.length ? workflows : [SAMPLE];
  const [id, setId] = useState(list[0].id);
  const wf = list.find(w => w.id === id) ?? list[0];
  const box = useRef<HTMLDivElement>(null);
  const visible = useInView(box, { amount: 0.4 });
  const [tick, setTick] = useState(0);
  useEffect(() => { setTick(0); }, [id]);
  useEffect(() => {
    if (!visible) return;
    const t = window.setInterval(() => setTick(x => (x + 1) % (wf.steps.length + 2)), 1500);
    return () => window.clearInterval(t);
  }, [visible, wf.steps.length]);
  const n = wf.steps.length;
  const steps: GraphStep[] = wf.steps.map((s, i) => ({
    id: s.id, icon: s.agentIcon, role: s.role, name: s.agentName,
    status: tick > n ? 'pending' : tick >= n ? 'complete' : i < tick ? 'complete' : i === tick ? 'active' : 'pending'
  }));

  return (
    <Tile className="md:col-span-2" eyebrow="Multi-agent orchestration" title="Teams that hand work along." delay={0.08}>
      <div ref={box} className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Workflows">
        {list.map(w => (
          <button key={w.id} type="button" role="tab" aria-selected={w.id === id} onClick={() => setId(w.id)}
            className={clsx('rounded-md border px-2.5 py-1 font-mono text-[11px] transition', w.id === id ? 'border-neon-violet bg-neon-violet/12 text-neon-violet' : 'border-line text-muted hover:text-fg')}>
            {w.command}
          </button>
        ))}
      </div>
      <div className="mt-3 flex-1 rounded-xl border border-line bg-[var(--code-bg)] px-3 py-4">
        <CollabGraph steps={steps} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">Preview of <span className="font-mono text-fg">{wf.command}</span>. Live runs make one real model call per step.</p>
        <Magnetic>
          <button type="button" className="group/btn inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 font-display text-xs font-semibold transition hover:bg-hover" onClick={() => onRunWorkflow(wf)} data-testid="bento-run-workflow">
            <Play size={13} aria-hidden /> Run it live
          </button>
        </Magnetic>
      </div>
    </Tile>
  );
}

/* ----- 3. command palette ---------------------------------------------------------------------------------------- */

function PaletteTile({ onOpenPalette }: { onOpenPalette: () => void }) {
  const rows = ['Switch to Full-Stack Coding Assistant', 'Run /research: Deep Research Brief', 'Create a new agent…'];
  return (
    <Tile eyebrow="Keyboard first" title="One shortcut for everything." delay={0.16}>
      <div className="mt-4 flex items-center gap-1.5 font-mono text-sm"><kbd className="!px-2 !py-1 !text-sm">{MOD}</kbd><kbd className="!px-2 !py-1 !text-sm">K</kbd></div>
      <ul className="mt-4 space-y-1.5" aria-hidden>
        {rows.map((r, i) => (
          <li key={r} className={clsx('flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]', i === 0 ? 'border-neon-cyan/40 bg-neon-cyan/10' : 'border-line text-muted')}>
            <Search size={11} /> <span className="truncate">{r}</span>
          </li>
        ))}
      </ul>
      <Magnetic className="mt-auto self-start pt-5">
        <button type="button" onClick={onOpenPalette} className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 font-display text-xs font-semibold transition hover:bg-hover" data-testid="bento-open-palette">
          <Command size={13} aria-hidden /> Try it now
        </button>
      </Magnetic>
    </Tile>
  );
}

/* ----- 4. portable agents ---------------------------------------------------------------------------------------- */

function PortableTile({ onOpenBuilder }: { onOpenBuilder: () => void }) {
  return (
    <Tile eyebrow="Local-first" title="Agents you can carry." delay={0.24}>
      <p className="mt-2 text-sm leading-relaxed text-muted">Your agents live in this browser: no account. Export any of them as a JSON file and import it anywhere.</p>
      <svg viewBox="0 0 220 64" className="mt-4 h-auto w-full" role="img" aria-label="An agent file moving between two browsers">
        <rect x="6" y="12" width="52" height="40" rx="8" fill="var(--code-bg)" stroke="rgb(var(--neon-cyan))" strokeOpacity="0.6" />
        <FileJson x={20} y={22} size={24} color="rgb(var(--neon-cyan))" />
        <line x1="66" y1="32" x2="154" y2="32" stroke="rgb(var(--neon-violet))" strokeWidth="2" strokeDasharray="6 6" className="animate-flow" />
        <path d="M150 26 l8 6 l-8 6" fill="none" stroke="rgb(var(--neon-violet))" strokeWidth="2" strokeLinecap="round" />
        <rect x="162" y="12" width="52" height="40" rx="8" fill="var(--code-bg)" stroke="rgb(var(--neon-violet))" strokeOpacity="0.6" />
        <FileJson x={176} y={22} size={24} color="rgb(var(--neon-violet))" />
      </svg>
      <Magnetic className="mt-auto self-start pt-4">
        <button type="button" onClick={onOpenBuilder} className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 font-display text-xs font-semibold transition hover:bg-hover">
          <FileJson size={13} aria-hidden /> Open the builder
        </button>
      </Magnetic>
    </Tile>
  );
}

/* ----- grid ------------------------------------------------------------------------------------------------------ */

interface Props {
  workflows: Workflow[];
  onRunWorkflow: (w: Workflow) => void;
  onOpenBuilder: (draft?: AgentDraft) => void;
  onOpenPalette: () => void;
}

export function BentoGrid({ workflows, onRunWorkflow, onOpenBuilder, onOpenPalette }: Props) {
  const open = useMemo(() => (d?: AgentDraft) => onOpenBuilder(d), [onOpenBuilder]);
  return (
    <section id="features" aria-labelledby="bento-title" className="relative mx-auto max-w-7xl overflow-x-clip px-5 py-24 sm:px-8 sm:py-32">
      <div aria-hidden data-parallax="0.25" className="pointer-events-none absolute -right-24 top-24 h-80 w-80 rounded-full bg-neon-cyan/10 blur-[90px]" />
      <SectionHeading index="03" label="Features" title={<span id="bento-title">Built to be played with.</span>}>
        Play with the controls below, then open the real thing with one click.
      </SectionHeading>
      <div className="mt-10 grid gap-5 md:grid-cols-2 lg:auto-rows-[minmax(220px,auto)] lg:grid-cols-4">
        <PromptBuilderTile onOpenBuilder={open} />
        <OrchestrationTile workflows={workflows} onRunWorkflow={onRunWorkflow} />
        <PaletteTile onOpenPalette={onOpenPalette} />
        <PortableTile onOpenBuilder={() => open()} />
      </div>
    </section>
  );
}
