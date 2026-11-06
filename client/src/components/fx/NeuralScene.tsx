import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei/core';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, MathUtils, PerspectiveCamera, ShaderMaterial, Vector3 } from 'three';
import { buildNetwork, nodesForQuality } from '../../lib/fx/network';
import { pointer, scrollState } from '../../lib/fx/pointer';
import { EDGE_FRAG, EDGE_VERT, NODE_FRAG, NODE_VERT } from '../../lib/fx/shaders';
import type { FxTier } from '../../lib/fx/capability';

interface SceneProps {
  view: 'landing' | 'app';
  tier: Exclude<FxTier, 'off'>;
  onReady: () => void;
  onFail: () => void;
}

// Exact display colours: ShaderMaterial output isn't colour-managed, so set raw sRGB components.
const rgb = (r: number, g: number, b: number) => new Color().setRGB(r / 255, g / 255, b / 255);

/**
 * The agent swarm: instanced nodes (Points) and their links (LineSegments), both drawn with custom GLSL.
 * Every per-frame effect (drift, twinkle, cursor push, travelling pulses) runs in the vertex/fragment shaders,
 * so the CPU's only per-frame work is updating a handful of uniforms and the camera.
 */
function Swarm({ view, tier, quality }: { view: SceneProps['view']; tier: SceneProps['tier']; quality: number }) {
  const high = tier === 'high';
  const count = high ? 190 : 90;
  const net = useMemo(() => buildNetwork(count, { spread: [17, 13, 8], maxDist: high ? 4.8 : 5.4 }), [count, high]);

  // Uniform objects are shared by the node and edge materials so time/cursor/scroll are written once per frame.
  const u = useMemo(() => ({
    uTime: { value: 0 },
    uMouse: { value: new Vector3(0, 0, 0) },
    uMouseStrength: { value: 0 },
    uScroll: { value: 0 },
    uPixelRatio: { value: 1 },
    uSize: { value: high ? 175 : 150 },
    uAlpha: { value: 1 },
    uPulse: { value: high ? 1 : 0 },
    uCyan: { value: rgb(34, 211, 238) },
    uViolet: { value: rgb(167, 139, 250) },
    uMagenta: { value: rgb(244, 114, 182) }
  }), [high]);

  const { nodeGeo, edgeGeo, nodeMat, edgeMat } = useMemo(() => {
    const n = net.nodes.length;
    const pos = new Float32Array(n * 3), phase = new Float32Array(n), size = new Float32Array(n), tint = new Float32Array(n), hub = new Float32Array(n);
    net.nodes.forEach((nd, i) => {
      pos.set([nd.x, nd.y, nd.z], i * 3);
      phase[i] = nd.phase; size[i] = nd.size; tint[i] = nd.tint; hub[i] = nd.hub ? 1 : 0;
    });
    const nodeGeo = new BufferGeometry();
    nodeGeo.setAttribute('position', new BufferAttribute(pos, 3));
    nodeGeo.setAttribute('aPhase', new BufferAttribute(phase, 1));
    nodeGeo.setAttribute('aSize', new BufferAttribute(size, 1));
    nodeGeo.setAttribute('aTint', new BufferAttribute(tint, 1));
    nodeGeo.setAttribute('aHub', new BufferAttribute(hub, 1));

    const e = net.edges.length;
    const ePos = new Float32Array(e * 6), ePhase = new Float32Array(e * 2), eAlong = new Float32Array(e * 2), eSeed = new Float32Array(e * 2), eTint = new Float32Array(e * 2);
    net.edges.forEach((ed, i) => {
      const a = net.nodes[ed.a], b = net.nodes[ed.b];
      ePos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
      ePhase[i * 2] = a.phase; ePhase[i * 2 + 1] = b.phase;
      eAlong[i * 2] = 0; eAlong[i * 2 + 1] = 1;
      eSeed[i * 2] = ed.seed; eSeed[i * 2 + 1] = ed.seed;
      eTint[i * 2] = a.tint; eTint[i * 2 + 1] = b.tint;
    });
    const edgeGeo = new BufferGeometry();
    edgeGeo.setAttribute('position', new BufferAttribute(ePos, 3));
    edgeGeo.setAttribute('aPhase', new BufferAttribute(ePhase, 1));
    edgeGeo.setAttribute('aAlong', new BufferAttribute(eAlong, 1));
    edgeGeo.setAttribute('aSeed', new BufferAttribute(eSeed, 1));
    edgeGeo.setAttribute('aTint', new BufferAttribute(eTint, 1));

    // Vertices drift in the shader, so the CPU-side bounds are wrong; skip culling instead of computing them.
    const common = { transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, uniforms: u };
    const nodeMat = new ShaderMaterial({ ...common, vertexShader: NODE_VERT, fragmentShader: NODE_FRAG });
    const edgeMat = new ShaderMaterial({ ...common, vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG });
    return { nodeGeo, edgeGeo, nodeMat, edgeMat };
  }, [net, u]);

  useEffect(() => () => { nodeGeo.dispose(); edgeGeo.dispose(); nodeMat.dispose(); edgeMat.dispose(); }, [nodeGeo, edgeGeo, nodeMat, edgeMat]);

  // Adaptive quality: draw only the first M nodes and the edges that touch only those (see network.ts).
  useEffect(() => {
    const m = nodesForQuality(net.nodes.length, quality);
    nodeGeo.setDrawRange(0, m);
    edgeGeo.setDrawRange(0, net.edgePrefix[m] * 2);
  }, [net, nodeGeo, edgeGeo, quality]);

  const smooth = useRef({ scroll: 0, strength: 0 });
  useFrame((state, dt) => {
    const cam = state.camera as PerspectiveCamera;
    const k = 1 - Math.exp(-dt * 6);
    const landing = view === 'landing';

    u.uTime.value = state.clock.elapsedTime * (landing ? 1 : 0.55);
    u.uPixelRatio.value = state.viewport.dpr;
    u.uAlpha.value = landing ? 1 : 0.55;

    smooth.current.scroll += ((landing ? scrollState.progress : 0) - smooth.current.scroll) * (1 - Math.exp(-dt * 3));
    const s = smooth.current.scroll;
    u.uScroll.value = s;

    // Cursor on the z=0 plane, using this frame's camera.
    const halfH = Math.tan(MathUtils.degToRad(cam.fov / 2)) * cam.position.z;
    const halfW = halfH * cam.aspect;
    u.uMouse.value.x += (pointer.nx * halfW + cam.position.x - u.uMouse.value.x) * k;
    u.uMouse.value.y += (pointer.ny * halfH + cam.position.y - u.uMouse.value.y) * k;
    const want = pointer.active ? (landing ? 1 : 0.6) : 0;
    smooth.current.strength += (want - smooth.current.strength) * k;
    u.uMouseStrength.value = smooth.current.strength;

    // Scroll flies the camera down and around the swarm; the pointer adds a little parallax.
    const portrait = cam.aspect < 1 ? 1 / Math.sqrt(cam.aspect) : 1;
    const targetX = Math.sin(s * Math.PI * 1.4) * 3.2 + pointer.nx * 0.9;
    const targetY = -s * 7 + pointer.ny * 0.5;
    const targetZ = 14 * portrait - s * 3;
    cam.position.x += (targetX - cam.position.x) * k * 0.7;
    cam.position.y += (targetY - cam.position.y) * k * 0.7;
    cam.position.z += (targetZ - cam.position.z) * k * 0.7;
    cam.lookAt(0, cam.position.y * 0.55, 0);
  });

  return (
    <group>
      <lineSegments geometry={edgeGeo} material={edgeMat} frustumCulled={false} />
      <points geometry={nodeGeo} material={nodeMat} frustumCulled={false} />
    </group>
  );
}

/** Caps the render rate (the workspace sits behind a chat UI and doesn't need 60 fps of background). */
function FrameLimiter({ fps }: { fps: number }) {
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    let raf = 0, last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last >= 1000 / fps - 2) { last = t; invalidate(); }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps, invalidate]);
  return null;
}

export default function NeuralScene({ view, tier, onReady, onFail }: SceneProps) {
  const [quality, setQuality] = useState(1);
  const [maxDpr, setMaxDpr] = useState(tier === 'high' ? 1.5 : 1);

  return (
    <Canvas
      className="!absolute inset-0"
      dpr={[1, maxDpr]}
      flat
      frameloop={view === 'app' ? 'demand' : 'always'}
      gl={{ antialias: false, alpha: true, depth: false, stencil: false, powerPreference: 'high-performance' }}
      camera={{ fov: 55, near: 0.1, far: 80, position: [0, 0, 14] }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); onFail(); });
        onReady();
      }}
    >
      {/* Measures real frame times on this device and sheds work (fewer nodes, lower resolution) when it can't hold ~60 fps. */}
      <PerformanceMonitor
        flipflops={3}
        onDecline={() => { setQuality(q => Math.max(0.35, q - 0.25)); setMaxDpr(1); }}
        onIncline={() => setQuality(q => Math.min(1, q + 0.15))}
        onFallback={() => { setQuality(0.35); setMaxDpr(1); }}
      />
      <Swarm view={view} tier={tier} quality={quality} />
      {view === 'app' && <FrameLimiter fps={30} />}
    </Canvas>
  );
}
