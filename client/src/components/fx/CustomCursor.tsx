import { useEffect, useRef } from 'react';
import { useFx } from '../../lib/fx/capability';
import { followTrailPoint } from '../../lib/fx/trail';

const TRAIL = 20;
const INTERACTIVE = 'a[href], button, [role="button"], [role="option"], [role="menuitem"], [role="tab"], summary, label, select, input[type="checkbox"], input[type="radio"], input[type="range"], [data-cursor]';
const TEXT_FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]), textarea, [contenteditable="true"]';

type Mode = 'none' | 'magnet' | 'card' | 'text';
interface Hover { mode: Mode; el: HTMLElement | null; radius: number; label: string }

const NONE: Hover = { mode: 'none', el: null, radius: 0, label: '' };

function classify(target: EventTarget | null): Hover {
  if (!(target instanceof Element)) return NONE;
  if (target.closest(TEXT_FIELD)) return { ...NONE, mode: 'text' };
  const el = target.closest<HTMLElement>(INTERACTIVE);
  if (!el || el.dataset.cursor === 'none' || el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') return NONE;
  const r = el.getBoundingClientRect();
  const big = el.dataset.cursor === 'card' || (el.dataset.cursor !== 'magnet' && (r.width > 300 || r.height > 170));
  if (big) return { mode: 'card', el, radius: 0, label: el.dataset.cursorLabel ?? '' };
  const br = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8;
  return { mode: 'magnet', el, radius: br + 5, label: '' };
}

/**
 * Fluid trailing cursor. A dot tracks the pointer exactly; a ring eases after it and, over small controls, morphs
 * to wrap them (magnetic snap); over big cards it becomes a labelled disc; over text fields it steps aside so the
 * native I-beam shows. A tapered neon trail follows. One rAF loop that sleeps as soon as everything has settled.
 * Only runs for a real mouse on a device with effects enabled; touch and reduced-motion users never see it.
 */
export function CustomCursor() {
  const { tier, finePointer } = useFx();
  const enabled = tier !== 'off' && finePointer;
  const canvas = useRef<HTMLCanvasElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const cv = canvas.current, ringEl = ring.current, dotEl = dot.current, labelEl = label.current;
    if (!enabled || !cv || !ringEl || !dotEl || !labelEl) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const html = document.documentElement;

    let raf = 0, running = false, last = 0, lastMove = 0, shown = false, down = false, lastTarget: EventTarget | null = null;
    const pos = { x: -200, y: -200 };
    const ringP = { x: -200, y: -200, w: 34, h: 34, r: 17 };
    const pts = Array.from({ length: TRAIL }, () => ({ x: -200, y: -200 }));
    let hover: Hover = NONE;
    let dirty: [number, number, number, number] | null = null;

    const resize = () => { cv.width = window.innerWidth; cv.height = window.innerHeight; };
    resize();

    const show = (on: boolean) => {
      shown = on;
      ringEl.style.opacity = on ? '1' : '0';
      dotEl.style.opacity = on ? '1' : '0';
      html.classList.toggle('fx-cursor', on);
    };

    const setHover = (h: Hover) => {
      hover = h;
      labelEl.textContent = h.mode === 'card' ? h.label : '';
      const text = h.mode === 'text';
      ringEl.style.opacity = shown && !text ? '1' : '0';
      dotEl.style.opacity = shown && !text ? '1' : '0';
    };

    const tick = (now: number) => {
      // The rAF timestamp can precede the performance.now() taken when the loop was woken, giving a negative step that
      // would flip the easing factor's sign and make the ring diverge. Always use a positive, bounded step.
      const raw = (now - last) / 1000;
      const dt = raw > 0 ? Math.min(0.05, raw) : 0.016;
      last = now;
      const kPos = 1 - Math.exp(-dt * 14);
      const kSize = 1 - Math.exp(-dt * 18);

      let tx = pos.x, ty = pos.y, tw = down ? 26 : 34, th = tw, tr = tw / 2;
      if (hover.mode === 'magnet' && hover.el && hover.el.isConnected) {
        const r = hover.el.getBoundingClientRect();
        tx = r.left + r.width / 2 + (pos.x - (r.left + r.width / 2)) * 0.1; // lean slightly toward the pointer
        ty = r.top + r.height / 2 + (pos.y - (r.top + r.height / 2)) * 0.1;
        tw = r.width + 12; th = r.height + 12; tr = Math.min(hover.radius + 1, th / 2);
      } else if (hover.mode === 'card') {
        tw = th = hover.label ? 72 : 52; tr = tw / 2;
      } else if (hover.mode === 'magnet') {
        hover = NONE; // the element was removed
      }
      ringP.x += (tx - ringP.x) * kPos; ringP.y += (ty - ringP.y) * kPos;
      ringP.w += (tw - ringP.w) * kSize; ringP.h += (th - ringP.h) * kSize; ringP.r += (tr - ringP.r) * kSize;

      ringEl.style.width = `${ringP.w.toFixed(1)}px`;
      ringEl.style.height = `${ringP.h.toFixed(1)}px`;
      ringEl.style.borderRadius = `${ringP.r.toFixed(1)}px`;
      ringEl.style.transform = `translate3d(${(ringP.x - ringP.w / 2).toFixed(1)}px,${(ringP.y - ringP.h / 2).toFixed(1)}px,0)`;
      dotEl.style.transform = `translate3d(${pos.x - 3}px,${pos.y - 3}px,0)`;
      // Over a labelled disc the dot would cover the label; over a control the ring does the talking.
      dotEl.style.scale = hover.mode === 'card' && hover.label ? '0' : hover.mode === 'magnet' || hover.mode === 'card' ? '0.45' : '1';

      // Trail: each point eases toward the one ahead of it and is held within a few pixels of it (see lib/fx/trail.ts),
      // which gives a fluid tail whose length can never exceed a short comet, whatever the pointer speed.
      pts[0].x = pos.x; pts[0].y = pos.y;
      let spread = 0;
      for (let i = 1; i < TRAIL; i++) {
        const p = pts[i], q = pts[i - 1];
        followTrailPoint(p, q, dt);
        spread = Math.max(spread, Math.abs(q.x - p.x) + Math.abs(q.y - p.y));
      }
      if (dirty) ctx.clearRect(dirty[0], dirty[1], dirty[2], dirty[3]);
      let minX = 1e5, minY = 1e5, maxX = -1e5, maxY = -1e5;
      const fade = hover.mode === 'magnet' || hover.mode === 'text' ? 0.25 : 1;
      ctx.lineCap = 'round';
      ctx.globalCompositeOperation = 'lighter';
      for (let i = TRAIL - 1; i >= 1; i--) {
        const f = 1 - i / TRAIL;
        minX = Math.min(minX, pts[i].x); maxX = Math.max(maxX, pts[i].x); minY = Math.min(minY, pts[i].y); maxY = Math.max(maxY, pts[i].y);
        const a = (0.42 * f * fade).toFixed(3);
        ctx.strokeStyle = i < TRAIL / 2 ? `rgba(34,211,238,${a})` : `rgba(167,139,250,${a})`;
        ctx.lineWidth = 0.5 + 3.6 * f;
        ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[i - 1].x, pts[i - 1].y); ctx.stroke();
      }
      dirty = [minX - 10, minY - 10, maxX - minX + 20, maxY - minY + 20];

      const settled = Math.abs(tx - ringP.x) < 0.3 && Math.abs(ty - ringP.y) < 0.3 && Math.abs(tw - ringP.w) < 0.3 && spread < 0.4;
      if (settled && now - lastMove > 120) { running = false; return; }
      raf = requestAnimationFrame(tick);
    };
    const wake = () => { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(tick); } };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') { if (shown) show(false); return; }
      pos.x = e.clientX; pos.y = e.clientY; lastMove = performance.now();
      if (!shown) {
        show(true);
        ringP.x = pos.x; ringP.y = pos.y; pts.forEach(p => { p.x = pos.x; p.y = pos.y; });
      }
      if (e.target !== lastTarget) { lastTarget = e.target; setHover(classify(e.target)); }
      wake();
    };
    const onDown = () => { down = true; wake(); };
    const onUp = () => { down = false; wake(); };
    const onLeave = () => { show(false); if (dirty) { ctx.clearRect(0, 0, cv.width, cv.height); dirty = null; } };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      html.classList.remove('fx-cursor');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('resize', resize);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div aria-hidden data-testid="fx-cursor" className="pointer-events-none fixed inset-0 z-[100]">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      <div
        ref={ring}
        className="absolute left-0 top-0 flex items-center justify-center border border-neon-cyan/70 bg-neon-cyan/[0.07] opacity-0 shadow-[0_0_18px_-4px_rgb(var(--neon-cyan)/0.7)] transition-opacity duration-200 [contain:layout_paint]"
        style={{ width: 34, height: 34, borderRadius: 17 }}
      >
        <span ref={label} className="font-mono text-[9px] font-bold uppercase tracking-wider text-neon-cyan" />
      </div>
      <div ref={dot} className="absolute left-0 top-0 h-1.5 w-1.5 rounded-full bg-white opacity-0 shadow-[0_0_8px_2px_rgb(var(--neon-cyan)/0.9)] transition-[scale,opacity] duration-150" />
    </div>
  );
}
