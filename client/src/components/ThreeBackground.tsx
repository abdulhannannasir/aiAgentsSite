import { useEffect, useRef } from 'react';

/** Decorative drifting "agent network" behind the UI. Lazy-loaded, dark theme only, and fully optional. */
export default function ThreeBackground() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let teardown = () => undefined as void;

    void (async () => {
      try {
        const THREE = await import('three');
        const mount = host.current;
        if (disposed || !mount) return;

        const w = window.innerWidth;
        const h = window.innerHeight;
        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x0b0c10, 0.015);
        const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 1000);
        camera.position.set(0, 2, 15);
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        mount.appendChild(renderer.domElement);

        const count = w < 768 ? 700 : 1800;
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < pos.length; i++) pos[i] = (Math.random() - 0.5) * 30;
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const starMat = new THREE.PointsMaterial({ color: 0x6366f1, size: 0.025, transparent: true, opacity: 0.7 });
        const stars = new THREE.Points(starGeo, starMat);
        scene.add(stars);

        const colors = [0x3b82f6, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xec4899, 0x06b6d4, 0xf97316, 0xa855f7];
        const nodeGeo = new THREE.IcosahedronGeometry(0.3, 1);
        const nodeMats: InstanceType<typeof THREE.MeshStandardMaterial>[] = [];
        const nodes = colors.map(color => {
          const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.1 });
          nodeMats.push(mat);
          const mesh = new THREE.Mesh(nodeGeo, mat);
          mesh.userData = { speed: 0.3 + Math.random() * 0.5, offset: Math.random() * Math.PI * 2, radius: 4 + Math.random() * 6, angle: Math.random() * Math.PI * 2, baseY: (Math.random() - 0.5) * 6 };
          scene.add(mesh);
          return mesh;
        });

        const pairs: Array<[number, number]> = [];
        for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) pairs.push([i, j]);
        const linePos = new Float32Array(pairs.length * 6);
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
        const lineMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.15 });
        const lines = new THREE.LineSegments(lineGeo, lineMat);
        lines.frustumCulled = false;
        scene.add(lines);
        scene.add(new THREE.AmbientLight(0xffffff, 0.4));
        const light = new THREE.PointLight(0x3b82f6, 2, 30);
        light.position.set(5, 5, 5);
        scene.add(light);

        const onResize = () => {
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', onResize);

        let raf = 0;
        const frame = () => {
          raf = requestAnimationFrame(frame);
          const t = performance.now() * 0.001;
          scene.rotation.y += 0.0006;
          stars.rotation.y = t * 0.03;
          for (const n of nodes) {
            const u = n.userData as { speed: number; offset: number; radius: number; angle: number; baseY: number };
            u.angle += 0.005 * u.speed;
            n.position.set(Math.cos(u.angle) * u.radius, u.baseY + Math.sin(t * u.speed + u.offset) * 0.6, Math.sin(u.angle) * u.radius);
            n.rotation.y += 0.015;
          }
          pairs.forEach(([a, b], k) => {
            linePos.set([nodes[a].position.x, nodes[a].position.y, nodes[a].position.z, nodes[b].position.x, nodes[b].position.y, nodes[b].position.z], k * 6);
          });
          lineGeo.attributes.position.needsUpdate = true;
          renderer.render(scene, camera);
        };
        frame();

        teardown = () => {
          cancelAnimationFrame(raf);
          window.removeEventListener('resize', onResize);
          [starGeo, nodeGeo, lineGeo].forEach(g => g.dispose());
          [starMat, lineMat, ...nodeMats].forEach(m => m.dispose());
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch {
        /* no WebGL or the chunk failed to load: the app is fine without it */
      }
    })();

    return () => { disposed = true; teardown(); };
  }, []);

  return <div ref={host} aria-hidden className="pointer-events-none fixed inset-0 z-0" />;
}
