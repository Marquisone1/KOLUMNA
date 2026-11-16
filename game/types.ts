// Core data model. Everything here is plain JSON so it can be cloned and sent over the wire.

export interface Card {
  id: number;
  /** Card value. `null` in a public view when the card is face down. */
  v: number | null;
}

export interface Slot {
  card: Card;
  up: boolean;
}

/** A column always holds three slots, top to bottom. Cleared columns are removed from the grid. */
export type Column = Slot[];

export interface Player {
  id: string;
  name: string;
  /** Stable colour index 0–5, assigned on join */
  seat: number;
  bot: boolean;
  connected: boolean;
  grid: Column[];
  total: number;
  history: number[];
  setupFlips: number;
}

export type Phase = 'lobby' | 'setup' | 'play' | 'roundEnd' | 'gameOver';

/**
 * choose       – pick deck or discard
 * deckDrawn    – holding a card from the deck: swap it or discard it
 * discardTaken – holding the open card: must swap
 * mustFlip     – discarded the drawn card: flip one face-down card
 */
export type Stage = 'choose' | 'deckDrawn' | 'discardTaken' | 'mustFlip';

export interface RoundResult {
  round: number;
  finisher: string;
  raw: Record<string, number>;
  scores: Record<string, number>;
  doubled: boolean;
}

/** Which table views the players may use: both (each picks), or only one for everybody */
export type ViewPolicy = 'both' | '2d' | '3d';

export interface Settings {
  view: ViewPolicy;
  /** Draw new seats before every round, which changes who plays after whom */
  shuffleSeats: boolean;
}

export const DEFAULT_SETTINGS: Settings = { view: 'both', shuffleSeats: false };

export interface GameState {
  phase: Phase;
  round: number;
  target: number;
  hostId: string;
  players: Player[];
  /** Private to the host. Always empty in a public view. */
  deck: Card[];
  deckCount: number;
  discard: Card[];
  turn: number;
  stage: Stage;
  drawn: Card | null;
  finisher: string | null;
  /** Player ids that still get their final turn after someone revealed everything */
  lastTurns: string[];
  starter: string | null;
  result: RoundResult | null;
  nextId: number;
  /** Set by the host in the lobby. Missing in games saved by older versions: use DEFAULT_SETTINGS. */
  settings?: Settings;
}

export type GameEvent =
  | { k: 'sync' }
  | { k: 'lobby' }
  | { k: 'deal' }
  | { k: 'start'; p: string }
  | { k: 'turn'; p: string }
  | { k: 'draw'; p: string; card: Card }
  | { k: 'take'; p: string; card: Card }
  | { k: 'swap'; p: string; card: Card; out: Card; wasUp: boolean }
  | { k: 'toss'; p: string; card: Card }
  | { k: 'flip'; p: string; card: Card }
  | { k: 'clear'; p: string; cards: Card[] }
  | { k: 'shuffle'; n: number }
  | { k: 'finish'; p: string }
  | { k: 'reveal' }
  | { k: 'roundEnd' }
  | { k: 'presence'; p: string };

export interface Step {
  ev: GameEvent;
  state: GameState;
}

export type Action =
  | { a: 'flip'; card: number }
  | { a: 'drawDeck' }
  | { a: 'takeDiscard' }
  | { a: 'swap'; card: number }
  | { a: 'toss' }
  // host only
  | { a: 'start' }
  | { a: 'nextRound' }
  | { a: 'toLobby' }
  | { a: 'addBot'; name: string }
  | { a: 'remove'; id: string }
  | { a: 'botTakeover'; id: string }
  | { a: 'target'; value: number }
  | { a: 'settings'; view?: ViewPolicy; shuffleSeats?: boolean };

export interface PeerHover {
  card: number | null;
  x: number;
  y: number;
}

export const MAX_PLAYERS = 6;
export const TARGET_OPTIONS = [50, 100, 150];
