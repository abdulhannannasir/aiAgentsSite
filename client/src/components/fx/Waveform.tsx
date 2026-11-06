import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { prefersReducedMotion } from '../../lib/platform';

/**
 * Animated audio-style waveform. Amplitude follows `level` (real streaming throughput, see useStreamActivity);
 * when `active` is false the bars rest flat. One rAF loop drives every bar's scaleY (compositor-only), and the loop
 * only exists while active. With reduced motion it renders a still, level-sized profile instead.
 */
export function Waveform({ active, level, bars = 24, className }: { active: boolean; level: number; bars?: number; className?: string }) {
  const els = useRef<Array<HTMLSpanElement | null>>([]);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const set = (i: number, v: number) => { const el = els.current[i]; if (el) el.style.transform = `scaleY(${Math.max(0.1, Math.min(1, v)).toFixed(3)})`; };
    if (!active) { for (let i = 0; i < bars; i++) set(i, 0.1); return; }
    if (prefersReducedMotion()) { for (let i = 0; i < bars; i++) set(i, 0.2 + 0.5 * levelRef.current * (0.5 + 0.5 * Math.sin(i * 0.9))); return; }
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const t = (now - t0) / 1000;
      const amp = 0.22 + 0.78 * levelRef.current; // never fully flat while a reply is running: the agent is working
      for (let i = 0; i < bars; i++) {
        const a = Math.sin(t * (3.2 + (i % 5) * 0.85) + i * 0.7) * 0.5 + 0.5;
        const b = Math.sin(t * 1.7 + i * 0.33) * 0.5 + 0.5;
        set(i, 0.12 + a * b * amp * 0.9);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, bars]);

  return (
    <span aria-hidden data-testid="waveform" data-active={active} className={clsx('flex h-7 items-center gap-[3px]', className)}>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} ref={el => { els.current[i] = el; }} className="h-full w-[3px] origin-center rounded-full bg-gradient-to-t from-neon-violet to-neon-cyan will-change-transform" style={{ transform: 'scaleY(0.1)' }} />
      ))}
    </span>
  );
}
