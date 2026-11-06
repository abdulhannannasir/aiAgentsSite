import { useEffect, useRef, type ReactNode } from 'react';
import { motion, useMotionValue, useSpring, type MotionValue } from 'framer-motion';
import clsx from 'clsx';
import { useFx } from '../../lib/fx/capability';

interface Entry { el: HTMLElement; x: MotionValue<number>; y: MotionValue<number>; strength: number; radius: number }

// One shared pointer listener for every magnetic element on the page (instead of one per element).
const entries = new Set<Entry>();
let listening = false;
let frame = 0;
let px = 0, py = 0;

function update() {
  frame = 0;
  for (const e of entries) {
    const r = e.el.getBoundingClientRect();
    // getBoundingClientRect includes our own translation; remove it to get the resting centre.
    const cx = r.left + r.width / 2 - e.x.get();
    const cy = r.top + r.height / 2 - e.y.get();
    const dx = px - cx, dy = py - cy;
    const reach = e.radius + Math.max(r.width, r.height) / 2;
    if (Math.hypot(dx, dy) < reach) {
      e.x.set(clamp(dx * e.strength, -18, 18));
      e.y.set(clamp(dy * e.strength, -14, 14));
    } else {
      e.x.set(0);
      e.y.set(0);
    }
  }
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const onMove = (ev: PointerEvent) => {
  if (ev.pointerType !== 'mouse') return;
  px = ev.clientX; py = ev.clientY;
  if (!frame) frame = requestAnimationFrame(update);
};
const release = () => entries.forEach(e => { e.x.set(0); e.y.set(0); });

function register(e: Entry) {
  entries.add(e);
  if (!listening) {
    listening = true;
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', release);
    window.addEventListener('blur', release);
  }
  return () => {
    entries.delete(e);
    if (!entries.size && listening) {
      listening = false;
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', release);
      window.removeEventListener('blur', release);
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
    }
  };
}

/** Pulls its child toward the cursor when the pointer gets near, then springs back. Does nothing on touch or with effects off. */
export function Magnetic({ children, strength = 0.32, radius = 70, className }: { children: ReactNode; strength?: number; radius?: number; className?: string }) {
  const { tier, finePointer } = useFx();
  const enabled = tier !== 'off' && finePointer;
  const ref = useRef<HTMLSpanElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 18, mass: 0.35 });
  const sy = useSpring(y, { stiffness: 260, damping: 18, mass: 0.35 });

  useEffect(() => {
    if (!enabled || !ref.current) return;
    return register({ el: ref.current, x, y, strength, radius });
  }, [enabled, x, y, strength, radius]);

  return (
    <motion.span ref={ref} style={enabled ? { x: sx, y: sy } : undefined} className={clsx('inline-block', className)}>
      {children}
    </motion.span>
  );
}
