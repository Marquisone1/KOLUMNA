import * as THREE from 'three';
import { CARD_H, CARD_W } from './textures';

// Table geometry in world units (1 unit ≈ 10 cm, a card is 63 × 88 mm, the table top is y = 0).
// You sit at the front (+Z) and look across the table; the camera is your eyes.
// The others follow clockwise as seen from above: the next player sits to your left.

export const GAP = 0.08;
export const PITCH_X = CARD_W + GAP;
export const PITCH_Z = CARD_H + GAP;
export const GRID_W = 4 * CARD_W + 3 * GAP;
export const GRID_D = 3 * CARD_H + 2 * GAP;
/** Thickness used when stacking cards */
export const CARD_T = 0.007;
/** From a grid's centre to the table edge in front of its player */
export const EDGE = GRID_D / 2 + 1.05;
/** From a grid's centre to where its player sits */
export const SITTER = EDGE + 1.6;
/** Eye height above the table top */
export const EYE_Y = 4.8;

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
  /** on the turntable, in its own frame (it turns to face the player whose turn it is) */
  deck: { x: number; z: number };
  discard: { x: number; z: number };
  toss: { x: number; z: number };
  handMine: Pose;
  /** radius of the round table top */
  table: { r: number };
  eye: THREE.Vector3;
  camera: { pos: THREE.Vector3; target: THREE.Vector3; fov: number };
  portrait: boolean;
}

/** Rotate a seat-local offset into world space (local +Z points away from the table centre); offsets scale with the seat */
export function seatPoint(seat: Seat, lx: number, lz: number) {
  return seatPointRaw(seat, lx * seat.s, lz * seat.s);
}

/** Same, without the seat's scale: for distances that belong to the room, not the cards */
export function seatPointRaw(seat: Seat, x: number, z: number) {
  const c = Math.cos(seat.yaw);
  const s = Math.sin(seat.yaw);
  return { x: seat.x + c * x + s * z, z: seat.z - s * x + c * z };
}

/** From a seat's grid centre to the table edge in front of its player */
export function edgeOf(seat: Seat) {
  return (GRID_D / 2) * seat.s + 1.05;
}

/**
 * Opponents' cards are drawn larger than yours: from across a big table at the same size
 * they would be hard to read, and reading them is the game. The piles in the middle too.
 */
export const OPPONENT_SCALE = 1.35;
/** Deck and discard pile on the turntable */
export const PILE_SCALE = 1.85;

/** Where a grid card sits: column c of `cols`, row r (0 = far row, toward the centre) */
export function slotPose(seat: Seat, cols: number, c: number, r: number, up: boolean): Pose {
  const lx = (c - (cols - 1) / 2) * PITCH_X;
  const lz = (r - 1) * PITCH_Z;
  const p = seatPoint(seat, lx, lz);
  // cards lie the way their owner reads them, as on a real table
  return { x: p.x, y: CARD_T, z: p.z, yaw: seat.yaw, tilt: 0, flip: up ? 0 : Math.PI, s: seat.s };
}

/** The card an opponent holds: up in their hands above the table edge, face toward them */
export function opponentHandPose(seat: Seat, up: boolean): Pose {
  const p = seatPointRaw(seat, 0.45, edgeOf(seat) + 0.2);
  return { x: p.x, y: 2.1, z: p.z, yaw: seat.yaw, tilt: 1.15, flip: up ? 0 : Math.PI, s: seat.s };
}

/** Where a seat's player sits, at table-top height */
export function sitterPoint(seat: Seat) {
  const p = seatPointRaw(seat, 0, edgeOf(seat) + 1.6);
  return new THREE.Vector3(p.x, 0, p.z);
}

/** Everyone sits evenly round the table, as at a real one: with n players, one every 360/n degrees */
function spread(m: number) {
  const n = m + 1;
  return Array.from({ length: m }, (_, i) => ((i + 1) / n) * Math.PI * 2);
}

export function computeLayout(n: number, meIdx: number, aspect: number, hudTop: number, hudBottom: number): Layout {
  if (meIdx < 0) return spectatorLayout(n, aspect, hudTop, hudBottom);
  const portrait = aspect < 0.9;
  const m = Math.max(0, n - 1);
  const angles = spread(m);

  // Grids sit on a circle. Grow it until neither grids nor the people behind them crowd each other.
  let R = m <= 1 ? 5.2 : 6.2;
  const seatAt = (a: number, r: number): Seat => ({ x: -Math.sin(a) * r, z: Math.cos(a) * r, yaw: -a, s: a === 0 ? 1 : OPPONENT_SCALE, angle: a });
  for (; R < 14; R += 0.1) {
    const all = [0, ...angles].map((a) => seatAt(a, R));
    let ok = true;
    for (let i = 0; i < all.length && ok; i++) {
      for (let j = i + 1; j < all.length && ok; j++) {
        if (Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z) < 2.15 * (all[i].s + all[j].s)) ok = false;
        if (sitterPoint(all[i]).distanceTo(sitterPoint(all[j])) < 7.2) ok = false;
      }
      if (Math.hypot(all[i].x, all[i].z) < 2.0 + 1.55 * all[i].s + 0.8) ok = false;
    }
    if (ok) break;
  }
  const seats: Seat[] = new Array(n);
  const me = Math.max(0, meIdx);
  seats[me] = seatAt(0, R);
  angles.forEach((a, i) => { seats[(me + 1 + i) % n] = seatAt(a, R); });

  // deck and discard sit side by side on the turntable in the middle (its own frame)
  const deck = { x: -0.8, z: 0 };
  const discard = { x: 0.8, z: 0 };
  // the button that rises out of the table, to your right
  const toss = portrait ? { x: 0, z: R + GRID_D / 2 + 0.75 } : { x: GRID_W / 2 + 1.0, z: R + 0.2 };

  const sit = sitterPoint(seats[me]);
  // sitting back in the chair, looking over your cards
  const eye = new THREE.Vector3(0, EYE_Y, sit.z + 0.4);
  // The card you hold: up in front of you, to the right, turned to your eyes
  const hp = portrait ? new THREE.Vector3(0.75, 2.0, R - 0.6) : new THREE.Vector3(1.45, 1.6, R - 0.2);
  const toEye = eye.clone().sub(hp);
  const handMine: Pose = { x: hp.x, y: hp.y, z: hp.z, yaw: 0, tilt: Math.atan2(toEye.z, toEye.y), flip: 0, s: 1.05 };

  const table = { r: R + Math.max(...seats.filter(Boolean).map(edgeOf)) };

  // What the eyes should take in, most important first
  const must: THREE.Vector3[] = [];
  const grids: THREE.Vector3[] = [];
  const heads: THREE.Vector3[] = [];
  seats.forEach((seat, i) => {
    if (!seat) return;
    const hw = GRID_W / 2 + 0.05;
    const hd = GRID_D / 2 + 0.05;
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
      const p = seatPoint(seat, lx, lz);
      // grids beside and behind you are seen by turning your head, they do not widen the view
      if (i === me) must.push(new THREE.Vector3(p.x, 0, p.z));
      else if (Math.abs(Math.atan2(Math.sin(seat.angle), Math.cos(seat.angle))) > (portrait ? 2.2 : 1.9)) grids.push(new THREE.Vector3(p.x, 0, p.z));
    }
    // faces in front of you; those beside you are seen by turning your head (drag)
    if (i !== me) {
      const h = sitterPoint(seat).setY(EYE_Y + 1.5);
      const ang = Math.abs(Math.atan2(h.x, sit.z + 0.4 - h.z));
      if (ang < (portrait ? 0.32 : 0.62)) heads.push(h);
    }
  });
  must.push(new THREE.Vector3(-2, 0, 0), new THREE.Vector3(2, 0, 0));
  must.push(new THREE.Vector3(toss.x + 0.5, 0, toss.z + 0.3));
  const camera = fitEyes(eye, [[...must, ...grids, ...heads], [...must, ...grids], must], aspect, hudTop, hudBottom, portrait ? 84 : 70);
  return { seats, deck, discard, toss, handMine, table, eye, camera, portrait };
}

/**
 * The camera stays at your eyes. Pick the downward look and the narrowest field of view
 * that keeps a set of points between the HUD margins; drop to a smaller set when even
 * the widest allowed view cannot hold the larger one.
 */
function fitEyes(eye: THREE.Vector3, sets: THREE.Vector3[][], aspect: number, top: number, bottom: number, maxFov: number) {
  const cam = new THREE.PerspectiveCamera(50, aspect, 0.1, 200);
  cam.position.copy(eye);
  const yMax = 1 - top;
  const yMin = -1 + bottom;
  const v = new THREE.Vector3();
  const target = new THREE.Vector3();
  const aim = (pitch: number) => {
    target.set(eye.x, eye.y - Math.sin(pitch) * 10, eye.z - Math.cos(pitch) * 10);
    cam.lookAt(target);
    cam.updateMatrixWorld();
  };
  const fits = (pts: THREE.Vector3[], fov: number) => {
    cam.fov = fov;
    cam.updateProjectionMatrix();
    for (const p of pts) {
      v.copy(p).project(cam);
      // faces may reach up behind the status line; table points stay clear of it
      const top = p.y > 2 ? 0.97 : yMax;
      if (v.z > 1 || v.x < -0.96 || v.x > 0.96 || v.y < yMin || v.y > top) return false;
    }
    return true;
  };
  for (const pts of sets) {
    let best: { fov: number; pitch: number } | null = null;
    for (let deg = 12; deg <= 66; deg += 1) {
      const pitch = (deg * Math.PI) / 180;
      aim(pitch);
      if (!fits(pts, maxFov)) continue;
      let lo = 30;
      let hi = maxFov;
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (fits(pts, mid)) hi = mid;
        else lo = mid;
      }
      if (!best || hi < best.fov) best = { fov: hi, pitch };
    }
    if (best) {
      aim(best.pitch);
      return { pos: eye.clone(), target: target.clone(), fov: best.fov };
    }
  }
  // Nothing fits (very narrow screens): look at your own cards with the widest view
  aim((42 * Math.PI) / 180);
  return { pos: eye.clone(), target: target.clone(), fov: maxFov };
}

/**
 * Couch mode: the TV sits at no seat. Everyone sits evenly round the table, a half step turned so
 * nobody has their back to the screen, and the camera looks down on the whole table from above
 * the front edge, like a TV broadcast of a card game. Everyone's grid is drawn at the same size.
 */
function spectatorLayout(n: number, aspect: number, hudTop: number, hudBottom: number): Layout {
  const portrait = aspect < 0.9;
  const s = OPPONENT_SCALE;
  const angles = Array.from({ length: n }, (_, i) => Math.PI / Math.max(1, n) + (i / Math.max(1, n)) * Math.PI * 2);
  const seatAt = (a: number, r: number): Seat => ({ x: -Math.sin(a) * r, z: Math.cos(a) * r, yaw: -a, s, angle: a });
  let R = 5.6;
  for (; R < 14; R += 0.1) {
    const all = angles.map((a) => seatAt(a, R));
    let ok = true;
    for (let i = 0; i < all.length && ok; i++) {
      for (let j = i + 1; j < all.length && ok; j++) {
        if (Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z) < 2.15 * 2 * s) ok = false;
        if (sitterPoint(all[i]).distanceTo(sitterPoint(all[j])) < 7.2) ok = false;
      }
      if (Math.hypot(all[i].x, all[i].z) < 2.0 + 1.55 * s + 0.8) ok = false;
    }
    if (ok) break;
  }
  const seats = angles.map((a) => seatAt(a, R));
  const table = { r: R + Math.max(...seats.map(edgeOf)) };
  const deck = { x: -0.8, z: 0 };
  const discard = { x: 0.8, z: 0 };
  // nobody presses the discard button on the TV: it stays sunk under the felt in the middle
  const toss = { x: 0, z: 0 };
  const handMine: Pose = { x: 0, y: -2, z: 0, yaw: 0, tilt: 0, flip: 0, s: 1 };
  // high above the front of the table, steep enough that the nearest players' heads do not hide their cards
  // (under the bar's ceiling beams at 21, and clear of the lamp shade over the middle of the table)
  const eye = new THREE.Vector3(0, 18, table.r * (portrait ? 0.95 : 0.8) + 3);
  const pts: THREE.Vector3[] = [];
  const heads: THREE.Vector3[] = [];
  seats.forEach((seat) => {
    const hw = GRID_W / 2 + 0.05;
    const hd = GRID_D / 2 + 0.05;
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
      const p = seatPoint(seat, lx, lz);
      pts.push(new THREE.Vector3(p.x, 0, p.z));
    }
    heads.push(sitterPoint(seat).setY(EYE_Y + 1.5));
  });
  pts.push(new THREE.Vector3(-2.2, 0, 0), new THREE.Vector3(2.2, 0, 0));
  // the whole round table, not only the grids on it
  const rim: THREE.Vector3[] = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return new THREE.Vector3(Math.sin(a) * table.r, 0, Math.cos(a) * table.r);
  });
  const camera = fitEyes(eye, [[...rim, ...pts, ...heads], [...rim, ...pts], pts], aspect, hudTop, hudBottom, portrait ? 80 : 62);
  return { seats, deck, discard, toss, handMine, table, eye, camera, portrait };
}
