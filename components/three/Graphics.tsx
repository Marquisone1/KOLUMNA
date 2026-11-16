import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Lighting beyond what the lights alone give: ambient occlusion, a bounce from the felt,
// the lamp's cone in the room's haze, and a watchdog that steps quality down on slow devices.

export type Quality = 'high' | 'normal';

/** True when the URL sets the quality (?gfx=high or ?gfx=low); then it is never changed automatically */
export function qualityForced(): boolean {
  try { return new URLSearchParams(location.search).has('gfx'); } catch { return false; }
}

export function initialQuality(width: number): Quality {
  try {
    const q = new URLSearchParams(location.search).get('gfx');
    if (q === 'low' || q === 'normal') return 'normal';
    if (q === 'high') return 'high';
  } catch { /* ignore */ }
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return width >= 900 && !coarse ? 'high' : 'normal';
}

/**
 * Renders through a composer: the scene, ground-truth ambient occlusion (contact shadows in
 * corners, under cards and furniture, where figures meet the table), SMAA, then tone mapping.
 * Taking over the render loop is what a useFrame with priority 1 does in react-three-fiber.
 */
export function PostEffects() {
  const { gl, scene, camera, size } = useThree();
  const composer = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, size.width, size.height);
    ao.output = GTAOPass.OUTPUT.Default;
    ao.blendIntensity = 0.85;
    ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 12 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    c.addPass(ao);
    c.addPass(new SMAAPass());
    c.addPass(new OutputPass());
    return c;
  }, [gl, scene, camera]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
  }, [composer, gl, size.width, size.height]);
  useEffect(() => () => composer.dispose(), [composer]);
  useFrame((_, dt) => composer.render(dt), 1);
  return null;
}

/**
 * Indirect light from the table: the lamp's light falls on the green felt and comes back up,
 * tinting faces, hands and the undersides of held cards. One soft light just above the felt.
 */
export function FeltBounce({ radius }: { radius: number }) {
  return <pointLight position={[0, 1.4, 0]} intensity={14} distance={radius + 9} decay={1.8} color="#5fae7e" />;
}

/** The lamp's cone made visible in the room's air: a faint warm haze, densest near the bulb */
export function LampHaze({ lampY, radius }: { lampY: number; radius: number }) {
  const mat = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(255,226,180,0.55)');
    g.addColorStop(0.5, 'rgba(255,226,180,0.12)');
    g.addColorStop(1, 'rgba(255,226,180,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.07, fog: false });
  }, []);
  useEffect(() => () => { mat.map?.dispose(); mat.dispose(); }, [mat]);
  const h = lampY - 0.4;
  return (
    <mesh position={[0, h / 2 + 0.2, 0]} material={mat} raycast={() => {}} renderOrder={2}>
      <cylinderGeometry args={[2.3, radius * 0.92, h, 64, 1, true]} />
    </mesh>
  );
}

/** Steps quality down when frames stay slow for a couple of seconds */
export function QualityWatch({ onSlow }: { onSlow: () => void }) {
  const acc = useRef({ t: 0, n: 0, slow: 0, done: false });
  useFrame((_, dt) => {
    const a = acc.current;
    if (a.done) return;
    a.t += dt;
    a.n++;
    if (a.t >= 1) {
      const fps = a.n / a.t;
      a.slow = fps < 28 ? a.slow + 1 : 0;
      a.t = 0;
      a.n = 0;
      if (a.slow >= 3) {
        a.done = true;
        onSlow();
      }
    }
  });
  return null;
}
