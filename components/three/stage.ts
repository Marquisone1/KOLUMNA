import * as THREE from 'three';
import type { GameState } from '../../game/types';
import { SEAT_COLORS } from '../PlayerBoard';
import { backTexture, CARD_H, CARD_W, frontTexture, leatherTexture, woodTexture } from './textures';
import { CARD_T, GRID_D, GRID_W, PILE_SCALE, PITCH_X, PITCH_Z, opponentHandPose, slotPose, type Layout, type Pose } from './layout';

// The card scene. Every card on the table is one object keyed by its id.
// `sync` derives where each card belongs from the game state; a card whose place changed
// flies there (arc, flip, turn) instead of jumping. Event-specific moves that must happen
// before a state commit (gather for a deal, lift a cleared column) go through `flyTo`.
//
// Deck and discard pile sit on a turntable in the middle of the table that turns to face
// whoever's turn it is. Cards resting on the pile ride along with it.

const ACCENT = new THREE.Color('#e3a34a');
const WHITE = new THREE.Color('#efe9de');
const DISCARD_SHOWN = 6;
/** Height of the turntable's top above the felt */
export const TT_H = 0.17;
const TT_R = 1.95;
const EASE = (t: number) => 1 - Math.pow(1 - t, 3);
const EASE_IO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const CARD_THICK = 0.0062;

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
  const g = new THREE.ShapeGeometry(roundedRectShape(CARD_W, CARD_H, CARD_W * 0.075), 5);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / CARD_W + 0.5, pos.getY(i) / CARD_H + 0.5);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** The card's paper edge: only the sides of an extruded outline */
function edgeGeometry() {
  const g = new THREE.ExtrudeGeometry(roundedRectShape(CARD_W, CARD_H, CARD_W * 0.075), { depth: CARD_THICK, bevelEnabled: false, curveSegments: 5 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -CARD_THICK / 2, 0);
  return g;
}

function ringGeometry(w: number, h: number, r: number, t: number) {
  const outer = roundedRectShape(w + t * 2, h + t * 2, r + t);
  outer.holes.push(roundedRectShape(w, h, r) as unknown as THREE.Path);
  const g = new THREE.ShapeGeometry(outer, 5);
  g.rotateX(-Math.PI / 2);
  return g;
}

const geo = {
  card: null as THREE.BufferGeometry | null,
  edge: null as THREE.BufferGeometry | null,
  ring: null as THREE.BufferGeometry | null,
};

const materials = new Map<string, THREE.Material>();
function faceMaterial(v: number | null): THREE.MeshStandardMaterial {
  const key = v === null ? 'back' : 'f' + v;
  let m = materials.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    // satin card stock: a soft sheen from the room, no plastic shine
    m = new THREE.MeshStandardMaterial({ map: v === null ? backTexture() : frontTexture(v), roughness: 0.48, metalness: 0, envMapIntensity: 0.6 });
    m.shadowSide = THREE.DoubleSide;
    materials.set(key, m);
  }
  return m;
}
/** See-through copies of the card faces for the hologram preview; all share one opacity */
const previewMats = new Map<string, THREE.MeshBasicMaterial>();
function previewMaterial(v: number | null): THREE.MeshBasicMaterial {
  const key = v === null ? 'back' : 'f' + v;
  let m = previewMats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: v === null ? backTexture() : frontTexture(v), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    previewMats.set(key, m);
  }
  return m;
}

function edgeMaterials(): THREE.Material[] {
  let hidden = materials.get('edge-hidden');
  let side = materials.get('edge');
  if (!hidden || !side) {
    hidden = new THREE.MeshBasicMaterial({ visible: false });
    side = new THREE.MeshStandardMaterial({ color: '#efe6d6', roughness: 0.8 });
    materials.set('edge-hidden', hidden);
    materials.set('edge', side);
  }
  return [hidden, side];
}

const noRaycast = () => {};

interface Tween { from: Pose; to: Pose; t0: number; dur: number; arc: number; resolve?: () => void }

class CardObj {
  group = new THREE.Group();
  front: THREE.Mesh;
  back: THREE.Mesh;
  edge: THREE.Mesh;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  v: number | null = null;
  pose: Pose;
  target: Pose;
  tween: Tween | null = null;
  /** index on the discard pile while the card rests there, else −1 */
  pile = -1;
  lift = 0;
  liftGoal = 0;
  ringOpacity = 0;
  ringGoal = 0;

  constructor(public id: number, pose: Pose) {
    this.front = new THREE.Mesh(geo.card!, faceMaterial(null));
    this.front.position.y = CARD_THICK / 2 + 0.0003;
    this.front.castShadow = true;
    this.back = new THREE.Mesh(geo.card!, faceMaterial(null));
    this.back.rotation.z = Math.PI;
    this.back.position.y = -CARD_THICK / 2 - 0.0003;
    this.edge = new THREE.Mesh(geo.edge!, edgeMaterials());
    this.edge.raycast = noRaycast;
    this.ringMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(geo.ring!, this.ringMat);
    this.ring.raycast = noRaycast;
    this.ring.visible = false;
    this.ring.renderOrder = 1;
    this.front.userData.cardId = id;
    this.back.userData.cardId = id;
    this.group.add(this.front, this.back, this.edge, this.ring);
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
function wrapAngle(d: number) {
  return Math.atan2(Math.sin(d), Math.cos(d));
}
function lerpAngle(a: number, b: number, t: number) {
  return a + wrapAngle(b - a) * t;
}
const samePose = (a: Pose, b: Pose) =>
  Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3 && Math.abs(a.z - b.z) < 1e-3 &&
  Math.abs(wrapAngle(a.yaw - b.yaw)) < 1e-3 && Math.abs(a.tilt - b.tilt) < 1e-3 && Math.abs(a.flip - b.flip) < 1e-3 && Math.abs(a.s - b.s) < 1e-3;

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
  private turntable = new THREE.Group();
  /** current and goal turn of the turntable; it turns on the wall clock so slow frames do not slow the game */
  private ttAngle = 0;
  private ttGoal = 0;
  private ttFrom = 0;
  private ttT0 = 0;
  private ttDur = 0;
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
  tossActive = false;
  pileHover: 'deck' | 'discard' | 'toss' | null = null;
  private toss = new THREE.Group();
  private tossMoving = new THREE.Group();
  private tossLabelMesh: THREE.Mesh;
  private tossY = -0.06;
  private tossV = 0;
  private tossPress = -1;
  private tossLabel = '';
  private tossLacquer: THREE.MeshStandardMaterial | null = null;
  private static readonly CAP_OFF = new THREE.Color('#5c2219');
  private static readonly CAP_ON = new THREE.Color('#a8341f');
  reduced = false;
  invalidate: () => void = () => {};
  private waiters: (() => void)[] = [];
  private deckRing: THREE.Mesh;
  private discardRing: THREE.Mesh;
  private topDiscard: number | null = null;
  private discardIds: number[] = [];
  /** Options for the next sync, set by the animator right before a commit */
  nextSync: SyncOptions | null = null;
  camera: THREE.Camera | null = null;
  canvas: HTMLElement | null = null;
  /** The last state shown, for tests and debugging */
  view: GameState | null = null;
  /** which player each card on a grid belongs to */
  private owners = new Map<number, string>();
  private me = '';
  // hologram preview of another player's grid, read the right way up, beside yours
  private preview = new THREE.Group();
  private previewCards = new THREE.Group();
  private previewPanel: THREE.Mesh;
  private previewPanelMat: THREE.MeshBasicMaterial;
  private previewLabel: THREE.Mesh;
  private previewOf: string | null = null;
  private previewKey = '';
  private previewOpacity = 0;
  private previewHideAt = 0;

  takeNextSync(): SyncOptions {
    const o = this.nextSync ?? {};
    this.nextSync = null;
    return o;
  }

  constructor() {
    if (!geo.card) geo.card = cardGeometry();
    if (!geo.edge) geo.edge = edgeGeometry();
    if (!geo.ring) geo.ring = ringGeometry(CARD_W, CARD_H, CARD_W * 0.075, 0.016);

    this.buildTurntable();

    // the deck: a block of card stock with a card back on top
    const edge = new THREE.MeshStandardMaterial({ color: '#e6dccb', roughness: 0.85 });
    const top = new THREE.MeshStandardMaterial({ map: backTexture(), roughness: 0.48 });
    const box = new THREE.BoxGeometry(CARD_W * 0.99, 1, CARD_H * 0.99);
    box.translate(0, 0.5, 0);
    this.deckMesh = new THREE.Mesh(box, [edge, edge, top, edge, edge, edge]);
    this.deckMesh.castShadow = true;
    this.deckMesh.receiveShadow = true;
    this.deckMesh.userData.anchor = 'deck';
    this.deckMesh.scale.y = 0.0001;
    this.deckRing = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false }));
    this.deckRing.raycast = noRaycast;
    // an outline tooled into the leather where the discard pile goes
    const markMat = new THREE.MeshBasicMaterial({ color: '#e8c27a', transparent: true, opacity: 0.22, depthWrite: false });
    this.discardMark = new THREE.Mesh(ringGeometry(CARD_W, CARD_H, CARD_W * 0.075, 0.012), markMat);
    this.discardMark.raycast = noRaycast;
    // invisible pick target that covers the whole discard pile, so a click lands even between cards
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 1.2, CARD_H * 1.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.anchor = 'discard';
    hit.position.y = 0.01;
    this.discardMark.add(hit);
    this.discardRing = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false }));
    this.discardRing.raycast = noRaycast;
    this.turntable.add(this.deckMesh, this.deckRing, this.discardMark, this.discardRing);

    this.tossLabelMesh = this.buildButton();
    this.previewPanelMat = new THREE.MeshBasicMaterial({ color: '#13202a', transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.previewPanel = new THREE.Mesh(new THREE.ShapeGeometry(roundedRectShape(GRID_W + 0.5, GRID_D + 1.0, 0.22), 5).rotateX(-Math.PI / 2), this.previewPanelMat);
    this.previewPanel.position.set(0, -0.01, -0.22);
    this.previewLabel = new THREE.Mesh(new THREE.PlaneGeometry(GRID_W, 0.42).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    this.previewLabel.position.set(0, 0, -GRID_D / 2 - 0.45);
    for (const m of [this.previewPanel, this.previewLabel]) { m.raycast = noRaycast; m.renderOrder = 3; }
    this.preview.add(this.previewPanel, this.previewCards, this.previewLabel);
    this.preview.visible = false;
    this.root.add(this.matGroup, this.turntable, this.toss, this.preview);
  }

  // ---------- hologram preview ----------

  /** Whose grid a card belongs to, if it lies on a grid */
  ownerOf(cardId: number) {
    return this.owners.get(cardId) ?? null;
  }

  /**
   * Show another player's grid beside yours, turned so you read it upright, slightly see-through.
   * `null` hides it after a short grace period, so moving between their cards does not flicker.
   */
  setPreview(playerId: string | null) {
    if (playerId === this.me) playerId = null;
    if (playerId) {
      this.previewHideAt = 0;
      if (playerId !== this.previewOf) {
        this.previewOf = playerId;
        this.previewKey = '';
        this.rebuildPreview();
      }
    } else if (this.previewOf && !this.previewHideAt) {
      this.previewHideAt = performance.now() + 220;
    }
    this.invalidate();
  }

  togglePreview(playerId: string) {
    if (this.previewOf === playerId && !this.previewHideAt) this.setPreview(null);
    else this.setPreview(playerId);
  }

  private rebuildPreview() {
    const L = this.layout;
    const v = this.view;
    const p = v?.players.find((x) => x.id === this.previewOf);
    if (!L || !p) return;
    const key = p.grid.map((col) => col.map((s) => s.card.id + ':' + (s.up ? s.card.v : 'x')).join(',')).join('|');
    if (key === this.previewKey) return;
    this.previewKey = key;
    this.previewCards.clear();
    const cols = p.grid.length;
    p.grid.forEach((col, c) => col.forEach((slot, r) => {
      const m = new THREE.Mesh(geo.card!, previewMaterial(slot.up ? slot.card.v : null));
      m.position.set((c - (cols - 1) / 2) * PITCH_X, 0, (r - 1) * PITCH_Z);
      m.raycast = noRaycast;
      m.renderOrder = 4;
      this.previewCards.add(m);
    }));
    // their name above the copy
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 72;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#efe9de';
    ctx.font = "600 40px 'Instrument Sans', system-ui, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.name, 256, 38);
    const lm = this.previewLabel.material as THREE.MeshBasicMaterial;
    lm.map?.dispose();
    lm.map = new THREE.CanvasTexture(canvas);
    lm.map.colorSpace = THREE.SRGBColorSpace;
    lm.needsUpdate = true;
    // place it beside your own grid (above it on narrow screens), tipped toward your eyes
    const mine = L.seats.find((s) => s && s.angle === 0) ?? L.seats[0];
    const ps = 0.82;
    this.preview.scale.setScalar(ps);
    if (L.portrait) this.preview.position.set(0, 1.4, mine.z - GRID_D * 1.05);
    else this.preview.position.set(-(GRID_W / 2 + 0.45 + (GRID_W * ps) / 2), 0.9, mine.z - 0.15);
    const toEye = L.eye.clone().sub(this.preview.position);
    this.preview.rotation.set(Math.atan2(toEye.z, toEye.y) * 0.8, 0, 0);
  }


  /** A walnut lazy susan with a leather top and a brass rim, on a dark bearing */
  private buildTurntable() {
    const wood = woodTexture('#5b3923', 90);
    const woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.42, metalness: 0, envMapIntensity: 0.8 });
    const profile = [
      new THREE.Vector2(0, 0.06), new THREE.Vector2(TT_R - 0.05, 0.06), new THREE.Vector2(TT_R, 0.085),
      new THREE.Vector2(TT_R + 0.015, 0.12), new THREE.Vector2(TT_R, 0.155), new THREE.Vector2(TT_R - 0.04, TT_H - 0.002),
      new THREE.Vector2(0, TT_H - 0.002),
    ];
    const disc = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), woodMat);
    disc.castShadow = true;
    disc.receiveShadow = true;
    const bearing = new THREE.Mesh(new THREE.CylinderGeometry(TT_R * 0.7, TT_R * 0.75, 0.06, 48), new THREE.MeshStandardMaterial({ color: '#1b1612', roughness: 0.5, metalness: 0.4 }));
    bearing.position.y = 0.03;
    const leather = leatherTexture('#22140f');
    leather.repeat.set(3, 3);
    const top = new THREE.Mesh(new THREE.CircleGeometry(TT_R - 0.16, 72).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: leather, roughness: 0.62, envMapIntensity: 0.5 }));
    top.position.y = TT_H - 0.0005;
    top.receiveShadow = true;
    const brass = new THREE.MeshStandardMaterial({ color: '#c9a063', roughness: 0.3, metalness: 1, envMapIntensity: 1.1 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(TT_R - 0.15, 0.018, 8, 96).rotateX(Math.PI / 2), brass);
    rim.position.y = TT_H;
    // a small brass pointer on the edge shows whom the piles face
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 3).rotateX(Math.PI / 2), brass);
    tip.position.set(0, TT_H - 0.01, TT_R - 0.07);
    tip.scale.y = 0.3;
    for (const m of [disc, bearing, top, rim, tip]) m.raycast = noRaycast;
    this.turntable.add(bearing, disc, top, rim, tip);
  }

  /**
   * The discard button: a brass bezel set into the table, and a lacquered cap on a stem
   * that sits flush with the felt and rises when you may discard.
   */
  private buildButton(): THREE.Mesh {
    const brass = new THREE.MeshStandardMaterial({ color: '#c9a063', roughness: 0.28, metalness: 1, envMapIntensity: 1.1 });
    const bezel = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.5, -0.02), new THREE.Vector2(0.5, 0.025), new THREE.Vector2(0.56, 0.04),
      new THREE.Vector2(0.64, 0.025), new THREE.Vector2(0.66, 0.0), new THREE.Vector2(0.66, -0.02),
    ], 64), brass);
    bezel.castShadow = true;
    bezel.receiveShadow = true;
    const well = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#0e0b09', roughness: 0.9 }));
    well.position.y = -0.3;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.6, 40), brass);
    stem.position.y = -0.3;
    // satin red enamel: a little sheen, but no mirror that would wash out the label
    const lacquer = new THREE.MeshStandardMaterial({ color: '#5c2219', roughness: 0.42, metalness: 0, envMapIntensity: 0.35 });
    this.tossLacquer = lacquer;
    // lathe profile from the bottom edge up to the centre, so the faces point outward
    const cap = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.47, 0.0), new THREE.Vector2(0.48, 0.05), new THREE.Vector2(0.46, 0.11),
      new THREE.Vector2(0.4, 0.15), new THREE.Vector2(0.3, 0.165), new THREE.Vector2(0, 0.17),
    ], 64), lacquer);
    cap.castShadow = true;
    const label = new THREE.Mesh(new THREE.CircleGeometry(0.34, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    label.position.y = 0.176;
    label.raycast = noRaycast;
    for (const m of [stem, cap]) m.userData.anchor = 'toss';
    bezel.raycast = noRaycast;
    well.raycast = noRaycast;
    this.tossMoving.add(stem, cap, label);
    this.tossMoving.position.y = this.tossY;
    this.toss.add(well, bezel, this.tossMoving);
    return label;
  }

  /** Print the button's label on its cap (language changes redraw it) */
  setTossLabel(text: string) {
    if (text === this.tossLabel) return;
    this.tossLabel = text;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(244,228,200,0.7)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(128, 128, 116, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#f7ead2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 58;
    const font = (s: number) => `700 ${s}px 'Instrument Sans', system-ui, sans-serif`;
    ctx.font = font(size);
    while (ctx.measureText(text).width > 196 && size > 20) ctx.font = font((size -= 2));
    ctx.fillText(text, 128, 132);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = this.tossLabelMesh.material as THREE.MeshBasicMaterial;
    m.map?.dispose();
    m.map = tex;
    m.color.set('#ffffff');
    m.needsUpdate = true;
    this.invalidate();
  }

  /** Short press-in when the button is clicked */
  pressToss() {
    this.tossPress = performance.now();
    this.invalidate();
  }

  // ---------- layout ----------

  setLayout(layout: Layout, players: GameState['players']) {
    this.layout = layout;
    this.deckMesh.position.set(layout.deck.x, TT_H, layout.deck.z);
    this.deckMesh.scale.x = this.deckMesh.scale.z = PILE_SCALE;
    for (const m of [this.deckRing, this.discardMark, this.discardRing]) m.scale.setScalar(PILE_SCALE);
    this.deckRing.position.set(layout.deck.x, TT_H + 0.0015, layout.deck.z);
    this.discardMark.position.set(layout.discard.x, TT_H + 0.0008, layout.discard.z);
    this.discardRing.position.set(layout.discard.x, TT_H + 0.0015, layout.discard.z);
    this.toss.position.set(layout.toss.x, 0, layout.toss.z);
    // a mat for every seat: a printed rule in the seat colour around the grid
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
    const curIdx = view.phase === 'play' ? view.turn : -1;
    const cur = curIdx >= 0 ? view.players[curIdx]?.id : null;
    this.mats.forEach((m, id) => { m.goal = id === cur ? 0.85 : 0.2; });
    // the turntable faces whoever plays; outside play it faces you
    const seat = curIdx >= 0 ? this.layout?.seats[curIdx] : null;
    const goal = seat ? seat.yaw : 0;
    const next = this.ttAngle + wrapAngle(goal - this.ttAngle);
    if (Math.abs(next - this.ttGoal) > 1e-4) {
      this.ttGoal = next;
      this.ttFrom = this.ttAngle;
      this.ttT0 = performance.now();
      this.ttDur = this.reduced ? 0 : 420 + Math.abs(next - this.ttAngle) * 220;
    }
    this.invalidate();
  }

  // ---------- poses ----------

  worldOnTurntable(lx: number, lz: number) {
    return this.onTurntable(lx, lz);
  }

  /** A point on the turntable (in its own frame) at the table's current turn, in world space */
  private onTurntable(lx: number, lz: number, angle = this.ttAngle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: c * lx + s * lz, z: -s * lx + c * lz };
  }

  deckTop(): Pose {
    const L = this.layout!;
    const p = this.onTurntable(L.deck.x, L.deck.z);
    return { x: p.x, y: TT_H + this.deckHeight + CARD_T, z: p.z, yaw: this.ttAngle, tilt: 0, flip: Math.PI, s: PILE_SCALE };
  }

  discardPose(i: number, id: number, angle = this.ttAngle): Pose {
    const L = this.layout!;
    const j = hash(id);
    const p = this.onTurntable(L.discard.x + (j - 0.5) * 0.05, L.discard.z + (hash(id + 7) - 0.5) * 0.05, angle);
    return { x: p.x, y: TT_H + CARD_T * (i + 1), z: p.z, yaw: angle + (j - 0.5) * 0.22, tilt: 0, flip: 0, s: PILE_SCALE };
  }

  /** Where every card shown on the table belongs in this state */
  homes(view: GameState, me: string) {
    const L = this.layout!;
    const out = new Map<number, { pose: Pose; v: number | null; order: number; pile: number }>();
    this.slots.clear();
    this.owners.clear();
    this.me = me;
    view.players.forEach((p, pi) => {
      const seat = L.seats[pi];
      if (!seat) return;
      const cols = p.grid.length;
      p.grid.forEach((col, c) => col.forEach((slot, r) => {
        out.set(slot.card.id, { pose: slotPose(seat, cols, c, r, slot.up), v: slot.card.v, order: (r * 4 + c) * view.players.length + pi, pile: -1 });
        this.owners.set(slot.card.id, p.id);
        if (p.id === me) this.slots.set(slot.card.id, { owner: p.id, c, r, cols });
      }));
    });
    const shown = view.discard.slice(-DISCARD_SHOWN);
    shown.forEach((card, i) => out.set(card.id, { pose: this.discardPose(i, card.id), v: card.v, order: 1000 + i, pile: i }));
    this.discardIds = shown.map((c) => c.id);
    if (view.drawn) {
      const holderIdx = view.turn;
      const holder = view.players[holderIdx];
      const known = view.drawn.v !== null;
      const pose = holder?.id === me ? { ...L.handMine, flip: known ? 0 : Math.PI } : opponentHandPose(L.seats[holderIdx], known);
      out.set(view.drawn.id, { pose, v: view.drawn.v, order: 2000, pile: -1 });
    }
    return out;
  }

  // ---------- sync ----------

  sync(view: GameState, me: string, opts: SyncOptions = {}) {
    if (!this.layout) return;
    this.view = view;
    this.setTurn(view);
    if (opts.instant) {
      this.ttAngle = this.ttFrom = this.ttGoal;
      this.turntable.rotation.y = this.ttAngle;
    }
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
        // a new card normally comes off the deck; one that turns up under the top of the discard pile
        // was lying there all along (only the top few are drawn), so it simply appears in place
        const underneath = h.pile >= 0 && h.pile < this.discardIds.length - 1;
        obj = this.take(id, opts.instant || underneath ? h.pose : this.deckTop());
        this.cards.set(id, obj);
        if (underneath) {
          obj.pile = h.pile;
          obj.target = { ...h.pose };
          obj.setValue(h.v);
          obj.apply();
          return;
        }
      }
      obj.setValue(h.v);
      obj.pile = h.pile;
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
    if (this.previewOf) this.rebuildPreview();
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
      o.pile = -1;
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
    obj.pile = -1;
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

  /** Resolves when nothing moves any more (cards and the turntable) */
  settled(): Promise<void> {
    if (!this.moving()) return Promise.resolve();
    this.invalidate();
    return new Promise((r) => this.waiters.push(r));
  }

  private moving() {
    if (this.ttAngle !== this.ttGoal) return true;
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

  /** Screen position (client px) of a card or pile, for tests and debugging */
  screenOf(what: number | 'deck' | 'discard' | 'toss'): { x: number; y: number } | null {
    if (!this.camera || !this.canvas || !this.layout) return null;
    const v = new THREE.Vector3();
    if (typeof what === 'number') {
      const o = this.cards.get(what);
      if (!o) return null;
      o.group.getWorldPosition(v);
    } else if (what === 'toss') {
      v.set(this.layout.toss.x, this.tossY + 0.17, this.layout.toss.z);
    } else {
      const p = what === 'deck' ? this.layout.deck : this.layout.discard;
      const w = this.onTurntable(p.x, p.z);
      v.set(w.x, TT_H + (what === 'deck' ? this.deckHeight : CARD_T), w.z);
    }
    v.project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** Advance animations; returns true while something still moves */
  update(dt: number): boolean {
    const now = performance.now();
    let active = false;
    const k = 1 - Math.exp(-dt * 16);
    // the turntable eases round; resting pile cards ride along
    let turned = false;
    if (this.ttAngle !== this.ttGoal) {
      const t = this.ttDur > 0 ? Math.min(1, (now - this.ttT0) / this.ttDur) : 1;
      this.ttAngle = t >= 1 ? this.ttGoal : lerp(this.ttFrom, this.ttGoal, EASE_IO(t));
      this.turntable.rotation.y = this.ttAngle;
      turned = true;
      active = true;
    }
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
          // a card flying onto the pile aims at where the pile is now
          const to = o.pile >= 0 ? this.discardPose(o.pile, o.id) : tw.to;
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
          o.pose = o.pile >= 0 ? this.discardPose(o.pile, o.id) : { ...tw.to };
          o.tween = null;
          tw.resolve?.();
        }
      } else if (turned && o.pile >= 0) {
        o.pose = this.discardPose(o.pile, o.id);
        o.target = { ...o.pose };
        changed = true;
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
    // riffle: the deck sways briefly after a reshuffle
    const dx = this.layout?.deck.x ?? 0;
    if (this.shuffleT > 0) {
      const t = (now - this.shuffleT) / 520;
      if (t >= 1) {
        this.shuffleT = -1;
        this.deckMesh.rotation.y = 0;
        this.deckMesh.position.x = dx;
      } else {
        this.deckMesh.rotation.y = Math.sin(t * Math.PI * 4) * 0.12 * (1 - t);
        this.deckMesh.position.x = dx + Math.sin(t * Math.PI * 3) * 0.06 * (1 - t);
        active = true;
      }
    }
    // discard button: a spring toward up or flush, so it pops out with a small overshoot
    const goal = this.tossActive ? (this.pileHover === 'toss' ? 0.4 : 0.34) : -0.06;
    const press = this.tossPress > 0 ? Math.max(0, 1 - (now - this.tossPress) / 220) : 0;
    if (press === 0) this.tossPress = -1;
    const d = goal - press * 0.1 - this.tossY;
    if (Math.abs(d) > 1e-4 || Math.abs(this.tossV) > 1e-4 || press > 0) {
      // fixed small steps keep the spring stable however long the frame was
      let left = Math.min(dt, 0.25);
      while (left > 0) {
        const h = Math.min(left, 1 / 120);
        const dd = goal - press * 0.1 - this.tossY;
        this.tossV += (dd * 180 - this.tossV * 15) * h;
        this.tossY += this.tossV * h;
        left -= h;
      }
      if (Math.abs(goal - this.tossY) < 1e-4 && Math.abs(this.tossV) < 1e-3 && press === 0) {
        this.tossY = goal;
        this.tossV = 0;
      }
      this.tossMoving.position.y = this.tossY;
      // the enamel brightens as the button comes up: dull while it cannot be pressed
      const lit = Math.min(1, Math.max(0, (this.tossY + 0.06) / 0.4));
      this.tossLacquer?.color.copy(TableStage.CAP_OFF).lerp(TableStage.CAP_ON, lit);
      active = true;
    }
    // hologram fades in and out
    if (this.previewHideAt && now >= this.previewHideAt) {
      this.previewHideAt = 0;
      this.previewOf = null;
    }
    const pGoal = this.previewOf ? 1 : 0;
    if (Math.abs(this.previewOpacity - pGoal) > 1e-3) {
      this.previewOpacity += (pGoal - this.previewOpacity) * (1 - Math.exp(-dt * 12));
      if (Math.abs(this.previewOpacity - pGoal) <= 1e-3) this.previewOpacity = pGoal;
      const o = this.previewOpacity;
      previewMats.forEach((m) => { m.opacity = o * 0.8; });
      this.previewPanelMat.opacity = o * 0.42;
      (this.previewLabel.material as THREE.MeshBasicMaterial).opacity = o * 0.9;
      this.preview.visible = o > 0.01;
      this.preview.position.y += 0;
      active = true;
    }
    if (this.previewHideAt) active = true;
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

  /** Let anything that waits on this stage go; the scene itself stays intact so a remount can reuse it */
  release() {
    this.cards.forEach((o) => { o.tween?.resolve?.(); });
    this.waiters.forEach((r) => r());
    this.waiters = [];
  }
}

/** Only one 3D table exists at a time; the animator talks to it through here */
export const stageRef: { current: TableStage | null; me: string } = { current: null, me: '' };
