import * as THREE from 'three';
import type { GameState } from '../../game/types';
import { SEAT_COLORS } from '../PlayerBoard';
import { backTexture, CARD_H, CARD_W, frontTexture } from './textures';
import { CARD_T, GRID_D, GRID_W, opponentHandPose, slotPose, type Layout, type Pose } from './layout';

// The card scene. Every card on the table is one object keyed by its id.
// `sync` derives where each card belongs from the game state; a card whose place changed
// flies there (arc, flip, turn) instead of jumping. Event-specific moves that must happen
// before a state commit (gather for a deal, lift a cleared column) go through `flyTo`.

const ACCENT = new THREE.Color('#e3a34a');
const WHITE = new THREE.Color('#efe9de');
const DISCARD_SHOWN = 6;
const EASE = (t: number) => 1 - Math.pow(1 - t, 3);
const EASE_IO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function roundedRectShape(w: number, h: number, r: number, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x = cx - w / 2;
  const y = cy - h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** A flat rounded rectangle lying in the XZ plane, facing +Y, UVs 0..1 over the card */
function cardGeometry() {
  const g = new THREE.ShapeGeometry(roundedRectShape(CARD_W, CARD_H, CARD_W * 0.11), 4);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / CARD_W + 0.5, pos.getY(i) / CARD_H + 0.5);
  g.rotateX(-Math.PI / 2);
  return g;
}

function ringGeometry(w: number, h: number, r: number, t: number) {
  const outer = roundedRectShape(w + t * 2, h + t * 2, r + t);
  outer.holes.push(roundedRectShape(w, h, r) as unknown as THREE.Path);
  const g = new THREE.ShapeGeometry(outer, 4);
  g.rotateX(-Math.PI / 2);
  return g;
}

const geo = {
  card: null as THREE.BufferGeometry | null,
  ring: null as THREE.BufferGeometry | null,
};

const materials = new Map<string, THREE.MeshStandardMaterial>();
function faceMaterial(v: number | null): THREE.MeshStandardMaterial {
  const key = v === null ? 'back' : 'f' + v;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: v === null ? backTexture() : frontTexture(v), roughness: 0.62, metalness: 0 });
    m.shadowSide = THREE.DoubleSide;
    materials.set(key, m);
  }
  return m;
}

const noRaycast = () => {};

interface Tween { from: Pose; to: Pose; t0: number; dur: number; arc: number; resolve?: () => void }

class CardObj {
  group = new THREE.Group();
  front: THREE.Mesh;
  back: THREE.Mesh;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  v: number | null = null;
  pose: Pose;
  target: Pose;
  tween: Tween | null = null;
  lift = 0;
  liftGoal = 0;
  ringOpacity = 0;
  ringGoal = 0;

  constructor(public id: number, pose: Pose) {
    this.front = new THREE.Mesh(geo.card!, faceMaterial(null));
    this.front.position.y = 0.0012;
    this.front.castShadow = true;
    this.back = new THREE.Mesh(geo.card!, faceMaterial(null));
    this.back.rotation.z = Math.PI;
    this.back.position.y = -0.0012;
    this.ringMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(geo.ring!, this.ringMat);
    this.ring.raycast = noRaycast;
    this.ring.visible = false;
    this.ring.renderOrder = 1;
    this.front.userData.cardId = id;
    this.back.userData.cardId = id;
    this.group.add(this.front, this.back, this.ring);
    this.pose = { ...pose };
    this.target = { ...pose };
    this.apply();
  }

  setValue(v: number | null) {
    if (v === null || v === this.v) return;
    this.v = v;
    this.front.material = faceMaterial(v);
  }

  apply() {
    const p = this.pose;
    this.group.position.set(p.x, p.y + this.lift, p.z);
    this.group.rotation.set(p.tilt - this.lift * 0.4, p.yaw, p.flip, 'YXZ');
    this.group.scale.setScalar(p.s);
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const samePose = (a: Pose, b: Pose) =>
  Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3 && Math.abs(a.z - b.z) < 1e-3 &&
  Math.abs(a.yaw - b.yaw) < 1e-3 && Math.abs(a.tilt - b.tilt) < 1e-3 && Math.abs(a.flip - b.flip) < 1e-3 && Math.abs(a.s - b.s) < 1e-3;

function hash(id: number) {
  let x = (id + 1) * 2654435761;
  x ^= x >>> 15;
  return ((x >>> 0) % 1000) / 1000;
}

export interface SyncOptions {
  instant?: boolean;
  /** delay before a card starts moving, in ms */
  delay?: (id: number, order: number) => number;
  /** duration factor */
  pace?: number;
}

export interface CardSlotInfo { owner: string; c: number; r: number; cols: number }

export class TableStage {
  root = new THREE.Group();
  cards = new Map<number, CardObj>();
  private pool: CardObj[] = [];
  private deckMesh: THREE.Mesh;
  private deckHeight = 0;
  private deckGoal = 0;
  private mats = new Map<string, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; goal: number }>();
  private matGroup = new THREE.Group();
  private discardMark: THREE.Mesh;
  private shuffleT = -1;
  layout: Layout | null = null;
  /** where each of the local player's cards sits, for hover reports */
  slots = new Map<number, CardSlotInfo>();
  selectable = new Set<number>();
  hovered: number | null = null;
  peerHover = new Map<number, string>();
  raised = new Set<number>();
  deckActive = false;
  discardActive = false;
  pileHover: 'deck' | 'discard' | null = null;
  reduced = false;
  invalidate: () => void = () => {};
  private waiters: (() => void)[] = [];
  private deckRing: THREE.Mesh;
  private discardRing: THREE.Mesh;
  private topDiscard: number | null = null;
  private discardIds: number[] = [];
  /** Options for the next sync, set by the animator right before a commit */
  nextSync: SyncOptions | null = null;

  takeNextSync(): SyncOptions {
    const o = this.nextSync ?? {};
    this.nextSync = null;
    return o;
  }

  constructor() {
    if (!geo.card) geo.card = cardGeometry();
    if (!geo.ring) geo.ring = ringGeometry(CARD_W, CARD_H, CARD_W * 0.11, 0.016);
    // the deck: a block of card stock with a card back on top
    const edge = new THREE.MeshStandardMaterial({ color: '#d8cdb8', roughness: 0.9 });
    const top = new THREE.MeshStandardMaterial({ map: backTexture(), roughness: 0.62 });
    const box = new THREE.BoxGeometry(CARD_W * 0.985, 1, CARD_H * 0.985);
    box.translate(0, 0.5, 0);
    this.deckMesh = new THREE.Mesh(box, [edge, edge, top, edge, edge, edge]);
    this.deckMesh.castShadow = true;
    this.deckMesh.receiveShadow = true;
    this.deckMesh.userData.anchor = 'deck';
    this.deckMesh.scale.y = 0.0001;
    this.deckRing = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false }));
    this.deckRing.raycast = noRaycast;
    // an outline printed on the felt where the discard pile goes
    const markMat = new THREE.MeshBasicMaterial({ color: '#efe9de', transparent: true, opacity: 0.14, depthWrite: false });
    this.discardMark = new THREE.Mesh(ringGeometry(CARD_W, CARD_H, CARD_W * 0.11, 0.012), markMat);
    this.discardMark.raycast = noRaycast;
    // invisible pick target that covers the whole discard pile, so a click lands even between cards
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 1.15, CARD_H * 1.15).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.anchor = 'discard';
    this.discardMark.add(hit);
    hit.raycast = THREE.Mesh.prototype.raycast;
    this.discardRing = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false }));
    this.discardRing.raycast = noRaycast;
    this.root.add(this.matGroup, this.deckMesh, this.deckRing, this.discardMark, this.discardRing);
  }

  // ---------- layout ----------

  setLayout(layout: Layout, players: GameState['players']) {
    this.layout = layout;
    this.deckMesh.position.set(layout.deck.x, 0, layout.deck.z);
    this.deckRing.position.set(layout.deck.x, 0.0015, layout.deck.z);
    this.discardMark.position.set(layout.discard.x, 0.0008, layout.discard.z);
    this.discardRing.position.set(layout.discard.x, 0.0015, layout.discard.z);
    // a mat for every seat: slightly lighter felt with a printed rule in the seat colour
    this.matGroup.clear();
    this.mats.clear();
    players.forEach((p, i) => {
      const seat = layout.seats[i];
      if (!seat) return;
      const w = GRID_W + 0.36;
      const d = GRID_D + 0.36;
      const mat = new THREE.MeshBasicMaterial({ color: SEAT_COLORS[p.seat % 6], transparent: true, opacity: 0.22, depthWrite: false });
      const ring = new THREE.Mesh(ringGeometry(w, d, 0.16, 0.018), mat);
      ring.raycast = noRaycast;
      ring.position.set(seat.x, 0.0006, seat.z);
      ring.rotation.y = seat.yaw;
      ring.scale.setScalar(seat.s);
      this.matGroup.add(ring);
      this.mats.set(p.id, { mesh: ring, mat, goal: 0.22 });
    });
  }

  setTurn(view: GameState) {
    const cur = view.phase === 'play' ? view.players[view.turn]?.id : null;
    this.mats.forEach((m, id) => { m.goal = id === cur ? 0.85 : 0.2; });
    this.invalidate();
  }

  // ---------- poses ----------

  deckTop(): Pose {
    const L = this.layout!;
    return { x: L.deck.x, y: this.deckHeight + CARD_T, z: L.deck.z, yaw: 0, tilt: 0, flip: Math.PI, s: 1 };
  }

  discardPose(i: number, id: number): Pose {
    const L = this.layout!;
    const j = hash(id);
    return {
      x: L.discard.x + (j - 0.5) * 0.05,
      y: CARD_T * (i + 1),
      z: L.discard.z + (hash(id + 7) - 0.5) * 0.05,
      yaw: (j - 0.5) * 0.22,
      tilt: 0,
      flip: 0,
      s: 1,
    };
  }

  /** Where every card shown on the table belongs in this state */
  homes(view: GameState, me: string) {
    const L = this.layout!;
    const out = new Map<number, { pose: Pose; v: number | null; order: number }>();
    this.slots.clear();
    let order = 0;
    view.players.forEach((p, pi) => {
      const seat = L.seats[pi];
      if (!seat) return;
      const cols = p.grid.length;
      p.grid.forEach((col, c) => col.forEach((slot, r) => {
        out.set(slot.card.id, { pose: slotPose(seat, cols, c, r, slot.up), v: slot.card.v, order: (r * 4 + c) * view.players.length + pi });
        if (p.id === me) this.slots.set(slot.card.id, { owner: p.id, c, r, cols });
      }));
      order++;
    });
    const shown = view.discard.slice(-DISCARD_SHOWN);
    shown.forEach((card, i) => out.set(card.id, { pose: this.discardPose(i, card.id), v: card.v, order: 1000 + i }));
    this.discardIds = shown.map((c) => c.id);
    if (view.drawn) {
      const holderIdx = view.turn;
      const holder = view.players[holderIdx];
      const known = view.drawn.v !== null;
      const pose = holder?.id === me ? { ...L.handMine, flip: known ? 0 : Math.PI } : opponentHandPose(L.seats[holderIdx], known);
      out.set(view.drawn.id, { pose, v: view.drawn.v, order: 2000 });
    }
    return out;
  }

  // ---------- sync ----------

  /** The last state shown, for tests and debugging */
  view: GameState | null = null;

  sync(view: GameState, me: string, opts: SyncOptions = {}) {
    if (!this.layout) return;
    this.view = view;
    const homes = this.homes(view, me);
    const now = performance.now();
    const pace = opts.pace ?? 1;
    // cards that left the table
    this.cards.forEach((obj, id) => {
      if (homes.has(id)) return;
      this.cards.delete(id);
      obj.tween?.resolve?.();
      obj.tween = null;
      this.root.remove(obj.group);
      this.pool.push(obj);
    });
    homes.forEach((h, id) => {
      let obj = this.cards.get(id);
      if (!obj) {
        obj = this.take(id, opts.instant ? h.pose : this.deckTop());
        this.cards.set(id, obj);
      }
      obj.setValue(h.v);
      if (samePose(obj.target, h.pose) && !opts.instant) return;
      obj.target = { ...h.pose };
      if (opts.instant || this.reduced) {
        obj.tween?.resolve?.();
        obj.tween = null;
        obj.pose = { ...h.pose };
        obj.apply();
        return;
      }
      const delay = opts.delay?.(id, h.order) ?? 0;
      this.startTween(obj, h.pose, now + delay, pace);
    });
    this.deckGoal = Math.max(0.002, view.deckCount * 0.0022);
    if (opts.instant) this.deckHeight = this.deckGoal;
    const top = view.discard[view.discard.length - 1];
    this.topDiscard = top ? top.id : null;
    this.setTurn(view);
    this.refreshInteractive();
    this.invalidate();
  }

  private take(id: number, pose: Pose) {
    const obj = this.pool.pop();
    let o: CardObj;
    if (obj) {
      o = obj;
      o.id = id;
      o.v = null;
      o.front.material = faceMaterial(null);
      o.front.userData.cardId = id;
      o.back.userData.cardId = id;
      o.pose = { ...pose };
      o.target = { ...pose };
      o.lift = o.liftGoal = 0;
      o.ringOpacity = o.ringGoal = 0;
      o.apply();
    } else {
      o = new CardObj(id, pose);
    }
    this.root.add(o.group);
    return o;
  }

  private startTween(obj: CardObj, to: Pose, t0: number, pace: number, arcOverride?: number) {
    const from = { ...obj.pose };
    const dist = Math.hypot(to.x - from.x, to.z - from.z, (to.y - from.y) * 1.5);
    const flips = Math.abs(to.flip - from.flip) > 0.01;
    // flip in place needs room for half a card width, longer flights rise higher
    let arc = Math.min(1.1, dist * 0.16);
    if (flips) arc = Math.max(arc, CARD_W * 0.55 * Math.max(from.s, to.s));
    if (arcOverride !== undefined) arc = arcOverride;
    const dur = (Math.min(820, 360 + dist * 70) + (flips ? 80 : 0)) * pace;
    obj.tween?.resolve?.();
    obj.tween = { from, to: { ...to }, t0, dur, arc };
  }

  /** Fly one card to a pose now; resolves when it lands */
  flyTo(id: number, pose: Pose, opts: { delay?: number; pace?: number; arc?: number } = {}) {
    const obj = this.cards.get(id);
    if (!obj) return Promise.resolve();
    obj.target = { ...pose };
    if (this.reduced) {
      obj.pose = { ...pose };
      obj.apply();
      this.invalidate();
      return Promise.resolve();
    }
    this.startTween(obj, pose, performance.now() + (opts.delay ?? 0), opts.pace ?? 1, opts.arc);
    this.invalidate();
    return new Promise<void>((r) => { obj.tween!.resolve = r; });
  }

  /** Gather every card on the table onto the deck, e.g. before a new deal */
  gather() {
    const ids = [...this.cards.keys()];
    const top = this.deckTop();
    return Promise.all(ids.map((id, i) => this.flyTo(id, { ...top, y: top.y + 0.002 * (i % 10) }, { delay: (i % 24) * 18, pace: 0.85 })));
  }

  /** The discard pile apart from its new top goes back to the deck, then the deck gives a short riffle */
  async reshuffle(keepTop: number | null) {
    const under = this.discardIds.filter((id) => id !== keepTop && this.cards.has(id));
    const deck = this.deckTop();
    await Promise.all(under.map((id, i) => this.flyTo(id, { ...deck, y: deck.y + i * CARD_T }, { delay: i * 70, pace: 0.9 })));
    this.shuffleT = performance.now();
    this.invalidate();
    await new Promise((r) => setTimeout(r, this.reduced ? 0 : 520));
  }

  /** Lift cards off the table, e.g. a column about to be cleared */
  raise(ids: number[], on: boolean) {
    ids.forEach((id) => (on ? this.raised.add(id) : this.raised.delete(id)));
    this.refreshInteractive();
    this.invalidate();
  }

  /** Resolves when nothing moves any more */
  settled(): Promise<void> {
    if (!this.moving()) return Promise.resolve();
    this.invalidate();
    return new Promise((r) => this.waiters.push(r));
  }

  private moving() {
    for (const o of this.cards.values()) if (o.tween) return true;
    return false;
  }

  refreshInteractive() {
    this.cards.forEach((o, id) => {
      const sel = this.selectable.has(id);
      const peer = this.peerHover.get(id);
      const hov = this.hovered === id && sel;
      const raised = this.raised.has(id);
      o.liftGoal = raised ? 0.22 : hov ? 0.07 : peer ? 0.035 : 0;
      if (raised) {
        o.ringMat.color.copy(WHITE);
        o.ringGoal = 0.9;
      } else if (sel) {
        o.ringMat.color.copy(ACCENT);
        o.ringGoal = hov ? 1 : 0.45;
      } else if (peer) {
        o.ringMat.color.set(peer);
        o.ringGoal = 0.9;
      } else {
        o.ringGoal = 0;
      }
    });
    (this.deckRing.material as THREE.MeshBasicMaterial).opacity = this.deckActive ? (this.pileHover === 'deck' ? 1 : 0.55) : 0;
    (this.discardRing.material as THREE.MeshBasicMaterial).opacity = this.discardActive ? (this.pileHover === 'discard' ? 1 : 0.55) : 0;
    this.invalidate();
  }

  isTopDiscard(id: number) {
    return id === this.topDiscard;
  }

  /** Advance animations; returns true while something still moves */
  update(dt: number): boolean {
    const now = performance.now();
    let active = false;
    const k = 1 - Math.exp(-dt * 16);
    this.cards.forEach((o) => {
      let changed = false;
      const tw = o.tween;
      if (tw) {
        active = true;
        const t = Math.min(1, Math.max(0, (now - tw.t0) / tw.dur));
        if (t > 0) {
          const e = EASE_IO(t);
          const ep = EASE(t);
          const f = tw.from;
          const to = tw.to;
          o.pose.x = lerp(f.x, to.x, e);
          o.pose.z = lerp(f.z, to.z, e);
          o.pose.y = lerp(f.y, to.y, e) + tw.arc * 4 * t * (1 - t);
          o.pose.yaw = lerpAngle(f.yaw, to.yaw, e);
          o.pose.tilt = lerp(f.tilt, to.tilt, ep);
          o.pose.flip = lerp(f.flip, to.flip, EASE_IO(Math.min(1, t * 1.15)));
          o.pose.s = lerp(f.s, to.s, e);
          changed = true;
        }
        if (t >= 1) {
          o.pose = { ...tw.to };
          o.tween = null;
          tw.resolve?.();
        }
      }
      if (Math.abs(o.lift - o.liftGoal) > 1e-4) {
        o.lift += (o.liftGoal - o.lift) * k;
        if (Math.abs(o.lift - o.liftGoal) <= 1e-4) o.lift = o.liftGoal;
        changed = true;
        active = true;
      }
      if (Math.abs(o.ringOpacity - o.ringGoal) > 1e-3) {
        o.ringOpacity += (o.ringGoal - o.ringOpacity) * k;
        if (Math.abs(o.ringOpacity - o.ringGoal) <= 1e-3) o.ringOpacity = o.ringGoal;
        o.ringMat.opacity = o.ringOpacity;
        o.ring.visible = o.ringOpacity > 0.01;
        active = true;
      }
      if (changed) o.apply();
    });
    // deck height follows the count
    if (Math.abs(this.deckHeight - this.deckGoal) > 1e-4) {
      this.deckHeight += (this.deckGoal - this.deckHeight) * k;
      active = true;
    }
    this.deckMesh.scale.y = Math.max(0.0001, this.deckHeight);
    this.deckRing.position.y = 0.0015;
    // riffle: the deck sways briefly after a reshuffle
    if (this.shuffleT > 0) {
      const t = (now - this.shuffleT) / 520;
      if (t >= 1) {
        this.shuffleT = -1;
        this.deckMesh.rotation.y = 0;
        this.deckMesh.position.x = this.layout?.deck.x ?? 0;
      } else {
        this.deckMesh.rotation.y = Math.sin(t * Math.PI * 4) * 0.12 * (1 - t);
        this.deckMesh.position.x = (this.layout?.deck.x ?? 0) + Math.sin(t * Math.PI * 3) * 0.06 * (1 - t);
        active = true;
      }
    }
    this.mats.forEach((m) => {
      if (Math.abs(m.mat.opacity - m.goal) > 1e-3) {
        m.mat.opacity += (m.goal - m.mat.opacity) * k;
        active = true;
      }
    });
    if (!this.moving() && this.waiters.length) {
      const w = this.waiters;
      this.waiters = [];
      w.forEach((r) => r());
    }
    return active;
  }

  camera: THREE.Camera | null = null;
  canvas: HTMLElement | null = null;

  /** Screen position (client px) of a card or pile, for tests and debugging */
  screenOf(what: number | 'deck' | 'discard'): { x: number; y: number } | null {
    if (!this.camera || !this.canvas || !this.layout) return null;
    const v = new THREE.Vector3();
    if (typeof what === 'number') {
      const o = this.cards.get(what);
      if (!o) return null;
      o.group.getWorldPosition(v);
    } else {
      const p = what === 'deck' ? this.layout.deck : this.layout.discard;
      v.set(p.x, what === 'deck' ? this.deckHeight : CARD_T, p.z);
    }
    v.project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** Let anything that waits on this stage go; the scene itself stays intact so a remount can reuse it */
  release() {
    this.cards.forEach((o) => { o.tween?.resolve?.(); });
    this.waiters.forEach((r) => r());
    this.waiters = [];
  }
}

/** Only one 3D table exists at a time; the animator talks to it through here */
export const stageRef: { current: TableStage | null; me: string } = { current: null, me: '' };
