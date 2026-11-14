import type { CSSProperties } from 'react';
import type { GameEvent, GameState, Player } from '../game/types';
import { visibleSum } from '../game/engine';
import { useI18n } from '../i18n';
import { Card } from './Card';
import { Icon } from './Icon';

export const SEAT_COLORS = ['#e3a34a', '#86b38f', '#7ea9cc', '#d98f86', '#cdb67a', '#ab9fd3'];

interface Props {
  player: Player;
  view: GameState;
  isMe: boolean;
  w: number;
  selectable: (cardId: number, up: boolean) => boolean;
  onCard?: (cardId: number) => void;
  lastEv: GameEvent | null;
  isHostView: boolean;
  onBotTakeover?: (id: string) => void;
}

export function PlayerBoard({ player, view, isMe, w, selectable, onCard, lastEv, isHostView, onBotTakeover }: Props) {
  const { t } = useI18n();
  const isTurn = view.phase === 'play' && view.players[view.turn]?.id === player.id;
  const progress = Math.min(1, Math.max(0, player.total / view.target));
  const revealing = lastEv?.k === 'reveal';
  const showDeal = lastEv?.k === 'deal';
  const gap = Math.max(4, Math.round(w * 0.1));
  const isFinisher = view.finisher === player.id;
  const done = view.phase === 'setup' && player.setupFlips >= 2;

  return (
    <section
      className={'board' + (isMe ? ' is-me' : '') + (isTurn ? ' is-turn' : '') + (!player.connected ? ' is-offline' : '')}
      style={{ '--seat': SEAT_COLORS[player.seat % 6], '--gap': gap + 'px' } as CSSProperties}
      aria-label={player.name}
    >
      <header className="board-head">
        <span className="seat-dot" />
        <span className="board-name">
          {player.name}
          {isMe && <span className="muted"> · {t('you')}</span>}
        </span>
        {player.bot && <span className="tag"><Icon name="bot" size={12} />{t('bot')}</span>}
        {!player.connected && !player.bot && <span className="tag tag-warn"><Icon name="wifiOff" size={12} />{t('offline')}</span>}
        {isFinisher && view.phase === 'play' && <span className="tag tag-accent">{t('wentOut')}</span>}
        <span className="board-score tabular" title={t('visible')}>{visibleSum(player)}</span>
      </header>
      <div className="target-row" title={`${t('total')} ${player.total} / ${view.target}`}>
        <div className="target-rule" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <span className="target-num tabular">{player.total}<span className="muted">/{view.target}</span></span>
      </div>
      <div className="grid" key={view.round}>
        {player.grid.map((col, c) => (
          <div className="col" key={col[0]?.card.id ?? c}>
            {col.map((slot, r) => {
              const can = !!onCard && selectable(slot.card.id, slot.up);
              const idx = c * 3 + r;
              return (
                <Card
                  key={slot.card.id}
                  id={slot.card.id}
                  v={slot.card.v}
                  up={slot.up}
                  w={w}
                  selectable={can}
                  onClick={onCard ? () => onCard(slot.card.id) : undefined}
                  label={slot.up ? String(slot.card.v) : undefined}
                  delay={revealing ? idx * 45 : 0}
                  className={showDeal ? 'is-dealt' : ''}
                  style={showDeal ? ({ '--deal': (r * 4 + c) * 28 + 'ms' } as CSSProperties) : undefined}
                />
              );
            })}
          </div>
        ))}
        {player.grid.length === 0 && <div className="grid-empty" style={{ '--cw': w + 'px' } as CSSProperties} />}
      </div>
      {view.phase === 'setup' && !isMe && (
        <div className="board-foot muted">{done ? <Icon name="check" size={14} /> : <span className="tabular">{player.setupFlips}/2</span>}</div>
      )}
      {isHostView && !player.connected && !player.bot && onBotTakeover && (
        <button type="button" className="btn btn-quiet btn-xs" onClick={() => onBotTakeover(player.id)}>
          <Icon name="bot" size={14} /> {t('botTakeover')}
        </button>
      )}
    </section>
  );
}
