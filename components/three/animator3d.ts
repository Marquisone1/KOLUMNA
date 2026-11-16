import { flushSync } from 'react-dom';
import { sfx } from '../../audio';
import type { Animator } from '../../anim';
import type { GameEvent, GameState } from '../../game/types';
import { stageRef, type SyncOptions } from './stage';

// The 3D table plays every step in the same order as the 2D one: animate on the old state,
// commit, then wait until the cards the commit set in motion have landed.

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Where a player sits, as a stereo position: you are in the middle, the others left or right */
function panFor(state: GameState, pid: string | undefined): number {
  const st = stageRef.current;
  const L = st?.layout;
  if (!L || !pid) return 0;
  const i = state.players.findIndex((p) => p.id === pid);
  const seat = L.seats[i];
  return seat ? Math.max(-0.85, Math.min(0.85, seat.x / 9)) : 0;
}

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

function commitSound3d(ev: GameEvent, state: GameState) {
  switch (ev.k) {
    case 'flip': sfx.flip({ pan: panFor(state, ev.p) }); break;
    case 'reveal':
      // every face-down card turns, round the table
      state.players.forEach((p, i) => sfx.flip({ when: i * 0.12, pan: panFor(state, p.id), gain: 0.7 }));
      break;
    case 'deal': sfx.deal(14, state.players.map((p) => panFor(state, p.id))); break;
    case 'roundEnd': sfx.end(); break;
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
        sfx.slide({ pan: panFor(state, ev.p) });
        break;
      case 'swap': {
        // the outgoing card lands on the pile, the incoming one in the grid a beat later
        const pan = panFor(state, ev.p);
        sfx.toss({ when: 0.4, pan: pan * 0.4, gain: 0.7 });
        sfx.place({ when: 0.5, pan });
        break;
      }
      case 'toss':
        sfx.toss({ when: 0.36, pan: panFor(state, ev.p) * 0.4 });
        break;
      case 'clear':
        sfx.clear({ pan: panFor(state, ev.p) });
        st.raise(ev.cards.map((c) => c.id), true);
        await wait(st.reduced ? 60 : 460);
        break;
      case 'deal':
        // everyone's cards are swept together and riffled before the new deal
        if (st.cards.size) {
          sfx.shuffle();
          await st.gather();
        }
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
    if (!skip) commitSound3d(ev, _state);
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
