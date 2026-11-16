import * as THREE from 'three';
import type { GameState } from '../../game/types';
import { SEAT_COLORS } from '../PlayerBoard';
import { EYE_Y, opponentHandPose, seatPoint, sitterPoint, type Layout, type Seat } from './layout';
import { CHARACTER_MODELS, CHARACTER_HEIGHT } from './characterModels';

// The people at the table. Until real models are uploaded, each one is a placeholder:
// a chair and a seated clay figure in the seat colour. Heads turn to wherever the game is:
// the player whose turn it is, a card in hand, their own grid.

const CLAY = '#cdb9a2';
const WOOD = '#4a2f1f';

function mat(color: string, rough = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
}

function limb(from: THREE.Vector3, to: THREE.Vector3, r: number, m: THREE.Material) {
  const len = from.distanceTo(to);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len), 4, 10);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  mesh.castShadow = true;
  return mesh;
}

interface Figure {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Object3D;
  /** current and goal head turn (yaw, pitch) and body lean */
  yaw: number; pitch: number; lean: number;
  goalYaw: number; goalPitch: number; goalLean: number;
  seat: Seat;
  playerId: string;
  modelUrl?: string;
}

/** A seated placeholder, built facing −Z (toward the table) with its origin at table-top height */
function placeholder(color: string): { body: THREE.Group; head: THREE.Object3D } {
  const body = new THREE.Group();
  const cloth = mat(color, 0.9);
  const clay = mat(CLAY, 0.7);
  // torso: a soft, slightly flattened capsule from the seat to the shoulders
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(1.45, 2.6, 6, 16), cloth);
  torso.scale.set(1.2, 1, 0.78);
  torso.position.set(0, 0.35, 0);
  torso.castShadow = true;
  body.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.8, 12), clay);
  neck.position.set(0, 3.25, 0);
  body.add(neck);
  // head pivots at the neck so nodding looks right
  const head = new THREE.Group();
  head.position.set(0, 3.55, 0);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1.0, 24, 18), clay);
  skull.scale.set(0.92, 1.08, 0.98);
  skull.position.set(0, 0.95, 0);
  skull.castShadow = true;
  head.add(skull);
  // a nose so you can tell where they look
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), clay);
  nose.scale.set(1, 1.2, 1.4);
  nose.position.set(0, 0.85, -0.98);
  head.add(nose);
  body.add(head);
  // arms: shoulder → elbow → hands resting on the table edge
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Vector3(side * 1.75, 2.55, 0.05);
    const elbow = new THREE.Vector3(side * 2.0, 0.7, -0.75);
    const hand = new THREE.Vector3(side * 1.35, 0.4, -1.75);
    body.add(limb(shoulder, elbow, 0.42, cloth));
    body.add(limb(elbow, hand, 0.36, cloth));
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), clay);
    palm.scale.set(1, 0.6, 1.25);
    palm.position.copy(hand);
    palm.castShadow = true;
    body.add(palm);
  }
  return { body, head };
}

function chair(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(WOOD, 0.6);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.35, 4.0), wood);
  seat.position.set(0, -2.85, 0.5);
  const back = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4.6, 0.3), wood);
  back.position.set(0, -0.6, 2.4);
  back.rotation.x = -0.08;
  g.add(seat, back);
  for (const [x, z] of [[-1.85, -1.3], [1.85, -1.3], [-1.85, 2.3], [1.85, 2.3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.6, 0.3), wood);
    leg.position.set(x, -5.2, z);
    g.add(leg);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

let gltfLoader: Promise<{ load: (url: string) => Promise<THREE.Object3D> }> | null = null;
function loader() {
  if (!gltfLoader) {
    gltfLoader = import('three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      const l = new GLTFLoader();
      return { load: (url: string) => l.loadAsync(url).then((g) => g.scene) };
    });
  }
  return gltfLoader;
}

/** Fit an uploaded model into the seat: scaled to CHARACTER_HEIGHT, feet on the floor, facing the table */
function fitModel(model: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = size.y > 0 ? CHARACTER_HEIGHT / size.y : 1;
  model.scale.setScalar(s);
  box.setFromObject(model);
  // models are expected to face +Z (glTF convention); the table is at −Z
  model.rotation.y = Math.PI;
  model.position.set(-(box.min.x + box.max.x) / 2, -7.4 - box.min.y, 0);
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  let head: THREE.Object3D | null = null;
  model.traverse((o) => { if (!head && /head/i.test(o.name)) head = o; });
  return head as THREE.Object3D | null;
}

export class Characters {
  root = new THREE.Group();
  private figures = new Map<string, Figure>();
  invalidate: () => void = () => {};

  /** One figure per opponent; you are the camera */
  setSeats(layout: Layout, players: GameState['players'], me: string) {
    this.root.clear();
    this.figures.clear();
    players.forEach((p, i) => {
      const seat = layout.seats[i];
      if (!seat || p.id === me) return;
      const root = new THREE.Group();
      const sp = sitterPoint(seat);
      root.position.set(sp.x, 0, sp.z);
      root.rotation.y = seat.yaw;
      root.add(chair());
      const color = SEAT_COLORS[p.seat % 6];
      const ph = placeholder(color);
      const body = ph.body;
      root.add(body);
      const fig: Figure = { root, body, head: ph.head, yaw: 0, pitch: 0, lean: 0, goalYaw: 0, goalPitch: 0, goalLean: 0, seat, playerId: p.id };
      const url = CHARACTER_MODELS[p.seat % CHARACTER_MODELS.length];
      if (url) {
        fig.modelUrl = url;
        loader()
          .then((l) => l.load(url))
          .then((model) => {
            if (this.figures.get(p.id) !== fig) return;
            const head = fitModel(model);
            root.remove(body);
            const wrap = new THREE.Group();
            wrap.add(model);
            root.add(wrap);
            fig.body = wrap;
            fig.head = head ?? new THREE.Object3D();
            this.invalidate();
          })
          .catch(() => { /* keep the placeholder */ });
      }
      this.root.add(root);
      this.figures.set(p.id, fig);
    });
    this.invalidate();
  }

  /** Decide where everyone looks for this state */
  look(view: GameState, layout: Layout, me: string) {
    const cur = view.phase === 'play' ? view.players[view.turn] : null;
    const tmp = new THREE.Vector3();
    view.players.forEach((p, i) => {
      const fig = this.figures.get(p.id);
      if (!fig) return;
      const seat = layout.seats[i];
      let target: THREE.Vector3;
      let lean = 0;
      if (!p.connected && !p.bot) {
        // away from the table: head down
        fig.goalYaw = 0;
        fig.goalPitch = 0.75;
        fig.goalLean = -0.05;
        return;
      }
      if (cur?.id === p.id) {
        lean = 0.14;
        if (view.drawn) {
          const h = opponentHandPose(seat, true);
          target = tmp.set(h.x, h.y, h.z);
        } else {
          const g = seatPoint(seat, 0, 0);
          target = tmp.set(g.x, 0, g.z);
        }
      } else if (view.phase === 'setup') {
        const g = seatPoint(seat, 0, 0);
        target = tmp.set(g.x, 0, g.z);
      } else if (cur) {
        const ci = view.players.indexOf(cur);
        if (cur.id === me) target = tmp.copy(layout.eye).setY(EYE_Y - 0.5);
        else {
          const g = seatPoint(layout.seats[ci], 0, 0);
          target = tmp.set(g.x, 0.5, g.z);
        }
      } else {
        target = tmp.set(0, 0, 0.4);
      }
      // turn the world target into head yaw/pitch relative to the seat
      const head = new THREE.Vector3(fig.root.position.x, EYE_Y, fig.root.position.z);
      const d = target.clone().sub(head);
      // a figure faces its local −Z, which points at world yaw = seat.yaw
      let rel = Math.atan2(-d.x, -d.z) - seat.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      fig.goalYaw = Math.max(-1.1, Math.min(1.1, rel));
      fig.goalPitch = Math.max(-0.2, Math.min(0.7, Math.atan2(-d.y, Math.hypot(d.x, d.z))));
      fig.goalLean = lean;
    });
    this.invalidate();
  }

  update(dt: number): boolean {
    let active = false;
    const k = 1 - Math.exp(-dt * 5);
    this.figures.forEach((f) => {
      const dy = f.goalYaw - f.yaw;
      const dp = f.goalPitch - f.pitch;
      const dl = f.goalLean - f.lean;
      if (Math.abs(dy) + Math.abs(dp) + Math.abs(dl) < 1e-3) return;
      f.yaw += dy * k;
      f.pitch += dp * k;
      f.lean += dl * k;
      // the body follows the head a little, the head does the rest
      f.body.rotation.set(-f.lean, f.yaw * 0.25, 0);
      f.head.rotation.set(-f.pitch * 0.85, f.yaw * 0.75, 0, 'YXZ');
      active = true;
    });
    return active;
  }

  /** Head positions for name plates */
  headOf(playerId: string, out: THREE.Vector3) {
    const f = this.figures.get(playerId);
    if (!f) return null;
    return out.set(f.root.position.x, EYE_Y + 2.3, f.root.position.z);
  }
}
