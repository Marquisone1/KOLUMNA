import type { CSSProperties } from 'react';

export function tier(v: number | null): string {
  if (v === null) return 't-unknown';
  if (v < 0) return 't-neg';
  if (v === 0) return 't-zero';
  if (v <= 4) return 't-low';
  if (v <= 8) return 't-mid';
  return 't-high';
}

/** Typographic minus for negative values */
export const fmt = (v: number | null) => (v === null ? '' : v < 0 ? '−' + Math.abs(v) : String(v));

interface Props {
  id?: number;
  v: number | null;
  up: boolean;
  /** Pixel width; height follows the 5:7 card ratio */
  w: number;
  onClick?: () => void;
  selectable?: boolean;
  label?: string;
  delay?: number;
  className?: string;
  style?: CSSProperties;
}

export function Card({ id, v, up, w, onClick, selectable, label, delay, className = '', style }: Props) {
  const small = w < 52;
  const cls = ['card', up ? 'is-up' : '', small ? 'is-small' : '', selectable ? 'is-selectable' : '', className].join(' ');
  const st = { '--cw': w + 'px', '--delay': (delay ?? 0) + 'ms', ...style } as CSSProperties;
  const inner = (
    <span className="card-inner">
      <span className={'card-face card-front ' + tier(v)}>
        {!small && <span className="pip tl">{fmt(v)}</span>}
        <span className="num">{v !== null && v < 0 ? <><span className="minus">{'\u2212'}</span>{Math.abs(v)}</> : fmt(v)}</span>
        {!small && <span className="pip br">{fmt(v)}</span>}
      </span>
      <span className="card-face card-back" />
    </span>
  );
  if (onClick) {
    return (
      <button type="button" className={cls} style={st} data-card={id} onClick={onClick} disabled={!selectable} aria-label={label}>
        {inner}
      </button>
    );
  }
  return (
    <span className={cls} style={st} data-card={id} aria-label={label} role={label ? 'img' : undefined}>
      {inner}
    </span>
  );
}

/** Same markup as <Card>, as an element for the flight layer */
export function cardElement(v: number | null, up: boolean, w: number): HTMLElement {
  const el = document.createElement('span');
  el.className = 'card' + (up ? ' is-up' : '') + (w < 52 ? ' is-small' : '');
  el.style.setProperty('--cw', w + 'px');
  const f = fmt(v);
  const big = v !== null && v < 0 ? `<span class="minus">\u2212</span>${Math.abs(v)}` : f;
  const pips = w < 52 ? '' : `<span class="pip tl">${f}</span>`;
  const pipsB = w < 52 ? '' : `<span class="pip br">${f}</span>`;
  el.innerHTML = `<span class="card-inner"><span class="card-face card-front ${tier(v)}">${pips}<span class="num">${big}</span>${pipsB}</span><span class="card-face card-back"></span></span>`;
  return el;
}

export function EmptySlot({ w, label, anchor, onClick, active }: { w: number; label?: string; anchor?: string; onClick?: () => void; active?: boolean }) {
  const st = { '--cw': w + 'px' } as CSSProperties;
  if (onClick) {
    return (
      <button type="button" className={'slot-empty' + (active ? ' is-selectable' : '')} style={st} data-anchor={anchor} onClick={onClick} disabled={!active}>
        {label && <span>{label}</span>}
      </button>
    );
  }
  return (
    <span className="slot-empty" style={st} data-anchor={anchor}>
      {label && <span>{label}</span>}
    </span>
  );
}
