import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
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
import { TableStage, stageRef } from './stage';
import { computeLayout, GRID_D, GRID_W, seatPoint, type Layout } from './layout';
import { feltTexture, loadCardFonts, redrawCards, setAnisotropy, woodTexture } from './textures';
import { threeAnimator } from './animator3d';

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
}

// Room for the HTML status at the top and the own name plate at the bottom, in px
const HUD_TOP = 100;
const HUD_BOTTOM = 44;

export default function Table3D({ view, me, isHost, busy, lastEv, hovers, send, onHover, animator }: Props) {
  const { t } = useI18n();
  const m = useTableModel(view, me, busy, lastEv, send);
  const stage = useMemo(() => new TableStage(), []);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

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

  // Layout changes (resize, players joining) move everything into place at once
  useLayoutEffect(() => {
    stage.setLayout(layout, view.players);
    stage.sync(view, me, { instant: true });
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every committed state: cards fly to their new places
  const firstSync = useRef(true);
  useLayoutEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    stage.sync(view, me, stage.takeNextSync());
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // Which cards and piles take a click right now
  const mine = m.mine;
  useLayoutEffect(() => {
    const sel = new Set<number>();
    if (mine) for (const col of mine.grid) for (const s of col) if (m.selectable(s.card.id, s.up)) sel.add(s.card.id);
    stage.selectable = sel;
    stage.deckActive = m.deckActive;
    stage.discardActive = m.discardActive;
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

  // Pointer → action
  const lastHoverSent = useRef(0);
  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const ud = e.object.userData as { cardId?: number; anchor?: string };
    if (ud.cardId !== undefined) {
      if (stage.selectable.has(ud.cardId)) return { card: ud.cardId };
      if (stage.isTopDiscard(ud.cardId)) return { pile: 'discard' as const };
      return null;
    }
    if (ud.anchor === 'deck' || ud.anchor === 'discard') return { pile: ud.anchor as 'deck' | 'discard' };
    return null;
  };
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
    if (e.pointerType === 'touch') return;
    const hit = pick(e);
    const card = hit && 'card' in hit ? hit.card ?? null : null;
    const pile = hit && 'pile' in hit ? hit.pile ?? null : null;
    const pileOn = pile === 'deck' ? stage.deckActive : pile === 'discard' ? stage.discardActive : false;
    if (stage.hovered !== card || stage.pileHover !== (pileOn ? pile : null)) {
      stage.hovered = card;
      stage.pileHover = pileOn ? pile : null;
      stage.refreshInteractive();
    }
    setCursor(card !== null || pileOn);
    const own = (e.object.userData as { cardId?: number }).cardId;
    reportHover(own !== undefined && stage.slots.has(own) ? own : null);
  };
  const onOut = () => {
    clearHover();
    reportHover(null);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const hit = pick(e);
    if (!hit) return;
    if ('card' in hit && hit.card !== undefined) {
      reportHover(null);
      clearHover();
      m.onMyCard(hit.card);
    } else if ('pile' in hit) {
      if (hit.pile === 'deck' && m.deckActive) m.onDeck();
      if (hit.pile === 'discard' && m.discardActive) m.onDiscard();
      clearHover();
    }
  };

  // Name plates: project each seat's anchor with the same camera the canvas uses
  const plates = useMemo(() => {
    if (!size.w || !size.h) return [];
    const cam = new THREE.PerspectiveCamera(layout.camera.fov, size.w / size.h, 0.1, 200);
    cam.position.copy(layout.camera.pos);
    cam.lookAt(layout.camera.target);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const v = new THREE.Vector3();
    return view.players.map((p, i) => {
      const seat = layout.seats[i];
      if (!seat) return null;
      // the grid's outline on screen; the plate sits above it (below it for your own grid)
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const hw = (GRID_W + 0.36) / 2;
      const hd = (GRID_D + 0.36) / 2;
      for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
        const q = seatPoint(seat, lx, lz);
        v.set(q.x, 0, q.z).project(cam);
        const sx = ((v.x + 1) / 2) * size.w;
        const sy = ((1 - v.y) / 2) * size.h;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      const mine = p.id === me;
      return { id: p.id, x: (x0 + x1) / 2, y: mine ? y1 + 4 : y0 - 4 };
    });
  }, [layout, size, view.players, me]);
  const anchors = useMemo(() => {
    if (!size.w) return null;
    const cam = new THREE.PerspectiveCamera(layout.camera.fov, size.w / size.h, 0.1, 200);
    cam.position.copy(layout.camera.pos);
    cam.lookAt(layout.camera.target);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const toScreen = (v: THREE.Vector3) => { v.project(cam); return { x: ((v.x + 1) / 2) * size.w, y: ((1 - v.y) / 2) * size.h }; };
    return {
      deck: toScreen(new THREE.Vector3(layout.deck.x, 0, layout.deck.z + 0.62)),
    };
  }, [layout, size]);

  const current = view.players[view.turn];
  return (
    <div className="table3d" ref={wrap}>
      {size.w > 0 && (
        <Canvas
          shadows="percentage"
          dpr={[1, Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, size.w < 700 ? 1.5 : 1.75)]}
          frameloop="demand"
          gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
          camera={{ fov: layout.camera.fov, near: 0.1, far: 120, position: layout.camera.pos.toArray() as [number, number, number] }}
          onCreated={({ gl, scene }) => {
            gl.toneMapping = THREE.NeutralToneMapping;
            gl.toneMappingExposure = 1;
            scene.background = new THREE.Color('#141210');
            setAnisotropy(gl.capabilities.getMaxAnisotropy());
          }}
          onPointerMissed={onOut}
        >
          <CameraRig layout={layout} />
          <Lights layout={layout} />
          <TableTop layout={layout} />
          <StageDriver stage={stage} />
          <primitive object={stage.root} onPointerMove={onMove} onPointerOut={onOut} onClick={onClick} />
        </Canvas>
      )}

      <div className="hud3d" aria-live="polite">
        <p className={'status-main tone-' + m.tone}>{m.status}</p>
        {m.finalNote && <p className="status-final">{m.finalNote}</p>}
        {m.canToss && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => send({ a: 'toss' })} disabled={!m.canAct}>
            {t('discardIt')}
          </button>
        )}
        {m.toast && <div className="toast3d" role="status">{m.toast}</div>}
      </div>

      {anchors && (
        <span className="pile-tag3d tabular" style={{ left: anchors.deck.x, top: anchors.deck.y }}>
          {t('deck')} {view.deckCount}
        </span>
      )}

      {plates.map((pl, i) => {
        if (!pl) return null;
        const p = view.players[i];
        const isMe = p.id === me;
        const isTurn = view.phase === 'play' && current?.id === p.id;
        const done = view.phase === 'setup' && p.setupFlips >= 2;
        return (
          <div
            key={p.id}
            className={'plate3d' + (isMe ? ' is-me' : '') + (isTurn ? ' is-turn' : '') + (!p.connected ? ' is-offline' : '')}
            style={{ left: pl.x, top: pl.y, '--seat': SEAT_COLORS[p.seat % 6] } as CSSProperties}
          >
            <span className="seat-dot" />
            <span className="board-name">{p.name}{isMe && <span className="muted"> · {t('you')}</span>}</span>
            {p.bot && <span className="tag"><Icon name="bot" size={12} />{t('bot')}</span>}
            {!p.connected && !p.bot && <span className="tag tag-warn"><Icon name="wifiOff" size={12} />{t('offline')}</span>}
            {view.finisher === p.id && view.phase === 'play' && <span className="tag tag-accent">{t('wentOut')}</span>}
            {view.phase === 'setup' && !isMe && (done ? <Icon name="check" size={14} /> : <span className="muted tabular">{p.setupFlips}/2</span>)}
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
    </div>
  );
}

function CameraRig({ layout }: { layout: Layout }) {
  const { camera, invalidate, size } = useThree();
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = layout.camera.fov;
    cam.position.copy(layout.camera.pos);
    cam.lookAt(layout.camera.target);
    cam.updateProjectionMatrix();
    invalidate();
  }, [layout, camera, invalidate, size.width, size.height]);
  return null;
}

function StageDriver({ stage }: { stage: TableStage }) {
  const { invalidate, camera, gl } = useThree();
  useEffect(() => {
    stage.camera = camera;
    stage.canvas = gl.domElement;
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { __k3d?: TableStage }).__k3d = stage;
  }, [stage, camera, gl]);
  useEffect(() => {
    stage.invalidate = () => invalidate();
    let alive = true;
    // card faces are drawn again once Fraunces has loaded
    loadCardFonts().then(() => { if (alive) { redrawCards(); invalidate(); } });
    return () => { alive = false; stage.invalidate = () => {}; };
  }, [stage, invalidate]);
  useFrame((_, dt) => {
    if (stage.update(Math.min(dt, 0.05))) invalidate();
  });
  return null;
}

function Lights({ layout }: { layout: Layout }) {
  const target = useMemo(() => new THREE.Object3D(), []);
  const cz = layout.table.cz;
  const reach = Math.max(layout.table.rx, layout.table.rz);
  useLayoutEffect(() => {
    target.position.set(0, 0, cz);
    target.updateMatrixWorld();
  }, [target, cz]);
  const h = 7 + reach * 0.6;
  return (
    <>
      <hemisphereLight args={['#fff0dc', '#1a120c', 0.7]} />
      {/* the lamp over the table */}
      <spotLight
        position={[0.4, h, cz + 0.6]}
        target={target}
        angle={Math.atan((reach + 2.2) / h)}
        penumbra={0.85}
        decay={0}
        intensity={4.2}
        color="#ffe2bb"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.015}
        shadow-radius={4}
        shadow-camera-near={h - 3}
        shadow-camera-far={h + 2}
      />
      <primitive object={target} />
    </>
  );
}

/** A superellipse outline: a soft rounded-rectangle table */
function tableShape(rx: number, rz: number, cz: number, e = 4) {
  const s = new THREE.Shape();
  const N = 96;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / e) * rx;
    const y = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e) * rz;
    if (i === 0) s.moveTo(x, -(y + cz));
    else s.lineTo(x, -(y + cz));
  }
  return s;
}

function TableTop({ layout }: { layout: Layout }) {
  const { rx, rz, cz } = layout.table;
  const felt = useMemo(() => feltTexture(), []);
  const wood = useMemo(() => woodTexture(), []);
  const geos = useMemo(() => {
    const top = new THREE.ShapeGeometry(tableShape(rx, rz, cz), 1);
    // shape is built in XY with y = −z so that rotating to the floor keeps it in place
    top.rotateX(-Math.PI / 2);
    const uv = top.attributes.uv;
    const pos = top.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 2.2, pos.getZ(i) / 2.2);
    const railShape = tableShape(rx + 0.5, rz + 0.5, cz);
    railShape.holes.push(tableShape(rx, rz, cz) as unknown as THREE.Path);
    const rail = new THREE.ExtrudeGeometry(railShape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3, curveSegments: 64 });
    rail.rotateX(-Math.PI / 2);
    rail.translate(0, -0.08, 0);
    const rpos = rail.attributes.position;
    const ruv = rail.attributes.uv;
    for (let i = 0; i < rpos.count; i++) {
      const x = rpos.getX(i);
      const z = rpos.getZ(i) - cz;
      ruv.setXY(i, (Math.atan2(z / rz, x / rx) / (Math.PI * 2)) * 14, rpos.getY(i) * 2 + Math.hypot(x / rx, z / rz) * 3);
    }
    return { top, rail };
  }, [rx, rz, cz]);
  useEffect(() => () => { geos.top.dispose(); geos.rail.dispose(); }, [geos]);
  return (
    <group>
      <mesh geometry={geos.top} receiveShadow castShadow>
        <meshStandardMaterial map={felt} roughness={0.96} metalness={0} />
      </mesh>
      <mesh geometry={geos.rail} castShadow receiveShadow>
        <meshStandardMaterial map={wood} roughness={0.55} metalness={0} />
      </mesh>
      {/* the room below: a dark floor so the table has something to stand on */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -2.2, cz]}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#1a1612" roughness={1} />
      </mesh>
    </group>
  );
}
