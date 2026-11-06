import { describe, expect, it } from 'vitest';
import { buildNetwork, mulberry32, nodesForQuality } from './network';
import { decideTier, type FxEnv } from './capability';
import { activityLevel, FULL_ACTIVITY_CPS, smoothLevel } from './activity';
import { parseView } from '../route';

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
