import { describe, expect, it } from 'vitest';
import { buildNetwork, mulberry32, nodesForQuality } from './network';
import { decideTier, type FxEnv } from './capability';
import { activityLevel, FULL_ACTIVITY_CPS, smoothLevel } from './activity';
import { parseView } from '../route';
import { followTrailPoint, TRAIL_FOLLOW_RATE, TRAIL_MAX_GAP_PX, type TrailPoint } from './trail';

const desktop: FxEnv = { reducedMotion: false, coarsePointer: false, webgl: true, saveData: false, cores: 8, memoryGb: 8, width: 1440 };

describe('mulberry32', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('differs between seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('buildNetwork', () => {
  const net = buildNetwork(120, { seed: 5 });

  it('is reproducible for a seed', () => {
    expect(buildNetwork(120, { seed: 5 })).toEqual(net);
    expect(buildNetwork(120, { seed: 6 }).nodes[0]).not.toEqual(net.nodes[0]);
  });

  it('creates the requested node count with hubs first', () => {
    expect(net.nodes).toHaveLength(120);
    const hubs = net.nodes.filter(n => n.hub).length;
    expect(hubs).toBeGreaterThan(0);
    expect(net.nodes.slice(0, hubs).every(n => n.hub)).toBe(true);
    expect(net.nodes.slice(hubs).every(n => !n.hub)).toBe(true);
  });

  it('keeps every node inside the volume', () => {
    for (const n of net.nodes) {
      expect(Math.abs(n.x)).toBeLessThanOrEqual(16 + 1e-9);
      expect(Math.abs(n.y)).toBeLessThanOrEqual(9 + 1e-9);
      expect(Math.abs(n.z)).toBeLessThanOrEqual(8 + 1e-9);
    }
  });

  it('only links an earlier node to a later one, within range, without duplicates', () => {
    const seen = new Set<string>();
    for (const e of net.edges) {
      expect(e.a).toBeLessThan(e.b);
      const a = net.nodes[e.a], b = net.nodes[e.b];
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThanOrEqual(4.6 + 1e-9);
      const key = `${e.a}-${e.b}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(net.edges.length).toBeGreaterThan(20);
  });

  it('orders edges by their later endpoint so a node prefix owns an edge prefix', () => {
    for (let i = 1; i < net.edges.length; i++) expect(net.edges[i].b).toBeGreaterThanOrEqual(net.edges[i - 1].b);
    for (const m of [0, 1, 10, 60, 120]) {
      const expected = net.edges.filter(e => e.b < m).length;
      expect(net.edgePrefix[m]).toBe(expected);
      // and every one of those edges really only touches the first m nodes
      expect(net.edges.slice(0, net.edgePrefix[m]).every(e => e.a < m && e.b < m)).toBe(true);
    }
  });

  it('handles an empty network', () => {
    const empty = buildNetwork(0);
    expect(empty.nodes).toHaveLength(0);
    expect(empty.edges).toHaveLength(0);
    expect(empty.edgePrefix).toHaveLength(1);
  });
});

describe('nodesForQuality', () => {
  it('scales with quality but never empties the scene', () => {
    expect(nodesForQuality(200, 1)).toBe(200);
    expect(nodesForQuality(200, 0.5)).toBe(100);
    expect(nodesForQuality(200, 0)).toBe(40); // floored at 20%
    expect(nodesForQuality(5, 0.2)).toBe(5);
  });
});

describe('decideTier', () => {
  it('gives a capable desktop the full effects', () => {
    expect(decideTier(desktop, 'auto')).toBe('high');
  });
  it('turns effects off for reduced motion, no WebGL, or when the user asks', () => {
    expect(decideTier({ ...desktop, reducedMotion: true }, 'auto')).toBe('off');
    expect(decideTier({ ...desktop, webgl: false }, 'auto')).toBe('off');
    expect(decideTier(desktop, 'off')).toBe('off');
  });
  it('uses the lite tier for phones, small screens, weak devices, data-saver and by choice', () => {
    expect(decideTier({ ...desktop, coarsePointer: true }, 'auto')).toBe('low');
    expect(decideTier({ ...desktop, width: 390 }, 'auto')).toBe('low');
    expect(decideTier({ ...desktop, cores: 2 }, 'auto')).toBe('low');
    expect(decideTier({ ...desktop, memoryGb: 2 }, 'auto')).toBe('low');
    expect(decideTier({ ...desktop, saveData: true }, 'auto')).toBe('low');
    expect(decideTier(desktop, 'low')).toBe('low');
  });
  it('lets QA force a tier but never past missing WebGL', () => {
    expect(decideTier({ ...desktop, reducedMotion: true }, 'auto', 'high')).toBe('high');
    expect(decideTier({ ...desktop, webgl: false }, 'auto', 'high')).toBe('off');
  });
  it('lets reduced motion win over a "lite" preference', () => {
    expect(decideTier({ ...desktop, reducedMotion: true }, 'low')).toBe('off');
  });
});

describe('activity level', () => {
  it('maps throughput to 0..1 and clamps', () => {
    expect(activityLevel(0)).toBe(0);
    expect(activityLevel(-5)).toBe(0);
    expect(activityLevel(FULL_ACTIVITY_CPS / 2)).toBeCloseTo(0.5);
    expect(activityLevel(FULL_ACTIVITY_CPS * 10)).toBe(1);
    expect(activityLevel(Number.NaN)).toBe(0);
    expect(activityLevel(Infinity)).toBe(0);
  });
  it('smooths between samples', () => {
    expect(smoothLevel(0, 1)).toBeCloseTo(0.5);
    expect(smoothLevel(1, 1)).toBe(1);
    expect(smoothLevel(0.8, 0, 0.25)).toBeCloseTo(0.6);
  });
});

describe('parseView', () => {
  it('opens the workspace only for #/app routes', () => {
    expect(parseView('#/app')).toBe('app');
    expect(parseView('#/app/')).toBe('app');
    expect(parseView('#/app?agent=coding-assistant')).toBe('app');
    expect(parseView('')).toBe('landing');
    expect(parseView('#/')).toBe('landing');
    expect(parseView('#/application')).toBe('landing');
    expect(parseView('#story')).toBe('landing');
  });
});

describe('cursor trail', () => {
  const POINTS = 20; // as in CustomCursor
  const chain = (x: number, y: number): TrailPoint[] => Array.from({ length: POINTS }, () => ({ x, y }));
  /** One animation frame: the head goes to the pointer and every other point follows the one ahead. */
  const frame = (pts: TrailPoint[], x: number, y: number, dt: number) => {
    pts[0].x = x; pts[0].y = y;
    for (let i = 1; i < pts.length; i++) followTrailPoint(pts[i], pts[i - 1], dt);
  };
  const tail = (pts: TrailPoint[]) => Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  const maxGap = (pts: TrailPoint[]) => Math.max(...pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y)));

  it('holds a point within the maximum gap of its neighbour, even after a huge jump', () => {
    for (const [px, py] of [[1000, 0], [0, -1000], [700, 700], [8, 0], [3, 4]]) {
      const p = { x: px, y: py };
      followTrailPoint(p, { x: 0, y: 0 }, 1 / 60);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(TRAIL_MAX_GAP_PX + 1e-9);
    }
  });

  it('leaves a point that is already close alone apart from easing it in', () => {
    const p = { x: 3, y: 0 };
    followTrailPoint(p, { x: 0, y: 0 }, 1 / 60);
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(3);
    expect(p.y).toBe(0);
  });

  it('bounds the whole tail at every pointer speed, which the old easing did not', () => {
    const limit = (POINTS - 1) * TRAIL_MAX_GAP_PX;
    for (const speed of [1, 2, 5, 10, 20, 40, 80, 300, 2000]) { // px per frame, from a crawl to a teleport
      const pts = chain(0, 0);
      let x = 0, longest = 0;
      for (let f = 0; f < 120; f++) { x += speed; frame(pts, x, 0, 1 / 60); longest = Math.max(longest, tail(pts), maxGap(pts) * (POINTS - 1)); }
      expect(longest).toBeLessThanOrEqual(limit + 1e-6);
    }
  });

  it('still grows with speed up to the cap, so a faster flick looks faster', () => {
    const lengthAt = (speed: number) => { const pts = chain(0, 0); let x = 0; for (let f = 0; f < 120; f++) { x += speed; frame(pts, x, 0, 1 / 60); } return tail(pts); };
    expect(lengthAt(1)).toBeLessThan(lengthAt(2));
    expect(lengthAt(2)).toBeLessThan(lengthAt(5));
    expect(lengthAt(5)).toBeGreaterThan(0.85 * (POINTS - 1) * TRAIL_MAX_GAP_PX); // already near the cap
    expect(lengthAt(40)).toBeCloseTo(lengthAt(5), 0); // beyond that, speed no longer lengthens it
  });

  it('collapses a stretched chain within a single frame (no streak survives a jump)', () => {
    const pts = chain(0, 0);
    frame(pts, 1100, 650, 1 / 60); // one event ~1,280 px away
    expect(maxGap(pts)).toBeLessThanOrEqual(TRAIL_MAX_GAP_PX + 1e-9);
    expect(tail(pts)).toBeLessThanOrEqual((POINTS - 1) * TRAIL_MAX_GAP_PX + 1e-9);
  });

  it('eases the same amount of distance over the same time at any refresh rate', () => {
    // Close enough that the gap cap is not involved: only the time-based easing matters.
    // 100 ms of frames at each rate (whole frames: 3, 6, 12 and 24).
    const at = (hz: number) => { const p = { x: 5, y: 0 }; for (let i = 0; i < hz / 10; i++) followTrailPoint(p, { x: 0, y: 0 }, 1 / hz); return p.x; };
    const expected = 5 * Math.exp(-TRAIL_FOLLOW_RATE * 0.1); // closing in for 100 ms
    for (const hz of [30, 60, 120, 240]) expect(at(hz)).toBeCloseTo(expected, 9);
  });

  it('survives zero, negative and invalid time steps', () => {
    for (const dt of [0, -1, Number.NaN, Infinity, 5]) {
      const p = { x: 4, y: 3 };
      followTrailPoint(p, { x: 0, y: 0 }, dt);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(TRAIL_MAX_GAP_PX + 1e-9);
    }
    const stay = { x: 4, y: 3 };
    followTrailPoint(stay, { x: 0, y: 0 }, 0);
    expect(stay).toEqual({ x: 4, y: 3 }); // no movement without time passing
  });
});
