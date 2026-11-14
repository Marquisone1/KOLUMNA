import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Action, GameEvent, GameState } from '../game/types';
import { useI18n } from '../i18n';
import { Card, EmptySlot } from './Card';
import { PlayerBoard } from './PlayerBoard';
import { useViewport } from './useViewport';

interface Props {
  view: GameState;
  me: string;
  isHost: boolean;
  busy: boolean;
  lastEv: GameEvent | null;
  send: (a: Action) => void;
}

export function Table({ view, me, isHost, busy, lastEv, send }: Props) {
  const { t } = useI18n();
  const { w: vw, h: vh } = useViewport();
  const meIdx = view.players.findIndex((p) => p.id === me);
  const mine = view.players[meIdx];
  const current = view.players[view.turn];
  const myTurn = view.phase === 'play' && current?.id === me;

  // Opponents in seating order, starting with the player after me
  const opponents = useMemo(() => {
    const n = view.players.length;
    const out = [];
    for (let i = 1; i < n; i++) out.push(view.players[(Math.max(0, meIdx) + i) % n]);
    return meIdx < 0 ? view.players : out;
  }, [view.players, meIdx]);

  // Card sizes follow the viewport. Wide screens put the piles beside your board, narrow ones stack.
  const side = vw >= 960;
  const n = opponents.length;
  const heightScale = Math.min(1, Math.max(0.75, vh / 900));
  const oppW = Math.round((side ? (n <= 2 ? 48 : n <= 3 ? 42 : 34) : (n <= 2 ? 30 : n <= 3 ? 26 : 24)) * (side ? heightScale : 1));
  const oppGap = Math.max(4, Math.round(oppW * 0.1));
  const oppH = 3 * oppW * 1.4 + 2 * oppGap + (side ? 84 : 66);
  let myW: number;
  let pileW: number;
  if (side) {
    const availH = vh - 56 - 56 - oppH - 32;
    myW = Math.min(104, (availH - 96) / 4.2, (vw - 48 - 360 - 48) / 4 - 10);
    pileW = Math.min(88, myW * 0.86);
  } else {
    const availH = vh - 56 - 52 - oppH;
    myW = Math.min(96, (vw - 24) / 4 - 8, (availH - 200) / 5.3);
    pileW = Math.min(72, myW * 0.8);
  }
  myW = Math.max(44, Math.round(myW));
  pileW = Math.max(44, Math.round(pileW));

  const stage = view.stage;
  const canAct = !busy;
  const selectable = (cardId: number, up: boolean) => {
    if (!canAct || !mine) return false;
    if (view.phase === 'setup') return !up && mine.setupFlips < 2;
    if (!myTurn) return false;
    if (stage === 'deckDrawn' || stage === 'discardTaken') return true;
    if (stage === 'mustFlip') return !up;
    return false;
  };
  const onMyCard = (cardId: number) => {
    if (view.phase === 'setup') return send({ a: 'flip', card: cardId });
    if (stage === 'mustFlip') return send({ a: 'flip', card: cardId });
    send({ a: 'swap', card: cardId });
  };

  const deckActive = canAct && myTurn && stage === 'choose';
  const discardActive = canAct && myTurn && (stage === 'choose' || stage === 'deckDrawn');
  const onDiscard = () => {
    if (stage === 'choose') send({ a: 'takeDiscard' });
    else if (stage === 'deckDrawn') send({ a: 'toss' });
  };

  const top = view.discard[view.discard.length - 1];
  const under = view.discard[view.discard.length - 2];

  // Status line
  let status = '';
  let tone: 'mine' | 'wait' = 'wait';
  if (view.phase === 'setup') {
    const left = mine ? 2 - mine.setupFlips : 0;
    status = left === 2 ? t('setupMine') : left === 1 ? t('setupOne') : t('setupWait');
    tone = left > 0 ? 'mine' : 'wait';
  } else if (view.phase === 'play' && current) {
    if (myTurn) {
      tone = 'mine';
      status = { choose: t('chooseMine'), deckDrawn: t('deckDrawnMine'), discardTaken: t('discardTakenMine'), mustFlip: t('mustFlipMine') }[stage];
    } else {
      status = t('turnOf', { name: current.name });
    }
  }
  const finisher = view.finisher ? view.players.find((p) => p.id === view.finisher) : null;
  const finalNote = finisher && view.phase === 'play'
    ? (myTurn && view.lastTurns.includes(me) ? t('yourLastTurn') : t('finalTurns', { name: finisher.name }))
    : null;

  // Short note when a column is cleared
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (lastEv?.k === 'clear' && view.phase === 'play') {
      const p = view.players.find((x) => x.id === lastEv.p);
      if (p) {
        setToast(t('clears', { name: p.id === me ? t('you') : p.name }));
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 2200);
      }
    }
  }, [lastEv]); // eslint-disable-line react-hooks/exhaustive-deps

  const holder = view.drawn ? current : null;

  return (
    <div className={'table ' + (side ? 'is-side' : 'is-stack')}>
      <div className="opponents" style={{ '--opp-count': opponents.length } as CSSProperties}>
        {opponents.map((p) => (
          <PlayerBoard
            key={p.id}
            player={p}
            view={view}
            isMe={false}
            w={oppW}
            selectable={() => false}
            lastEv={lastEv}
            isHostView={isHost}
            onBotTakeover={(id) => send({ a: 'botTakeover', id })}
          />
        ))}
      </div>

      <div className="play-area">
      <div className="center">
        <div className="piles">
          <div className="pile">
            <button
              type="button"
              className={'deck' + (deckActive ? ' is-selectable' : '')}
              style={{ '--cw': pileW + 'px' } as CSSProperties}
              data-anchor="deck"
              onClick={() => send({ a: 'drawDeck' })}
              disabled={!deckActive}
              aria-label={t('deck')}
            >
              <Card v={null} up={false} w={pileW} className="deck-under deck-under-2" />
              <Card v={null} up={false} w={pileW} className="deck-under" />
              <Card v={null} up={false} w={pileW} />
            </button>
            <span className="pile-label">{t('deck')} <span className="muted tabular">{view.deckCount}</span></span>
          </div>

          <div className="pile">
            <button
              type="button"
              className={'discard' + (discardActive ? ' is-selectable' : '') + (stage === 'deckDrawn' && myTurn ? ' is-drop' : '')}
              style={{ '--cw': pileW + 'px' } as CSSProperties}
              data-anchor="discard"
              onClick={onDiscard}
              disabled={!discardActive}
              aria-label={stage === 'deckDrawn' && myTurn ? t('discardIt') : t('discard')}
            >
              {under && <Card v={under.v} up w={pileW} className="discard-under" />}
              {top ? <Card id={top.id} v={top.v} up w={pileW} /> : <EmptySlot w={pileW} />}
            </button>
            <span className="pile-label">{t('discard')}</span>
          </div>

          <div className={'pile pile-hand' + (view.drawn ? ' has-card' : '')}>
            <div className="hand" style={{ '--cw': pileW + 'px' } as CSSProperties} data-anchor="hand">
              {view.drawn
                ? <Card id={view.drawn.id} v={view.drawn.v} up w={pileW} className="is-held" />
                : <EmptySlot w={pileW} />}
            </div>
            <span className="pile-label">
              {holder ? (holder.id === me ? t('drawn') : holder.name) : t('drawn')}
            </span>
          </div>
        </div>

        <div className="status" aria-live="polite">
          <p className={'status-main tone-' + tone}>{status}</p>
          {finalNote && <p className="status-final">{finalNote}</p>}
          {myTurn && stage === 'deckDrawn' && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => send({ a: 'toss' })} disabled={!canAct}>
              {t('discardIt')}
            </button>
          )}
        </div>
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>

      {mine && (
        <div className="mine">
          <PlayerBoard
            player={mine}
            view={view}
            isMe
            w={myW}
            selectable={selectable}
            onCard={onMyCard}
            lastEv={lastEv}
            isHostView={isHost}
          />
        </div>
      )}
      </div>
    </div>
  );
}
