import type { CSSProperties } from 'react';
import type { Action, GameEvent, GameState, PeerHover } from '../game/types';
import { useI18n } from '../i18n';
import { Card, EmptySlot } from './Card';
import { PlayerBoard, SEAT_COLORS } from './PlayerBoard';
import { visibleSum } from '../game/engine';
import { useViewport } from './useViewport';
import { useTableModel } from './useTableModel';

interface Props {
  view: GameState;
  me: string;
  isHost: boolean;
  busy: boolean;
  lastEv: GameEvent | null;
  hovers?: Record<string, PeerHover>;
  send: (a: Action) => void;
  onHover?: (h: PeerHover | null) => void;
  /** couch mode on a phone: the table is on the TV, here only your cards, the piles and who is playing */
  controller?: boolean;
}

export function Table({ view, me, isHost, busy, lastEv, hovers, send, onHover, controller = false }: Props) {
  const { t } = useI18n();
  const { w: vw, h: vh } = useViewport();
  const m = useTableModel(view, me, busy, lastEv, send);
  const { mine, myTurn, stage, canAct, opponents, selectable, onMyCard, deckActive, discardActive, onDiscard, status, tone, finalNote, toast, holder } = m;

  // Card sizes follow the viewport. Wide screens put the piles beside your board, narrow ones stack.
  const side = vw >= 960;
  const n = opponents.length;
  const heightScale = Math.min(1, Math.max(0.75, vh / 900));
  const oppW = Math.round((side ? (n <= 2 ? 48 : n <= 3 ? 42 : 34) : (n <= 2 ? 30 : n <= 3 ? 26 : 24)) * (side ? heightScale : 1));
  const oppGap = Math.max(4, Math.round(oppW * 0.1));
  const oppH = controller ? 52 : 3 * oppW * 1.4 + 2 * oppGap + (side ? 84 : 66);
  let myW: number;
  let pileW: number;
  if (side) {
    const availH = vh - 56 - 56 - oppH - 32;
    myW = Math.min(104, (availH - 96) / 4.2, (vw - 48 - 360 - 48) / 4 - 10);
    pileW = Math.min(88, myW * 0.86);
  } else {
    const availH = vh - 56 - 52 - oppH;
    myW = Math.min(controller ? 124 : 96, (vw - 24) / 4 - 8, (availH - 200) / 5.3);
    pileW = Math.min(controller ? 92 : 72, myW * 0.8);
  }
  myW = Math.max(44, Math.round(myW));
  pileW = Math.max(44, Math.round(pileW));

  const top = view.discard[view.discard.length - 1];
  const under = view.discard[view.discard.length - 2];

  return (
    <div className={'table ' + (side ? 'is-side' : 'is-stack') + (controller ? ' is-controller' : '')}>
      {controller ? (
        <ul className="opp-chips" aria-label={t('players')}>
          {opponents.map((p) => (
            <li
              key={p.id}
              className={'opp-chip' + (view.players[view.turn]?.id === p.id && view.phase === 'play' ? ' is-turn' : '')}
              style={{ '--seat': SEAT_COLORS[p.seat % 6] } as CSSProperties}
            >
              <span className="opp-chip-dot" aria-hidden="true" />
              <span className="opp-chip-name">{p.name}</span>
              <span className="tabular muted">{visibleSum(p)}</span>
            </li>
          ))}
        </ul>
      ) : (
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
            hover={hovers?.[p.id]}
            isHostView={isHost}
            onBotTakeover={(id) => send({ a: 'botTakeover', id })}
          />
        ))}
      </div>
      )}

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
                ? <Card id={view.drawn.id} v={view.drawn.v} up={view.drawn.v !== null} w={pileW} className="is-held" />
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
            onHover={onHover}
            lastEv={lastEv}
            isHostView={isHost}
          />
        </div>
      )}
      </div>
    </div>
  );
}
