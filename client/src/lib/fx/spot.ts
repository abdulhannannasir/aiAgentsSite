import type { PointerEvent } from 'react';

/** Feeds the .spot spotlight border/glare (see index.css): writes the pointer position into --mx/--my without re-rendering. */
export function trackSpot(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== 'mouse') return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
  el.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
}
