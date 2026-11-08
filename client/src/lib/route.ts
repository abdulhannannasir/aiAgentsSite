import { useCallback, useSyncExternalStore } from 'react';

/**
 * Hash routing (no server rewrites needed):
 *   #/              landing page
 *   #/app           the chat workspace (kept as the app's front door so existing links still work)
 *   #/app/<page>    other app pages (command-center, discover, my-agents, …)
 */
export type View = 'landing' | 'app' | 'auth';

export const AUTH_PAGES = ['sign-in', 'sign-up', 'forgot-password', 'reset-password', 'verified'] as const;
export type AuthPageId = (typeof AUTH_PAGES)[number];

export const PAGE_IDS = [
  'chat', 'command-center', 'discover', 'my-agents', 'builder', 'workflows',
  'projects', 'memory', 'integrations', 'activity', 'analytics', 'settings', 'billing'
] as const;
export type PageId = (typeof PAGE_IDS)[number];

export interface Route {
  view: View;
  page: PageId;
  /** True when the hash named an app page that does not exist (shown as "page not found", never a blank screen). */
  unknown: boolean;
  /** Set when view is 'auth'. */
  authPage?: AuthPageId;
  /** Query parameters inside the hash (e.g. #/auth/verified?error=…). */
  params?: Record<string, string>;
}

const isPage = (s: string): s is PageId => (PAGE_IDS as readonly string[]).includes(s);

export function parseRoute(hash: string): Route {
  const a = /^#\/auth\/([a-z-]+)\/?(?:\?(.*))?$/.exec(hash);
  if (a) {
    const params = Object.fromEntries(new URLSearchParams(a[2] ?? ''));
    return (AUTH_PAGES as readonly string[]).includes(a[1])
      ? { view: 'auth', page: 'chat', unknown: false, authPage: a[1] as AuthPageId, params }
      : { view: 'auth', page: 'chat', unknown: true, authPage: 'sign-in', params };
  }
  const m = /^#\/app(?:\/([^/?#]*))?\/?(?:[?].*)?$/.exec(hash);
  if (!m) return { view: 'landing', page: 'chat', unknown: false };
  const segment = (m[1] ?? '').toLowerCase();
  if (!segment) return { view: 'app', page: 'chat', unknown: false };
  return isPage(segment) ? { view: 'app', page: segment, unknown: false } : { view: 'app', page: 'chat', unknown: true };
}

export const parseView = (hash: string): View => parseRoute(hash).view;

/** The hash for a page. The chat workspace stays at plain #/app. */
export const pageHref = (page: PageId): string => (page === 'chat' ? '#/app' : `#/app/${page}`);

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

// useSyncExternalStore needs a stable snapshot: cache the parsed route per hash string.
let lastHash: string | null = null;
let lastRoute: Route = { view: 'landing', page: 'chat', unknown: false };
const snapshot = (): Route => {
  if (location.hash !== lastHash) {
    lastHash = location.hash;
    lastRoute = parseRoute(lastHash);
  }
  return lastRoute;
};
const serverSnapshot = (): Route => ({ view: 'landing', page: 'chat', unknown: false });

function setHash(target: string) {
  if (location.hash !== target) location.hash = target;
  window.scrollTo(0, 0);
}

export const authHref = (p: AuthPageId) => `#/auth/${p}`;
export const goAuth = (p: AuthPageId) => setHash(authHref(p));

export function useRoute(): [Route, (page: PageId) => void] {
  const route = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const navigate = useCallback((page: PageId) => setHash(pageHref(page)), []);
  return [route, navigate];
}

/** The original two-screen API, still used by the landing page and the palette. */
export function useView(): [View, (v: View) => void] {
  const [route] = useRoute();
  const go = useCallback((v: View) => setHash(v === 'app' ? '#/app' : v === 'auth' ? '#/auth/sign-in' : '#/'), []);
  return [route.view, go];
}
