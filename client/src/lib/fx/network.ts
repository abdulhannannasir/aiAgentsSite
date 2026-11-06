/**
 * Procedural "agent network" used by the 3D background and its static fallback.
 *
 * Pure data, no three.js: nodes are clustered around a few hubs, and edges connect each node to the nearest earlier
 * nodes. Edges are emitted in order of their later endpoint, so the first K edges only touch the first M nodes.
 * That lets the renderer shed load (adaptive quality) by shrinking draw ranges instead of rebuilding geometry.
 */

export interface NetworkNode {
  x: number;
  y: number;
  z: number;
  phase: number; // 0..1, drives per-node drift and twinkle
  size: number; // 0.6..1 (hubs are larger)
  tint: number; // 0 = cyan, 1 = violet
  hub: boolean;
}

export interface NetworkEdge {
  a: number; // always < b
  b: number;
  seed: number; // 0..1, offsets the travelling pulse
}

export interface Network {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  /** edgePrefix[m] = number of leading edges whose endpoints are both < m (valid for m in 0..nodes.length). */
  edgePrefix: Uint32Array;
}

export interface NetworkOptions {
  seed?: number;
  /** Half-extent of the volume on each axis, in world units. */
  spread?: [number, number, number];
  /** Longest edge. */
  maxDist?: number;
  /** Most edges a node may start (links to earlier nodes). */
  maxLinks?: number;
}

/** Small deterministic PRNG, so the network looks the same on every load and in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildNetwork(count: number, opts: NetworkOptions = {}): Network {
  const { seed = 7, spread = [16, 9, 8], maxDist = 4.6, maxLinks = 2 } = opts;
  const n = Math.max(0, Math.floor(count));
  const rand = mulberry32(seed);
  const hubCount = Math.max(1, Math.round(n / 16));
  const nodes: NetworkNode[] = [];
  const hubs: Array<[number, number, number]> = [];

  for (let i = 0; i < n; i++) {
    const hub = i < hubCount;
    let x: number, y: number, z: number;
    if (hub) {
      x = (rand() * 2 - 1) * spread[0] * 0.85;
      y = (rand() * 2 - 1) * spread[1] * 0.85;
      z = (rand() * 2 - 1) * spread[2] * 0.7;
      hubs.push([x, y, z]);
    } else {
      const [hx, hy, hz] = hubs[Math.floor(rand() * hubs.length)];
      // Sum of uniforms ~ bell curve: dense near the hub, thin at the edge of the cluster.
      const bell = () => (rand() + rand() + rand() - 1.5) * 2;
      x = clamp(hx + bell() * 3.6, -spread[0], spread[0]);
      y = clamp(hy + bell() * 2.8, -spread[1], spread[1]);
      z = clamp(hz + bell() * 2.6, -spread[2], spread[2]);
    }
    nodes.push({ x, y, z, phase: rand(), size: hub ? 1 : 0.55 + rand() * 0.3, tint: hub ? rand() * 0.4 + 0.3 : rand(), hub });
  }

  // Node b links to up to `maxLinks` of the nearest earlier nodes within maxDist; iterating b upward keeps edges sorted by b.
  const edges: NetworkEdge[] = [];
  const maxD2 = maxDist * maxDist;
  const degree = new Uint8Array(n);
  const edgePrefix = new Uint32Array(n + 1);
  for (let b = 0; b < n; b++) {
    edgePrefix[b] = edges.length;
    const nb = nodes[b];
    const near: Array<{ a: number; d2: number }> = [];
    for (let a = 0; a < b; a++) {
      const na = nodes[a];
      const dx = na.x - nb.x, dy = na.y - nb.y, dz = na.z - nb.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= maxD2 && degree[a] < 6) near.push({ a, d2 });
    }
    near.sort((p, q) => p.d2 - q.d2);
    for (const { a } of near.slice(0, maxLinks)) {
      edges.push({ a, b, seed: rand() });
      degree[a]++;
      degree[b]++;
    }
  }
  edgePrefix[n] = edges.length;
  return { nodes, edges, edgePrefix };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Number of leading nodes to draw for a quality level in 0..1 (never below 20% so the scene never empties). */
export function nodesForQuality(total: number, quality: number): number {
  const q = clamp(quality, 0.2, 1);
  return Math.max(Math.min(total, 8), Math.round(total * q));
}
