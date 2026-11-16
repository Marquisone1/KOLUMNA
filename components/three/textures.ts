import * as THREE from 'three';

// Every surface in the 3D view is drawn on a canvas at runtime. No image files.
// Cards keep the 2D palette (one printed ink per value tier, Fraunces numerals, the three-tile mark)
// and gain what a printed card has: a paper border, a fine print screen, a pressed numeral.

export const CARD_W = 0.63;
export const CARD_H = 0.882;

const TEX_W = 400;
const TEX_H = 560;
const PAPER = '#fbf7ee';

// one bright ink per value tier: dark blue below zero, sky at zero, then green, yellow, red
const INK = {
  neg: { ink: '#3560c4', deep: '#26479a', num: '#ffffff', rule: 'rgba(255,255,255,0.4)', dark: false },
  zero: { ink: '#62cbef', deep: '#3fb0db', num: '#0d2b3e', rule: 'rgba(13,43,62,0.3)', dark: true },
  low: { ink: '#47ad61', deep: '#348d4b', num: '#ffffff', rule: 'rgba(255,255,255,0.4)', dark: false },
  mid: { ink: '#f7cb3a', deep: '#eaae1c', num: '#3b2a05', rule: 'rgba(59,42,5,0.3)', dark: true },
  high: { ink: '#e74c35', deep: '#c63622', num: '#ffffff', rule: 'rgba(255,255,255,0.4)', dark: false },
};
const BACK = '#2a3d7a';
const BACK_DEEP = '#1c2a59';
const ACCENT = '247,203,58';

function tierOf(v: number) {
  if (v < 0) return INK.neg;
  if (v === 0) return INK.zero;
  if (v <= 4) return INK.low;
  if (v <= 8) return INK.mid;
  return INK.high;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const SERIF = "'Fraunces', Georgia, serif";
const SANS = "'Instrument Sans', system-ui, sans-serif";

/** Paper grain: a few thousand faint specks, seeded so every card of a value looks the same */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, alpha: number) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < w * h * 0.012; i++) {
    ctx.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1.4, 1.4);
  }
}

/** The three-tile mark: one column of the game grid */
function mark(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, color: (a: number) => string) {
  const h = w * 1.7;
  const tile = h * 0.28;
  const x = cx - w / 2;
  const y = cy - h / 2;
  [0.45, 0.7, 1].forEach((a, i) => {
    ctx.fillStyle = color(a);
    const ty = i === 0 ? y : i === 1 ? y + (h - tile) / 2 : y + h - tile;
    roundRect(ctx, x, ty, w, tile, Math.max(1, w * 0.08));
    ctx.fill();
  });
}

function drawFront(ctx: CanvasRenderingContext2D, v: number) {
  const W = TEX_W;
  const H = TEX_H;
  const t = tierOf(v);
  ctx.clearRect(0, 0, W, H);
  // paper
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, 7, 0.025);
  // printed panel
  const m = W * 0.055;
  const px = m;
  const py = m;
  const pw = W - m * 2;
  const ph = H - m * 2;
  const pr = W * 0.075;
  ctx.save();
  roundRect(ctx, px, py, pw, ph, pr);
  ctx.clip();
  const g = ctx.createRadialGradient(W / 2, H * 0.42, W * 0.1, W / 2, H / 2, H * 0.62);
  g.addColorStop(0, t.ink);
  g.addColorStop(1, t.deep);
  ctx.fillStyle = g;
  ctx.fillRect(px, py, pw, ph);
  // fine diagonal print screen
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let d = -H; d < W + H; d += 7) {
    ctx.moveTo(d, py);
    ctx.lineTo(d + ph, py + ph);
  }
  ctx.stroke();
  grain(ctx, W, H, 11 + v, 0.03);
  ctx.restore();
  // inner rule
  const ri = W * 0.045;
  ctx.strokeStyle = t.rule;
  ctx.lineWidth = 2.5;
  roundRect(ctx, px + ri, py + ri, pw - ri * 2, ph - ri * 2, pr * 0.6);
  ctx.stroke();

  const abs = Math.abs(v);
  const label = v < 0 ? '−' + abs : String(v);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const size = W * (label.length > 2 ? 0.43 : 0.52);
  ctx.font = `600 ${size}px ${SERIF}`;
  const mt = ctx.measureText(label);
  const asc = mt.actualBoundingBoxAscent || size * 0.7;
  const desc = mt.actualBoundingBoxDescent || 0;
  const baseY = H / 2 + (asc - desc) / 2 - H * 0.005;
  // pressed into the stock: a dark lower edge and a light upper edge
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillText(label, W / 2 + 1.5, baseY + 3);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillText(label, W / 2 - 1, baseY - 1.5);
  ctx.fillStyle = t.num;
  ctx.fillText(label, W / 2, baseY);
  // 6 and 9 read the same upside down; the bar marks the bottom, as on printed cards
  if (abs === 6 || abs === 9) {
    const digitW = ctx.measureText(String(abs)).width;
    const cx = W / 2 + (v < 0 ? mt.width / 2 - digitW / 2 : 0);
    ctx.fillRect(cx - digitW * 0.3, baseY + size * 0.09, digitW * 0.6, size * 0.05);
  }
  // corner indices with a small mark under them
  const corner = (rot: boolean) => {
    ctx.save();
    if (rot) {
      ctx.translate(W, H);
      ctx.rotate(Math.PI);
    }
    ctx.fillStyle = t.num;
    ctx.globalAlpha = 0.92;
    ctx.font = `600 ${W * 0.13}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const cx = px + W * 0.11;
    ctx.fillText(label, cx, py + W * 0.06);
    ctx.globalAlpha = 1;
    mark(ctx, cx, py + W * 0.27, W * 0.05, (a) => (t.dark ? `rgba(20,24,30,${a * 0.6})` : `rgba(255,255,255,${a * 0.8})`));
    ctx.restore();
  };
  corner(false);
  corner(true);
}

function drawBack(ctx: CanvasRenderingContext2D) {
  const W = TEX_W;
  const H = TEX_H;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, 3, 0.025);
  const m = W * 0.055;
  const pw = W - m * 2;
  const ph = H - m * 2;
  ctx.save();
  roundRect(ctx, m, m, pw, ph, W * 0.075);
  ctx.clip();
  const g = ctx.createRadialGradient(W / 2, H / 2, W * 0.05, W / 2, H / 2, H * 0.6);
  g.addColorStop(0, BACK);
  g.addColorStop(1, BACK_DEEP);
  ctx.fillStyle = g;
  ctx.fillRect(m, m, pw, ph);
  // lattice
  ctx.strokeStyle = `rgba(${ACCENT},0.16)`;
  ctx.lineWidth = 1.6;
  const step = W * 0.075;
  ctx.beginPath();
  for (let d = -H; d < W + H; d += step) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + H, H);
    ctx.moveTo(d, H);
    ctx.lineTo(d + H, 0);
  }
  ctx.stroke();
  grain(ctx, W, H, 5, 0.03);
  ctx.restore();
  // double rule
  ctx.strokeStyle = `rgba(${ACCENT},0.55)`;
  ctx.lineWidth = 2.5;
  roundRect(ctx, m + W * 0.04, m + W * 0.04, pw - W * 0.08, ph - W * 0.08, W * 0.045);
  ctx.stroke();
  ctx.strokeStyle = `rgba(${ACCENT},0.28)`;
  ctx.lineWidth = 1.5;
  roundRect(ctx, m + W * 0.065, m + W * 0.065, pw - W * 0.13, ph - W * 0.13, W * 0.03);
  ctx.stroke();
  // medallion with the mark
  const r = W * 0.2;
  ctx.fillStyle = BACK_DEEP;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(${ACCENT},0.7)`;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = `rgba(${ACCENT},0.3)`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, r * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  mark(ctx, W / 2, H / 2, W * 0.1, (a) => `rgba(${ACCENT},${a})`);
  // wordmark
  ctx.fillStyle = `rgba(${ACCENT},0.6)`;
  ctx.font = `600 ${W * 0.045}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${W * 0.012}px`;
  ctx.fillText('KOLUMNA', W / 2, H - m - W * 0.13);
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
}

// ---------- cache ----------

interface Entry { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; draw: (ctx: CanvasRenderingContext2D) => void }
const entries = new Map<string, Entry>();
let anisotropy = 4;

export function setAnisotropy(a: number) {
  anisotropy = Math.max(1, Math.min(8, a));
  entries.forEach((e) => { e.tex.anisotropy = anisotropy; e.tex.needsUpdate = true; });
}

function entry(key: string, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  let e = entries.get(key);
  if (!e) {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    const ctx = canvas.getContext('2d')!;
    draw(ctx);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    e = { canvas, tex, draw };
    entries.set(key, e);
  }
  return e.tex;
}

export const frontTexture = (v: number) => entry('f' + v, (ctx) => drawFront(ctx, v));
export const backTexture = () => entry('back', drawBack);

/** Redraw every card canvas, e.g. once the web fonts have arrived */
export function redrawCards() {
  entries.forEach((e) => {
    e.draw(e.canvas.getContext('2d')!);
    e.tex.needsUpdate = true;
  });
}

let fontsReady: Promise<void> | null = null;
export function loadCardFonts(): Promise<void> {
  if (!fontsReady) {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fontsReady = !fonts
      ? Promise.resolve()
      : Promise.race([
          Promise.all([
            fonts.load(`600 160px ${SERIF}`, '0123456789−'),
            fonts.load(`600 48px ${SANS}`, '0123456789−KOLUMNA'),
          ]).then(() => undefined),
          new Promise<void>((r) => setTimeout(r, 2500)),
        ]).catch(() => undefined);
  }
  return fontsReady;
}

// ---------- surfaces ----------

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function toTexture(c: HTMLCanvasElement, repeat?: [number, number]) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** Felt for the whole round top: nap, and a little darker toward the rail where less light falls */
export function feltTexture(): THREE.Texture {
  const S = 1024;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#1d6b49';
  ctx.fillRect(0, 0, S, S);
  noise(ctx, S, S, 10);
  ctx.globalAlpha = 0.04;
  for (let i = 0; i < S * 14; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const a = Math.random() * Math.PI;
    const l = 2 + Math.random() * 4;
    ctx.strokeStyle = Math.random() < 0.5 ? '#000' : '#cfe3d5';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c);
}

/** Long-grain wood for rails and furniture */
export function woodTexture(base = '#4a2f1f', lines = 70): THREE.Texture {
  const W = 512;
  const H = 128;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < lines; i++) {
    const y = Math.random() * H;
    const amp = 1 + Math.random() * 3;
    const freq = 0.004 + Math.random() * 0.01;
    const ph = Math.random() * 10;
    ctx.strokeStyle = Math.random() < 0.6 ? 'rgba(25,14,8,0.32)' : 'rgba(150,100,64,0.2)';
    ctx.lineWidth = 0.6 + Math.random() * 1.8;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const yy = y + Math.sin(x * freq + ph) * amp;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  noise(ctx, W, H, 6);
  const tex = toTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Floor planks: staggered boards, each a slightly different tone */
export function plankTexture(): THREE.Texture {
  const W = 512;
  const H = 1024;
  const [c, ctx] = canvas(W, H);
  const boards = 4;
  const bw = W / boards;
  for (let b = 0; b < boards; b++) {
    let y = -Math.random() * H;
    while (y < H) {
      const len = H * (0.35 + Math.random() * 0.4);
      const tone = 60 + Math.random() * 22;
      ctx.fillStyle = `rgb(${tone + 18},${tone - 4},${tone - 26})`;
      ctx.fillRect(b * bw, y, bw, len);
      for (let i = 0; i < 18; i++) {
        const x = b * bw + Math.random() * bw;
        ctx.strokeStyle = `rgba(20,10,4,${0.12 + Math.random() * 0.18})`;
        ctx.lineWidth = 0.6 + Math.random();
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + 4, y + len * 0.3, x - 4, y + len * 0.6, x + 2, y + len);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(10,6,3,0.7)';
      ctx.fillRect(b * bw, y, bw, 2);
      y += len;
    }
    ctx.fillStyle = 'rgba(10,6,3,0.75)';
    ctx.fillRect(b * bw, 0, 2, H);
  }
  noise(ctx, W, H, 8);
  return toTexture(c, [10, 5]);
}

/** Dark wallpaper with a quiet damask-like diamond print */
export function wallpaperTexture(base = '#22302a'): THREE.Texture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(227,190,120,0.09)';
  ctx.lineWidth = 2;
  for (const [x, y] of [[0, 0], [S, 0], [0, S], [S, S], [S / 2, S / 2]]) {
    ctx.beginPath();
    ctx.moveTo(x, y - 48);
    ctx.quadraticCurveTo(x + 30, y, x, y + 48);
    ctx.quadraticCurveTo(x - 30, y, x, y - 48);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  noise(ctx, S, S, 6);
  return toTexture(c, [14, 4]);
}

/** Dark leather: soft mottling and a fine crease pattern */
export function leatherTexture(base = '#2a1712'): THREE.Texture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 4 + Math.random() * 14;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, Math.random() < 0.5 ? 'rgba(255,220,190,0.05)' : 'rgba(0,0,0,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  noise(ctx, S, S, 10);
  return toTexture(c, [24, 1]);
}

/** A painted wooden sign: name over a thin rule */
export function signTexture(title: string, sub: string): THREE.Texture {
  const W = 1024;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#1b1410';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(227,163,74,0.55)';
  ctx.lineWidth = 4;
  roundRect(ctx, 14, 14, W - 28, H - 28, 10);
  ctx.stroke();
  ctx.fillStyle = '#e8c27a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 120px ${SERIF}`;
  ctx.fillText(title, W / 2, H / 2 - 18);
  ctx.fillStyle = 'rgba(232,194,122,0.7)';
  ctx.font = `600 30px ${SANS}`;
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '10px';
  ctx.fillText(sub, W / 2, H / 2 + 74);
  noise(ctx, W, H, 8);
  return toTexture(c);
}

/** Framed pictures for the walls: a few abstract still lifes in muted inks */
export function pictureTexture(seed: number): THREE.Texture {
  const W = 256;
  const H = 320;
  const [c, ctx] = canvas(W, H);
  const palettes = [
    ['#3a4a44', '#c9a86a', '#8a3b2a', '#e8dcc4'],
    ['#2c3646', '#d6a043', '#5d8a5e', '#efe6d4'],
    ['#46302a', '#b5482f', '#e2d4b6', '#2f4c5a'],
  ];
  const p = palettes[seed % palettes.length];
  ctx.fillStyle = p[0];
  ctx.fillRect(0, 0, W, H);
  let s = seed * 77 + 13;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = p[1 + (i % 3)];
    ctx.globalAlpha = 0.75;
    if (i % 2) {
      ctx.beginPath();
      ctx.arc(40 + rnd() * 176, 60 + rnd() * 200, 20 + rnd() * 50, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(20 + rnd() * 150, 40 + rnd() * 200, 30 + rnd() * 80, 30 + rnd() * 90);
    }
  }
  ctx.globalAlpha = 1;
  noise(ctx, W, H, 14);
  return toTexture(c);
}
