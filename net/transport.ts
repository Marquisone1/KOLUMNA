import Peer, { type DataConnection } from 'peerjs';

// Two interchangeable transports:
//  - PeerJS (WebRTC, default): works across the internet, no server of our own needed.
//  - BroadcastChannel (?net=local): tabs of the same browser only. Handy for testing.

export interface Conn {
  send(msg: unknown): void;
  onData(cb: (msg: any) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export interface HostTransport {
  onConnection(cb: (conn: Conn) => void): void;
  close(): void;
}

export type NetError = 'unavailable-id' | 'not-found' | 'network' | 'timeout';

const PREFIX = 'kolumna-v1-';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRoomCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function useLocal(): boolean {
  try {
    return new URLSearchParams(location.search).get('net') === 'local';
  } catch {
    return false;
  }
}

// ---------------- PeerJS ----------------

function wrapPeerConn(dc: DataConnection): Conn {
  const dataCbs: ((m: any) => void)[] = [];
  const closeCbs: (() => void)[] = [];
  let closed = false;
  const fireClose = () => {
    if (closed) return;
    closed = true;
    closeCbs.forEach((cb) => cb());
  };
  dc.on('data', (m) => dataCbs.forEach((cb) => cb(m)));
  dc.on('close', fireClose);
  dc.on('error', fireClose);
  // WebRTC can go silent without a close event; ICE state catches that
  const pc = (dc as any).peerConnection as RTCPeerConnection | undefined;
  pc?.addEventListener?.('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') fireClose();
  });
  return {
    send: (m) => { if (dc.open) dc.send(m); },
    onData: (cb) => dataCbs.push(cb),
    onClose: (cb) => closeCbs.push(cb),
    close: () => { dc.close(); fireClose(); },
  };
}

function peerHost(code: string): Promise<HostTransport> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code, { debug: 0 });
    const cbs: ((c: Conn) => void)[] = [];
    let opened = false;
    const timer = setTimeout(() => { if (!opened) { peer.destroy(); reject('timeout' as NetError); } }, 15000);
    peer.on('open', () => {
      opened = true;
      clearTimeout(timer);
      resolve({
        onConnection: (cb) => cbs.push(cb),
        close: () => peer.destroy(),
      });
    });
    peer.on('connection', (dc) => {
      dc.on('open', () => {
        const c = wrapPeerConn(dc);
        cbs.forEach((cb) => cb(c));
      });
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', (err: any) => {
      if (opened) return;
      clearTimeout(timer);
      peer.destroy();
      reject((err?.type === 'unavailable-id' ? 'unavailable-id' : 'network') as NetError);
    });
  });
}

function peerJoin(code: string): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const peer = new Peer({ debug: 0 });
    let done = false;
    const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => finish(() => { peer.destroy(); reject('timeout' as NetError); }), 15000);
    peer.on('open', () => {
      const dc = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      dc.on('open', () => finish(() => {
        const c = wrapPeerConn(dc);
        c.onClose(() => setTimeout(() => peer.destroy(), 0));
        resolve(c);
      }));
    });
    peer.on('error', (err: any) => {
      finish(() => {
        peer.destroy();
        reject((err?.type === 'peer-unavailable' ? 'not-found' : 'network') as NetError);
      });
    });
  });
}

// ---------------- BroadcastChannel ----------------

type Packet = { kind: 'connect' | 'accept' | 'data' | 'close' | 'probe' | 'here'; from: string; to?: string; data?: unknown };

function localHost(code: string): Promise<HostTransport> {
  return new Promise((resolve, reject) => {
    const ch = new BroadcastChannel('kolumna-' + code);
    const me = 'host';
    let taken = false;
    ch.postMessage({ kind: 'probe', from: me } as Packet);
    const conns = new Map<string, { data: ((m: any) => void)[]; close: (() => void)[] }>();
    const cbs: ((c: Conn) => void)[] = [];
    ch.onmessage = (e: MessageEvent<Packet>) => {
      const p = e.data;
      if (p.kind === 'here') taken = true;
      if (p.kind === 'probe') ch.postMessage({ kind: 'here', from: me } as Packet);
      if (p.to !== me) return;
      if (p.kind === 'connect') {
        const entry = { data: [] as ((m: any) => void)[], close: [] as (() => void)[] };
        conns.set(p.from, entry);
        ch.postMessage({ kind: 'accept', from: me, to: p.from } as Packet);
        const c: Conn = {
          send: (m) => ch.postMessage({ kind: 'data', from: me, to: p.from, data: m } as Packet),
          onData: (cb) => entry.data.push(cb),
          onClose: (cb) => entry.close.push(cb),
          close: () => { ch.postMessage({ kind: 'close', from: me, to: p.from } as Packet); entry.close.forEach((cb) => cb()); conns.delete(p.from); },
        };
        cbs.forEach((cb) => cb(c));
      } else if (p.kind === 'data') {
        conns.get(p.from)?.data.forEach((cb) => cb(p.data));
      } else if (p.kind === 'close') {
        conns.get(p.from)?.close.forEach((cb) => cb());
        conns.delete(p.from);
      }
    };
    setTimeout(() => {
      if (taken) { ch.close(); reject('unavailable-id' as NetError); return; }
      const bye = () => conns.forEach((_, id) => ch.postMessage({ kind: 'close', from: me, to: id } as Packet));
      addEventListener('pagehide', bye);
      resolve({ onConnection: (cb) => cbs.push(cb), close: () => { bye(); ch.close(); } });
    }, 150);
  });
}

function localJoin(code: string): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const ch = new BroadcastChannel('kolumna-' + code);
    const me = 'c-' + Math.random().toString(36).slice(2, 10);
    const data: ((m: any) => void)[] = [];
    const close: (() => void)[] = [];
    let open = false;
    const timer = setTimeout(() => { if (!open) { ch.close(); reject('not-found' as NetError); } }, 1500);
    ch.onmessage = (e: MessageEvent<Packet>) => {
      const p = e.data;
      if (p.to !== me) return;
      if (p.kind === 'accept') {
        open = true;
        clearTimeout(timer);
        addEventListener('pagehide', () => ch.postMessage({ kind: 'close', from: me, to: 'host' } as Packet));
        resolve({
          send: (m) => ch.postMessage({ kind: 'data', from: me, to: 'host', data: m } as Packet),
          onData: (cb) => data.push(cb),
          onClose: (cb) => close.push(cb),
          close: () => { ch.postMessage({ kind: 'close', from: me, to: 'host' } as Packet); ch.close(); close.forEach((cb) => cb()); },
        });
      } else if (p.kind === 'data') data.forEach((cb) => cb(p.data));
      else if (p.kind === 'close') { close.forEach((cb) => cb()); ch.close(); }
    };
    ch.postMessage({ kind: 'connect', from: me, to: 'host' } as Packet);
  });
}

export function hostRoom(code: string) {
  return useLocal() ? localHost(code) : peerHost(code);
}

export function joinRoom(code: string) {
  return useLocal() ? localJoin(code) : peerJoin(code);
}
