import * as THREE from 'three';

// Card faces and table surfaces, drawn on canvases at runtime. No image files.
// The card look follows the 2D cards in index.css: one printed ink per value tier,
// Fraunces numerals, a lattice back with the three-tile mark.

export const CARD_W = 0.63;
export const CARD_H = 0.882;

const TEX_W = 320;
const TEX_H = 448;

const INK = {
  neg: { ink: '#2f4c5a', num: '#f1ead9', rule: 'rgba(255,255,255,0.26)' },
  zero: { ink: '#e9e0cc', num: '#2a2622', rule: 'rgba(42,38,34,0.2)' },
  low: { ink: '#5d8a5e', num: '#f7f2e6', rule: 'rgba(255,255,255,0.26)' },
  mid: { ink: '#d6a043', num: '#2b2014', rule: 'rgba(43,32,20,0.22)' },
  high: { ink: '#b5482f', num: '#fcefe2', rule: 'rgba(255,255,255,0.26)' },
};
const BACK = '#2b231d';
const ACCENT = '227,163,74';

function tierOf(v: number) {
  if (v < 0) return INK.neg;
  if (v === 0) return INK.zero;
  if (v <= 4) return INK.low;
  if (v <= 8) return INK.mid;
  return INK.high;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

function drawFront(ctx: CanvasRenderingContext2D, v: number) {
  const W = TEX_W;
  const H = TEX_H;
  const t = tierOf(v);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = t.ink;
  ctx.fillRect(0, 0, W, H);
  // the same faint top-to-bottom sheen as the 2D card stock
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0.07)');
  g.addColorStop(1, 'rgba(0,0,0,0.07)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // printed inner rule
  const inset = W * 0.06;
  ctx.strokeStyle = t.rule;
  ctx.lineWidth = 2.5;
  roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, W * 0.06);
  ctx.stroke();

  const abs = Math.abs(v);
  const label = v < 0 ? '−' + abs : String(v);
  ctx.fillStyle = t.num;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // big numeral
  const size = W * (label.length > 2 ? 0.44 : 0.5);
  ctx.font = `600 ${size}px ${SERIF}`;
  const m = ctx.measureText(label);
  const asc = m.actualBoundingBoxAscent || size * 0.7;
  const desc = m.actualBoundingBoxDescent || 0;
  const baseY = H / 2 + (asc - desc) / 2 - H * 0.01;
  ctx.fillText(label, W / 2, baseY);
  // 6 and 9 read the same upside down; the bar marks the bottom, as on printed cards
  if (abs === 6 || abs === 9) {
    const digitW = ctx.measureText(String(abs)).width;
    const cx = W / 2 + (v < 0 ? m.width / 2 - digitW / 2 : 0);
    ctx.fillRect(cx - digitW * 0.32, baseY + size * 0.08, digitW * 0.64, size * 0.055);
  }
  // corner indices
  ctx.globalAlpha = 0.85;
  ctx.font = `600 ${W * 0.15}px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(label, W * 0.12, W * 0.11);
  ctx.save();
  ctx.translate(W - W * 0.12, H - W * 0.11);
  ctx.rotate(Math.PI);
  ctx.fillText(label, 0, 0);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawBack(ctx: CanvasRenderingContext2D) {
  const W = TEX_W;
  const H = TEX_H;
  ctx.fillStyle = BACK;
  ctx.fillRect(0, 0, W, H);
  // lattice
  ctx.strokeStyle = `rgba(${ACCENT},0.16)`;
  ctx.lineWidth = 2;
  const step = W * 0.1;
  ctx.beginPath();
  for (let d = -H; d < W + H; d += step) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + H, H);
    ctx.moveTo(d, H);
    ctx.lineTo(d + H, 0);
  }
  ctx.stroke();
  // inner rule
  const inset = W * 0.06;
  ctx.strokeStyle = `rgba(${ACCENT},0.34)`;
  ctx.lineWidth = 2.5;
  roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, W * 0.06);
  ctx.stroke();
  // the mark: three stacked tiles, one column of the game grid
  const mw = W * 0.2;
  const mh = W * 0.34;
  const tile = mh * 0.28;
  const x = (W - mw) / 2;
  const y = (H - mh) / 2;
  // clear the lattice behind the mark so it reads cleanly
  ctx.fillStyle = BACK;
  roundRect(ctx, x - 10, y - 10, mw + 20, mh + 20, 8);
  ctx.fill();
  const alphas = [0.45, 0.7, 1];
  alphas.forEach((a, i) => {
    ctx.fillStyle = `rgba(${ACCENT},${a})`;
    const ty = i === 0 ? y : i === 1 ? y + (mh - tile) / 2 : y + mh - tile;
    roundRect(ctx, x, ty, mw, tile, 4);
    ctx.fill();
  });
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
            fonts.load(`600 48px ${SANS}`, '0123456789−'),
          ]).then(() => undefined),
          new Promise<void>((r) => setTimeout(r, 2500)),
        ]).catch(() => undefined);
  }
  return fontsReady;
}

// ---------- table surfaces ----------

function noiseCanvas(size: number, base: string, amount: number, fibers: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  if (fibers) {
    // short fibres give the felt its nap
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < size * 6; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const a = Math.random() * Math.PI;
      const l = 2 + Math.random() * 5;
      ctx.strokeStyle = Math.random() < 0.5 ? '#000' : '#fff';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  return c;
}

export function feltTexture(): THREE.Texture {
  const tex = new THREE.CanvasTexture(noiseCanvas(256, '#21392f', 12, true));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

export function woodTexture(): THREE.Texture {
  const W = 512;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#4a2f1f';
  ctx.fillRect(0, 0, W, H);
  // long grain lines along the rail
  for (let i = 0; i < 70; i++) {
    const y = Math.random() * H;
    const amp = 1 + Math.random() * 3;
    const freq = 0.004 + Math.random() * 0.01;
    const ph = Math.random() * 10;
    ctx.strokeStyle = Math.random() < 0.6 ? 'rgba(25,14,8,0.35)' : 'rgba(140,92,58,0.22)';
    ctx.lineWidth = 0.6 + Math.random() * 1.6;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const yy = y + Math.sin(x * freq + ph) * amp;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
