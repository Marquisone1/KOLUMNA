import { findSlot, Game, publicStep, publicView } from '../game/engine';
import { botMove } from '../game/bot';
import type { Action, PeerHover, Step } from '../game/types';
import { hostRoom, joinRoom, makeRoomCode, type Conn, type HostTransport, type NetError } from './transport';

// Wire protocol
//   client → host: { t: 'hello', pid, name } | { t: 'act', act } | { t: 'hover', hover }
//   host → client: { t: 'welcome', pid } | { t: 'steps', steps } | { t: 'hover', pid, hover } | { t: 'reject', reason } | { t: 'error', err }

export type SessionStatus = 'connecting' | 'open' | 'lost' | 'rejected' | 'closed';
export type RejectReason = 'full' | 'started' | 'not-found' | 'network' | 'timeout';

export interface Session {
  readonly code: string;
  readonly pid: string;
  readonly isHost: boolean;
  status: SessionStatus;
  reason?: RejectReason;
  send(act: Action): void;
  sendHover(hover: PeerHover | null): void;
  onSteps(cb: (steps: Step[]) => void): () => void;
  onHovers(cb: (hovers: Record<string, PeerHover>) => void): () => void;
  onStatus(cb: () => void): () => void;
  close(): void;
}

function uid(prefix: string) {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    : Math.random().toString(36).slice(2, 12);
  return prefix + r;
}

/**
 * Remember who we were in a room so a reload or network drop rejoins the same seat.
 * Per tab (sessionStorage): a second tab with the same invite link becomes a new player.
 */
const idKey = (code: string) => 'kolumna:pid:' + code;
export function rememberedId(code: string): string | null {
  try { return sessionStorage.getItem(idKey(code)); } catch { return null; }
}
function rememberId(code: string, pid: string) {
  try { sessionStorage.setItem(idKey(code), pid); } catch { /* storage unavailable */ }
}

/** The host tab keeps a copy of the game so a reload can pick up where it left off */
const hostKey = (code: string) => 'kolumna:host:' + code;
export interface SavedHost { code: string; pid: string; state: Game['s']; at: number }
export function savedHost(code: string): SavedHost | null {
  try {
    const raw = sessionStorage.getItem(hostKey(code));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedHost;
    return Date.now() - saved.at < 6 * 3600 * 1000 ? saved : null;
  } catch { return null; }
}

abstract class Base {
  status: SessionStatus = 'connecting';
  reason?: RejectReason;
  protected stepCbs = new Set<(s: Step[]) => void>();
  protected statusCbs = new Set<() => void>();
  protected hoverCbs = new Set<(h: Record<string, PeerHover>) => void>();
  protected hovers: Record<string, PeerHover> = {};
  /** Latest public state, replayed to late subscribers */
  protected latest: Step['state'] | null = null;
  onSteps(cb: (s: Step[]) => void) {
    this.stepCbs.add(cb);
    if (this.latest) cb([{ ev: { k: 'sync' }, state: this.latest }]);
    return () => { this.stepCbs.delete(cb); };
  }
  onHovers(cb: (h: Record<string, PeerHover>) => void) {
    this.hoverCbs.add(cb);
    cb({ ...this.hovers });
    return () => { this.hoverCbs.delete(cb); };
  }
  onStatus(cb: () => void) { this.statusCbs.add(cb); return () => { this.statusCbs.delete(cb); }; }
  protected setStatus(s: SessionStatus, reason?: RejectReason) {
    this.status = s;
    this.reason = reason;
    this.statusCbs.forEach((cb) => cb());
  }
  protected setHover(pid: string, hover: PeerHover | null) {
    if (!pid) return;
    if (hover) this.hovers[pid] = hover;
    else delete this.hovers[pid];
    const snap = { ...this.hovers };
    this.hoverCbs.forEach((cb) => cb(snap));
  }
  protected deliver(steps: Step[]) {
    if (!steps.length) return;
    this.latest = steps[steps.length - 1].state;
    this.stepCbs.forEach((cb) => cb(steps));
  }
}

// ---------------- Host ----------------

export class HostSession extends Base implements Session {
  readonly isHost = true;
  readonly pid: string;
  code = '';
  game: Game;
  private transport?: HostTransport;
  private conns = new Map<Conn, string | null>();
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSteps: Step[] = [];

  private fixedCode: string | null = null;

  /** `screen`: couch mode, this device only shows the table and takes no seat */
  constructor(name: string, resume?: SavedHost, screen = false) {
    super();
    if (resume) {
      this.pid = resume.pid;
      this.fixedCode = resume.code;
      this.game = new Game(this.pid, resume.state);
      for (const p of this.game.s.players) if (p.id !== this.pid && !p.id.startsWith('bot-')) p.connected = false;
    } else {
      this.pid = uid('h-');
      this.game = new Game(this.pid);
      if (!screen) this.game.addPlayer(this.pid, name);
    }
  }

  async open(): Promise<void> {
    // After a reload the old peer id can stay reserved on the signalling server for a few seconds
    const attempts = this.fixedCode ? 8 : 4;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const code = this.fixedCode ?? makeRoomCode();
      if (this.fixedCode && attempt > 0) await new Promise((r) => setTimeout(r, 2000));
      try {
        this.transport = await hostRoom(code);
        this.code = code;
        rememberId(code, this.pid);
        this.transport.onConnection((c) => this.accept(c));
        this.setStatus('open');
        this.deliver([{ ev: { k: 'sync' }, state: publicView(this.game.s, this.pid) }]);
        this.save();
        this.scheduleBots();
        return;
      } catch (e) {
        if ((e as NetError) !== 'unavailable-id') {
          this.setStatus('rejected', e === 'timeout' ? 'timeout' : 'network');
          throw e;
        }
      }
    }
    this.setStatus('rejected', 'network');
    throw new Error('network');
  }

  private accept(c: Conn) {
    this.conns.set(c, null);
    c.onData((msg) => this.onMessage(c, msg));
    c.onClose(() => {
      const pid = this.conns.get(c);
      this.conns.delete(c);
      if (pid) {
        this.relayHover(pid, null);
        if (![...this.conns.values()].includes(pid)) this.broadcast(this.game.setConnected(pid, false));
      }
    });
  }

  private onMessage(c: Conn, msg: any) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      const name = String(msg.name ?? '');
      let pid = typeof msg.pid === 'string' ? msg.pid : '';
      const known = pid && this.game.player(pid) && pid !== this.pid;
      if (known) {
        this.conns.set(c, pid);
        c.send({ t: 'welcome', pid });
        this.broadcast(this.game.setConnected(pid, true));
        c.send({ t: 'steps', steps: [{ ev: { k: 'sync' }, state: publicView(this.game.s, pid) }] });
        return;
      }
      pid = uid('p-');
      const res = this.game.addPlayer(pid, name);
      if (!res.ok) {
        c.send({ t: 'reject', reason: res.err });
        setTimeout(() => c.close(), 300);
        return;
      }
      this.conns.set(c, pid);
      c.send({ t: 'welcome', pid });
      c.send({ t: 'steps', steps: [{ ev: { k: 'sync' }, state: publicView(this.game.s, pid) }] });
      this.broadcast(res.steps, c);
      return;
    }
    if (msg.t === 'act') {
      const pid = this.conns.get(c);
      if (!pid) return;
      this.run(pid, msg.act as Action, c);
      return;
    }
    if (msg.t === 'hover') {
      const pid = this.conns.get(c);
      if (!pid) return;
      this.relayHover(pid, (msg.hover as PeerHover | null) ?? null, c);
    }
  }

  private relayHover(pid: string, hover: PeerHover | null, skip?: Conn) {
    this.setHover(pid, hover);
    for (const [c, cPid] of this.conns) {
      if (cPid && c !== skip) c.send({ t: 'hover', pid, hover });
    }
  }

  private run(pid: string, act: Action, from?: Conn) {
    const res = this.game.apply(pid, act);
    if (!res.ok && from) from.send({ t: 'error', err: res.err });
    this.broadcast(res.steps);
  }

  send(act: Action) {
    this.run(this.pid, act);
  }

  sendHover(hover: PeerHover | null) {
    this.relayHover(this.pid, hover);
  }

  /** Send steps to every client (each gets its own public view) and to the host's own UI */
  private broadcast(steps: Step[], skip?: Conn) {
    if (!steps.length) return;
    const hostPub = steps.map((s) => publicStep(s, this.pid));
    this.lastSteps = hostPub;
    for (const [c, pid] of this.conns) {
      if (pid && c !== skip) {
        c.send({ t: 'steps', steps: steps.map((s) => publicStep(s, pid)) });
      }
    }
    this.deliver(hostPub);
    this.save();
    this.scheduleBots();
  }

  private save() {
    if (!this.code) return;
    try {
      const data: SavedHost = { code: this.code, pid: this.pid, state: this.game.s, at: Date.now() };
      sessionStorage.setItem(hostKey(this.code), JSON.stringify(data));
    } catch { /* storage full or unavailable */ }
  }

  private scheduleBots() {
    const s = this.game.s;
    if (s.phase === 'setup' && this.botTimer) return;
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    // Give clients time to play the animations for the steps they just received
    const animMs = this.lastSteps.length * 520;
    let actor: string | null = null;
    if (s.phase === 'setup') actor = s.players.find((p) => p.bot && p.setupFlips < 2)?.id ?? null;
    else if (s.phase === 'play' && s.players[s.turn]?.bot) actor = s.players[s.turn].id;
    if (!actor) return;
    const id = actor;
    const isDeal = this.lastSteps.some((x) => x.ev.k === 'deal');
    const delay = s.phase === 'setup'
      ? (isDeal ? 600 : 220) + Math.random() * 200
      : 750 + animMs + Math.random() * 350;
    this.botTimer = setTimeout(() => {
      const move = botMove(publicView(this.game.s, id), id);
      if (!move) {
        this.botTimer = null;
        return;
      }
      const botPlayer = this.game.player(id);
      const targetCard = move.a === 'flip' || move.a === 'swap' ? move.card : null;
      const hit = targetCard !== null && botPlayer ? findSlot(botPlayer, targetCard) : null;
      if (hit && botPlayer && targetCard !== null) {
        const cols = Math.max(1, botPlayer.grid.length);
        this.relayHover(id, {
          card: targetCard,
          x: (hit.c + 0.55) / cols,
          y: (hit.r + 0.55) / 3,
        });
        this.botTimer = setTimeout(() => {
          this.botTimer = null;
          this.relayHover(id, null);
          this.run(id, move);
        }, 260);
      } else {
        this.botTimer = null;
        this.run(id, move);
      }
    }, delay);
  }

  close() {
    if (this.botTimer) clearTimeout(this.botTimer);
    try { sessionStorage.removeItem(hostKey(this.code)); } catch { /* ignore */ }
    this.transport?.close();
    this.setStatus('closed');
  }
}

// ---------------- Client ----------------

export class ClientSession extends Base implements Session {
  readonly isHost = false;
  pid = '';
  private conn?: Conn;
  private retries = 0;
  private closedByUser = false;

  constructor(readonly code: string, private name: string) {
    super();
  }

  async open(): Promise<void> {
    try {
      this.conn = await joinRoom(this.code);
    } catch (e) {
      const reason = (['not-found', 'timeout'].includes(e as string) ? e : 'network') as RejectReason;
      if (this.status === 'lost' && this.retries < 12) return this.retry();
      this.setStatus('rejected', reason);
      return;
    }
    this.retries = 0;
    this.conn.onData((m) => this.onMessage(m));
    this.conn.onClose(() => {
      if (this.closedByUser || this.status === 'rejected') return;
      this.setStatus('lost');
      this.retry();
    });
    this.conn.send({ t: 'hello', pid: rememberedId(this.code), name: this.name });
  }

  private retry() {
    this.retries++;
    setTimeout(() => { if (!this.closedByUser) this.open(); }, Math.min(1000 * this.retries, 4000));
  }

  private onMessage(m: any) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'welcome') {
      this.pid = m.pid;
      rememberId(this.code, m.pid);
      this.setStatus('open');
    } else if (m.t === 'steps') {
      this.deliver(m.steps as Step[]);
    } else if (m.t === 'hover') {
      this.setHover(String(m.pid ?? ''), (m.hover as PeerHover | null) ?? null);
    } else if (m.t === 'reject') {
      this.setStatus('rejected', m.reason);
    }
  }

  send(act: Action) {
    this.conn?.send({ t: 'act', act });
  }

  sendHover(hover: PeerHover | null) {
    this.conn?.send({ t: 'hover', hover });
  }

  close() {
    this.closedByUser = true;
    this.conn?.close();
    this.setStatus('closed');
  }
}
