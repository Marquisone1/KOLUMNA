// Small synthesized sounds. No audio files, nothing to load.

let ctx: AudioContext | null = null;
let enabled = (() => {
  try { return localStorage.getItem('kolumna:sound') !== 'off'; } catch { return true; }
})();

export function soundOn() { return enabled; }
export function setSound(on: boolean) {
  enabled = on;
  try { localStorage.setItem('kolumna:sound', on ? 'on' : 'off'); } catch { /* ignore */ }
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Short band-passed noise burst: the sound of card stock */
function snap(freq: number, dur: number, gain: number, when = 0) {
  const a = ac();
  if (!a) return;
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
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
}

function tone(freq: number, dur: number, gain: number, when = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  slide: () => snap(2400, 0.12, 0.18),
  place: () => { snap(1400, 0.06, 0.32); snap(900, 0.05, 0.12, 0.02); },
  flip: () => { snap(3200, 0.04, 0.18); snap(1800, 0.05, 0.2, 0.07); },
  clear: () => { [523.25, 659.25, 783.99].forEach((f, i) => tone(f, 0.5, 0.06, i * 0.07)); },
  turn: () => tone(880, 0.22, 0.05),
  shuffle: () => { for (let i = 0; i < 6; i++) snap(2000 + i * 120, 0.05, 0.12, i * 0.045); },
  end: () => { [392, 493.88, 587.33, 783.99].forEach((f, i) => tone(f, 0.7, 0.05, i * 0.09)); },
};
