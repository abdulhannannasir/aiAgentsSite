import { useRef } from 'react';
import { Gauge, Layers, ShieldAlert } from 'lucide-react';
import { gsap, useParallax, useScrollFx } from '../../hooks/useScrollFx';
import { SectionHeading } from './SectionHeading';

/** What actually happens to a message, in order. Mirrors server.js and the README. */
const NODES = [
  { icon: '🖥️', title: 'Browser', sub: 'holds the chat' },
  { icon: '🛡️', title: 'Rate limit', sub: 'per-IP limiter' },
  { icon: '⚙️', title: '/api/v1/chat', sub: 'validates, stateless' },
  { icon: '🧭', title: 'Workflow runner', sub: 'one call per step' },
  { icon: '🤖', title: 'Agent', sub: 'prompt + role' },
  { icon: '✨', title: 'Gemini / OpenAI', sub: 'streams tokens' }
];
const NODE_W = 126, GAP = 40, X0 = 12, Y = 60, NODE_H = 84;
const nx = (i: number) => X0 + i * (NODE_W + GAP);

const NOTES = [
  { Icon: Layers, title: 'Stateless by design', body: 'The browser sends the recent history with each message and the server keeps nothing between requests, so any instance can answer any request.' },
  { Icon: Gauge, title: 'Guarded', body: 'Requests are rate-limited per IP, and a workflow counts one request per step. Hosts like Vercel can add an edge rule on top.' },
  { Icon: ShieldAlert, title: 'Honest failures', body: 'If a workflow step fails, the run stops and that step shows Failed. Nothing is replaced with made-up output.' }
];

export function Architecture() {
  const root = useRef<HTMLElement>(null);
  useParallax(root);

  // Scrubbed with the scrollbar: nodes rise in and the links draw themselves one after another.
  useScrollFx(root, ({ motion }) => {
    const el = root.current;
    if (!motion || !el) return;
    const nodes = gsap.utils.toArray<SVGGElement>('[data-arch-node]', el);
    const links = gsap.utils.toArray<SVGPathElement>('[data-arch-link]', el);
    const ret = el.querySelector<SVGPathElement>('[data-arch-return]');
    if (!nodes.length) return;
    gsap.set(nodes, { autoAlpha: 0, y: 18 });
    [...links, ...(ret ? [ret] : [])].forEach(l => { const len = l.getTotalLength(); gsap.set(l, { strokeDasharray: len, strokeDashoffset: len }); });
    const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: el.querySelector('[data-arch-stage]'), start: 'top 78%', end: 'bottom 45%', scrub: 0.8 } });
    nodes.forEach((n, i) => {
      tl.to(n, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out' }, i * 0.7);
      if (links[i]) tl.to(links[i], { strokeDashoffset: 0, duration: 0.6 }, i * 0.7 + 0.35);
    });
    if (ret) tl.to(ret, { strokeDashoffset: 0, duration: 2.2 }, nodes.length * 0.7);
  });

  return (
    <section ref={root} id="architecture" aria-labelledby="arch-title" className="relative mx-auto max-w-7xl overflow-x-clip px-5 py-24 sm:px-8 sm:py-32">
      <div aria-hidden data-parallax="0.2" className="pointer-events-none absolute right-0 top-32 h-72 w-72 rounded-full bg-neon-magenta/10 blur-[100px]" />
      <SectionHeading index="04" label="Architecture" title={<span id="arch-title">Follow one message through the machine.</span>}>
        No black box. This is the whole path, from your keystroke to the last streamed token.
      </SectionHeading>

      {/* Wide screens: one diagram, drawn as you scroll. */}
      <div data-arch-stage className="glass bg-glass-strong mt-12 hidden overflow-hidden rounded-3xl p-6 md:block">
        <svg viewBox="0 0 980 300" role="img" aria-label="Architecture: browser, rate limit, chat API, workflow runner, agent, model provider, with the reply streaming back to the browser" className="block h-auto w-full">
          <defs>
            <linearGradient id="arch-grad" x1="0" x2="1"><stop offset="0" stopColor="rgb(var(--neon-cyan))" /><stop offset="1" stopColor="rgb(var(--neon-violet))" /></linearGradient>
          </defs>
          {NODES.slice(0, -1).map((_, i) => (
            <path key={i} data-arch-link d={`M${nx(i) + NODE_W} ${Y + NODE_H / 2} H${nx(i + 1)}`} stroke="url(#arch-grad)" strokeWidth="2" fill="none" strokeLinecap="round" />
          ))}
          <path data-arch-return d={`M${nx(5) + NODE_W / 2} ${Y + NODE_H} C${nx(5) + NODE_W / 2} 262, ${nx(0) + NODE_W / 2} 262, ${nx(0) + NODE_W / 2} ${Y + NODE_H + 4}`} stroke="rgb(var(--neon-magenta))" strokeWidth="2" fill="none" strokeDasharray="1" strokeLinecap="round" />
          <text x={(nx(0) + nx(5) + NODE_W) / 2} y={286} textAnchor="middle" fontSize="12" fill="rgb(var(--muted))" fontFamily="'JetBrains Mono Variable', monospace">SSE stream: tokens flow back as they are generated</text>
          {NODES.map((n, i) => (
            <g key={n.title} data-arch-node>
              <rect x={nx(i)} y={Y} width={NODE_W} height={NODE_H} rx="12" fill="var(--glass-strong)" stroke="rgb(var(--neon-cyan))" strokeOpacity="0.45" />
              <text x={nx(i) + NODE_W / 2} y={Y + 30} textAnchor="middle" fontSize="20">{n.icon}</text>
              <text x={nx(i) + NODE_W / 2} y={Y + 52} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="rgb(var(--fg))" fontFamily="'Space Grotesk Variable', sans-serif">{n.title}</text>
              <text x={nx(i) + NODE_W / 2} y={Y + 69} textAnchor="middle" fontSize="9.5" fill="rgb(var(--muted))" fontFamily="'JetBrains Mono Variable', monospace">{n.sub}</text>
            </g>
          ))}
        </svg>
      </div>

      {/* Phones: the same path as a vertical list. */}
      <ol className="mt-10 space-y-3 md:hidden" aria-label="Request path">
        {NODES.map((n, i) => (
          <li key={n.title} className="glass flex items-center gap-3 rounded-2xl px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-strong font-mono text-xs text-neon-cyan">{i + 1}</span>
            <span className="min-w-0"><span className="block font-display font-semibold">{n.icon} {n.title}</span><span className="block text-xs text-muted">{n.sub}</span></span>
          </li>
        ))}
      </ol>

      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {NOTES.map(({ Icon, title, body }) => (
          <div key={title} className="rounded-2xl border border-line p-5">
            <Icon size={20} className="text-neon-cyan" aria-hidden />
            <h3 className="mt-3 font-display text-lg font-semibold">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
