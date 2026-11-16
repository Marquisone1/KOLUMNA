// Card sounds. Recorded samples (Kenney "Casino Audio", CC0, in public/sounds) with a little random
// variation in take, pitch and level so repeated actions never sound mechanical. Each sound can be
// placed left or right, so in 3D an opponent's card is heard from their side of the table.
// Until the samples have loaded (or if they cannot load) short synthesized stand-ins play instead.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = (() => {
  try { return localStorage.getItem('kolumna:sound') !== 'off'; } catch { return true; }
})();

export function soundOn() { return enabled; }
export function setSound(on: boolean) {
  enabled = on;
  try { localStorage.setItem('kolumna:sound', on ? 'on' : 'off'); } catch { /* ignore */ }
}

function context(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    return ctx;
  } catch {
    return null;
  }
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  const a = context();
  if (a && a.state === 'suspended') a.resume().catch(() => {});
  return a;
}

// Browsers only start audio after a user gesture; unlock on the first one
if (typeof window !== 'undefined') {
  const unlock = () => {
    const a = context();
    a?.resume().catch(() => {});
    loadSamples();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

// ---------- samples ----------

const SAMPLES = {
  slide: ['card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-4', 'card-slide-5', 'card-slide-6', 'card-slide-7', 'card-slide-8'],
  place: ['card-place-1', 'card-place-2', 'card-place-3', 'card-place-4'],
  shove: ['card-shove-1', 'card-shove-2', 'card-shove-3', 'card-shove-4'],
  shuffle: ['card-shuffle'],
  fan: ['card-fan-1', 'card-fan-2'],
  chip: ['chip-lay-1', 'chip-lay-2', 'chip-lay-3'],
  chips: ['chips-stack-1', 'chips-stack-2', 'chips-collide-1'],
} as const;
type Group = keyof typeof SAMPLES;

const buffers = new Map<string, AudioBuffer>();
let loading: Promise<void> | null = null;

/** Fetch and decode every sample once; the path also works where public/ is served as is */
export function loadSamples(): Promise<void> {
  if (loading) return loading;
  const a = context();
  if (!a) return Promise.resolve();
  const base = typeof document !== 'undefined' ? document.baseURI : '/';
  const names = [...new Set(Object.values(SAMPLES).flat())];
  loading = Promise.all(names.map(async (n) => {
    for (const path of [`sounds/${n}.mp3`, `public/sounds/${n}.mp3`]) {
      try {
        const res = await fetch(new URL(path, base).href);
        if (!res.ok) continue;
        const data = await res.arrayBuffer();
        buffers.set(n, await a.decodeAudioData(data));
        return;
      } catch { /* try the next path */ }
    }
  })).then(() => undefined);
  return loading;
}

/** How many samples are decoded and ready (for tests and debugging) */
export function samplesReady() {
  return buffers.size;
}

export interface SoundOpts {
  /** −1 left … 1 right */
  pan?: number;
  /** seconds from now */
  when?: number;
  /** level, 1 = normal */
  gain?: number;
  /** playback speed, 1 = normal (also shifts pitch) */
  rate?: number;
}

const last = new Map<Group, number>();
/** Play one take from a group, never the same take twice in a row; false if nothing is loaded yet */
function sample(group: Group, o: SoundOpts = {}): boolean {
  const a = ac();
  if (!a || !master) return true;
  const names = SAMPLES[group];
  let i = Math.floor(Math.random() * names.length);
  if (names.length > 1 && i === last.get(group)) i = (i + 1) % names.length;
  const buf = buffers.get(names[i]);
  if (!buf) return false;
  last.set(group, i);
  const src = a.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = (o.rate ?? 1) * (0.95 + Math.random() * 0.1);
  const g = a.createGain();
  g.gain.value = (o.gain ?? 1) * (0.85 + Math.random() * 0.2);
  let node: AudioNode = src.connect(g);
  if (o.pan && a.createStereoPanner) {
    const p = a.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan));
    node = node.connect(p);
  }
  node.connect(master);
  src.start(a.currentTime + (o.when ?? 0));
  return true;
}

// ---------- synthesized stand-ins ----------

function snap(freq: number, dur: number, gain: number, when = 0) {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + when;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 0.9;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
}

function tone(freq: number, dur: number, gain: number, when = 0) {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// ---------- what the game plays ----------

export const sfx = {
  /** a card slid off the deck or the pile */
  slide: (o: SoundOpts = {}) => { if (!sample('slide', { gain: 0.8, ...o })) snap(2400, 0.12, 0.18, o.when); },
  /** a card laid down on the table */
  place: (o: SoundOpts = {}) => { if (!sample('place', o)) { snap(1400, 0.06, 0.32, o.when); snap(900, 0.05, 0.12, (o.when ?? 0) + 0.02); } },
  /** a card tossed onto the discard pile */
  toss: (o: SoundOpts = {}) => { if (!sample('shove', { gain: 0.85, ...o })) snap(1400, 0.06, 0.3, o.when); },
  /** a card turned over: a quick, light snap */
  flip: (o: SoundOpts = {}) => { if (!sample('place', { gain: 0.7, rate: 1.25, ...o })) { snap(3200, 0.04, 0.18, o.when); snap(1800, 0.05, 0.2, (o.when ?? 0) + 0.07); } },
  /** a column swept up: three cards fanned together, and a soft chime */
  clear: (o: SoundOpts = {}) => {
    if (!sample('fan', o)) snap(2000, 0.1, 0.15, o.when);
    [523.25, 659.25, 783.99].forEach((f, i) => tone(f, 0.45, 0.03, 0.12 + i * 0.07));
  },
  /** your turn: a ceramic chip set down, a cue you can feel rather than an alarm */
  turn: () => { if (!sample('chip', { gain: 0.7 })) tone(880, 0.22, 0.05); },
  /** the deck riffled */
  shuffle: () => { if (!sample('shuffle', { gain: 0.8 })) for (let i = 0; i < 6; i++) snap(2000 + i * 120, 0.05, 0.12, i * 0.045); },
  /** dealing: cards slide out one after another, panned toward where they land */
  deal: (count: number, pans: number[] = []) => {
    const n = Math.min(count, 14);
    for (let i = 0; i < n; i++) {
      if (!sample('slide', { gain: 0.45, rate: 1.15, when: i * 0.09, pan: pans[i % Math.max(1, pans.length)] })) snap(2400, 0.08, 0.1, i * 0.09);
    }
  },
  /** the discard button pressed */
  press: () => { if (!sample('chip', { gain: 0.6, rate: 0.8 })) snap(700, 0.05, 0.2); },
  /** round over: chips counted onto the table */
  end: () => {
    if (!sample('chips', { gain: 0.8 })) [392, 493.88, 587.33, 783.99].forEach((f, i) => tone(f, 0.7, 0.05, i * 0.09));
    else sample('chips', { gain: 0.6, when: 0.18 });
  },
};
