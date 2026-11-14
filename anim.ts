import { cardElement } from './components/Card';
import { sfx } from './audio';
import type { GameEvent } from './game/types';

// Card flights: a temporary card travels from one place on the table to another
// while the real state is still the old one. The state commits when it lands.

export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let layer: HTMLElement | null = null;
function getLayer() {
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div');
    layer.className = 'flight-layer';
    document.body.appendChild(layer);
  }
  return layer;
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const cardEl = (id: number) => q(`[data-card="${id}"]`);
const anchor = (name: string) => q(`[data-anchor="${name}"]`);

/** Elements hidden for the length of a flight; shown again after the state commits */
const hidden = new Set<HTMLElement>();
function hide(el: HTMLElement | null) {
  if (!el) return;
  el.style.visibility = 'hidden';
  hidden.add(el);
}
export function restoreHidden() {
  hidden.forEach((el) => { el.style.visibility = ''; });
  hidden.clear();
}

interface FlyOpts {
  from: HTMLElement | null;
  to: HTMLElement | null;
  v: number | null;
  upFrom: boolean;
  upTo: boolean;
  duration?: number;
  delay?: number;
  lift?: number;
}

async function fly({ from, to, v, upFrom, upTo, duration = 520, delay = 0, lift = 1.08 }: FlyOpts) {
  if (!from || !to) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const fast = reduced();
  const dur = fast ? 160 : duration;
  const el = cardElement(v, upTo, b.width);
  el.classList.add('is-flying');
  Object.assign(el.style, { left: b.left + 'px', top: b.top + 'px' });
  const s = a.width / b.width;
  const dx = a.left - b.left;
  const dy = a.top - b.top;
  getLayer().appendChild(el);
  const mid = ((s + 1) / 2) * lift;
  const anim = el.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, boxShadow: '0 1px 2px rgba(0,0,0,.35)' },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 14}px) scale(${mid})`, boxShadow: '0 18px 36px rgba(0,0,0,.45)', offset: 0.55 },
      { transform: 'translate(0, 0) scale(1)', boxShadow: '0 1px 2px rgba(0,0,0,.35)' },
    ],
    { duration: dur, delay, easing: EASE, fill: 'both' },
  );
  if (upFrom !== upTo && !fast) {
    const inner = el.firstElementChild as HTMLElement;
    inner.animate(
      [{ transform: `rotateY(${upTo ? 180 : 0}deg)` }, { transform: `rotateY(${upTo ? 0 : 180}deg)` }],
      { duration: dur * 0.8, delay: delay + dur * 0.1, easing: EASE, fill: 'both' },
    );
  }
  await anim.finished.catch(() => {});
  // Keep the flying card in place for one frame so the committed card appears underneath it
  requestAnimationFrame(() => requestAnimationFrame(() => el.remove()));
}

/** Plays the flight for one event, before its state is committed */
export async function animateBefore(ev: GameEvent, myId: string) {
  switch (ev.k) {
    case 'draw': {
      sfx.slide();
      await fly({ from: anchor('deck'), to: anchor('hand'), v: ev.card.v, upFrom: false, upTo: true });
      break;
    }
    case 'take': {
      sfx.slide();
      const src = cardEl(ev.card.id);
      const flight = fly({ from: src, to: anchor('hand'), v: ev.card.v, upFrom: true, upTo: true });
      hide(src);
      await flight;
      break;
    }
    case 'swap': {
      const src = cardEl(ev.card.id);
      const target = cardEl(ev.out.id);
      const outgoing = fly({ from: target, to: anchor('discard'), v: ev.out.v, upFrom: ev.wasUp, upTo: true, duration: 560, lift: 1.12 });
      const incoming = fly({ from: src, to: target, v: ev.card.v, upFrom: true, upTo: true, duration: 520, delay: 90 });
      hide(src);
      hide(target);
      setTimeout(() => sfx.place(), 380);
      await Promise.all([outgoing, incoming]);
      break;
    }
    case 'toss': {
      const src = cardEl(ev.card.id);
      const flight = fly({ from: src, to: anchor('discard'), v: ev.card.v, upFrom: true, upTo: true });
      hide(src);
      setTimeout(() => sfx.place(), 320);
      await flight;
      break;
    }
    case 'clear': {
      const els = ev.cards.map((c) => cardEl(c.id));
      els.forEach((el) => el?.classList.add('is-clearing'));
      sfx.clear();
      await wait(reduced() ? 80 : 420);
      const flights = ev.cards.map((c, i) =>
        fly({ from: els[i], to: anchor('discard'), v: c.v, upFrom: true, upTo: true, delay: i * 70, duration: 480 }),
      );
      els.forEach(hide);
      await Promise.all(flights);
      break;
    }
    case 'shuffle': {
      sfx.shuffle();
      const flights = Array.from({ length: 5 }, (_, i) =>
        fly({ from: anchor('discard'), to: anchor('deck'), v: null, upFrom: true, upTo: false, delay: i * 60, duration: 420 }),
      );
      await Promise.all(flights);
      break;
    }
    case 'start':
    case 'turn':
      if (ev.p === myId) sfx.turn();
      break;
  }
}

/** Pause after a commit so CSS transitions (flips, deal-in) can finish */
export function afterDelay(ev: GameEvent): number {
  if (reduced()) return 60;
  switch (ev.k) {
    case 'flip': return 440;
    case 'reveal': return 1100;
    case 'deal': return 900;
    case 'finish': return 500;
    case 'clear': return 260;
    case 'start': return 200;
    case 'roundEnd': return 200;
    default: return 0;
  }
}

/** Sound that belongs to the moment of commit */
export function commitSound(ev: GameEvent) {
  if (ev.k === 'flip' || ev.k === 'reveal') sfx.flip();
  if (ev.k === 'deal') sfx.shuffle();
  if (ev.k === 'roundEnd') sfx.end();
}

/** FLIP for layout shifts, e.g. columns closing a gap after a clear */
export function measureCards(): Map<string, DOMRect> {
  const m = new Map<string, DOMRect>();
  document.querySelectorAll<HTMLElement>('[data-card]').forEach((el) => m.set(el.dataset.card!, el.getBoundingClientRect()));
  return m;
}

export function playLayoutShift(before: Map<string, DOMRect>) {
  if (reduced()) return;
  document.querySelectorAll<HTMLElement>('[data-card]').forEach((el) => {
    const old = before.get(el.dataset.card!);
    if (!old) return;
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    if (Math.abs(old.width - now.width) > 2) return; // a different board size, not a shift
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 360, easing: EASE });
  });
}
