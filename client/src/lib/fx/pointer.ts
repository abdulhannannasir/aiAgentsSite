/**
 * Shared, non-reactive input state for the effects (cursor, 3D scenes). It is plain mutable data read from
 * animation loops, so pointer moves and scrolls never cause React renders.
 */

export const pointer = {
  x: 0, // client px
  y: 0,
  nx: 0, // -1..1, +y is up
  ny: 0,
  active: false, // false until the first real mouse/pen movement, and after the pointer leaves the window
  mouse: false // true once a fine pointer (not touch) has been seen
};

export const scrollState = {
  y: 0,
  progress: 0 // 0..1 through the document
};

let users = 0;
let maxScroll = 1;
let cleanup: (() => void) | null = null;

function attach() {
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.nx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ny = -((e.clientY / window.innerHeight) * 2 - 1);
    pointer.active = true;
    pointer.mouse = true;
  };
  const onLeave = () => { pointer.active = false; };
  const measure = () => { maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight); onScroll(); };
  const onScroll = () => {
    scrollState.y = window.scrollY;
    scrollState.progress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', measure, { passive: true });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
  ro?.observe(document.body);
  measure();

  cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('blur', onLeave);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', measure);
    ro?.disconnect();
  };
}

/** Start tracking (reference counted). Returns the stop function. */
export function trackInput(): () => void {
  if (users++ === 0) attach();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--users === 0) { cleanup?.(); cleanup = null; }
  };
}
