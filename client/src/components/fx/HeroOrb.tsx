import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useFx } from '../../lib/fx/capability';
import { trackInput } from '../../lib/fx/pointer';
import { FxBoundary } from './FxBackground';

const OrbScene = lazy(() => import('./OrbScene'));

/** Pure-CSS orb: shown while the 3D scene loads and whenever WebGL is off or unavailable. */
function CssOrb({ className }: { className?: string }) {
  return (
    <div aria-hidden className={clsx('absolute inset-[12%] transition-opacity duration-700', className)}>
      <div className="absolute inset-0 animate-glow-breathe rounded-full bg-[radial-gradient(circle,rgb(var(--neon-violet)/0.5),rgb(var(--neon-cyan)/0.18)_55%,transparent_72%)] blur-2xl" />
      <div className="absolute inset-[8%] rounded-full border border-neon-cyan/40 bg-[radial-gradient(circle_at_35%_30%,rgb(var(--neon-cyan)/0.45),rgb(var(--neon-violet)/0.25)_45%,#04060c_75%)] shadow-[0_0_60px_-10px_rgb(var(--neon-cyan)/0.6)]" />
      <div className="absolute inset-0 animate-spin-slow rounded-full border border-dashed border-neon-violet/40" />
    </div>
  );
}

/**
 * The interactive hero mascot: a noise-displaced GLSL orb with a wireframe shell, orbit rings and seven agent
 * "satellites". It follows the cursor, swells on hover and ripples on click. Renders only while on screen.
 */
export function HeroOrb({ className, onPulse }: { className?: string; onPulse?: () => void }) {
  const { tier } = useFx();
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => trackInput(), []);

  // Stop rendering when scrolled out of view (and let the GPU rest).
  useEffect(() => {
    const el = host.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '80px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const sceneOn = tier !== 'off' && !failed;
  return (
    <div ref={host} data-testid="hero-orb" data-ready={sceneOn && ready} className={clsx('relative aspect-square w-full', className)}>
      <CssOrb className={sceneOn && ready ? 'opacity-0' : 'opacity-100'} />
      {sceneOn && (
        <FxBoundary onError={() => setFailed(true)}>
          <Suspense fallback={null}>
            <div className="absolute inset-0" data-cursor="card" data-cursor-label="Pulse">
              <OrbScene lowDetail={tier === 'low'} paused={!visible} onReady={() => setReady(true)} onFail={() => setFailed(true)} onPulse={() => onPulse?.()} />
            </div>
          </Suspense>
        </FxBoundary>
      )}
    </div>
  );
}
