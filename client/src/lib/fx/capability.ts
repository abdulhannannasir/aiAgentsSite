import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from '../storage';

/** How much of the visual effects stack to run. */
export type FxTier = 'high' | 'low' | 'off';
/** What the user chose: let the device decide, or turn effects down. */
export type FxPref = 'auto' | 'low' | 'off';

export interface FxEnv {
  reducedMotion: boolean;
  coarsePointer: boolean;
  webgl: boolean;
  saveData: boolean;
  cores: number;
  memoryGb: number;
  width: number;
}

/**
 * Pure decision: which tier does this device get?
 *  - off:  the user asked, prefers reduced motion, or WebGL is unavailable. No canvas, no cursor, static art only.
 *  - low:  phones/tablets, small screens, weak CPUs, data-saver. Fewer nodes, no edge pulses, no backdrop blur.
 *  - high: everything on.
 * `force` is for QA (?fx=high) and cannot override missing WebGL.
 */
export function decideTier(env: FxEnv, pref: FxPref, force?: FxTier): FxTier {
  if (!env.webgl) return 'off';
  if (force) return force;
  if (pref === 'off' || env.reducedMotion) return 'off';
  if (pref === 'low' || env.saveData) return 'low';
  if (env.coarsePointer || env.width < 768 || env.cores <= 2 || env.memoryGb <= 2) return 'low';
  return 'high';
}

let webglCache: boolean | null = null;
/** Cheap one-off probe; the context is released straight away so it doesn't count against the browser's limit. */
export function hasWebGL(): boolean {
  if (webglCache !== null) return webglCache;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
    webglCache = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglCache = false;
  }
  return webglCache;
}

const PREF_KEY = 'agentverse.fx';
const isPref = (v: unknown): v is FxPref => v === 'auto' || v === 'low' || v === 'off';
const isTier = (v: unknown): v is FxTier => v === 'high' || v === 'low' || v === 'off';

interface Snapshot { pref: FxPref; env: FxEnv; tier: FxTier; finePointer: boolean }

const mq = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null);

function readEnv(): FxEnv {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return {
    reducedMotion: !!mq('(prefers-reduced-motion: reduce)')?.matches,
    coarsePointer: !!mq('(pointer: coarse)')?.matches,
    webgl: hasWebGL(),
    saveData: !!nav.connection?.saveData,
    cores: nav.hardwareConcurrency || 8,
    memoryGb: nav.deviceMemory || 8,
    width: window.innerWidth
  };
}

const forced: FxTier | undefined = (() => {
  try {
    const v = new URLSearchParams(location.search).get('fx');
    return isTier(v) ? v : undefined;
  } catch {
    return undefined;
  }
})();

function snapshot(pref: FxPref): Snapshot {
  const env = readEnv();
  const tier = decideTier(env, pref, forced);
  return { pref, env, tier, finePointer: !!mq('(hover: hover) and (pointer: fine)')?.matches };
}

let state: Snapshot | null = null;
const listeners = new Set<() => void>();

function recompute(pref: FxPref = state?.pref ?? 'auto') {
  const next = snapshot(pref);
  const same = state && state.pref === next.pref && state.tier === next.tier && state.finePointer === next.finePointer
    && state.env.reducedMotion === next.env.reducedMotion && state.env.coarsePointer === next.env.coarsePointer && (state.env.width < 768) === (next.env.width < 768);
  if (same) return;
  state = next;
  document.documentElement.dataset.fx = next.tier;
  listeners.forEach(l => l());
}

function ensure(): Snapshot {
  if (!state) {
    recompute(readStored<FxPref>(PREF_KEY, 'auto', isPref));
    const again = () => recompute();
    mq('(prefers-reduced-motion: reduce)')?.addEventListener?.('change', again);
    mq('(pointer: coarse)')?.addEventListener?.('change', again);
    window.addEventListener('resize', again, { passive: true });
  }
  return state as Snapshot;
}

export function setFxPref(pref: FxPref) {
  writeStored(PREF_KEY, pref);
  recompute(pref);
}

/** Current effects tier and the user's preference. Re-renders when the device or the preference changes. */
export function useFx() {
  const s = useSyncExternalStore(cb => { ensure(); listeners.add(cb); return () => { listeners.delete(cb); }; }, ensure, ensure);
  return { tier: s.tier, pref: s.pref, finePointer: s.finePointer, reducedMotion: s.env.reducedMotion, mobile: s.env.coarsePointer || s.env.width < 768, setPref: setFxPref };
}
