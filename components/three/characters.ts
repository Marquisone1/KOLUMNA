import * as THREE from 'three';
import type { GameEvent, GameState } from '../../game/types';
import { SEAT_COLORS } from '../PlayerBoard';
import { EYE_Y, opponentHandPose, seatPoint, sitterPoint, type Layout, type Seat } from './layout';
import { CHARACTER_HEIGHT, CHARACTER_MODELS, REACTION_CLIPS, SEATED_CLIP, UPPER_BODY } from './characterModels';

// The people at the table. Each opponent sits on a chair at their seat as an animated character
// (see characterModels.ts). While the model loads, or if it cannot load, a simple clay figure
// in the seat colour sits there instead. Heads turn to wherever the game is, and the figures
// react to what happens to them: picking up a card, swapping, cheering at a cleared column.

const FLOOR = -7.4;
const WOOD = '#6b4123';

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

/** A seated placeholder, built facing −Z (toward the table) with its origin at table-top height */
function placeholder(color: string): { body: THREE.Group; head: THREE.Object3D } {
  const body = new THREE.Group();
  const cloth = mat(color, 0.9);
  const clay = mat('#e8cdb0', 0.7);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(1.45, 2.6, 6, 16), cloth);
  torso.scale.set(1.2, 1, 0.78);
  torso.position.set(0, 0.35, 0);
  torso.castShadow = true;
  body.add(torso);
  const head = new THREE.Group();
  head.position.set(0, 3.55, 0);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1.0, 24, 18), clay);
  skull.scale.set(0.92, 1.08, 0.98);
  skull.position.set(0, 0.95, 0);
  skull.castShadow = true;
  head.add(skull);
  body.add(head);
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Vector3(side * 1.75, 2.55, 0.05);
    const elbow = new THREE.Vector3(side * 2.0, 0.7, -0.75);
    const hand = new THREE.Vector3(side * 1.35, 0.4, -1.75);
    body.add(limb(shoulder, elbow, 0.42, cloth));
    body.add(limb(elbow, hand, 0.36, cloth));
  }
  return { body, head };
}

/** A bar chair whose seat top sits at `seatTop`, legs down to the floor, cushion in the seat colour */
function chair(seatTop: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(WOOD, 0.55);
  const cushion = mat(color, 0.8);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.35, 4.0), wood);
  seat.position.set(0, seatTop - 0.35, 0.5);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.3, 3.6), cushion);
  pad.position.set(0, seatTop - 0.05, 0.5);
  const back = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4.6, 0.3), wood);
  back.position.set(0, seatTop + 2.0, 2.45);
  back.rotation.x = -0.08;
  g.add(seat, pad, back);
  const legH = seatTop - 0.5 - FLOOR;
  for (const [x, z] of [[-1.85, -1.3], [1.85, -1.3], [-1.85, 2.3], [1.85, 2.3]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, legH, 0.3), wood);
    leg.position.set(x, FLOOR + legH / 2, z);
    g.add(leg);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ---------- loading ----------

interface Loaded { scene: THREE.Object3D; animations: THREE.AnimationClip[] }
const cache = new Map<string, Promise<Loaded>>();
let tools: Promise<{ load: (url: string) => Promise<Loaded>; clone: (o: THREE.Object3D) => THREE.Object3D }> | null = null;

function loadTools() {
  if (!tools) {
    tools = Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/utils/SkeletonUtils.js'),
    ]).then(([{ GLTFLoader }, SkeletonUtils]) => {
      const l = new GLTFLoader();
      return { load: (url: string) => l.loadAsync(url).then((g) => ({ scene: g.scene, animations: g.animations })), clone: (o) => SkeletonUtils.clone(o) };
    });
  }
  return tools;
}

/** Try the path as given, then under public/ (hosts that serve the source tree) */
function loadModel(path: string): Promise<Loaded> {
  let p = cache.get(path);
  if (!p) {
    const base = typeof document !== 'undefined' ? document.baseURI : '/';
    const urls = /^(https?:)?\//.test(path) ? [path] : [new URL(path, base).href, new URL('public/' + path, base).href];
    p = loadTools().then(async (t) => {
      let err: unknown;
      for (const u of urls) {
        try { return await t.load(u); } catch (e) { err = e; }
      }
      throw err;
    });
    cache.set(path, p);
  }
  return p;
}

/** Keep only tracks of the given bones, so a standing gesture can play on a seated body */
function filterClip(clip: THREE.AnimationClip, keep: (bone: string) => boolean, name: string) {
  const tracks = clip.tracks.filter((t) => keep(t.name.split('.')[0]));
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

// ---------- figures ----------

type Reaction = keyof typeof REACTION_CLIPS;

interface Rig {
  mixer: THREE.AnimationMixer;
  sitUpper: THREE.AnimationAction | null;
  reactions: Partial<Record<Reaction, THREE.AnimationAction>>;
  current: THREE.AnimationAction | null;
}

interface Figure {
  root: THREE.Group;
  body: THREE.Object3D;
  head: THREE.Object3D;
  /** placeholders turn their head group directly; models get the turn added on top of the animation */
  additive: boolean;
  rig: Rig | null;
  yaw: number; pitch: number; lean: number;
  goalYaw: number; goalPitch: number; goalLean: number;
  seat: Seat;
  playerId: string;
  /** height above the table for the name plate */
  top: number;
}

const qLook = new THREE.Quaternion();
const qRoot = new THREE.Quaternion();
const qParent = new THREE.Quaternion();
const eLook = new THREE.Euler();
const vTmp = new THREE.Vector3();

export class Characters {
  root = new THREE.Group();
  private figures = new Map<string, Figure>();
  invalidate: () => void = () => {};

  /** One figure per opponent; you are the camera */
  setSeats(layout: Layout, players: GameState['players'], me: string) {
    this.figures.forEach((f) => f.rig?.mixer.stopAllAction());
    this.root.clear();
    this.figures.clear();
    let k = 0;
    players.forEach((p, i) => {
      const seat = layout.seats[i];
      if (!seat || p.id === me) return;
      const color = SEAT_COLORS[p.seat % 6];
      const root = new THREE.Group();
      const sp = sitterPoint(seat);
      root.position.set(sp.x, 0, sp.z);
      root.rotation.y = seat.yaw;
      const seatChair = chair(-2.7, color);
      root.add(seatChair);
      const ph = placeholder(color);
      root.add(ph.body);
      const fig: Figure = { root, body: ph.body, head: ph.head, additive: false, rig: null, yaw: 0, pitch: 0, lean: 0, goalYaw: 0, goalPitch: 0, goalLean: 0, seat, playerId: p.id, top: EYE_Y + 2.3 };
      this.root.add(root);
      this.figures.set(p.id, fig);
      const path = CHARACTER_MODELS.length ? CHARACTER_MODELS[k++ % CHARACTER_MODELS.length] : '';
      if (path) {
        Promise.all([loadModel(path), loadTools()])
          .then(([model, t]) => {
            if (this.figures.get(p.id) !== fig) return;
            this.useModel(fig, t.clone(model.scene), model.animations, seatChair, color);
            this.invalidate();
          })
          // keep the placeholder, but say why, so a broken model file is easy to spot
          .catch((e) => console.warn('Kolumna: character model not used', path, e));
      }
    });
    this.invalidate();
  }

  /** Seat a loaded model: pose it, scale it to the table, put a chair of the right height under it */
  private useModel(fig: Figure, scene: THREE.Object3D, clips: THREE.AnimationClip[], oldChair: THREE.Object3D, color: string) {
    const wrap = new THREE.Group();
    const turn = new THREE.Group();
    // models face +Z (glTF); the table is at −Z of the seat
    turn.rotation.y = Math.PI;
    turn.add(scene);
    wrap.add(turn);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; }
    });
    const mixer = new THREE.AnimationMixer(scene);
    const seated = clips.find((c) => c.name === SEATED_CLIP);
    const isUpper = (bone: string) => UPPER_BODY.test(bone);
    let sitUpper: THREE.AnimationAction | null = null;
    if (seated) {
      mixer.clipAction(filterClip(seated, (b) => !isUpper(b), 'sit-lower')).play();
      sitUpper = mixer.clipAction(filterClip(seated, isUpper, 'sit-upper'));
      sitUpper.play();
    }
    const reactions: Rig['reactions'] = {};
    (Object.keys(REACTION_CLIPS) as Reaction[]).forEach((r) => {
      const c = clips.find((x) => x.name === REACTION_CLIPS[r]);
      if (!c) return;
      const a = mixer.clipAction(filterClip(c, isUpper, 'react-' + r));
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = false;
      reactions[r] = a;
    });
    const rig: Rig = { mixer, sitUpper, reactions, current: null };
    mixer.addEventListener('finished', (e) => {
      if (e.action !== rig.current) return;
      rig.current.fadeOut(0.35);
      rig.sitUpper?.reset().fadeIn(0.35).play();
      rig.current = null;
    });

    // three.js drops dots from node names on load ("foot.l" becomes "footl"), so look for both
    const bone = (name: string) => scene.getObjectByName(name) ?? scene.getObjectByName(name.replace(/\./g, ''));
    const headBone = bone('head');
    // standing (bind pose) neck height, at scale 1
    wrap.updateMatrixWorld(true);
    const feet = ['foot.l', 'foot.r'].map((n) => bone(n)).filter(Boolean) as THREE.Object3D[];
    const standNeck = headBone && feet.length ? headBone.getWorldPosition(vTmp).y - Math.min(...feet.map((f) => f.getWorldPosition(new THREE.Vector3()).y)) : 0;
    // then the seated pose
    mixer.update(0);
    wrap.updateMatrixWorld(true);
    let s: number;
    let seatTop = -2.7;
    const hips = bone('hips');
    if (seated && headBone && hips) {
      const headY = headBone.getWorldPosition(vTmp).y;
      hips.getWorldPosition(vTmp);
      const hipsY = vTmp.y;
      // size by the standing neck height (about 50 cm: small, friendly figures whose big heads
      // still read as heads), then raise them on a chair until the neck is near your eye height
      s = standNeck > 0 ? 4.3 / standNeck : 5.8 / Math.max(0.01, headY - hipsY);
      wrap.position.y = EYE_Y - 1.8 - headY * s;
      seatTop = hipsY * s + wrap.position.y - 0.25 * s;
      wrap.position.x = -vTmp.x * s;
      wrap.position.z = 0.5 - vTmp.z * s;
    } else {
      const box = new THREE.Box3().setFromObject(wrap);
      s = CHARACTER_HEIGHT / Math.max(0.01, box.max.y - box.min.y);
      wrap.position.y = FLOOR - box.min.y * s;
    }
    wrap.scale.setScalar(s);
    // everyone breathes at their own pace
    if (seated) mixer.setTime(Math.random() * seated.duration);

    fig.root.remove(fig.body);
    fig.root.remove(oldChair);
    fig.root.add(chair(seatTop, color), wrap);
    fig.body = wrap;
    fig.rig = rig;
    fig.root.updateMatrixWorld(true);
    if (headBone) {
      fig.head = headBone;
      fig.additive = true;
      fig.top = Math.max(EYE_Y + 1, headBone.getWorldPosition(vTmp).y + 4.4);
    } else {
      fig.head = new THREE.Object3D();
    }
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
        lean = 0.12;
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
        // between rounds everyone looks at you
        target = tmp.copy(layout.eye);
      }
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

  /** Play a short gesture for whatever just happened */
  react(ev: GameEvent | null, view: GameState) {
    if (!ev) return;
    const play = (pid: string | undefined, r: Reaction) => {
      const rig = pid ? this.figures.get(pid)?.rig : null;
      const a = rig?.reactions[r];
      if (!rig || !a) return;
      if (rig.current && rig.current !== a) rig.current.fadeOut(0.2);
      rig.sitUpper?.fadeOut(0.25);
      a.reset().setEffectiveWeight(1).fadeIn(0.25).play();
      rig.current = a;
      this.invalidate();
    };
    switch (ev.k) {
      case 'draw':
      case 'take': play(ev.p, 'pick'); break;
      case 'swap': play(ev.p, 'swap'); break;
      case 'toss': play(ev.p, 'tap'); break;
      case 'flip': if (view.phase === 'play') play(ev.p, 'tap'); break;
      case 'clear':
      case 'finish': play(ev.p, 'cheer'); break;
      case 'roundEnd': {
        const r = view.result;
        if (!r) break;
        const best = Math.min(...Object.values(r.scores));
        Object.entries(r.scores).forEach(([pid, sc]) => {
          if (r.doubled && pid === r.finisher) play(pid, 'wince');
          else if (sc === best) play(pid, 'cheer');
        });
        break;
      }
    }
  }

  update(dt: number): boolean {
    let active = false;
    const k = 1 - Math.exp(-dt * 5);
    this.figures.forEach((f) => {
      if (f.rig) {
        f.rig.mixer.update(dt);
        // seated figures breathe, so they need frames while they are on screen
        active = true;
      }
      const dy = f.goalYaw - f.yaw;
      const dp = f.goalPitch - f.pitch;
      const dl = f.goalLean - f.lean;
      const moving = Math.abs(dy) + Math.abs(dp) + Math.abs(dl) >= 1e-3;
      if (moving) {
        f.yaw += dy * k;
        f.pitch += dp * k;
        f.lean += dl * k;
        active = true;
      }
      if (!moving && !f.rig) return;
      if (f.additive) {
        // the body follows a little; the animated head turns further, in the figure's own frame
        f.body.rotation.set(-f.lean * 0.6, f.yaw * 0.2, 0);
        f.root.updateMatrixWorld(true);
        const parent = f.head.parent!;
        f.root.getWorldQuaternion(qRoot);
        parent.getWorldQuaternion(qParent);
        eLook.set(-f.pitch * 0.8, f.yaw * 0.75, 0, 'YXZ');
        qLook.setFromEuler(eLook);
        // world rotation = root · look · root⁻¹, then into the parent's frame
        qLook.premultiply(qRoot).multiply(qRoot.clone().invert());
        qLook.premultiply(qParent.clone().invert()).multiply(qParent);
        f.head.quaternion.premultiply(qLook);
      } else {
        f.body.rotation.set(-f.lean, f.yaw * 0.25, 0);
        f.head.rotation.set(-f.pitch * 0.85, f.yaw * 0.75, 0, 'YXZ');
      }
    });
    return active;
  }

  /** Point above a player's head, for their name plate */
  headOf(playerId: string, out: THREE.Vector3) {
    const f = this.figures.get(playerId);
    if (!f) return null;
    return out.set(f.root.position.x, f.top, f.root.position.z);
  }
}

// ---------- extras: people in the room who are not playing ----------

export interface Extra {
  group: THREE.Group;
  update(dt: number): void;
  /** play a short upper-body gesture, e.g. a bartender wiping the counter */
  gesture(clip: string): void;
}

/**
 * A character standing (feet at the group's origin) or seated (hips at the group's origin),
 * facing the group's −Z, at the same size as the players. Loads in the background.
 */
export function spawnExtra(path: string, mode: 'stand' | 'sit', neckHeight = 4.3): Extra {
  const group = new THREE.Group();
  let mixer: THREE.AnimationMixer | null = null;
  const gestures = new Map<string, THREE.AnimationAction>();
  let base: THREE.AnimationAction | null = null;
  let current: THREE.AnimationAction | null = null;
  Promise.all([loadModel(path), loadTools()]).then(([model, t]) => {
    const scene = t.clone(model.scene);
    const turn = new THREE.Group();
    turn.rotation.y = Math.PI;
    turn.add(scene);
    scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
    const bone = (n: string) => scene.getObjectByName(n) ?? scene.getObjectByName(n.replace(/\./g, ''));
    turn.updateMatrixWorld(true);
    const head = bone('head');
    const feet = ['foot.l', 'foot.r'].map(bone).filter(Boolean) as THREE.Object3D[];
    const footY = feet.length ? Math.min(...feet.map((f) => f.getWorldPosition(new THREE.Vector3()).y)) : 0;
    const neck = head ? head.getWorldPosition(new THREE.Vector3()).y - footY : 1;
    const s = neckHeight / Math.max(0.01, neck);
    mixer = new THREE.AnimationMixer(scene);
    const clipName = mode === 'stand' ? 'Idle' : SEATED_CLIP;
    const clip = model.animations.find((c) => c.name === clipName);
    if (clip) {
      if (mode === 'sit') {
        mixer.clipAction(filterClip(clip, (b) => !UPPER_BODY.test(b), 'x-lower')).play();
        base = mixer.clipAction(filterClip(clip, (b) => UPPER_BODY.test(b), 'x-upper'));
      } else {
        base = mixer.clipAction(clip);
      }
      base.play();
      mixer.setTime(Math.random() * clip.duration);
    }
    for (const c of model.animations) {
      if (c.name === clipName) continue;
      const a = mixer.clipAction(mode === 'sit' ? filterClip(c, (b) => UPPER_BODY.test(b), 'x-' + c.name) : c);
      a.setLoop(THREE.LoopOnce, 1);
      gestures.set(c.name, a);
    }
    mixer.addEventListener('finished', (e) => {
      if (e.action !== current) return;
      current.fadeOut(0.4);
      base?.reset().fadeIn(0.4).play();
      current = null;
    });
    mixer.update(0);
    turn.updateMatrixWorld(true);
    // measure the seated hips at scale 1, before the figure goes into its scaled wrapper
    const hips = bone('hips');
    const hp = hips ? hips.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    const wrap = new THREE.Group();
    wrap.add(turn);
    wrap.scale.setScalar(s);
    if (mode === 'stand') {
      wrap.position.y = -footY * s;
    } else {
      wrap.position.set(-hp.x * s, -hp.y * s + 0.25 * s, -hp.z * s);
    }
    group.add(wrap);
  }).catch((e) => console.warn('Kolumna: extra character not used', path, e));
  return {
    group,
    update(dt) { mixer?.update(dt); },
    gesture(name) {
      const a = gestures.get(name);
      if (!a || current) return;
      base?.fadeOut(0.3);
      a.reset().fadeIn(0.3).play();
      current = a;
    },
  };
}

/** Fetch and parse every character model ahead of time (shared cache with the table) */
export function preloadCharacters(): Promise<void> {
  const paths = [...new Set(CHARACTER_MODELS)];
  return Promise.all([loadTools(), ...paths.map((p) => loadModel(p).catch(() => null))]).then(() => undefined);
}
