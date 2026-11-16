import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { leatherTexture, plankTexture, signTexture, wallpaperTexture, woodTexture } from '../textures';
import type { RoomProps } from './types';

// A plain neighbourhood bar around the card table: plank floor, wainscoted walls,
// a long counter with a brass foot rail, a mirrored back bar with lit shelves and bottles,
// stools, a painted sign, windows onto the night, a dartboard and two empty side tables.
// Everything is built from primitives and canvas textures. Units: 1 = 10 cm, table top at y = 0.

const FLOOR = -7.4;
const CEIL = 21;
const BACK_Z = -42;
const FRONT_Z = 36;
const SIDE_X = 44;
const COUNTER_Z = -27;
const COUNTER_TOP = 3.6;

function useDispose(objs: { dispose: () => void }[]) {
  useEffect(() => () => objs.forEach((o) => o.dispose()), [objs]);
}

export default function Bar({ mobile }: RoomProps) {
  const tex = useMemo(() => {
    const floor = plankTexture();
    const wall = wallpaperTexture('#1f5562');
    const wood = woodTexture('#7a4a28', 80);
    wood.repeat.set(6, 1);
    const darkWood = woodTexture('#4a2c18', 80);
    darkWood.repeat.set(8, 1);
    const leather = leatherTexture('#b8402c');
    leather.repeat.set(2, 2);
    const sign = signTexture('Kolumna', 'BAR · KARTEN · SPIELABEND');
    return { floor, wall, wood, darkWood, leather, sign };
  }, []);

  const mats = useMemo(() => ({
    floor: new THREE.MeshStandardMaterial({ map: tex.floor, roughness: 0.62, envMapIntensity: 0.5 }),
    wall: new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.9 }),
    wainscot: new THREE.MeshStandardMaterial({ map: tex.darkWood, roughness: 0.55, envMapIntensity: 0.6 }),
    wood: new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.45, envMapIntensity: 0.8 }),
    top: new THREE.MeshStandardMaterial({ map: tex.darkWood, roughness: 0.28, envMapIntensity: 1 }),
    brass: new THREE.MeshStandardMaterial({ color: '#c9a063', roughness: 0.3, metalness: 1, envMapIntensity: 1.1 }),
    iron: new THREE.MeshStandardMaterial({ color: '#1c1916', roughness: 0.5, metalness: 0.6 }),
    leather: new THREE.MeshStandardMaterial({ map: tex.leather, roughness: 0.5, envMapIntensity: 0.6 }),
    mirror: new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.08, metalness: 1, envMapIntensity: 0.9 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 0.95 }),
    beam: new THREE.MeshStandardMaterial({ map: tex.darkWood, roughness: 0.7 }),
    shelfLight: new THREE.MeshBasicMaterial({ color: '#ffd59a' }),
    bulb: new THREE.MeshBasicMaterial({ color: '#ffe3b8' }),
    shade: new THREE.MeshStandardMaterial({ color: '#e2452f', roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide }),
    sign: new THREE.MeshStandardMaterial({ map: tex.sign, roughness: 0.6 }),
    night: new THREE.MeshBasicMaterial({ color: '#0b1520' }),
    frame: new THREE.MeshStandardMaterial({ color: '#2a1a10', roughness: 0.5 }),
  }), [tex]);
  useDispose(useMemo(() => [...Object.values(tex), ...Object.values(mats)], [tex, mats]));

  return (
    <group>
      <Shell mats={mats} />
      <Counter mats={mats} />
      <BackBar mats={mats} mobile={mobile} />
      <Stools mats={mats} />
      <WindowsWall mats={mats} />
      <SideWalls mats={mats} />
      <SideTables mats={mats} />
      <StringLights mobile={mobile} />
      <Bunting />
      <Plants />
      <Posters />
      {/* fill light for the room so it reads warm and open, not a dark cave */}
      <hemisphereLight args={['#fff1dc', '#5a3a22', 0.45]} />
      {/* pendants over the counter */}
      {[-14, 0, 14].map((x, i) => (
        <Pendant key={x} x={x} z={COUNTER_Z - 2} y={14.5} mats={mats} light={!mobile || i === 1} />
      ))}
    </group>
  );
}

type Mats = Record<string, THREE.Material>;

function Box({ size, pos, mat, rot, shadow = false }: { size: [number, number, number]; pos: [number, number, number]; mat: THREE.Material; rot?: [number, number, number]; shadow?: boolean }) {
  return (
    <mesh position={pos} rotation={rot} material={mat} castShadow={shadow} receiveShadow={shadow}>
      <boxGeometry args={size} />
    </mesh>
  );
}

/** Floor, walls with wainscoting, ceiling with beams */
function Shell({ mats }: { mats: Mats }) {
  const W = SIDE_X * 2;
  const D = FRONT_Z - BACK_Z;
  const cz = (FRONT_Z + BACK_Z) / 2;
  const wainTop = FLOOR + 9;
  const wallH = CEIL - FLOOR;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, FLOOR, cz]} material={mats.floor} receiveShadow>
        <planeGeometry args={[W, D]} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position={[0, CEIL, cz]} material={mats.ceiling}>
        <planeGeometry args={[W, D]} />
      </mesh>
      {Array.from({ length: 7 }, (_, i) => (
        <Box key={i} size={[W, 1.2, 1.6]} pos={[0, CEIL - 0.6, BACK_Z + 6 + i * 11]} mat={mats.beam} />
      ))}
      {/* walls: wallpaper above, panelled wood below, a moulding between */}
      {[
        { pos: [0, 0, BACK_Z] as const, rot: 0, len: W },
        { pos: [0, 0, FRONT_Z] as const, rot: Math.PI, len: W },
        { pos: [-SIDE_X, 0, cz] as const, rot: Math.PI / 2, len: D },
        { pos: [SIDE_X, 0, cz] as const, rot: -Math.PI / 2, len: D },
      ].map((w, i) => (
        <group key={i} position={[w.pos[0], 0, w.pos[2]]} rotation-y={w.rot}>
          <mesh position={[0, FLOOR + wallH / 2, 0]} material={mats.wall}>
            <planeGeometry args={[w.len, wallH]} />
          </mesh>
          <Box size={[w.len, wainTop - FLOOR, 0.5]} pos={[0, (FLOOR + wainTop) / 2, 0.25]} mat={mats.wainscot} />
          <Box size={[w.len, 0.5, 0.9]} pos={[0, wainTop, 0.45]} mat={mats.wood} />
          <Box size={[w.len, 1.2, 0.7]} pos={[0, FLOOR + 0.6, 0.35]} mat={mats.wood} />
        </group>
      ))}
    </group>
  );
}

/** The counter: panelled front, thick polished top, brass foot rail on posts */
function Counter({ mats }: { mats: Mats }) {
  const L = 54;
  const D = 6;
  const h = COUNTER_TOP - FLOOR;
  return (
    <group position={[0, 0, COUNTER_Z - D / 2]}>
      <Box size={[L, h - 0.6, D - 0.6]} pos={[0, FLOOR + (h - 0.6) / 2, 0]} mat={mats.wood} shadow />
      {/* raised panels on the front */}
      {Array.from({ length: 9 }, (_, i) => (
        <Box key={i} size={[4.6, h - 4.2, 0.25]} pos={[-L / 2 + 3 + i * 6, FLOOR + (h - 0.6) / 2 + 0.2, D / 2 - 0.2]} mat={mats.wainscot} />
      ))}
      <Box size={[L + 1.2, 0.7, D + 1.4]} pos={[0, COUNTER_TOP - 0.35, 0.3]} mat={mats.top} shadow />
      {/* foot rail */}
      <mesh position={[0, FLOOR + 2.2, D / 2 + 1.6]} rotation-z={Math.PI / 2} material={mats.brass}>
        <cylinderGeometry args={[0.28, 0.28, L - 2, 16]} />
      </mesh>
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} position={[-L / 2 + 2 + i * ((L - 4) / 6), FLOOR + 2.2, D / 2 + 0.9]} rotation-x={Math.PI / 2} material={mats.brass}>
          <cylinderGeometry args={[0.16, 0.16, 1.4, 10]} />
        </mesh>
      ))}
      {/* a few things on the counter */}
      <Taps x={-8} mats={mats} />
      <Glass x={6} z={0.8} />
      <Glass x={7.4} z={-0.6} />
      <Glass x={-16} z={0.4} />
    </group>
  );
}

function Taps({ x, mats }: { x: number; mats: Mats }) {
  return (
    <group position={[x, COUNTER_TOP, -0.8]}>
      <Box size={[5, 0.6, 1.2]} pos={[0, 2.6, 0]} mat={mats.brass} />
      {[-1.6, 0, 1.6].map((dx) => (
        <group key={dx} position={[dx, 0, 0]}>
          <mesh position={[0, 1.3, 0]} material={mats.brass}>
            <cylinderGeometry args={[0.18, 0.22, 2.6, 10]} />
          </mesh>
          <mesh position={[0, 3.6, 0.1]} material={mats.wainscot}>
            <cylinderGeometry args={[0.2, 0.26, 1.6, 10]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const glassMat = new THREE.MeshStandardMaterial({ color: '#d8e2de', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, envMapIntensity: 1.2 });
const beerMat = new THREE.MeshStandardMaterial({ color: '#c9842a', roughness: 0.2, transparent: true, opacity: 0.85 });
function Glass({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, COUNTER_TOP, z]}>
      <mesh position={[0, 0.9, 0]} material={glassMat}>
        <cylinderGeometry args={[0.45, 0.38, 1.8, 20, 1, true]} />
      </mesh>
      <mesh position={[0, 0.7, 0]} material={beerMat}>
        <cylinderGeometry args={[0.4, 0.35, 1.3, 20]} />
      </mesh>
    </group>
  );
}

/** Mirrored back bar: lower cabinets, three lit shelves of bottles, the sign above */
function BackBar({ mats, mobile }: { mats: Mats; mobile: boolean }) {
  const L = 50;
  const z = BACK_Z + 0.3;
  const shelves = [2.2, 6.4, 10.6];
  const bottles = useMemo(() => {
    const profile = [
      new THREE.Vector2(0, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.55, 0.1), new THREE.Vector2(0.55, 2.2),
      new THREE.Vector2(0.45, 2.6), new THREE.Vector2(0.2, 2.9), new THREE.Vector2(0.18, 3.6), new THREE.Vector2(0.21, 3.7), new THREE.Vector2(0, 3.7),
    ];
    const geom = new THREE.LatheGeometry(profile, 14);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0, transparent: true, opacity: 0.88, envMapIntensity: 1.3 });
    const colors = ['#5a3a12', '#2f4a2a', '#7a5a2a', '#c9b48a', '#3b1d16', '#24402f', '#8f6a2e', '#d8cdb0'];
    const per = mobile ? 14 : 22;
    const mesh = new THREE.InstancedMesh(geom, mat, per * shelves.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    let i = 0;
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    shelves.forEach((y) => {
      for (let k = 0; k < per; k++) {
        const x = -L / 2 + 2 + (k + rnd() * 0.4) * ((L - 4) / per);
        const s = 0.8 + rnd() * 0.45;
        m.compose(new THREE.Vector3(x, y + 0.2, z + 1.4 + rnd() * 0.5), q, new THREE.Vector3(s, s * (0.85 + rnd() * 0.3), s));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.set(colors[Math.floor(rnd() * colors.length)]));
        i++;
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [mobile]);
  useEffect(() => () => { bottles.geometry.dispose(); (bottles.material as THREE.Material).dispose(); bottles.dispose(); }, [bottles]);
  return (
    <group>
      <Box size={[L, 7.5, 3.6]} pos={[0, FLOOR + 3.75, z + 1.8]} mat={mats.wood} />
      <Box size={[L + 0.6, 0.5, 4]} pos={[0, FLOOR + 7.7, z + 2]} mat={mats.top} />
      <mesh position={[0, 7.4, z + 0.05]} material={mats.mirror}>
        <planeGeometry args={[L - 2, 13]} />
      </mesh>
      {/* frame around the mirror */}
      <Box size={[L, 1, 0.8]} pos={[0, 14.4, z + 0.4]} mat={mats.wood} />
      {[-L / 2, L / 2].map((x) => <Box key={x} size={[1, 14, 0.8]} pos={[x, 7.4, z + 0.4]} mat={mats.wood} />)}
      {shelves.map((y) => (
        <group key={y}>
          <Box size={[L - 2, 0.25, 2.6]} pos={[0, y, z + 1.4]} mat={mats.wood} />
          <Box size={[L - 2, 0.12, 0.12]} pos={[0, y + 0.05, z + 2.7]} mat={mats.brass} />
          {/* a warm strip under each shelf lights the bottles below */}
          <mesh position={[0, y - 0.16, z + 2.2]} rotation-x={Math.PI / 2} material={mats.shelfLight}>
            <planeGeometry args={[L - 4, 0.12]} />
          </mesh>
        </group>
      ))}
      <primitive object={bottles} />
      <pointLight position={[0, 9, z + 5]} intensity={mobile ? 45 : 60} distance={40} decay={1.5} color="#ffd59a" />
      {/* the sign */}
      <mesh position={[0, 17.4, z + 0.6]} material={mats.sign}>
        <boxGeometry args={[22, 5.5, 0.5]} />
      </mesh>
    </group>
  );
}

function Stools({ mats }: { mats: Mats }) {
  return (
    <group>
      {[-20, -12, -4, 4, 12, 20].map((x, i) => (
        <group key={x} position={[x, 0, COUNTER_Z + 3.2]} rotation-y={(i % 2 ? 1 : -1) * 0.15}>
          <mesh position={[0, 0.3, 0]} material={mats.leather} castShadow>
            <cylinderGeometry args={[1.6, 1.5, 0.7, 24]} />
          </mesh>
          <mesh position={[0, FLOOR / 2, 0]} material={mats.brass}>
            <cylinderGeometry args={[0.22, 0.3, -FLOOR, 10]} />
          </mesh>
          <mesh position={[0, FLOOR + 3, 0]} rotation-x={Math.PI / 2} material={mats.brass}>
            <torusGeometry args={[1.1, 0.1, 8, 24]} />
          </mesh>
          <mesh position={[0, FLOOR + 0.15, 0]} material={mats.iron}>
            <cylinderGeometry args={[1.4, 1.5, 0.3, 24]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** A pendant over the counter; one real light, the others only look lit */
function Pendant({ x, y, z, mats, light }: { x: number; y: number; z: number; mats: Mats; light: boolean }) {
  const geom = useMemo(() => new THREE.LatheGeometry([new THREE.Vector2(0.25, 1.2), new THREE.Vector2(0.5, 1.05), new THREE.Vector2(1.3, 0.3), new THREE.Vector2(1.7, 0)], 32), []);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, (CEIL - y) / 2 + 0.6, 0]} material={mats.iron}>
        <cylinderGeometry args={[0.03, 0.03, CEIL - y, 6]} />
      </mesh>
      <mesh geometry={geom} material={mats.shade} />
      <mesh position={[0, 0.35, 0]} material={mats.bulb}>
        <sphereGeometry args={[0.32, 16, 10]} />
      </mesh>
      {light && <pointLight position={[0, -0.4, 0]} intensity={45} distance={32} decay={1.5} color="#ffd9a6" />}
    </group>
  );
}

/** The wall behind you: windows onto the night street, a door */
function WindowsWall({ mats }: { mats: Mats }) {
  const z = FRONT_Z - 0.3;
  const night = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#0a121c');
    g.addColorStop(1, '#1a2230');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 256);
    // a few lit windows across the street
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(255,${190 + Math.random() * 40},${110 + Math.random() * 40},${0.25 + Math.random() * 0.4})`;
      ctx.fillRect(Math.random() * 120, 120 + Math.random() * 110, 6, 9);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t });
  }, []);
  useEffect(() => () => { night.map?.dispose(); night.dispose(); }, [night]);
  return (
    <group position={[0, 0, z]} rotation-y={Math.PI}>
      {[-24, -8, 24].map((x) => (
        <group key={x} position={[x, 7, 0]}>
          <mesh material={night}><planeGeometry args={[10, 14]} /></mesh>
          <Box size={[11, 0.6, 0.8]} pos={[0, 7.2, 0.2]} mat={mats.frame} />
          <Box size={[11, 0.8, 1.2]} pos={[0, -7.2, 0.4]} mat={mats.frame} />
          {[-5.2, 0, 5.2].map((dx) => <Box key={dx} size={[0.5, 14, 0.6]} pos={[dx, 0, 0.2]} mat={mats.frame} />)}
          <Box size={[10.4, 0.35, 0.5]} pos={[0, 2.5, 0.2]} mat={mats.frame} />
        </group>
      ))}
      {/* door */}
      <group position={[8, FLOOR + 10, 0]}>
        <Box size={[8, 20, 0.6]} pos={[0, 0, 0.3]} mat={mats.wainscot} />
        <Box size={[9, 0.8, 1]} pos={[0, 10.2, 0.5]} mat={mats.frame} />
        <mesh position={[2.8, -1, 0.75]} material={mats.brass}><sphereGeometry args={[0.35, 12, 8]} /></mesh>
        <mesh position={[0, 5, 0.65]} material={night}><planeGeometry args={[5, 6]} /></mesh>
      </group>
    </group>
  );
}

/** Side walls: framed pictures, a dartboard, small sconces */
function SideWalls({ mats }: { mats: Mats }) {
  const dart = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.translate(128, 128);
    const rings = [[124, '#1b1a17'], [100, '#e8dcc0'], [92, '#1b1a17'], [62, '#e8dcc0'], [54, '#1b1a17'], [16, '#5d8a5e'], [7, '#b5482f']] as const;
    rings.forEach(([r, col], k) => {
      for (let i = 0; i < 20; i++) {
        ctx.fillStyle = k > 0 && k < 5 && i % 2 ? (k % 2 ? '#b5482f' : '#5d8a5e') : col;
        if (k >= 5) ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, (i / 20) * Math.PI * 2 - Math.PI / 20, ((i + 1) / 20) * Math.PI * 2 - Math.PI / 20);
        ctx.fill();
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
  }, []);
  useEffect(() => () => { dart.map?.dispose(); dart.dispose(); }, [dart]);
  return (
    <group>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * (SIDE_X - 0.3), 0, 0]} rotation-y={-side * Math.PI / 2}>
          {/* sconces */}
          {[-6, 18].map((zz) => (
            <group key={zz} position={[zz * side, 11, 0.6]}>
              <Box size={[0.6, 1.2, 0.4]} pos={[0, 0, 0]} mat={mats.brass} />
              <mesh position={[0, 0.9, 0.5]} material={mats.bulb}><sphereGeometry args={[0.38, 12, 8]} /></mesh>
            </group>
          ))}
        </group>
      ))}
      {/* the dartboard on the left wall, near the bar */}
      <group position={[-SIDE_X + 0.4, 8, -26]} rotation-y={Math.PI / 2}>
        <mesh material={mats.wainscot} position={[0, 0, -0.1]}><cylinderGeometry args={[3.2, 3.2, 0.3, 32]} /></mesh>
        <mesh material={dart} position={[0, 0, 0.1]}><circleGeometry args={[2.6, 48]} /></mesh>
      </group>
    </group>
  );
}

/** Two empty side tables with chairs and a candle, so the room is not just for us */
function SideTables({ mats }: { mats: Mats }) {
  return (
    <group>
      {[[-30, 18], [31, 14]].map(([x, z]) => (
        <group key={x} position={[x, 0, z]}>
          <mesh position={[0, -0.25, 0]} material={mats.top} castShadow receiveShadow>
            <cylinderGeometry args={[4, 4, 0.5, 40]} />
          </mesh>
          <mesh position={[0, (FLOOR - 0.5) / 2, 0]} material={mats.iron}>
            <cylinderGeometry args={[0.4, 0.5, -FLOOR - 0.5, 12]} />
          </mesh>
          <mesh position={[0, FLOOR + 0.15, 0]} material={mats.iron}>
            <cylinderGeometry args={[2, 2.2, 0.3, 24]} />
          </mesh>
          <mesh position={[0, 0.6, 0]} material={mats.bulb}><cylinderGeometry args={[0.25, 0.25, 1.2, 12]} /></mesh>
          {[0, 1, 2].map((k) => {
            const a = (k / 3) * Math.PI * 2 + x;
            return (
              <group key={k} position={[Math.sin(a) * 5.4, 0, Math.cos(a) * 5.4]} rotation-y={a + Math.PI}>
                <Box size={[3.6, 0.35, 3.4]} pos={[0, -3, 0]} mat={mats.wood} />
                <Box size={[3.6, 4.2, 0.3]} pos={[0, -0.9, 1.6]} mat={mats.wood} />
                {[[-1.6, -1.5], [1.6, -1.5], [-1.6, 1.5], [1.6, 1.5]].map(([lx, lz]) => (
                  <Box key={`${lx}${lz}`} size={[0.25, 4.3, 0.25]} pos={[lx, FLOOR + 2.15, lz]} mat={mats.wood} />
                ))}
              </group>
            );
          })}
        </group>
      ))}
    </group>
  );
}

// The card colours, used for the bulbs, the pennants and the posters
const TIER = ['#3560c4', '#62cbef', '#47ad61', '#f7cb3a', '#e74c35'];

/** A sagging catenary between two points, for strings of lights and pennants */
function sag(a: THREE.Vector3, b: THREE.Vector3, drop: number, n: number) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    p.y -= drop * 4 * t * (1 - t);
    return p;
  });
}

/** Festoon lights across the room: warm and coloured bulbs on a dark cable */
function StringLights({ mobile }: { mobile: boolean }) {
  const { cable, bulbs } = useMemo(() => {
    const runs = [
      [new THREE.Vector3(-SIDE_X + 1, 17.5, -30), new THREE.Vector3(SIDE_X - 1, 17.5, -14)],
      [new THREE.Vector3(-SIDE_X + 1, 17.5, -10), new THREE.Vector3(SIDE_X - 1, 17.5, 6)],
      [new THREE.Vector3(-SIDE_X + 1, 17.5, 12), new THREE.Vector3(SIDE_X - 1, 17.5, 28)],
    ];
    const points: THREE.Vector3[][] = runs.map(([a, b]) => sag(a, b, 3.2, mobile ? 14 : 22));
    const cable = points.map((pts) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.05, 4));
    const geo = new THREE.SphereGeometry(0.32, 10, 8);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const count = points.reduce((n, p) => n + p.length - 2, 0);
    const bulbs = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let i = 0;
    points.forEach((pts) => pts.slice(1, -1).forEach((p, k) => {
      m.makeTranslation(p.x, p.y - 0.45, p.z);
      bulbs.setMatrixAt(i, m);
      // mostly warm white, every third bulb in a card colour, softened toward the warm light
      bulbs.setColorAt(i, k % 3 === 1 ? c.set(TIER[(k + i) % TIER.length]).lerp(new THREE.Color('#ffffff'), 0.25) : c.set('#ffe2b0'));
      i++;
    }));
    bulbs.instanceMatrix.needsUpdate = true;
    return { cable, bulbs };
  }, [mobile]);
  useEffect(() => () => { cable.forEach((g) => g.dispose()); bulbs.geometry.dispose(); (bulbs.material as THREE.Material).dispose(); bulbs.dispose(); }, [cable, bulbs]);
  const cableMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#1a1410' }), []);
  return (
    <group>
      {cable.map((g, i) => <mesh key={i} geometry={g} material={cableMat} />)}
      <primitive object={bulbs} />
    </group>
  );
}

/** A pennant garland in the card colours along the back bar */
function Bunting() {
  const flags = useMemo(() => {
    const pts = sag(new THREE.Vector3(-26, 20.6, BACK_Z + 1.2), new THREE.Vector3(26, 20.6, BACK_Z + 1.2), 1.6, 26);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.85, 0, 0, 0.85, 0, 0, 0, -1.7, 0], 3));
    tri.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(tri, mat, pts.length - 1);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i].clone().lerp(pts[i + 1], 0.5);
      m.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(TIER[i % TIER.length]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    const line = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.04, 4);
    return { mesh, line };
  }, []);
  useEffect(() => () => { flags.mesh.geometry.dispose(); flags.line.dispose(); }, [flags]);
  return (
    <group>
      <primitive object={flags.mesh} />
      <mesh geometry={flags.line}><meshBasicMaterial color="#f2e8d6" /></mesh>
    </group>
  );
}

/** Potted plants in the corners and by the windows */
function Plants() {
  const parts = useMemo(() => {
    const pot = new THREE.MeshStandardMaterial({ color: '#c8643c', roughness: 0.8 });
    const leaf = new THREE.MeshStandardMaterial({ color: '#3f8f4a', roughness: 0.7, side: THREE.DoubleSide });
    const leafDark = new THREE.MeshStandardMaterial({ color: '#2d6e3a', roughness: 0.7, side: THREE.DoubleSide });
    const leafGeo = new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    leafGeo.scale(0.5, 2.6, 1.3);
    return { pot, leaf, leafDark, leafGeo };
  }, []);
  useEffect(() => () => { Object.values(parts).forEach((p) => p.dispose()); }, [parts]);
  const spots: [number, number, number][] = [[-SIDE_X + 4, BACK_Z + 4, 1.2], [SIDE_X - 4, BACK_Z + 4, 1.2], [-SIDE_X + 4, FRONT_Z - 4, 1], [SIDE_X - 4, FRONT_Z - 4, 1], [-16, FRONT_Z - 3, 0.8], [16, FRONT_Z - 3, 0.8]];
  return (
    <group>
      {spots.map(([x, z, sc], i) => (
        <group key={i} position={[x, FLOOR, z]} scale={sc}>
          <mesh position={[0, 1.6, 0]} material={parts.pot} castShadow>
            <cylinderGeometry args={[1.6, 1.2, 3.2, 20]} />
          </mesh>
          {Array.from({ length: 9 }, (_, k) => (
            <mesh
              key={k}
              geometry={parts.leafGeo}
              material={k % 2 ? parts.leaf : parts.leafDark}
              position={[0, 3.1, 0]}
              rotation={[0.35 + (k % 3) * 0.18, (k / 9) * Math.PI * 2, 0]}
              scale={1 + (k % 3) * 0.25}
            />
          ))}
        </group>
      ))}
    </group>
  );
}

/** Bright posters with big card numerals, the house style of the bar */
function Posters() {
  const mats = useMemo(() => [12, -2, 0, 7].map((v, i) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 360;
    const ctx = c.getContext('2d')!;
    const ink = v < 0 ? TIER[0] : v === 0 ? TIER[1] : v <= 4 ? TIER[2] : v <= 8 ? TIER[3] : TIER[4];
    ctx.fillStyle = '#fbf3e4';
    ctx.fillRect(0, 0, 256, 360);
    ctx.fillStyle = ink;
    ctx.fillRect(18, 18, 220, 250);
    ctx.fillStyle = v === 0 || (v > 4 && v <= 8) ? '#1b2430' : '#ffffff';
    ctx.font = "600 150px 'Fraunces', Georgia, serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(v < 0 ? '\u2212' + Math.abs(v) : String(v), 128, 150);
    ctx.fillStyle = '#1b2430';
    ctx.font = "600 26px 'Instrument Sans', system-ui, sans-serif";
    ctx.fillText(['Spielabend', 'Jeden Freitag', 'Kolumna', 'Drei gleiche r\u00e4umen ab'][i], 128, 312);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.75 });
  }), []);
  useEffect(() => () => mats.forEach((m) => { m.map?.dispose(); m.dispose(); }), [mats]);
  const spots: { pos: [number, number, number]; rot: number }[] = [
    { pos: [-SIDE_X + 0.4, 9, -6], rot: Math.PI / 2 },
    { pos: [-SIDE_X + 0.4, 9, 6], rot: Math.PI / 2 },
    { pos: [SIDE_X - 0.4, 9, -2], rot: -Math.PI / 2 },
    { pos: [SIDE_X - 0.4, 9, 10], rot: -Math.PI / 2 },
  ];
  return (
    <group>
      {spots.map((s, i) => (
        <mesh key={i} position={s.pos} rotation-y={s.rot} material={mats[i]}>
          <planeGeometry args={[6, 8.4]} />
        </mesh>
      ))}
    </group>
  );
}
