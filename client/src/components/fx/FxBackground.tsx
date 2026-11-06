import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFx } from '../../lib/fx/capability';
import { buildNetwork } from '../../lib/fx/network';
import { trackInput } from '../../lib/fx/pointer';

const NeuralScene = lazy(() => import('./NeuralScene'));

/** If the 3D chunk fails to load or the scene throws, fall back to the static art instead of breaking the page. */
export class FxBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** The same network, drawn once as SVG: shown instantly, while the 3D chunk loads, and when effects are off. */
function StaticNetwork() {
  const { nodes, edges } = useMemo(() => buildNetwork(72, { seed: 11, spread: [16, 9, 8], maxDist: 5.2 }), []);
  const project = (x: number, y: number, z: number) => {
    const f = 14 / (14 - z);
    return { sx: 800 + x * f * 46, sy: 450 - y * f * 46, f };
  };
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
      <g stroke="rgb(var(--neon-cyan))" strokeOpacity="0.13" strokeWidth="1">
        {edges.map((e, i) => {
          const a = project(nodes[e.a].x, nodes[e.a].y, nodes[e.a].z), b = project(nodes[e.b].x, nodes[e.b].y, nodes[e.b].z);
          return <line key={i} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} />;
        })}
      </g>
      {nodes.map((n, i) => {
        const p = project(n.x, n.y, n.z);
        return <circle key={i} cx={p.sx} cy={p.sy} r={(n.hub ? 3.6 : 2) * p.f} fill={`rgb(var(--neon-${n.tint > 0.55 ? 'violet' : 'cyan'}))`} fillOpacity={n.hub ? 0.8 : 0.5} />;
      })}
    </svg>
  );
}

/**
 * Full-screen agent-network background. Layers: static SVG (instant, always the fallback) under the lazy-loaded
 * WebGL swarm, which fades the SVG out once its first frame is ready.
 */
export function FxBackground({ view }: { view: 'landing' | 'app' }) {
  const { tier } = useFx();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => trackInput(), []);

  const canvasOn = tier !== 'off' && !failed;
  const tierForScene = tier === 'high' ? 'high' : 'low';
  return (
    // On the landing page this layer carries its own forced-dark backdrop, whatever the workspace theme is.
    <div aria-hidden data-testid="fx-background" data-ready={canvasOn && ready} data-tier={tier} className={`pointer-events-none fixed inset-0 z-0 overflow-hidden bg-app ${view === 'landing' ? 'dark' : ''}`}>
      <div className={`absolute inset-0 transition-opacity duration-700 ${canvasOn && ready ? 'opacity-0' : 'opacity-100'}`}><StaticNetwork /></div>
      {canvasOn && (
        <FxBoundary onError={() => setFailed(true)}>
          <Suspense fallback={null}>
            <NeuralScene view={view} tier={tierForScene} onReady={() => setReady(true)} onFail={() => setFailed(true)} />
          </Suspense>
        </FxBoundary>
      )}
      {/* In the workspace the swarm sits behind a chat UI, so calm it down for legibility. */}
      {view === 'app' && <div className="absolute inset-0 bg-[var(--app)] opacity-40" />}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,var(--app)_100%)] opacity-70" />
    </div>
  );
}
