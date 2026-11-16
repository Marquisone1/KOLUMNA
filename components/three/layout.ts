import * as THREE from 'three';
import { CARD_H, CARD_W } from './textures';

// Table geometry in world units (1 unit ≈ 10 cm, a card is 63 × 88 mm).
// The local player always sits at the front (+Z), facing −Z. The others follow
// clockwise as seen from above: the next player sits to your left.

export const GAP = 0.08;
export const PITCH_X = CARD_W + GAP;
export const PITCH_Z = CARD_H + GAP;
export const GRID_W = 4 * CARD_W + 3 * GAP;
export const GRID_D = 3 * CARD_H + 2 * GAP;
/** Thickness used when stacking cards */
export const CARD_T = 0.004;

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** turn around the vertical axis */
  yaw: number;
  /** tilt about the card's short axis, positive tips the face toward +Z */
  tilt: number;
  /** turn about the card's long axis: 0 face up, π face down */
  flip: number;
  s: number;
}

export interface Seat {
  x: number;
  z: number;
  yaw: number;
  s: number;
  /** angle around the table, 0 = front */
  angle: number;
}

export interface Layout {
  seats: Seat[];
  deck: { x: number; z: number };
  discard: { x: number; z: number };
  handMine: Pose;
  table: { rx: number; rz: number; cz: number };
  camera: { pos: THREE.Vector3; target: THREE.Vector3; fov: number };
  portrait: boolean;
}

/** Rotate a seat-local offset into world space */
export function seatPoint(seat: Seat, lx: number, lz: number) {
  const c = Math.cos(seat.yaw);
  const s = Math.sin(seat.yaw);
  const x = lx * seat.s;
  const z = lz * seat.s;
  return { x: seat.x + c * x + s * z, z: seat.z - s * x + c * z };
}

/** Where a grid card sits: column c of `cols`, row r (0 = far row, toward the centre) */
export function slotPose(seat: Seat, cols: number, c: number, r: number, up: boolean): Pose {
  const lx = (c - (cols - 1) / 2) * PITCH_X;
  const lz = (r - 1) * PITCH_Z;
  const p = seatPoint(seat, lx, lz);
  return { x: p.x, y: CARD_T, z: p.z, yaw: seat.yaw, tilt: 0, flip: up ? 0 : Math.PI, s: seat.s };
}

/** The card an opponent holds: raised in front of their grid, tipped toward them */
export function opponentHandPose(seat: Seat, up: boolean): Pose {
  const p = seatPoint(seat, 0, -(GRID_D / 2 + 0.62));
  return { x: p.x, y: 0.55 * seat.s, z: p.z, yaw: seat.yaw, tilt: 0.95, flip: up ? 0 : Math.PI, s: seat.s };
}

/** Where a seat's name plate goes: just outside the grid's outer edge */
export function labelAnchor(seat: Seat, mine: boolean) {
  const p = seatPoint(seat, 0, mine ? GRID_D / 2 + 0.3 : GRID_D / 2 + 0.42);
  return new THREE.Vector3(p.x, 0, p.z);
}

function spread(m: number, portrait: boolean) {
  if (m <= 0) return [];
  if (m === 1) return [Math.PI];
  const range = portrait ? (m <= 2 ? 84 : m <= 3 ? 130 : 170) : 210;
  const step = Math.min(120, range / (m - 1));
  return Array.from({ length: m }, (_, i) => ((180 + (i - (m - 1) / 2) * step) * Math.PI) / 180);
}

export function computeLayout(n: number, meIdx: number, aspect: number, hudTop: number, hudBottom: number): Layout {
  const portrait = aspect < 0.9;
  const m = Math.max(0, n - 1);
  const oppScale = portrait ? (m <= 1 ? 0.9 : m <= 2 ? 0.74 : m <= 3 ? 0.62 : 0.54) : (m <= 2 ? 0.95 : 0.85);
  const zMe = portrait ? 2.75 : 2.65;
  const rz = portrait ? 1.75 + GRID_D * 0.5 * oppScale + (m >= 3 ? 0.3 : 0) : 1.95 + GRID_D * 0.5 * oppScale;
  const rx = portrait
    ? (m <= 2 ? 2.4 : 2.6)
    : 2.05 + GRID_W * 0.5 * oppScale + (m >= 4 ? 0.35 : 0);

  const seats: Seat[] = new Array(n);
  const me = Math.max(0, meIdx);
  const angles = spread(m, portrait);
  // Push the ring outward until no two grids (and no grid and the piles) overlap
  const R = (sc: number) => 1.86 * sc;
  const place = (k: number) => angles.map((a) => ({ x: -Math.sin(a) * rx * k, z: Math.cos(a) * rz * k, yaw: -a, s: oppScale, angle: a }));
  let k = 1;
  for (; k < 3; k += 0.03) {
    const ss = place(k);
    let ok = true;
    for (let i = 0; i < ss.length && ok; i++) {
      const a = ss[i];
      if (Math.hypot(a.x, a.z - zMe) < R(a.s) + 1.62) ok = false;
      if (Math.hypot(a.x + 0.4, a.z) < R(a.s) + 1.15) ok = false;
      for (let j = i + 1; j < ss.length && ok; j++) if (Math.hypot(a.x - ss[j].x, a.z - ss[j].z) < R(a.s) + R(ss[j].s)) ok = false;
    }
    if (ok) break;
  }
  seats[me] = { x: 0, z: zMe, yaw: 0, s: 1, angle: 0 };
  place(k).forEach((seat, i) => { seats[(me + 1 + i) % n] = seat; });

  const deck = { x: -0.78, z: 0.05 };
  const discard = { x: 0.0, z: 0.05 };
  const handMine: Pose = { x: 0.95, y: 0.62, z: 0.55, yaw: 0, tilt: 0.78, flip: 0, s: 1.08 };

  // Table top: a rounded oblong that holds every grid with a margin
  let maxX = GRID_W / 2;
  let minZ = -2.2;
  seats.forEach((seat) => {
    if (!seat) return;
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = seatPoint(seat, (lx * GRID_W) / 2, (lz * GRID_D) / 2);
      maxX = Math.max(maxX, Math.abs(p.x));
      minZ = Math.min(minZ, p.z);
    }
  });
  maxX = Math.max(maxX, handMine.x + 0.5);
  const far = minZ - 0.75;
  const near = zMe + GRID_D / 2 + 0.6;
  const table = { rx: maxX + 1.0, rz: (near - far) / 2, cz: (near + far) / 2 };

  // Points the camera has to keep in view: every grid corner and the piles
  const pts: THREE.Vector3[] = [];
  seats.forEach((seat, i) => {
    if (!seat) return;
    const hw = GRID_W / 2 + 0.05;
    const hd = GRID_D / 2 + 0.05;
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
      const p = seatPoint(seat, lx, lz);
      pts.push(new THREE.Vector3(p.x, 0, p.z));
    }
    pts.push(labelAnchor(seat, i === me).setY(i === me ? -0.25 : 0.2));
  });
  pts.push(new THREE.Vector3(deck.x - 0.4, 0, deck.z - 0.5));
  pts.push(new THREE.Vector3(handMine.x + 0.45, handMine.y + 0.3, handMine.z));

  const fov = portrait ? 50 : 40;
  // Landscape uses a fixed view. Portrait has height to spare, so look down more steeply
  // and keep the angle that shows your own grid largest.
  const mine = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => new THREE.Vector3((a * GRID_W) / 2, 0, zMe + (b * GRID_D) / 2));
  let camera = fitCamera(pts, aspect, fov, (54 * Math.PI) / 180, new THREE.Vector3(0, 0, zMe * 0.25), hudTop, hudBottom);
  if (portrait) {
    let best = -1;
    for (let deg = 52; deg <= 80; deg += 4) {
      const c = fitCamera(pts, aspect, fov, (deg * Math.PI) / 180, new THREE.Vector3(0, 0, zMe * 0.25), hudTop, hudBottom);
      const w = screenWidth(mine, c, aspect);
      if (w > best) { best = w; camera = c; }
    }
  }
  return { seats, deck, discard, handMine, table, camera, portrait };
}

function screenWidth(pts: THREE.Vector3[], c: { pos: THREE.Vector3; target: THREE.Vector3; fov: number }, aspect: number) {
  const cam = new THREE.PerspectiveCamera(c.fov, aspect, 0.1, 200);
  cam.position.copy(c.pos);
  cam.lookAt(c.target);
  cam.updateMatrixWorld();
  let x0 = Infinity, x1 = -Infinity;
  for (const p of pts) {
    const v = p.clone().project(cam);
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
  }
  return x1 - x0;
}

/**
 * Pull the camera back along a fixed pitch until every point fits between the HUD margins
 * (given in normalised device units), then centre the content vertically.
 */
function fitCamera(pts: THREE.Vector3[], aspect: number, fov: number, pitch: number, target: THREE.Vector3, top: number, bottom: number) {
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 200);
  const dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
  const yMax = 1 - top;
  const yMin = -1 + bottom;
  const xMax = 0.94;
  const v = new THREE.Vector3();
  const place = (d: number) => {
    cam.position.copy(target).addScaledVector(dir, d);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
  };
  const bounds = () => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      v.copy(p).project(cam);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    return { x0, x1, y0, y1 };
  };
  let d = 10;
  for (let pass = 0; pass < 3; pass++) {
    let lo = 2;
    let hi = 60;
    for (let i = 0; i < 30; i++) {
      d = (lo + hi) / 2;
      place(d);
      const b = bounds();
      const fits = b.x0 >= -xMax && b.x1 <= xMax && (b.y1 - b.y0) <= (yMax - yMin);
      if (fits) hi = d;
      else lo = d;
    }
    d = hi;
    place(d);
    // Shift the target along the table so the content sits between the margins
    const b = bounds();
    const off = (b.y0 + b.y1) / 2 - (yMax + yMin) / 2;
    if (Math.abs(off) < 0.005) break;
    // move along the table's depth axis; the projected shift is roughly linear in it
    const probe = 0.5;
    target.z += probe;
    place(d);
    const b2 = bounds();
    const slope = ((b2.y0 + b2.y1) / 2 - (b.y0 + b.y1) / 2) / probe;
    target.z -= probe;
    if (Math.abs(slope) > 1e-4) target.z -= off / slope;
  }
  place(d);
  return { pos: cam.position.clone(), target: target.clone(), fov };
}
