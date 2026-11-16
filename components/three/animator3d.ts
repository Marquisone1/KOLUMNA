import { flushSync } from 'react-dom';
import { sfx } from '../../audio';
import { commitSound, type Animator } from '../../anim';
import type { GameEvent } from '../../game/types';
import { stageRef, type SyncOptions } from './stage';

// The 3D table plays every step in the same order as the 2D one: animate on the old state,
// commit, then wait until the cards the commit set in motion have landed.

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function optionsFor(ev: GameEvent): SyncOptions {
  switch (ev.k) {
    // new cards leave the deck one by one, round the table like a dealer would
    case 'deal': return { delay: (_id, order) => order * 26, pace: 0.9 };
    // everything turns over in a ripple
    case 'reveal': return { delay: (_id, order) => (order % 1000) * 22 };
    // cleared cards follow each other onto the pile
    case 'clear': return { delay: (_id, order) => (order >= 1000 && order < 2000 ? (order - 1000) * 60 : 0) };
    // the incoming card leaves a beat after the outgoing one
    case 'swap': return { delay: (id) => (id === ev.card.id ? 90 : 0) };
    default: return {};
  }
}

export const threeAnimator: Animator = {
  async before(ev, state, myId) {
    const st = stageRef.current;
    if (!st) return;
    st.reduced = reduced();
    switch (ev.k) {
      case 'draw':
      case 'take':
        sfx.slide();
        break;
      case 'swap':
        setTimeout(() => sfx.place(), 420);
        break;
      case 'toss':
        setTimeout(() => sfx.place(), 380);
        break;
      case 'clear':
        sfx.clear();
        st.raise(ev.cards.map((c) => c.id), true);
        await wait(st.reduced ? 60 : 460);
        break;
      case 'deal':
        if (st.cards.size) await st.gather();
        break;
      case 'shuffle': {
        sfx.shuffle();
        const top = state.discard[state.discard.length - 1];
        await st.reshuffle(top ? top.id : null);
        break;
      }
      case 'start':
      case 'turn':
        if (ev.p === myId) sfx.turn();
        break;
    }
  },

  commit(ev, _state, apply, skip) {
    const st = stageRef.current;
    if (st) st.nextSync = skip ? { instant: true } : optionsFor(ev);
    if (skip) apply();
    else flushSync(apply);
    if (st && ev.k === 'clear') st.raise(ev.cards.map((c) => c.id), false);
    if (!skip) commitSound(ev);
  },

  async after(ev) {
    const st = stageRef.current;
    if (st) await Promise.race([st.settled(), wait(4000)]);
    if (reduced()) return;
    switch (ev.k) {
      case 'reveal': await wait(700); break;
      case 'finish': await wait(500); break;
      case 'start':
      case 'roundEnd': await wait(200); break;
    }
  },
};
