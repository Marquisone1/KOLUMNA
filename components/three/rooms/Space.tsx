import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CARD_H, CARD_W, backTexture, plankTexture } from '../textures';
import type { RoomProps } from './types';
import { useBackdrop } from './backdrop';

// The card table in space. Table, chairs and players ride on a round wooden deck that a few small
// thrusters keep afloat. Around it: a dense starfield with the band of the Milky Way, the Earth
// below with its turning cloud cover, the Moon, a ringed planet, the ISS on its slow orbit,
// asteroids, a few cards that got away, the odd shooting star, and a cow in a space helmet
// lounging in the middle distance. The whole sky turns slowly, so the table seems to drift.
// The sun lights everything from one side; the lamp over the table still lights the game.
// Everything is built from primitives and canvas textures. Units: 1 = 10 cm, table top at y = 0.

const FLOOR = -7.4;
const SUN_DIR = new THREE.Vector3(150, 90, 70).normalize();

function useDispose(objs: { dispose: () => void }[]) {
  useEffect(() => () => objs.forEach((o) => o.dispose()), [objs]);
}

// ---------- noise for planet textures ----------

function hash(x: number, y: number, z: number, seed: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x: number, y: number, z: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}
function fbm(x: number, y: number, z: number, seed: number, oct = 5) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, z * f, seed + i); a *= 0.5; f *= 2.03; }
  return s;
}

/** Paint an equirectangular map from a function of the point on the unit sphere (seamless) */
function sphereMap(W: number, H: number, paint: (x: number, y: number, z: number, lat: number) => [number, number, number, number]) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let j = 0; j < H; j++) {
    const lat = Math.PI * (0.5 - (j + 0.5) / H);
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const lon = 2 * Math.PI * ((i + 0.5) / W);
      const [r, g, b, a] = paint(cl * Math.cos(lon), sl, cl * Math.sin(lon), lat);
      const k = (j * W + i) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, t)));

function earthTextures(size: number) {
  const W = size, H = size / 2;
  const deep = [14, 46, 104], shallow = [36, 104, 168], green = [58, 112, 52], dry = [168, 142, 92], ice = [236, 240, 244];
  const surface = sphereMap(W, H, (x, y, z, lat) => {
    const n = fbm(x * 2.2 + 3, y * 2.2, z * 2.2, 1);
    const polar = Math.abs(lat) / (Math.PI / 2);
    if (polar > 0.86 + (n - 0.5) * 0.12) return [...ice, 255] as [number, number, number, number];
    if (n < 0.53) {
      const c = mix(deep, shallow, (n - 0.38) / 0.15);
      return [c[0], c[1], c[2], 255];
    }
    const d = fbm(x * 6, y * 6, z * 6, 9, 3);
    let c = mix(green, dry, (1 - polar) * 1.1 - 0.35 + (d - 0.5) * 0.9);
    c = mix(c, [200, 200, 196], (n - 0.66) * 4);
    return [c[0], c[1], c[2], 255];
  });
  const clouds = sphereMap(W, H, (x, y, z) => {
    const n = fbm(x * 3 + 11, y * 4.5, z * 3, 21);
    const a = Math.max(0, Math.min(1, (n - 0.5) * 3.2));
    return [255, 255, 255, Math.round(a * 235)];
  });
  return { surface, clouds };
}

function moonTexture(size: number) {
  const tex = sphereMap(size, size / 2, (x, y, z) => {
    const n = fbm(x * 3, y * 3, z * 3, 40);
    const mare = fbm(x * 1.4 + 5, y * 1.4, z * 1.4, 44) < 0.44 ? 0.72 : 1;
    const v = (120 + n * 90) * mare;
    return [v, v * 0.98, v * 0.95, 255];
  });
  // a scatter of craters on top
  const ctx = (tex.image as HTMLCanvasElement).getContext('2d')!;
  const W = size, H = size / 2;
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * W, y = H * 0.12 + Math.random() * H * 0.76, r = 2 + Math.random() ** 3 * size * 0.035;
    ctx.fillStyle = 'rgba(30,28,26,0.32)';
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.92, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(240,236,228,0.28)';
    ctx.lineWidth = Math.max(1, r * 0.18);
    ctx.beginPath(); ctx.arc(x - r * 0.12, y - r * 0.12, r, Math.PI * 0.9, Math.PI * 1.9); ctx.stroke();
  }
  tex.needsUpdate = true;
  return tex;
}

function gasTexture() {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const bands = ['#e9cf9c', '#d9a86a', '#f1e2c0', '#c48a55', '#e6c58e', '#b8794a', '#efd9ae'];
  let y = 0;
  while (y < H) {
    const h = 6 + Math.random() * 26;
    ctx.fillStyle = bands[Math.floor(Math.random() * bands.length)];
    ctx.fillRect(0, y, W, h + 1);
    y += h;
  }
  // soften and swirl the band edges
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 18; i++) ctx.drawImage(c, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 6);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(176,96,60,0.75)';
  ctx.beginPath(); ctx.ellipse(W * 0.62, H * 0.62, 22, 11, 0, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ringTexture() {
  const W = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = 4;
  const ctx = c.getContext('2d')!;
  for (let x = 0; x < W; x++) {
    const t = x / W;
    const a = (0.25 + 0.6 * Math.abs(Math.sin(t * 37) * Math.sin(t * 11 + 1))) * (t < 0.05 || t > 0.97 ? 0 : 1) * (t > 0.62 && t < 0.67 ? 0.1 : 1);
    const v = 200 + Math.sin(t * 23) * 30;
    ctx.fillStyle = `rgba(${v},${v * 0.86},${v * 0.66},${a})`;
    ctx.fillRect(x, 0, 1, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The Milky Way: a soft band of faint stars and dust on the inside of a big sphere */
function milkyWayTexture(W: number) {
  const H = W / 2;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * W;
    const y = H / 2 + (Math.random() + Math.random() - 1) * H * 0.12 + Math.sin((x / W) * Math.PI * 2) * H * 0.04;
    const r = H * (0.03 + Math.random() * 0.07);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const warm = Math.random() < 0.3;
    g.addColorStop(0, warm ? 'rgba(120,92,70,0.10)' : 'rgba(84,96,130,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < W * 14; i++) {
    const x = Math.random() * W;
    const y = H / 2 + (Math.random() + Math.random() + Math.random() - 1.5) * H * 0.16;
    const v = 120 + Math.random() * 135;
    ctx.fillStyle = `rgba(${v},${v},${v + 10},${0.25 + Math.random() * 0.5})`;
    ctx.fillRect(x, y, 1, 1);
  }
  // dark dust lane through the middle
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * W;
    const y = H / 2 + (Math.random() - 0.5) * H * 0.04;
    const r = H * (0.015 + Math.random() * 0.03);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(60,50,46,1)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Black and white patches for the cow */
function cowTexture() {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4efe6';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1b1714';
  const blob = (x: number, y: number, r: number) => {
    ctx.beginPath();
    for (let k = 0; k <= 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const rr = r * (0.7 + Math.random() * 0.5);
      ctx.lineTo(x + Math.cos(a) * rr * 1.3, y + Math.sin(a) * rr);
    }
    ctx.fill();
  };
  for (const [x, y, r] of [[40, 40, 22], [120, 80, 26], [200, 34, 20], [70, 104, 14], [176, 100, 16], [236, 76, 14], [8, 90, 12]]) {
    blob(x, y, r);
    if (x - 30 < 0) blob(x + W, y, r);
    if (x + 30 > W) blob(x - W, y, r);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Solar array cells: dark blue-violet with a fine grid and a warm gold sheen */
function solarTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#4a3a2a';
  ctx.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 8) {
    for (let x = 0; x < 64; x += 8) {
      const v = Math.random() * 14;
      ctx.fillStyle = `rgb(${46 + v},${44 + v},${88 + v})`;
      ctx.fillRect(x + 1, y + 1, 6, 6);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Vertical fade for thruster flames: hot white at the nozzle, orange, then nothing */
function flameTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,170,90,0)');
  g.addColorStop(0.45, 'rgba(255,128,48,0.35)');
  g.addColorStop(0.85, 'rgba(255,214,150,0.85)');
  g.addColorStop(1, 'rgba(255,246,226,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft round dot, for the sun's corona and the shooting stars */
function dotTexture(stops: [number, string][]) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- the room ----------

export default function Space({ mobile, reach }: RoomProps) {
  useBackdrop('#020309', null);
  const { invalidate } = useThree();
  const stars = useRef<THREE.Group>(null);
  const sky = useRef<THREE.Group>(null);
  const clock = useRef(0);

  // the stars wheel past slowly while the planets sway and the whole sky rocks a little:
  // the table drifts through space, yet the Earth never leaves the view for long
  useFrame((_, dt) => {
    clock.current += Math.min(dt, 0.25);
    const t = clock.current;
    if (stars.current) stars.current.rotation.y = t * 0.01;
    const g = sky.current;
    if (g) {
      g.rotation.y = Math.sin(t * 0.011) * 0.3;
      g.rotation.x = Math.sin(t * 0.05) * 0.03;
      g.rotation.z = Math.sin(t * 0.037 + 1) * 0.03;
    }
    invalidate();
  });

  return (
    <group>
      {/* sunlight from one side, blue earthshine from below, starlight elsewhere */}
      <directionalLight position={SUN_DIR.clone().multiplyScalar(100).toArray() as [number, number, number]} intensity={1.15} color="#fff3e2" />
      <hemisphereLight args={['#2a3550', '#2c5c9c', 0.22]} />
      <group ref={stars}>
        <Stars mobile={mobile} />
      </group>
      <group ref={sky}>
        <Sun />
        <Earth mobile={mobile} />
        <Moon mobile={mobile} />
        <RingedPlanet />
        <Asteroids count={mobile ? 18 : 40} />
        <ShootingStars />
      </group>
      <Deck reach={reach} />
      <ISS />
      <Cow />
      <LostCards count={mobile ? 3 : 5} reach={reach} />
    </group>
  );
}

// ---------- stars ----------

function Stars({ mobile }: { mobile: boolean }) {
  const { gl } = useThree();
  const dpr = gl.getPixelRatio();
  const layers = useMemo(() => {
    const temps = ['#9bb0ff', '#cad7ff', '#ffffff', '#fff4e8', '#ffd2a1', '#ffb56c'];
    const make = (n: number, size: number, radius: number) => {
      const pos = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        // more stars towards the Milky Way band (the sphere's equator before the tilt)
        let y = Math.random() * 2 - 1;
        if (Math.random() < 0.45) y *= 0.18;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - y * y);
        pos.set([Math.cos(a) * r * radius, y * radius, Math.sin(a) * r * radius], i * 3);
        c.set(temps[Math.floor(Math.random() * temps.length)]).multiplyScalar(0.55 + Math.random() * 0.45);
        col.set([c.r, c.g, c.b], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.PointsMaterial({ size: size * dpr, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false, transparent: true });
      return { geo, mat };
    };
    const k = mobile ? 0.45 : 1;
    return [make(Math.round(5200 * k), 1.1, 380), make(Math.round(1300 * k), 1.8, 376), make(Math.round(160 * k), 2.8, 372)];
  }, [mobile, dpr]);
  const band = useMemo(() => {
    const map = milkyWayTexture(mobile ? 1024 : 2048);
    return { map, mat: new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.9 }) };
  }, [mobile]);
  useDispose(useMemo(() => [...layers.flatMap((l) => [l.geo, l.mat]), band.map, band.mat], [layers, band]));
  return (
    // the band crosses the sky at a slant, like it does on a clear night
    <group rotation={[0.9, 0.4, 0.5]}>
      <mesh material={band.mat} renderOrder={-2}>
        <sphereGeometry args={[390, 48, 24]} />
      </mesh>
      {layers.map((l, i) => <points key={i} geometry={l.geo} material={l.mat} renderOrder={-1} />)}
    </group>
  );
}

function Sun() {
  const tex = useMemo(() => dotTexture([[0, 'rgba(255,252,240,1)'], [0.12, 'rgba(255,246,222,1)'], [0.2, 'rgba(255,214,160,0.35)'], [0.5, 'rgba(255,190,120,0.06)'], [1, 'rgba(255,180,110,0)']]), []);
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }), [tex]);
  useDispose(useMemo(() => [tex, mat], [tex, mat]));
  const p = SUN_DIR.clone().multiplyScalar(360);
  return <sprite material={mat} position={p} scale={[90, 90, 1]} />;
}

// ---------- planets ----------

/** A thin bright rim on the day side of a planet, brighter where the sun grazes it */
function atmosphereMaterial(color: string, power = 3.2, strength = 1.1) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, sun: { value: SUN_DIR.clone() }, power: { value: power }, strength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = normalize(mat3(modelMatrix) * normal);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-(viewMatrix * wp).xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform vec3 sun; uniform float power; uniform float strength;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        float rim = pow(1.0 - max(dot(vN, vV), 0.0), power);
        float lit = smoothstep(-0.25, 0.45, dot(vW, sun));
        gl_FragColor = vec4(color * rim * lit * strength, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
}

function Earth({ mobile }: { mobile: boolean }) {
  const tex = useMemo(() => earthTextures(mobile ? 512 : 1024), [mobile]);
  const mats = useMemo(() => ({
    surface: new THREE.MeshStandardMaterial({ map: tex.surface, roughness: 0.75, metalness: 0, fog: false, envMapIntensity: 0 }),
    clouds: new THREE.MeshStandardMaterial({ map: tex.clouds, transparent: true, roughness: 1, depthWrite: false, fog: false, envMapIntensity: 0 }),
    air: atmosphereMaterial('#6fa8ff'),
  }), [tex]);
  useDispose(useMemo(() => [tex.surface, tex.clouds, ...Object.values(mats)], [tex, mats]));
  const ground = useRef<THREE.Mesh>(null);
  const clouds = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.25);
    if (ground.current) ground.current.rotation.y += d * 0.008;
    if (clouds.current) clouds.current.rotation.y += d * 0.012;
  });
  const R = 230;
  return (
    // far ahead and below: the curve of the Earth rising behind the players on the left
    <group position={[-130, -212, -300]} rotation={[0.25, 0, 0.35]}>
      <mesh ref={ground} material={mats.surface}>
        <sphereGeometry args={[R, 96, 64]} />
      </mesh>
      <mesh ref={clouds} material={mats.clouds} scale={1.012}>
        <sphereGeometry args={[R, 96, 64]} />
      </mesh>
      <mesh material={mats.air} scale={1.03}>
        <sphereGeometry args={[R, 96, 64]} />
      </mesh>
    </group>
  );
}

function Moon({ mobile }: { mobile: boolean }) {
  const tex = useMemo(() => moonTexture(mobile ? 256 : 512), [mobile]);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, fog: false, envMapIntensity: 0 }), [tex]);
  useDispose(useMemo(() => [tex, mat], [tex, mat]));
  return (
    <mesh material={mat} position={[150, 95, -270]} rotation-y={-1.2}>
      <sphereGeometry args={[18, 48, 32]} />
    </mesh>
  );
}

function RingedPlanet() {
  const tex = useMemo(() => ({ body: gasTexture(), ring: ringTexture() }), []);
  const parts = useMemo(() => {
    const ring = new THREE.RingGeometry(34, 62, 128, 1);
    // map the texture across the ring's width
    const uv = ring.attributes.uv;
    const pos = ring.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (r - 34) / 28, 0.5);
    }
    return { ring };
  }, []);
  const mats = useMemo(() => ({
    body: new THREE.MeshStandardMaterial({ map: tex.body, roughness: 0.9, fog: false, envMapIntensity: 0 }),
    ring: new THREE.MeshStandardMaterial({ map: tex.ring, transparent: true, side: THREE.DoubleSide, roughness: 1, depthWrite: false, fog: false, envMapIntensity: 0 }),
  }), [tex]);
  useDispose(useMemo(() => [tex.body, tex.ring, parts.ring, mats.body, mats.ring], [tex, parts, mats]));
  return (
    <group position={[-250, 110, -40]} rotation={[0.35, 0.6, 0.28]}>
      <mesh material={mats.body}>
        <sphereGeometry args={[26, 64, 40]} />
      </mesh>
      <mesh geometry={parts.ring} material={mats.ring} rotation-x={-Math.PI / 2} />
    </group>
  );
}

// ---------- things floating by ----------

function Asteroids({ count }: { count: number }) {
  const { geo, mat, mesh, spin } = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      v.multiplyScalar(0.72 + fbm(v.x * 1.7 + 4, v.y * 1.7, v.z * 1.7, 61, 3) * 0.6);
      p.setXYZ(i, v.x, v.y * 0.8, v.z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: '#7a7066', roughness: 0.95, flatShading: true, fog: false, envMapIntensity: 0.2 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const spin: { pos: THREE.Vector3; rot: THREE.Euler; vel: THREE.Vector3; s: THREE.Vector3 }[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // a loose belt off to the right and behind, away from the planets
      const a = -0.6 + Math.random() * 2.4;
      const r = 110 + Math.random() * 120;
      const s = 0.8 + Math.random() ** 2 * 6;
      spin.push({
        pos: new THREE.Vector3(Math.cos(a) * r, -40 + Math.random() * 90, -Math.sin(a) * r),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        vel: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.25),
        s: new THREE.Vector3(s, s * (0.7 + Math.random() * 0.4), s * (0.8 + Math.random() * 0.4)),
      });
      mesh.setColorAt(i, c.set('#8a7f72').multiplyScalar(0.7 + Math.random() * 0.5));
    }
    return { geo, mat, mesh, spin };
  }, [count]);
  useDispose(useMemo(() => [geo, mat], [geo, mat]));
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.25);
    spin.forEach((a, i) => {
      a.rot.x += a.vel.x * d;
      a.rot.y += a.vel.y * d;
      a.rot.z += a.vel.z * d;
      m.compose(a.pos, q.setFromEuler(a.rot), a.s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} />;
}

function ShootingStars() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 4;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.85, 'rgba(220,232,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 4);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }), [tex]);
  useDispose(useMemo(() => [tex, mat], [tex, mat]));
  const mesh = useRef<THREE.Mesh>(null);
  const st = useRef({ wait: 4, t: -1, from: new THREE.Vector3(), dir: new THREE.Vector3(), dur: 0.9 });
  useFrame((_, dt) => {
    const s = st.current;
    const m = mesh.current;
    if (!m) return;
    const d = Math.min(dt, 0.25);
    if (s.t < 0) {
      s.wait -= d;
      m.visible = false;
      if (s.wait > 0) return;
      // somewhere in the upper half of the sky, mostly in front of you
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      s.from.set(Math.cos(a) * 300, 40 + Math.random() * 120, Math.sin(a) * 300);
      s.dir.set(Math.random() - 0.5, -0.35 - Math.random() * 0.3, Math.random() - 0.5).normalize();
      s.t = 0;
      s.dur = 0.7 + Math.random() * 0.6;
    }
    s.t += d;
    const k = s.t / s.dur;
    if (k >= 1) {
      s.t = -1;
      s.wait = 5 + Math.random() * 9;
      m.visible = false;
      return;
    }
    m.visible = true;
    m.position.copy(s.from).addScaledVector(s.dir, k * 120);
    m.lookAt(m.position.clone().add(s.dir));
    m.rotateY(Math.PI / 2);
    (m.material as THREE.MeshBasicMaterial).opacity = Math.sin(k * Math.PI);
  });
  return (
    <mesh ref={mesh} material={mat} visible={false}>
      <planeGeometry args={[24, 0.35]} />
    </mesh>
  );
}

/** The space station on a slow orbit around the table, turning to keep its arrays to the sun */
function ISS() {
  const group = useRef<THREE.Group>(null);
  const built = useMemo(() => {
    const solar = solarTexture();
    const mats = {
      white: new THREE.MeshStandardMaterial({ color: '#e8e6e0', roughness: 0.5, metalness: 0.2, fog: false }),
      foil: new THREE.MeshStandardMaterial({ color: '#d9b25e', roughness: 0.35, metalness: 0.8, fog: false }),
      truss: new THREE.MeshStandardMaterial({ color: '#a7a8a6', roughness: 0.55, metalness: 0.6, fog: false }),
      solar: new THREE.MeshStandardMaterial({ map: solar, roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide, fog: false }),
      dark: new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.6, fog: false }),
    };
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, 0, rz);
      g.add(m);
      return m;
    };
    // the long truss with its joints
    add(new THREE.BoxGeometry(30, 0.7, 0.7), mats.truss, 0, 0, 0);
    for (const x of [-13, -9, 9, 13]) add(new THREE.BoxGeometry(0.9, 0.9, 0.9), mats.dark, x, 0, 0);
    // four pairs of solar array wings
    const wing = new THREE.PlaneGeometry(2.4, 11);
    for (const x of [-14.6, -11.2, 11.2, 14.6]) {
      for (const s of [-1, 1]) {
        const w = add(wing, mats.solar, x, 0, s * 6.2, -Math.PI / 2);
        w.rotation.y = 0.2;
        add(new THREE.BoxGeometry(0.12, 0.12, 11), mats.truss, x, 0, s * 6.2);
      }
    }
    // white radiators
    for (const x of [-5, 5]) add(new THREE.BoxGeometry(1.6, 0.06, 5), mats.white, x, -2.6, 0, 0, 0.3);
    // pressurised modules along the other axis, with gold foil end caps
    const mod = new THREE.CylinderGeometry(1, 1, 5, 20);
    for (const [z, len] of [[-2.8, 1], [2.8, 1], [7.6, 0.9], [-7.4, 0.8]] as const) {
      const m = add(mod, mats.white, 0, -1.2, z, Math.PI / 2);
      m.scale.set(1, len, 1);
    }
    add(new THREE.CylinderGeometry(1, 1, 4.4, 20), mats.white, -3.4, -1.2, 2.8, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(1.02, 1.02, 0.4, 20), mats.foil, 0, -1.2, 10.1, Math.PI / 2);
    add(new THREE.CylinderGeometry(1.02, 1.02, 0.4, 20), mats.foil, 0, -1.2, -9.6, Math.PI / 2);
    // the cupola: a small dome with dark windows
    add(new THREE.SphereGeometry(0.8, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.dark, 0, -2.2, -3, Math.PI);
    g.scale.setScalar(1.25);
    return { g, mats, solar };
  }, []);
  useEffect(() => () => {
    built.g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    Object.values(built.mats).forEach((m) => m.dispose());
    built.solar.dispose();
  }, [built]);
  const t = useRef(Math.random() * 100);
  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.25);
    const g = group.current;
    if (!g) return;
    // a wide, tilted orbit; one lap in about four minutes
    const a = t.current * 0.026 + 1.2;
    g.position.set(Math.cos(a) * 95, 26 + Math.sin(a * 0.5) * 8, Math.sin(a) * 80 - 30);
    g.rotation.set(0.35, -a + Math.PI / 2, 0.15);
  });
  return <group ref={group}><primitive object={built.g} /></group>;
}

/** A cow in a space helmet, lounging on her back in the middle distance and turning slowly */
function Cow() {
  const built = useMemo(() => {
    const hide = cowTexture();
    const mats = {
      hide: new THREE.MeshStandardMaterial({ map: hide, roughness: 0.85, fog: false }),
      head: new THREE.MeshStandardMaterial({ color: '#f1ebe2', roughness: 0.8, fog: false }),
      dark: new THREE.MeshStandardMaterial({ color: '#1b1714', roughness: 0.7, fog: false }),
      pink: new THREE.MeshStandardMaterial({ color: '#e8a3a0', roughness: 0.6, fog: false }),
      horn: new THREE.MeshStandardMaterial({ color: '#e9dcc0', roughness: 0.5, fog: false }),
      glass: new THREE.MeshStandardMaterial({ color: '#cfe4ff', transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.1, envMapIntensity: 2, depthWrite: false, fog: false }),
      brass: new THREE.MeshStandardMaterial({ color: '#c9a063', roughness: 0.3, metalness: 1, fog: false }),
    };
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      g.add(m);
      return m;
    };
    // body along x, head at +x
    add(new THREE.CapsuleGeometry(0.85, 1.9, 6, 16), mats.hide, 0, 0, 0, 0, 0, Math.PI / 2);
    const leg = new THREE.CylinderGeometry(0.2, 0.17, 1.3, 10);
    const hoof = new THREE.CylinderGeometry(0.19, 0.21, 0.24, 10);
    for (const [x, z, sx, sz] of [[0.95, 0.45, 0.25, 0.2], [0.95, -0.45, 0.2, -0.25], [-0.95, 0.45, -0.15, 0.3], [-0.95, -0.45, -0.3, -0.15]]) {
      // legs splayed a little, the way you lie when nothing pulls you down
      add(leg, mats.head, x, -1.2, z, sz, 0, sx);
      add(hoof, mats.dark, x + sx * -0.6, -1.85, z + sz * 0.6, sz, 0, sx);
    }
    add(new THREE.SphereGeometry(0.34, 14, 10), mats.pink, -0.55, -0.82, 0);
    const head = new THREE.Group();
    head.position.set(1.85, 0.45, 0);
    head.rotation.z = -0.25;
    g.add(head);
    const h = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      head.add(m);
    };
    h(new THREE.BoxGeometry(0.9, 0.8, 0.8), mats.head, 0.2, 0, 0);
    h(new THREE.BoxGeometry(0.45, 0.5, 0.72), mats.pink, 0.72, -0.12, 0);
    h(new THREE.SphereGeometry(0.08, 8, 6), mats.dark, 0.95, -0.05, 0.18);
    h(new THREE.SphereGeometry(0.08, 8, 6), mats.dark, 0.95, -0.05, -0.18);
    h(new THREE.SphereGeometry(0.1, 10, 8), mats.dark, 0.5, 0.18, 0.4);
    h(new THREE.SphereGeometry(0.1, 10, 8), mats.dark, 0.5, 0.18, -0.4);
    h(new THREE.ConeGeometry(0.09, 0.4, 8), mats.horn, 0.05, 0.55, 0.32, 0.4);
    h(new THREE.ConeGeometry(0.09, 0.4, 8), mats.horn, 0.05, 0.55, -0.32, -0.4);
    h(new THREE.BoxGeometry(0.16, 0.12, 0.44), mats.dark, 0.0, 0.25, 0.6, 0.3);
    h(new THREE.BoxGeometry(0.16, 0.12, 0.44), mats.dark, 0.0, 0.25, -0.6, -0.3);
    // the helmet: a clear bubble on a brass collar
    h(new THREE.SphereGeometry(1.05, 28, 20), mats.glass, 0.3, 0.05, 0);
    h(new THREE.TorusGeometry(0.72, 0.09, 8, 28), mats.brass, -0.4, -0.05, 0, 0, Math.PI / 2);
    // a tail with a dark tuft, floating loose
    add(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), mats.head, -2.0, 0.3, 0, 0, 0, 0.9);
    add(new THREE.SphereGeometry(0.16, 8, 6), mats.dark, -2.5, 0.68, 0);
    g.scale.setScalar(2.3);
    return { g, mats, hide };
  }, []);
  useEffect(() => () => {
    built.g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    Object.values(built.mats).forEach((m) => m.dispose());
    built.hide.dispose();
  }, [built]);
  const group = useRef<THREE.Group>(null);
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.25);
    const k = t.current;
    const g = group.current;
    if (!g) return;
    // above and behind the players, a little left of centre, drifting in a lazy loop
    g.position.set(-16 + Math.sin(k * 0.07) * 6, 19 + Math.sin(k * 0.11) * 2, -70 + Math.cos(k * 0.07) * 5);
    g.rotation.set(Math.PI * 0.85 + Math.sin(k * 0.09) * 0.25, k * 0.05, Math.sin(k * 0.06) * 0.3);
  });
  return <group ref={group}><primitive object={built.g} /></group>;
}

/** A few cards that slipped off the table at some point, tumbling away into the dark */
function LostCards({ count, reach }: { count: number; reach: number }) {
  const mats = useMemo(() => ({
    back: new THREE.MeshStandardMaterial({ map: backTexture(), roughness: 0.6, fog: false }),
    face: new THREE.MeshStandardMaterial({ color: '#f6f0e4', roughness: 0.6, fog: false }),
  }), []);
  // the back texture is shared with the table's cards, so only the materials are ours to dispose
  useDispose(useMemo(() => [mats.back, mats.face], [mats]));
  const geo = useMemo(() => new THREE.PlaneGeometry(CARD_W * 3, CARD_H * 3), []);
  useDispose(useMemo(() => [geo], [geo]));
  const cards = useMemo(() => Array.from({ length: count }, (_, i) => {
    // well clear of the players and never right in front of your face: off to the sides and behind the others
    const a = Math.PI + (0.3 + (i / Math.max(1, count - 1)) * 0.45) * Math.PI * (i % 2 ? 1 : -1);
    const r = reach + 16 + Math.random() * 14;
    return {
      base: new THREE.Vector3(Math.sin(a) * r, 9 + Math.random() * 10, Math.cos(a) * r),
      spin: new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6),
      phase: Math.random() * 10,
    };
  }), [count, reach]);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.25);
    cards.forEach((c, i) => {
      const g = refs.current[i];
      if (!g) return;
      const k = t.current + c.phase;
      g.position.set(c.base.x + Math.sin(k * 0.13) * 1.5, c.base.y + Math.sin(k * 0.2) * 0.8, c.base.z + Math.cos(k * 0.11) * 1.5);
      g.rotation.set(k * c.spin.x, k * c.spin.y, k * c.spin.z);
    });
  });
  return (
    <group>
      {cards.map((_, i) => (
        <group key={i} ref={(el) => { refs.current[i] = el; }}>
          <mesh geometry={geo} material={mats.back} />
          <mesh geometry={geo} material={mats.face} rotation-y={Math.PI} />
        </group>
      ))}
    </group>
  );
}

// ---------- the deck everyone sits on ----------

function Deck({ reach }: { reach: number }) {
  const R = reach + 3;
  const tex = useMemo(() => {
    const planks = plankTexture();
    planks.repeat.set(R / 6, R / 6);
    return { planks, flame: flameTexture() };
  }, [R]);
  const mats = useMemo(() => ({
    planks: new THREE.MeshStandardMaterial({ map: tex.planks, roughness: 0.6, envMapIntensity: 0.4 }),
    hull: new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.45, metalness: 0.7, envMapIntensity: 0.8, side: THREE.DoubleSide }),
    brass: new THREE.MeshStandardMaterial({ color: '#c9a063', roughness: 0.3, metalness: 1, envMapIntensity: 1.1 }),
    nozzle: new THREE.MeshStandardMaterial({ color: '#25282d', roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide }),
    flame: new THREE.MeshBasicMaterial({ map: tex.flame, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    red: new THREE.MeshBasicMaterial({ color: '#ff4a3a' }),
    green: new THREE.MeshBasicMaterial({ color: '#46e07a' }),
    white: new THREE.MeshBasicMaterial({ color: '#fff6e8' }),
  }), [tex]);
  const parts = useMemo(() => {
    const top = new THREE.CircleGeometry(R, 96);
    top.rotateX(-Math.PI / 2);
    // the hull below the deck: a shallow bowl
    const hull = new THREE.LatheGeometry([
      new THREE.Vector2(0.01, -3.4), new THREE.Vector2(R * 0.35, -3.1), new THREE.Vector2(R * 0.8, -1.6), new THREE.Vector2(R, -0.3), new THREE.Vector2(R, 0),
    ], 96);
    const rim = new THREE.TorusGeometry(R, 0.22, 10, 128);
    rim.rotateX(Math.PI / 2);
    const nozzle = new THREE.CylinderGeometry(0.75, 1.15, 1.4, 20, 1, true);
    const flame = new THREE.ConeGeometry(0.95, 5, 20, 1, true);
    flame.rotateX(Math.PI);
    flame.translate(0, -2.5, 0);
    return { top, hull, rim, nozzle, flame };
  }, [R]);
  useDispose(useMemo(() => [...Object.values(tex), ...Object.values(mats), ...Object.values(parts)], [tex, mats, parts]));
  const flames = useRef<(THREE.Mesh | null)[]>([]);
  const lights = useRef<(THREE.Mesh | null)[]>([]);
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.25);
    const k = t.current;
    flames.current.forEach((f, i) => {
      if (!f) return;
      const s = 0.85 + Math.sin(k * 23 + i * 1.7) * 0.08 + Math.sin(k * 41 + i) * 0.06;
      f.scale.set(1, s, 1);
    });
    // navigation lights: steady red and green, a short white blink
    const blink = (k % 1.6) < 0.08;
    lights.current.forEach((l, i) => { if (l && i === 2) l.visible = blink; });
  });
  const thrusters = [0, 1, 2, 3].map((i) => {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    return [Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5] as const;
  });
  return (
    <group position={[0, FLOOR, 0]}>
      <mesh geometry={parts.top} material={mats.planks} receiveShadow />
      <mesh geometry={parts.hull} material={mats.hull} />
      <mesh geometry={parts.rim} material={mats.brass} />
      {thrusters.map(([x, z], i) => (
        <group key={i} position={[x, -2.6 + (Math.hypot(x, z) / R) * 1.4, z]}>
          <mesh geometry={parts.nozzle} material={mats.nozzle} position-y={-0.9} />
          <mesh ref={(el) => { flames.current[i] = el; }} geometry={parts.flame} material={mats.flame} position-y={-1.5} />
        </group>
      ))}
      {/* navigation lights on the rim, left red, right green, a white strobe at the back */}
      {([[-R, 0.3, 0, 'red'], [R, 0.3, 0, 'green'], [0, 0.3, -R, 'white']] as const).map(([x, y, z, c], i) => (
        <mesh key={i} ref={(el) => { lights.current[i] = el; }} position={[x, y, z]} material={mats[c]}>
          <sphereGeometry args={[0.22, 10, 8]} />
        </mesh>
      ))}
    </group>
  );
}
