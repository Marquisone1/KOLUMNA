import type { Action, GameState, Player } from './types';
import { HIDDEN_EXPECTATION } from './engine';

// The bot only ever reads a public view, so it plays with the same information a person has.

const est = (v: number | null) => (v === null ? HIDDEN_EXPECTATION : v);

function columnScore(col: { v: number | null; up: boolean }[]): number {
  if (col.length === 3 && col.every((x) => x.up && x.v !== null) && col.every((x) => x.v === col[0].v)) return 0;
  return col.reduce((s, x) => s + est(x.up ? x.v : null), 0);
}

function estimate(p: Player): number {
  return p.grid.reduce((s, col) => s + columnScore(col.map((x) => ({ v: x.card.v, up: x.up }))), 0);
}

/** Best place to put `value`. Gain is how much the estimated score drops, plus small bonuses. */
function bestSwap(me: Player, value: number, onlyUp = false) {
  let best = { card: -1, gain: -Infinity, hiddenLeftAfter: 0 };
  const hidden = me.grid.flat().filter((s) => !s.up).length;
  me.grid.forEach((col) => {
    col.forEach((slot, r) => {
      if (onlyUp && !slot.up) return;
      const before = col.map((x) => ({ v: x.card.v, up: x.up }));
      const after = before.map((x, i) => (i === r ? { v: value, up: true } : x));
      let gain = columnScore(before) - columnScore(after);
      // Building a pair in a column is worth a little
      const ups = after.filter((x) => x.up).map((x) => x.v);
      if (ups.filter((v) => v === value).length === 2 && value > 0) gain += 1;
      // Breaking an existing pair costs a little
      const pairBefore = before.filter((x) => x.up && x.v === slot.card.v).length >= 2;
      if (slot.up && pairBefore && slot.card.v !== value) gain -= 1.5;
      if (!slot.up) gain += 0.4; // information
      const hiddenLeftAfter = hidden - (slot.up ? 0 : 1);
      if (gain > best.gain) best = { card: slot.card.id, gain, hiddenLeftAfter };
    });
  });
  return best;
}

/** Would ending the round now likely backfire? */
function riskyToFinish(state: GameState, me: Player, myScoreAfter: number) {
  const others = state.players.filter((p) => p.id !== me.id).map(estimate);
  return myScoreAfter > 0 && others.some((o) => o <= myScoreAfter + 4);
}

function pickHidden(me: Player): number {
  // Prefer a column that already has a visible pair, then a random face-down card
  for (const col of me.grid) {
    const ups = col.filter((s) => s.up);
    const down = col.filter((s) => !s.up);
    if (ups.length === 2 && ups[0].card.v === ups[1].card.v && down.length === 1) return down[0].card.id;
  }
  const down = me.grid.flat().filter((s) => !s.up);
  return down[Math.floor(Math.random() * down.length)].card.id;
}

export function botMove(view: GameState, botId: string): Action | null {
  const me = view.players.find((p) => p.id === botId);
  if (!me) return null;

  if (view.phase === 'setup') {
    if (me.setupFlips >= 2) return null;
    return { a: 'flip', card: pickHidden(me) };
  }
  if (view.phase !== 'play' || view.players[view.turn]?.id !== botId) return null;

  const swapFor = (value: number, threshold: number) => {
    const b = bestSwap(me, value);
    if (b.gain < threshold) return null;
    if (b.hiddenLeftAfter === 0 && view.finisher === null) {
      const after = estimate(me) - b.gain;
      if (riskyToFinish(view, me, after)) return null;
    }
    return b;
  };

  switch (view.stage) {
    case 'choose': {
      const top = view.discard[view.discard.length - 1];
      if (top && top.v !== null && swapFor(top.v, top.v <= 2 ? 1 : 3)) return { a: 'takeDiscard' };
      return { a: 'drawDeck' };
    }
    case 'discardTaken': {
      const v = view.drawn?.v ?? 0;
      const b = bestSwap(me, v);
      return { a: 'swap', card: b.card };
    }
    case 'deckDrawn': {
      const v = view.drawn?.v ?? 0;
      const b = swapFor(v, v <= 4 ? 0.5 : 2);
      if (b) return { a: 'swap', card: b.card };
      const hidden = me.grid.flat().filter((s) => !s.up).length;
      // Flipping the last hidden card would end the round; if that looks bad, swap with the worst visible card instead
      if (hidden === 1 && view.finisher === null && riskyToFinish(view, me, estimate(me))) {
        const fallback = bestSwap(me, v, true);
        return { a: 'swap', card: fallback.card };
      }
      return { a: 'toss' };
    }
    case 'mustFlip':
      return { a: 'flip', card: pickHidden(me) };
  }
  return null;
}
