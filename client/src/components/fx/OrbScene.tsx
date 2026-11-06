import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float } from '@react-three/drei/core';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, ShaderMaterial } from 'three';
import { pointer } from '../../lib/fx/pointer';
import { ORB_FRAG, ORB_VERT, SAT_FRAG, SAT_VERT } from '../../lib/fx/shaders';

const rgb = (r: number, g: number, b: number) => new Color().setRGB(r / 255, g / 255, b / 255);
const AGENTS = 7; // orbiting points: one per "agent" in the swarm

function circle(radius: number, segments = 128) {
  const pts = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.set([Math.cos(a) * radius, 0, Math.sin(a) * radius], i * 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pts, 3));
  return g;
}

function Orb({ lowDetail, onPulse }: { lowDetail: boolean; onPulse: () => void }) {
  const root = useRef<Group>(null);
  const core = useRef<Group>(null);
  const shell = useRef<Group>(null);
  const hover = useRef({ target: 0 });

  const uniforms = useMemo(() => ({
    uTime: { value: 0 }, uPulse: { value: 0 }, uHover: { value: 0 },
    uCyan: { value: rgb(34, 211, 238) }, uViolet: { value: rgb(167, 139, 250) }, uMagenta: { value: rgb(244, 114, 182) },
    uPixelRatio: { value: 1 }
  }), []);

  const orbMat = useMemo(() => new ShaderMaterial({ vertexShader: ORB_VERT, fragmentShader: ORB_FRAG, uniforms }), [uniforms]);
  const satMat = useMemo(() => new ShaderMaterial({ vertexShader: SAT_VERT, fragmentShader: SAT_FRAG, uniforms, transparent: true, depthWrite: false, blending: AdditiveBlending }), [uniforms]);

  // Satellites: each has its own orbit radius, tilt and speed.
  const sats = useMemo(() => {
    const geo = new BufferGeometry();
    const pos = new Float32Array(AGENTS * 3);
    const size = new Float32Array(AGENTS);
    const tint = new Float32Array(AGENTS);
    const orbit = Array.from({ length: AGENTS }, (_, i) => ({
      r: 1.55 + (i % 3) * 0.24, speed: 0.35 + (i % 4) * 0.11, phase: (i / AGENTS) * Math.PI * 2, tilt: (i * 0.83) % Math.PI
    }));
    orbit.forEach((_, i) => { size[i] = 0.7 + (i % 3) * 0.2; tint[i] = i / (AGENTS - 1); });
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new BufferAttribute(size, 1));
    geo.setAttribute('aTint', new BufferAttribute(tint, 1));
    return { geo, pos, orbit };
  }, []);

  const rings = useMemo(() => [circle(1.62), circle(1.9)], []);
  useEffect(() => () => { orbMat.dispose(); satMat.dispose(); sats.geo.dispose(); rings.forEach(r => r.dispose()); }, [orbMat, satMat, sats, rings]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const k = 1 - Math.exp(-dt * 5);
    uniforms.uTime.value = t;
    uniforms.uPixelRatio.value = state.viewport.dpr;
    uniforms.uPulse.value = Math.max(0, uniforms.uPulse.value - dt * 1.4);
    uniforms.uHover.value += (hover.current.target - uniforms.uHover.value) * k;

    // The orb watches the cursor across the whole page, like a mascot.
    if (root.current) {
      const tx = pointer.active ? pointer.ny * -0.35 : 0;
      const ty = pointer.active ? pointer.nx * 0.55 : 0;
      root.current.rotation.x += (tx - root.current.rotation.x) * k;
      root.current.rotation.y += (ty - root.current.rotation.y) * k;
      const s = 1 + uniforms.uHover.value * 0.05 + uniforms.uPulse.value * 0.06;
      root.current.scale.setScalar(s);
    }
    if (core.current) core.current.rotation.y = t * 0.12;
    if (shell.current) { shell.current.rotation.y = -t * 0.08; shell.current.rotation.x = t * 0.05; }

    sats.orbit.forEach((o, i) => {
      const a = o.phase + t * o.speed;
      const x = Math.cos(a) * o.r, z = Math.sin(a) * o.r;
      // tilt the orbit plane about the x axis
      sats.pos[i * 3] = x;
      sats.pos[i * 3 + 1] = z * Math.sin(o.tilt) * 0.55;
      sats.pos[i * 3 + 2] = z * Math.cos(o.tilt * 0.6);
    });
    sats.geo.attributes.position.needsUpdate = true;
  });

  const detail = lowDetail ? 10 : 22;
  return (
    <Float speed={1.4} rotationIntensity={0.18} floatIntensity={0.45}>
      <group ref={root}>
        <group ref={core}>
          <mesh
            material={orbMat}
            onPointerOver={() => { hover.current.target = 1; }}
            onPointerOut={() => { hover.current.target = 0; }}
            onClick={() => { uniforms.uPulse.value = 1; onPulse(); }}
          >
            <icosahedronGeometry args={[1, detail]} />
          </mesh>
        </group>
        <group ref={shell}>
          <mesh>
            <icosahedronGeometry args={[1.34, 2]} />
            <meshBasicMaterial color="#22d3ee" wireframe transparent opacity={0.16} depthWrite={false} />
          </mesh>
        </group>
        {rings.map((g, i) => (
          <lineLoop key={i} geometry={g} rotation={[i ? 0.9 : -0.5, 0, i ? 0.3 : 0.6]}>
            <lineBasicMaterial color={i ? '#a78bfa' : '#22d3ee'} transparent opacity={0.32} depthWrite={false} />
          </lineLoop>
        ))}
        <points geometry={sats.geo} material={satMat} frustumCulled={false} />
      </group>
    </Float>
  );
}

export default function OrbScene({ lowDetail, paused, onReady, onFail, onPulse }: { lowDetail: boolean; paused: boolean; onReady: () => void; onFail: () => void; onPulse: () => void }) {
  return (
    <Canvas
      dpr={lowDetail ? [1, 1.25] : [1, 2]}
      flat
      frameloop={paused ? 'never' : 'always'}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 38, near: 0.1, far: 30, position: [0, 0, 6.8] }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); onFail(); });
        onReady();
      }}
    >
      <Orb lowDetail={lowDetail} onPulse={onPulse} />
    </Canvas>
  );
}
