import { useEffect, useRef, useState } from 'react';
import { activityLevel, smoothLevel } from '../lib/fx/activity';

/**
 * A 0..1 "how fast is text arriving" signal, sampled every 200 ms from the growing size of the streamed reply.
 * It reads real throughput (nothing is simulated) and falls to 0 when the stream is idle.
 */
export function useStreamActivity(size: number, active: boolean): number {
  const [level, setLevel] = useState(0);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const last = useRef({ size, at: 0 });

  useEffect(() => {
    if (!active) { setLevel(0); return; }
    last.current = { size: sizeRef.current, at: performance.now() };
    const id = window.setInterval(() => {
      const now = performance.now();
      const seconds = (now - last.current.at) / 1000;
      const cps = seconds > 0 ? (sizeRef.current - last.current.size) / seconds : 0;
      last.current = { size: sizeRef.current, at: now };
      setLevel(prev => smoothLevel(prev, activityLevel(cps)));
    }, 200);
    return () => window.clearInterval(id);
  }, [active]);

  return active ? level : 0;
}
