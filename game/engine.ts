import type { Action, Card, Column, GameEvent, GameState, Player, Step } from './types';
import { MAX_PLAYERS, TARGET_OPTIONS } from './types';

/** 150 cards: −2 ×5, −1 ×10, 0 ×15, 1 to 12 ×10 each */
export const DECK_SPEC: [number, number][] = [
  [-2, 5], [-1, 10], [0, 15],
  ...Array.from({ length: 12 }, (_, i) => [i + 1, 10] as [number, number]),
];

export const HIDDEN_EXPECTATION = 760 / 150; // average card value, ≈ 5.07

function rand(n: number): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % n;
  }
  return Math.floor(Math.random() * n);
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function slots(p: Player) {
  return p.grid.flat();
}

export function allUp(p: Player): boolean {
  return slots(p).every((s) => s.up);
}

export function visibleSum(p: Player): number {
  return slots(p).reduce((sum, s) => sum + (s.up && s.card.v !== null ? s.card.v : 0), 0);
}

export function findSlot(p: Player, cardId: number) {
  for (let c = 0; c < p.grid.length; c++) {
    for (let r = 0; r < p.grid[c].length; r++) {
      if (p.grid[c][r].card.id === cardId) return { c, r, slot: p.grid[c][r] };
    }
  }
  return null;
}

export function blankState(hostId: string): GameState {
  return {
    phase: 'lobby',
    round: 0,
    target: 100,
    hostId,
    players: [],
    deck: [],
    deckCount: 0,
    discard: [],
    turn: 0,
    stage: 'choose',
    drawn: null,
    finisher: null,
    lastTurns: [],
    starter: null,
    result: null,
    nextId: 1,
  };
}

/** The view one player is allowed to see: no deck order, no face-down values. */
export function publicView(s: GameState): GameState {
  const v: GameState = structuredClone(s);
  v.deckCount = s.deck.length;
  v.deck = [];
  for (const p of v.players) {
    for (const col of p.grid) for (const slot of col) if (!slot.up) slot.card.v = null;
  }
  return v;
}

type Result = { ok: true; steps: Step[] } | { ok: false; err: string; steps: Step[] };

export class Game {
  s: GameState;
  private steps: Step[] = [];

  constructor(hostId: string, state?: GameState) {
    this.s = state ?? blankState(hostId);
  }

  private emit(ev: GameEvent) {
    this.s.deckCount = this.s.deck.length;
    this.steps.push({ ev, state: structuredClone(this.s) });
  }

  private flush(): Step[] {
    const out = this.steps;
    this.steps = [];
    return out;
  }

  get current(): Player | undefined {
    return this.s.players[this.s.turn];
  }

  player(id: string) {
    return this.s.players.find((p) => p.id === id);
  }

  // ---------- roster ----------

  addPlayer(id: string, name: string, bot = false): Result {
    if (this.s.phase !== 'lobby') return { ok: false, err: 'started', steps: [] };
    if (this.s.players.length >= MAX_PLAYERS) return { ok: false, err: 'full', steps: [] };
    if (this.player(id)) return { ok: true, steps: [] };
    const used = new Set(this.s.players.map((p) => p.seat));
    let seat = 0;
    while (used.has(seat)) seat++;
    this.s.players.push({
      id, name: cleanName(name), seat, bot, connected: true,
      grid: [], total: 0, history: [], setupFlips: 0,
    });
    this.emit({ k: 'presence', p: id });
    return { ok: true, steps: this.flush() };
  }

  setConnected(id: string, connected: boolean): Step[] {
    const p = this.player(id);
    if (!p) return [];
    p.connected = connected;
    if (connected && p.bot && !p.id.startsWith('bot-')) p.bot = false; // a returning human takes their seat back
    if (!connected && this.s.phase === 'lobby' && id !== this.s.hostId) {
      this.s.players = this.s.players.filter((x) => x.id !== id);
    }
    this.emit({ k: 'presence', p: id });
    return this.flush();
  }

  // ---------- actions ----------

  apply(pid: string, act: Action): Result {
    const fail = (err: string): Result => ({ ok: false, err, steps: this.flush() });
    const s = this.s;
    const isHost = pid === s.hostId;
    const me = this.player(pid);

    switch (act.a) {
      case 'addBot': {
        if (!isHost) return fail('host');
        const id = 'bot-' + Math.random().toString(36).slice(2, 8);
        return this.addPlayer(id, act.name, true);
      }
      case 'remove': {
        if (!isHost || s.phase !== 'lobby' || act.id === s.hostId) return fail('host');
        s.players = s.players.filter((p) => p.id !== act.id);
        this.emit({ k: 'presence', p: act.id });
        return { ok: true, steps: this.flush() };
      }
      case 'botTakeover': {
        if (!isHost) return fail('host');
        const p = this.player(act.id);
        if (!p || p.connected) return fail('state');
        p.bot = true;
        this.emit({ k: 'presence', p: act.id });
        return { ok: true, steps: this.flush() };
      }
      case 'target': {
        if (!isHost || s.phase !== 'lobby' || !TARGET_OPTIONS.includes(act.value)) return fail('host');
        s.target = act.value;
        this.emit({ k: 'presence', p: pid });
        return { ok: true, steps: this.flush() };
      }
      case 'start': {
        if (!isHost || s.phase !== 'lobby') return fail('host');
        if (s.players.length < 2) return fail('players');
        for (const p of s.players) { p.total = 0; p.history = []; }
        s.round = 0;
        s.starter = null;
        this.deal();
        return { ok: true, steps: this.flush() };
      }
      case 'nextRound': {
        if (!isHost || s.phase !== 'roundEnd') return fail('host');
        this.deal();
        return { ok: true, steps: this.flush() };
      }
      case 'toLobby': {
        if (!isHost || (s.phase !== 'gameOver' && s.phase !== 'roundEnd')) return fail('host');
        s.phase = 'lobby';
        s.players = s.players.filter((p) => p.connected || p.id.startsWith('bot-'));
        for (const p of s.players) {
          p.grid = []; p.total = 0; p.history = []; p.setupFlips = 0;
          if (!p.id.startsWith('bot-')) p.bot = false;
        }
        Object.assign(s, { deck: [], discard: [], drawn: null, finisher: null, lastTurns: [], result: null, round: 0 });
        this.emit({ k: 'lobby' });
        return { ok: true, steps: this.flush() };
      }
    }

    if (!me) return fail('player');

    // Setup: everyone flips two cards, in any order
    if (s.phase === 'setup') {
      if (act.a !== 'flip') return fail('stage');
      if (me.setupFlips >= 2) return fail('stage');
      const hit = findSlot(me, act.card);
      if (!hit || hit.slot.up) return fail('card');
      this.reveal(hit.slot);
      me.setupFlips++;
      this.emit({ k: 'flip', p: me.id, card: hit.slot.card });
      if (s.players.every((p) => p.setupFlips >= 2)) this.beginPlay();
      return { ok: true, steps: this.flush() };
    }

    if (s.phase !== 'play') return fail('phase');
    if (this.current?.id !== pid) return fail('turn');

    switch (act.a) {
      case 'drawDeck': {
        if (s.stage !== 'choose') return fail('stage');
        if (s.deck.length === 0) this.reshuffle();
        const card = s.deck.pop();
        if (!card) return fail('empty');
        s.drawn = card;
        s.stage = 'deckDrawn';
        this.emit({ k: 'draw', p: pid, card });
        return { ok: true, steps: this.flush() };
      }
      case 'takeDiscard': {
        if (s.stage !== 'choose') return fail('stage');
        const card = s.discard.pop();
        if (!card) return fail('empty');
        s.drawn = card;
        s.stage = 'discardTaken';
        this.emit({ k: 'take', p: pid, card });
        return { ok: true, steps: this.flush() };
      }
      case 'swap': {
        if (s.stage !== 'deckDrawn' && s.stage !== 'discardTaken') return fail('stage');
        const hit = findSlot(me, act.card);
        if (!hit || !s.drawn) return fail('card');
        const wasUp = hit.slot.up;
        const out = hit.slot.card;
        me.grid[hit.c][hit.r] = { card: s.drawn, up: true };
        const incoming = s.drawn;
        s.drawn = null;
        s.discard.push(out);
        this.emit({ k: 'swap', p: pid, card: incoming, out, wasUp });
        this.clearColumns(me);
        this.endTurn();
        return { ok: true, steps: this.flush() };
      }
      case 'toss': {
        if (s.stage !== 'deckDrawn' || !s.drawn) return fail('stage');
        const card = s.drawn;
        s.discard.push(card);
        s.drawn = null;
        s.stage = 'mustFlip';
        this.emit({ k: 'toss', p: pid, card });
        if (allUp(me)) this.endTurn(); // cannot happen in normal play, kept as a guard
        return { ok: true, steps: this.flush() };
      }
      case 'flip': {
        if (s.stage !== 'mustFlip') return fail('stage');
        const hit = findSlot(me, act.card);
        if (!hit || hit.slot.up) return fail('card');
        this.reveal(hit.slot);
        this.emit({ k: 'flip', p: pid, card: hit.slot.card });
        this.clearColumns(me);
        this.endTurn();
        return { ok: true, steps: this.flush() };
      }
    }
    return fail('action');
  }

  // ---------- internals ----------

  private reveal(slot: { card: Card; up: boolean }) {
    slot.up = true;
  }

  private deal() {
    const s = this.s;
    const deck: Card[] = [];
    for (const [v, n] of DECK_SPEC) for (let i = 0; i < n; i++) deck.push({ id: 0, v });
    shuffle(deck);
    for (const c of deck) c.id = s.nextId++;
    s.deck = deck;
    for (const p of s.players) {
      const grid: Column[] = [];
      for (let c = 0; c < 4; c++) grid.push([0, 1, 2].map(() => ({ card: deck.pop()!, up: false })));
      p.grid = grid;
      p.setupFlips = 0;
    }
    s.discard = [deck.pop()!];
    s.round += 1;
    s.phase = 'setup';
    s.stage = 'choose';
    s.drawn = null;
    s.finisher = null;
    s.lastTurns = [];
    s.result = null;
    this.emit({ k: 'deal' });
  }

  private beginPlay() {
    const s = this.s;
    let idx = s.starter ? s.players.findIndex((p) => p.id === s.starter) : -1;
    if (idx < 0) {
      let best = -Infinity;
      s.players.forEach((p, i) => {
        const v = visibleSum(p);
        if (v > best) { best = v; idx = i; }
      });
    }
    s.turn = Math.max(0, idx);
    s.phase = 'play';
    s.stage = 'choose';
    this.emit({ k: 'start', p: s.players[s.turn].id });
  }

  private reshuffle() {
    const s = this.s;
    const top = s.discard.pop();
    s.deck = shuffle(s.discard);
    s.discard = top ? [top] : [];
    this.emit({ k: 'shuffle', n: s.deck.length });
  }

  private clearColumns(p: Player) {
    for (let c = p.grid.length - 1; c >= 0; c--) {
      const col = p.grid[c];
      if (col.length === 3 && col.every((x) => x.up) && col.every((x) => x.card.v === col[0].card.v)) {
        const cards = col.map((x) => x.card);
        p.grid.splice(c, 1);
        this.s.discard.push(...cards);
        this.emit({ k: 'clear', p: p.id, cards });
      }
    }
  }

  private endTurn() {
    const s = this.s;
    const me = this.current!;
    if (s.finisher === null && allUp(me)) {
      s.finisher = me.id;
      s.lastTurns = [];
      for (let i = 1; i < s.players.length; i++) s.lastTurns.push(s.players[(s.turn + i) % s.players.length].id);
      this.emit({ k: 'finish', p: me.id });
    } else if (s.finisher !== null) {
      s.lastTurns = s.lastTurns.filter((id) => id !== me.id);
    }
    if (s.finisher !== null && s.lastTurns.length === 0) {
      this.endRound();
      return;
    }
    s.turn = (s.turn + 1) % s.players.length;
    s.stage = 'choose';
    this.emit({ k: 'turn', p: s.players[s.turn].id });
  }

  private endRound() {
    const s = this.s;
    s.stage = 'choose';
    for (const p of s.players) for (const col of p.grid) for (const slot of col) slot.up = true;
    this.emit({ k: 'reveal' });
    for (const p of s.players) this.clearColumns(p);

    const raw: Record<string, number> = {};
    for (const p of s.players) raw[p.id] = visibleSum(p);
    const fid = s.finisher!;
    const fRaw = raw[fid];
    const doubled = fRaw > 0 && s.players.some((p) => p.id !== fid && raw[p.id] <= fRaw);
    const scores: Record<string, number> = { ...raw };
    if (doubled) scores[fid] = fRaw * 2;
    for (const p of s.players) {
      p.total += scores[p.id];
      p.history.push(scores[p.id]);
    }
    s.result = { round: s.round, finisher: fid, raw, scores, doubled };
    s.starter = fid;
    s.phase = s.players.some((p) => p.total >= s.target) ? 'gameOver' : 'roundEnd';
    this.emit({ k: 'roundEnd' });
  }
}

export function cleanName(name: string): string {
  const n = name.replace(/\s+/g, ' ').trim().slice(0, 16);
  return n || 'Player';
}

/** Players ranked by total, lowest first. Ties share a place. */
export function standings(players: Player[]) {
  const sorted = [...players].sort((a, b) => a.total - b.total);
  return sorted.map((p) => ({ p, place: sorted.findIndex((q) => q.total === p.total) + 1 }));
}
