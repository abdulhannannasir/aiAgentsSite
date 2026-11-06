import { useEffect, useLayoutEffect, useState, type DependencyList, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);
export { gsap, ScrollTrigger };

/** True while the media query matches; updates live. */
export function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export interface FxConditions { motion: boolean; desktop: boolean }

/**
 * Runs `setup` inside a gsap.matchMedia scope: every tween and ScrollTrigger created in it is scoped to `scope`,
 * is skipped or rebuilt when the media conditions change, and is reverted on unmount (React StrictMode safe).
 * `motion` is false for users who prefer reduced motion, so callers can set the final state instead of animating.
 */
export function useScrollFx(scope: RefObject<HTMLElement>, setup: (c: FxConditions) => void, deps: DependencyList = []) {
  useLayoutEffect(() => {
    if (!scope.current) return;
    const mm = gsap.matchMedia(scope.current);
    mm.add({ motion: '(prefers-reduced-motion: no-preference)', desktop: '(min-width: 1024px)' }, ctx => {
      setup(ctx.conditions as unknown as FxConditions);
    });
    // Fonts and lazy sections change layout after first paint; trigger positions must be measured again.
    const refresh = () => ScrollTrigger.refresh();
    void document.fonts?.ready.then(refresh);
    window.addEventListener('load', refresh);
    return () => { window.removeEventListener('load', refresh); mm.revert(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Layered depth: any descendant with data-parallax="0.15" drifts that fraction of its own height against the scroll
 * (scrubbed, so it follows the scrollbar exactly). Skipped entirely for reduced motion.
 */
export function useParallax(scope: RefObject<HTMLElement>, deps: DependencyList = []) {
  useScrollFx(scope, ({ motion }) => {
    if (!motion || !scope.current) return;
    gsap.utils.toArray<HTMLElement>('[data-parallax]', scope.current).forEach(el => {
      const amount = parseFloat(el.dataset.parallax || '0.15');
      gsap.fromTo(el, { yPercent: amount * 100 }, { yPercent: -amount * 100, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
    });
  }, deps);
}
