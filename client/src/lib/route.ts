import { useCallback, useSyncExternalStore } from 'react';

/** The site has two screens: the marketing landing page, and the agent workspace (#/app). Hash routing needs no server rewrites. */
export type View = 'landing' | 'app';

export const parseView = (hash: string): View => (/^#\/app(\/|\?|$)/.test(hash) ? 'app' : 'landing');

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useView(): [View, (v: View) => void] {
  const view = useSyncExternalStore(subscribe, () => parseView(location.hash), () => 'landing' as View);
  const go = useCallback((v: View) => {
    const target = v === 'app' ? '#/app' : '#/';
    if (location.hash !== target) location.hash = target;
    window.scrollTo(0, 0);
  }, []);
  return [view, go];
}
