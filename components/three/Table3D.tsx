import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Action, GameEvent, GameState, PeerHover } from '../../game/types';
import { visibleSum } from '../../game/engine';
import { useI18n } from '../../i18n';
import type { Animator } from '../../anim';
import { domAnimator } from '../../anim';
import { useTableModel } from '../useTableModel';
import { SEAT_COLORS } from '../PlayerBoard';
import { Icon } from '../Icon';
import { TableStage, TT_H, stageRef } from './stage';
import { Characters } from './characters';
import { computeLayout, sitterPoint, type Layout } from './layout';
import { feltTexture, leatherTexture, loadCardFonts, redrawCards, setAnisotropy, woodTexture } from './textures';
import { DEFAULT_ROOM, ROOMS, type RoomId } from './rooms';
import { threeAnimator } from './animator3d';
import { preload3d, preloadProgress } from './preload';
import { sfx } from '../../audio';
import { FeltBounce, LampHaze, PostEffects, QualityWatch, initialQuality, qualityForced, type Quality } from './Graphics';

interface Props {
  view: GameState;
  me: string;
  isHost: boolean;
  busy: boolean;
  lastEv: GameEvent | null;
  hovers?: Record<string, PeerHover>;
  send: (a: Action) => void;
  onHover?: (h: PeerHover | null) => void;
  animator: RefObject<Animator>;
  /** where the table stands */
  room?: RoomId;
}

// Room for the HTML status at the top and your own name plate at the bottom, in px
const HUD_TOP = 64;
const HUD_BOTTOM = 40;
/** Floor height below the table top (a table is about 74 cm high) */
const FLOOR_Y = -7.4;

/** Things the frame loop writes into the DOM: name plates over heads, the deck count */
interface Overlay {
  plates: Map<string, HTMLDivElement>;
  deck: HTMLSpanElement | null;
}

/** Looking around: drag offsets for the head, eased back once you let go */
interface Look { yaw: number; pitch: number; dragging: boolean; follow: boolean }

export default function Table3D({ view, me, isHost, busy, lastEv, hovers, send, onHover, animator, room = DEFAULT_ROOM }: Props) {
  const { t } = useI18n();
  const m = useTableModel(view, me, busy, lastEv, send);
  const stage = useMemo(() => new TableStage(), []);
  const chars = useMemo(() => new Characters(), []);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const overlay = useRef<Overlay>({ plates: new Map(), deck: null });
  const look = useRef<Look>({ yaw: 0, pitch: 0, dragging: false, follow: false });
  const invalidateRef = useRef<() => void>(() => {});
  // a loading screen covers the table until every asset is in and the first frames are drawn
  const [loaded, setLoaded] = useState(false);
  const [shown, setShown] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let alive = true;
    const off = preloadProgress((d, total) => alive && setProgress(total ? d / total : 0));
    preload3d().then(() => alive && setLoaded(true));
    return () => { alive = false; off(); };
  }, []);
  // graphics quality: decided once from the device, stepped down if frames stay slow
  const [quality, setQuality] = useState<Quality | null>(null);

  // This table plays the steps while it is mounted
  useLayoutEffect(() => {
    stageRef.current = stage;
    stageRef.me = me;
    animator.current = threeAnimator;
    return () => {
      if (stageRef.current === stage) stageRef.current = null;
      animator.current = domAnimator;
      stage.release();
    };
  }, [stage, animator, me]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    setQuality((q) => q ?? initialQuality(el.clientWidth));
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = size.w && size.h ? size.w / size.h : 1.6;
  const n = view.players.length;
  const layout = useMemo(
    () => computeLayout(n, m.meIdx, Math.round(aspect * 50) / 50, (HUD_TOP / Math.max(1, size.h)) * 2, (HUD_BOTTOM / Math.max(1, size.h)) * 2),
    [n, m.meIdx, aspect, size.h],
  );
  // how far out the chairs stand, for rooms that need to build under them; rounded so it rarely changes
  const reach = useMemo(
    () => Math.ceil(Math.max(layout.table.r + 6, ...layout.seats.map((s) => sitterPoint(s).length() + 3))),
    [layout],
  );
  // the room the host picked; ?world=… overrides it (handy for a quick look)
  const place: RoomId = useMemo(() => {
    const w = new URLSearchParams(location.search).get('world');
    if (w && w in ROOMS) return w as RoomId;
    return room in ROOMS ? room : DEFAULT_ROOM;
  }, [room]);

  // Layout changes (resize, players joining) move everything into place at once
  const seatKey = view.players.map((p) => p.id + p.seat).join();
  useLayoutEffect(() => {
    stage.setLayout(layout, view.players);
    stage.sync(view, me, { instant: true });
    chars.setSeats(layout, view.players, me);
    chars.look(view, layout, me);
  }, [layout, seatKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every committed state: cards fly to their new places, heads turn
  const firstSync = useRef(true);
  useLayoutEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    stage.sync(view, me, stage.takeNextSync());
    chars.look(view, layout, me);
    chars.react(lastEv, view);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { stage.setTossLabel(t('discardIt')); }, [stage, t]);

  // Which cards and piles take a click right now
  const mine = m.mine;
  useLayoutEffect(() => {
    const sel = new Set<number>();
    if (mine) for (const col of mine.grid) for (const s of col) if (m.selectable(s.card.id, s.up)) sel.add(s.card.id);
    stage.selectable = sel;
    stage.deckActive = m.deckActive;
    stage.discardActive = m.discardActive;
    stage.tossActive = m.canToss && m.canAct;
    const peers = new Map<number, string>();
    if (hovers) {
      for (const [pid, h] of Object.entries(hovers)) {
        const p = view.players.find((x) => x.id === pid);
        if (p && h.card !== null && pid !== me) peers.set(h.card, SEAT_COLORS[p.seat % 6]);
      }
    }
    stage.peerHover = peers;
    stage.refreshInteractive();
  });

  // Looking around. With a mouse the view follows the pointer near the screen edges and stays still in the
  // middle, where the cards are, so nothing slides away under the pointer. It turns back when the pointer
  // leaves. On touch screens you drag instead; the view turns back when you let go.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const edge = (n: number) => Math.sign(n) * Math.max(0, Math.abs(n) - 0.55) / 0.45;
    let start: { x: number; y: number; yaw: number; pitch: number; id: number } | null = null;
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        const r = el.getBoundingClientRect();
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
        const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
        look.current.follow = true;
        look.current.yaw = Math.max(-1, Math.min(1, edge(nx))) * 1.15;
        // only upward: looking down past your own cards shows nothing new
        look.current.pitch = -Math.max(-1, Math.min(0, edge(ny))) * 0.42;
        invalidateRef.current();
        return;
      }
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!look.current.dragging && Math.hypot(dx, dy) < 8) return;
      look.current.dragging = true;
      const k = 1.6 / Math.max(320, el.clientWidth);
      look.current.yaw = Math.max(-1.2, Math.min(1.2, start.yaw + dx * k));
      look.current.pitch = Math.max(-0.45, Math.min(0.45, start.pitch + dy * k));
      invalidateRef.current();
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button')) return;
      start = { x: e.clientX, y: e.clientY, yaw: look.current.yaw, pitch: look.current.pitch, id: e.pointerId };
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      // let the click handler see that this was a drag, then release
      setTimeout(() => { look.current.dragging = false; invalidateRef.current(); }, 0);
    };
    const leave = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      look.current.follow = false;
      invalidateRef.current();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerleave', leave);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  // Pointer → action
  const lastHoverSent = useRef(0);
  type Hit = { card: number } | { pile: 'deck' | 'discard' | 'toss' } | null;
  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>): Hit => {
    const ud = e.object.userData as { cardId?: number; anchor?: string };
    if (ud.cardId !== undefined) {
      if (stage.selectable.has(ud.cardId)) return { card: ud.cardId };
      if (stage.isTopDiscard(ud.cardId)) return { pile: 'discard' };
      return null;
    }
    if (ud.anchor === 'deck' || ud.anchor === 'discard' || ud.anchor === 'toss') return { pile: ud.anchor };
    return null;
  };
  const pileActive = (p: 'deck' | 'discard' | 'toss') => (p === 'deck' ? stage.deckActive : p === 'discard' ? stage.discardActive : stage.tossActive);
  const setCursor = (on: boolean) => { if (wrap.current) wrap.current.style.cursor = on ? 'pointer' : ''; };
  const clearHover = () => {
    if (stage.hovered !== null || stage.pileHover) {
      stage.hovered = null;
      stage.pileHover = null;
      stage.refreshInteractive();
    }
    setCursor(false);
  };
  const reportHover = (cardId: number | null) => {
    if (!onHover) return;
    const now = performance.now();
    if (cardId === null) {
      lastHoverSent.current = 0;
      onHover(null);
      return;
    }
    if (now - lastHoverSent.current < 40) return;
    lastHoverSent.current = now;
    const slot = stage.slots.get(cardId);
    if (!slot) return;
    onHover({ card: cardId, x: (slot.c + 0.5) / slot.cols, y: (slot.r + 0.5) / 3 });
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.pointerType === 'touch' || look.current.dragging) return;
    const hit = pick(e);
    const card = hit && 'card' in hit ? hit.card : null;
    const pile = hit && 'pile' in hit && pileActive(hit.pile) ? hit.pile : null;
    // hovering someone else's grid shows it beside yours, readable
    const hoveredId = (e.object.userData as { cardId?: number }).cardId;
    stage.setPreview(hoveredId !== undefined ? stage.ownerOf(hoveredId) : null);
    if (stage.hovered !== card || stage.pileHover !== pile) {
      stage.hovered = card;
      stage.pileHover = pile;
      stage.refreshInteractive();
    }
    setCursor(card !== null || pile !== null);
    const own = (e.object.userData as { cardId?: number }).cardId;
    reportHover(own !== undefined && stage.slots.has(own) ? own : null);
  };
  const onOut = () => {
    clearHover();
    reportHover(null);
    stage.setPreview(null);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (look.current.dragging || e.delta > 8) return;
    const hit = pick(e);
    if (!hit) {
      // on touch screens there is no hover: a tap on someone else's grid shows or hides the copy
      const id = (e.object.userData as { cardId?: number }).cardId;
      const owner = id !== undefined ? stage.ownerOf(id) : null;
      if (owner && owner !== me) stage.togglePreview(owner);
      return;
    }
    if ('card' in hit) {
      reportHover(null);
      clearHover();
      m.onMyCard(hit.card);
      return;
    }
    if (hit.pile === 'deck' && m.deckActive) m.onDeck();
    if (hit.pile === 'discard' && m.discardActive) m.onDiscard();
    if (hit.pile === 'toss' && m.canToss && m.canAct) {
      stage.pressToss();
      sfx.press();
      send({ a: 'toss' });
    }
    clearHover();
  };

  const current = view.players[view.turn];
  const meP = m.mine;
  return (
    <div className="table3d" ref={wrap}>
      {size.w > 0 && (
        <Canvas
          shadows="percentage"
          dpr={[1, Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2)]}
          frameloop="demand"
          gl={{ antialias: quality !== 'high', powerPreference: 'high-performance', alpha: false }}
          camera={{ fov: layout.camera.fov, near: 0.2, far: 420, position: layout.camera.pos.toArray() as [number, number, number] }}
          onCreated={({ gl, scene }) => {
            gl.toneMapping = THREE.NeutralToneMapping;
            gl.toneMappingExposure = 1.05;
            scene.background = new THREE.Color('#120d0a');
            scene.fog = new THREE.Fog('#120d0a', 55, 140);
            setAnisotropy(gl.capabilities.getMaxAnisotropy());
          }}
          onPointerMissed={onOut}
        >
          <CameraRig layout={layout} look={look} invalidateRef={invalidateRef} />
          <Reflections />
          <TableAndLamp layout={layout} mobile={size.w < 700} cord={place !== 'space'} />
          <FeltBounce radius={layout.table.r} />
          {quality === 'high' && <LampHaze lampY={13} radius={layout.table.r} />}
          {quality === 'high' && <PostEffects />}
          {quality === 'high' && !qualityForced() && <QualityWatch onSlow={() => setQuality('normal')} />}
          <Suspense fallback={null}>
            <RoomView id={place} tableRadius={layout.table.r} reach={reach} mobile={size.w < 700} />
          </Suspense>
          <StageDriver stage={stage} chars={chars} />
          <primitive object={chars.root} />
          <primitive object={stage.root} onPointerMove={onMove} onPointerOut={onOut} onClick={onClick} />
          <OverlayDriver overlay={overlay} chars={chars} layout={layout} stage={stage} />
          {loaded && !shown && <FirstFrames onDone={() => setShown(true)} />}
        </Canvas>
      )}

      <div className={'loading3d' + (shown ? ' is-done' : '')} aria-hidden={shown}>
        <div className="loading3d-card">
          <p className="loading3d-title">{t('loadingTable')}</p>
          <div className="loading3d-bar"><span style={{ transform: `scaleX(${loaded ? 1 : Math.max(0.08, progress)})` }} /></div>
        </div>
      </div>

      <div className="hud3d" aria-live="polite">
        {m.status && (
          <div className={'status-pill tone-' + m.tone}>
            {m.tone === 'mine' && <span className="status-dot" aria-hidden="true" />}
            <p className="status-main">{m.status}</p>
          </div>
        )}
        {m.finalNote && <p className="status-final">{m.finalNote}</p>}
        {/* the real button rises out of the table; this one is for keyboards and screen readers */}
        {m.canToss && (
          <button type="button" className="sr-only" onClick={() => { stage.pressToss(); sfx.press(); send({ a: 'toss' }); }} disabled={!m.canAct}>
            {t('discardIt')}
          </button>
        )}
        {m.toast && <div className="toast3d" role="status">{m.toast}</div>}
      </div>

      <span className="pile-tag3d tabular" ref={(el) => { overlay.current.deck = el; }}>
        {t('deck')} {view.deckCount}
      </span>

      {view.players.map((p) => {
        if (p.id === me) return null;
        const isTurn = view.phase === 'play' && current?.id === p.id;
        const done = view.phase === 'setup' && p.setupFlips >= 2;
        return (
          <div
            key={p.id}
            ref={(el) => { if (el) overlay.current.plates.set(p.id, el); else overlay.current.plates.delete(p.id); }}
            className={'plate3d' + (isTurn ? ' is-turn' : '') + (!p.connected ? ' is-offline' : '')}
            style={{ '--seat': SEAT_COLORS[p.seat % 6] } as CSSProperties}
          >
            <span className="plate-avatar" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
            <span className="board-name">{p.name}</span>
            {p.bot && <span className="tag"><Icon name="bot" size={12} />{t('bot')}</span>}
            {!p.connected && !p.bot && <span className="tag tag-warn"><Icon name="wifiOff" size={12} />{t('offline')}</span>}
            {view.finisher === p.id && view.phase === 'play' && <span className="tag tag-accent">{t('wentOut')}</span>}
            {view.phase === 'setup' && (done ? <Icon name="check" size={14} /> : <span className="muted tabular">{p.setupFlips}/2</span>)}
            <span className="plate-score tabular" title={t('visible')}>{visibleSum(p)}</span>
            <span className="plate-total tabular" title={t('total')}>{p.total}<span className="muted">/{view.target}</span></span>
            {isHost && !p.connected && !p.bot && (
              <button type="button" className="btn btn-quiet btn-xs" onClick={() => send({ a: 'botTakeover', id: p.id })}>
                <Icon name="bot" size={14} /> {t('botTakeover')}
              </button>
            )}
          </div>
        );
      })}

      {meP && (
        <div
          className={'plate3d is-me' + (view.phase === 'play' && current?.id === me ? ' is-turn' : '')}
          style={{ '--seat': SEAT_COLORS[meP.seat % 6] } as CSSProperties}
        >
          <span className="plate-avatar" aria-hidden="true">{meP.name.slice(0, 1).toUpperCase()}</span>
          <span className="board-name">{meP.name}<span className="muted"> · {t('you')}</span></span>
          {view.finisher === me && view.phase === 'play' && <span className="tag tag-accent">{t('wentOut')}</span>}
          <span className="plate-score tabular" title={t('visible')}>{visibleSum(meP)}</span>
          <span className="plate-total tabular" title={t('total')}>{meP.total}<span className="muted">/{view.target}</span></span>
        </div>
      )}
    </div>
  );
}

/** Waits a few rendered frames so the room, models and textures are on the GPU before the curtain lifts */
function FirstFrames({ onDone }: { onDone: () => void }) {
  const n = useRef(0);
  const { invalidate } = useThree();
  useFrame(() => {
    n.current++;
    if (n.current === 4) onDone();
    else if (n.current < 4) invalidate();
  });
  useEffect(() => { invalidate(); }, [invalidate]);
  return null;
}

function RoomView({ id, tableRadius, reach, mobile }: { id: RoomId; tableRadius: number; reach: number; mobile: boolean }) {
  const Room = ROOMS[id].component;
  return <Room tableRadius={tableRadius} reach={reach} mobile={mobile} />;
}

/** The camera is your eyes: fixed at your seat, turned by dragging, easing back to the table */
function CameraRig({ layout, look, invalidateRef }: { layout: Layout; look: RefObject<Look>; invalidateRef: RefObject<() => void> }) {
  const { camera, invalidate } = useThree();
  const cur = useRef({ yaw: 0, pitch: 0 });
  const base = useMemo(() => {
    const d = layout.camera.target.clone().sub(layout.camera.pos);
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(-d.y, Math.hypot(d.x, d.z)) };
  }, [layout]);
  useLayoutEffect(() => {
    invalidateRef.current = () => invalidate();
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = layout.camera.fov;
    cam.position.copy(layout.camera.pos);
    cam.updateProjectionMatrix();
    invalidate();
  }, [layout, camera, invalidate, invalidateRef]);
  useFrame((_, dt) => {
    // development only: tests can park the camera anywhere in the room
    if ((window as unknown as { __freeCam?: boolean }).__freeCam) return;
    const L = look.current;
    if (!L.dragging && !L.follow) {
      // the head turns back to the table by itself
      const k = 1 - Math.exp(-dt * 3);
      L.yaw -= L.yaw * k;
      L.pitch -= L.pitch * k;
      if (Math.abs(L.yaw) < 1e-4) L.yaw = 0;
      if (Math.abs(L.pitch) < 1e-4) L.pitch = 0;
    }
    const c = cur.current;
    // following the mouse is a slow, steady head turn; a drag follows the finger closely
    const k2 = 1 - Math.exp(-dt * (L.follow ? 3.5 : 14));
    c.yaw += (L.yaw - c.yaw) * k2;
    c.pitch += (L.pitch - c.pitch) * k2;
    if (Math.abs(c.yaw - L.yaw) < 1e-4) c.yaw = L.yaw;
    if (Math.abs(c.pitch - L.pitch) < 1e-4) c.pitch = L.pitch;
    const yaw = base.yaw - c.yaw;
    const pitch = Math.max(-0.2, Math.min(1.35, base.pitch - c.pitch));
    camera.rotation.set(-pitch, yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
    if (c.yaw !== 0 || c.pitch !== 0 || L.yaw !== 0 || L.pitch !== 0) invalidate();
  }, -1);
  return null;
}

function StageDriver({ stage, chars }: { stage: TableStage; chars: Characters }) {
  const { invalidate, camera, gl } = useThree();
  useEffect(() => {
    stage.camera = camera;
    stage.canvas = gl.domElement;
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) Object.assign(window as object, { __k3d: stage, __gl: gl, __chars: chars });
  }, [stage, camera, gl]);
  useEffect(() => {
    stage.invalidate = () => invalidate();
    chars.invalidate = () => invalidate();
    let alive = true;
    // card faces are drawn again once Fraunces has loaded
    loadCardFonts().then(() => { if (alive) { redrawCards(); invalidate(); } });
    return () => { alive = false; stage.invalidate = () => {}; chars.invalidate = () => {}; };
  }, [stage, chars, invalidate]);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.25);
    const a = stage.update(d);
    const b = chars.update(d);
    if (a || b) invalidate();
  });
  return null;
}

/** Each frame: put the name plates over the heads and the deck count under the deck */
function OverlayDriver({ overlay, chars, layout, stage }: { overlay: RefObject<Overlay>; chars: Characters; layout: Layout; stage: TableStage }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  // name plates stay on screen even when the head is out of view; the deck tag just hides
  const place = (el: HTMLElement, p: THREE.Vector3, clamp: boolean) => {
    p.project(camera);
    const behind = p.z > 1;
    let x = ((p.x + 1) / 2) * size.width;
    let y = ((1 - p.y) / 2) * size.height;
    if (clamp) {
      if (behind) { x = size.width - x; y = HUD_TOP + 30; }
      const half = el.offsetWidth / 2 + 8;
      x = Math.max(half, Math.min(size.width - half, x));
      y = Math.max(HUD_TOP + 30, Math.min(size.height - HUD_BOTTOM - 10, y));
    } else if (behind || p.x < -1.1 || p.x > 1.1 || p.y < -1.1 || p.y > 1.1) {
      el.style.visibility = 'hidden';
      return;
    }
    el.style.visibility = '';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  };
  useFrame(() => {
    const o = overlay.current;
    o.plates.forEach((el, id) => {
      if (chars.headOf(id, v)) place(el, v, true);
      else el.style.visibility = 'hidden';
    });
    if (o.deck) { const w = stage.worldOnTurntable(layout.deck.x, layout.deck.z + 0.66); place(o.deck, v.set(w.x, TT_H, w.z), false); }
  });
  return null;
}

/** The card table: felt top, brass inlay, a padded leather armrest, a turned pedestal; and the lamp over it */
function TableAndLamp({ layout, mobile, cord }: { layout: Layout; mobile: boolean; cord: boolean }) {
  const r = layout.table.r;
  const tex = useMemo(() => {
    const felt = feltTexture();
    const wood = woodTexture('#4a2c1a', 90);
    wood.repeat.set(10, 1);
    const leather = leatherTexture('#2a1712');
    return { felt, wood, leather };
  }, []);
  const lampTarget = useMemo(() => new THREE.Object3D(), []);
  const lampH = 13;
  const parts = useMemo(() => {
    const top = new THREE.CircleGeometry(r, 128);
    top.rotateX(-Math.PI / 2);
    const uv = top.attributes.uv;
    const pos = top.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * r) + 0.5, -pos.getZ(i) / (2 * r) + 0.5);
    // padded leather armrest: a flattened torus around the felt
    const rail = new THREE.TorusGeometry(r + 0.42, 0.46, 20, 160);
    rail.rotateX(Math.PI / 2);
    rail.scale(1, 0.62, 1);
    rail.translate(0, 0.1, 0);
    const ruv = rail.attributes.uv;
    for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i) * 30, ruv.getY(i));
    // wooden apron below the rail
    const apron = new THREE.CylinderGeometry(r + 0.55, r + 0.35, 1.2, 128, 1, true);
    apron.translate(0, -0.75, 0);
    const inlay = new THREE.RingGeometry(r - 0.06, r - 0.02, 160);
    inlay.rotateX(-Math.PI / 2);
    inlay.translate(0, 0.002, 0);
    return { top, rail, apron, inlay };
  }, [r]);
  const mats = useMemo(() => ({
    // shadowSide: the top must block the lamp's light for what lies under the table (rug, floor)
    felt: new THREE.MeshStandardMaterial({ map: tex.felt, roughness: 0.97, envMapIntensity: 0.2, shadowSide: THREE.DoubleSide }),
    rail: new THREE.MeshStandardMaterial({ map: tex.leather, roughness: 0.48, envMapIntensity: 0.7 }),
    wood: new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.4, envMapIntensity: 0.9 }),
    brass: new THREE.MeshStandardMaterial({ color: '#c9a063', roughness: 0.3, metalness: 1, envMapIntensity: 1.1 }),
    pedestal: new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.45, envMapIntensity: 0.8 }),
  }), [tex]);
  useEffect(() => () => {
    Object.values(parts).forEach((g) => g.dispose());
  }, [parts]);
  useEffect(() => () => {
    Object.values(mats).forEach((m) => m.dispose());
    Object.values(tex).forEach((t) => t.dispose());
  }, [mats, tex]);
  const shadowSize = mobile ? 1024 : 2048;
  // the lamp is close to the felt, so a wider PCF kernel reads as the soft edge of a real bulb
  return (
    <group>
      <hemisphereLight args={['#fff0dc', '#2a1a10', 0.08]} />
      {/* soft fill from behind your shoulder so faces and the card in your hand are not black */}
      <directionalLight position={[2, 9, r + 14]} intensity={0.16} color="#ffe7c8" />
      {/* the lamp over the table */}
      <spotLight
        position={[0, lampH - 0.6, 0]}
        target={lampTarget}
        angle={Math.atan((r + 1.6) / lampH)}
        penumbra={0.4}
        decay={0}
        intensity={5}
        color="#ffe4bf"
        castShadow
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={mobile ? 3 : 5}
        shadow-camera-near={4}
        shadow-camera-far={lampH + 9}
      />
      <primitive object={lampTarget} />
      <Lamp y={lampH} cord={cord} />

      <mesh geometry={parts.top} material={mats.felt} receiveShadow castShadow />
      <mesh geometry={parts.inlay} material={mats.brass} />
      <mesh geometry={parts.rail} material={mats.rail} castShadow receiveShadow />
      <mesh geometry={parts.apron} material={mats.wood} />
      {/* turned pedestal and foot */}
      <mesh position={[0, (FLOOR_Y - 1.4) / 2, 0]} material={mats.pedestal} castShadow>
        <cylinderGeometry args={[0.9, 1.3, -FLOOR_Y - 1.4, 32]} />
      </mesh>
      <mesh position={[0, FLOOR_Y + 1.2, 0]} material={mats.brass}>
        <torusGeometry args={[1.35, 0.12, 10, 40]} />
      </mesh>
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} position={[0, FLOOR_Y + 0.35, 0]} rotation-y={(k * Math.PI) / 2} material={mats.pedestal} castShadow>
          <boxGeometry args={[0.9, 0.7, 7]} />
        </mesh>
      ))}
    </group>
  );
}

/** A plain pendant: cord, dark enamel shade with a brass band, the bulb inside it (in space it simply floats) */
function Lamp({ y, cord }: { y: number; cord: boolean }) {
  const parts = useMemo(() => {
    const pts = [new THREE.Vector2(0.35, 1.7), new THREE.Vector2(0.62, 1.55), new THREE.Vector2(1.7, 0.6), new THREE.Vector2(2.7, 0.05), new THREE.Vector2(2.72, 0)];
    return { shade: new THREE.LatheGeometry(pts, 64), band: new THREE.TorusGeometry(2.71, 0.05, 8, 64).rotateX(Math.PI / 2) };
  }, []);
  useEffect(() => () => { parts.shade.dispose(); parts.band.dispose(); }, [parts]);
  return (
    <group position={[0, y, 0]}>
      <mesh position={[0, 6, 0]} visible={cord}>
        <cylinderGeometry args={[0.04, 0.04, 9, 6]} />
        <meshStandardMaterial color="#1a1714" />
      </mesh>
      <mesh geometry={parts.shade}>
        <meshStandardMaterial color="#24332c" roughness={0.35} metalness={0.25} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={parts.band}>
        <meshStandardMaterial color="#c9a063" roughness={0.3} metalness={1} />
      </mesh>
      {/* the bulb: a plain bright surface rather than a glow effect */}
      <mesh position={[0, 0.5, 0]}>
        <sphereGeometry args={[0.45, 20, 14]} />
        <meshBasicMaterial color="#ffe6c2" />
      </mesh>
    </group>
  );
}

/** Soft reflections for brass, lacquer, glass and polished wood, from a generic room light probe */
function Reflections() {
  const { gl, scene } = useThree();
  useEffect(() => {
    let alive = true;
    let env: THREE.Texture | null = null;
    import('three/examples/jsm/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
      if (!alive) return;
      const pmrem = new THREE.PMREMGenerator(gl);
      const room = new RoomEnvironment();
      env = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      pmrem.dispose();
      scene.environment = env;
      scene.environmentIntensity = 0.09;
    }).catch(() => { /* reflections are a nicety */ });
    return () => {
      alive = false;
      if (scene.environment === env) scene.environment = null;
      env?.dispose();
    };
  }, [gl, scene]);
  return null;
}
