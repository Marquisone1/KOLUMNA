import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getVolume, setSound, setVolume, sfx, soundOn } from '../audio';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

/** The sound button in the top bar: opens a small level slider with a mute switch */
export function VolumeControl() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(soundOn());
  const [vol, setVol] = useState(getVolume());
  const root = useRef<HTMLDivElement>(null);
  const preview = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  const audible = on && vol > 0;
  const change = (v: number) => {
    setVol(v);
    setVolume(v);
    if (v > 0 && !on) { setSound(true); setOn(true); }
    // a card sound at the new level, once the slider rests for a moment
    clearTimeout(preview.current);
    preview.current = setTimeout(() => sfx.place(), 140);
  };
  const toggle = () => {
    const next = !audible;
    if (next && vol === 0) { setVol(0.6); setVolume(0.6); }
    setSound(next);
    setOn(next);
    if (next) sfx.place();
  };
  const pct = Math.round((audible ? vol : 0) * 100);

  return (
    <div className="volume" ref={root}>
      <button
        type="button" className="icon-btn" onClick={() => setOpen((o) => !o)}
        aria-label={t('volume')} aria-expanded={open} title={`${t('volume')} ${pct} %`}
      >
        <Icon name={audible ? (vol < 0.4 ? 'volumeLow' : 'volume') : 'mute'} />
      </button>
      {open && (
        <div className="volume-pop" role="group" aria-label={t('volume')}>
          <button type="button" className="icon-btn icon-btn-sm" onClick={toggle} aria-pressed={!audible} aria-label={audible ? t('muteOn') : t('muteOff')} title={audible ? t('muteOn') : t('muteOff')}>
            <Icon name={audible ? 'volume' : 'mute'} size={16} />
          </button>
          <input
            type="range" min={0} max={100} step={1} value={pct}
            aria-label={t('volume')} aria-valuetext={`${pct} %`}
            style={{ '--fill': `${pct}%` } as CSSProperties}
            onChange={(e) => change(Number(e.target.value) / 100)}
          />
          <span className="volume-num">{pct}</span>
        </div>
      )}
    </div>
  );
}
