import { useEffect, useState, type CSSProperties } from 'react';
import type { Action, GameState } from '../game/types';
import { standings } from '../game/engine';
import { useI18n } from '../i18n';
import { SEAT_COLORS } from './PlayerBoard';

function Tween({ from, to, delay = 0 }: { from: number; to: number; delay?: number }) {
  const [v, setV] = useState(from);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(to); return; }
    let raf = 0;
    const startAt = performance.now() + delay;
    const dur = 700;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - startAt) / dur));
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(from + (to - from) * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, delay]);
  return <>{v}</>;
}

const signed = (n: number) => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0');

interface Props {
  view: GameState;
  me: string;
  isHost: boolean;
  send: (a: Action) => void;
  onLeave: () => void;
}

export function Scoreboard({ view, me, isHost, send, onLeave }: Props) {
  const { t } = useI18n();
  const [peek, setPeek] = useState(false);
  const r = view.result;
  if (!r) return null;
  const over = view.phase === 'gameOver';
  const finisher = view.players.find((p) => p.id === r.finisher);
  const ranked = standings(view.players);
  const winners = ranked.filter((x) => x.place === 1).map((x) => x.p);
  const rounds = view.players[0]?.history.length ?? 0;

  if (peek) {
    return (
      <button type="button" className="btn btn-primary score-reopen" onClick={() => setPeek(false)}>
        {over ? t('wins', { name: winners.map((w) => w.name).join(' & ') }) : t('roundOver', { n: r.round })}
      </button>
    );
  }

  return (
    <div className="sheet-backdrop">
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="score-title">
        <header className="sheet-head">
          {over ? (
            <>
              <p className="eyebrow">{t('roundOver', { n: r.round })}</p>
              <h2 id="score-title" className="display">
                {winners.length > 1 ? t('tie') : t('wins', { name: winners[0].id === me ? t('you') : winners[0].name })}
              </h2>
              <p className="secondary">{t(rounds === 1 ? 'winsWithOne' : 'winsWith', { n: winners[0].total, r: rounds })}</p>
            </>
          ) : (
            <>
              <h2 id="score-title" className="display display-sm">{t('roundOver', { n: r.round })}</h2>
              <p className="secondary">
                {t('endedBy', { name: finisher?.id === me ? t('you') : finisher?.name ?? '' })}
                {r.doubled && <> · <span className="neg">{t('doubled')}</span></>}
              </p>
            </>
          )}
        </header>

        <table className="scores">
          <thead>
            <tr>
              <th className="num-col">{t('place')}</th>
              <th>{t('players')}</th>
              <th className="num-col">{t('thisRound')}</th>
              <th className="num-col">{t('total')}</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ p, place }, i) => {
              const sc = r.scores[p.id] ?? 0;
              const doubledHere = r.doubled && p.id === r.finisher;
              return (
                <tr key={p.id} className={(p.id === me ? 'is-me ' : '') + (place === 1 ? 'is-lead' : '')} style={{ '--i': i } as CSSProperties}>
                  <td className="num-col tabular muted">{place}</td>
                  <td>
                    <span className="score-name">
                      <span className="seat-dot" style={{ '--seat': SEAT_COLORS[p.seat % 6] } as CSSProperties} />
                      {p.name}
                      {p.id === me && <span className="muted"> · {t('you')}</span>}
                    </span>
                    <span className="target-rule" aria-hidden="true">
                      <span style={{ transform: `scaleX(${Math.min(1, Math.max(0, p.total / view.target))})`, '--seat': SEAT_COLORS[p.seat % 6] } as CSSProperties} />
                    </span>
                  </td>
                  <td className="num-col tabular">
                    {signed(sc)}
                    {doubledHere && <span className="tag tag-neg">×2</span>}
                  </td>
                  <td className="num-col tabular total-cell">
                    <Tween from={p.total - sc} to={p.total} delay={250 + i * 60} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {over && rounds > 1 && (
          <div className="history" aria-label={t('history')}>
            <table>
              <thead>
                <tr>
                  <th />
                  {Array.from({ length: rounds }, (_, i) => <th key={i} className="tabular">{i + 1}</th>)}
                </tr>
              </thead>
              <tbody>
                {ranked.map(({ p }) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    {p.history.map((h, i) => <td key={i} className="tabular">{h}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <footer className="sheet-foot">
          <button type="button" className="btn btn-quiet" onClick={() => setPeek(true)}>{t('peek')}</button>
          <span className="spacer" />
          {over ? (
            isHost ? (
              <button type="button" className="btn btn-primary" onClick={() => send({ a: 'toLobby' })}>{t('newGame')}</button>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={onLeave}>{t('leave')}</button>
            )
          ) : isHost ? (
            <button type="button" className="btn btn-primary" onClick={() => send({ a: 'nextRound' })} autoFocus>{t('nextRound')}</button>
          ) : (
            <span className="muted">{t('waitingHost')}</span>
          )}
        </footer>
      </section>
    </div>
  );
}
