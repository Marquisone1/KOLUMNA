import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action, GameEvent, GameState } from '../game/types';
import { useI18n } from '../i18n';

/**
 * What the table means for the local player, independent of how it is drawn:
 * which cards and piles can be used right now, what happens on a click, the status line.
 * Shared by the 2D table and the 3D table.
 */
export function useTableModel(view: GameState, me: string, busy: boolean, lastEv: GameEvent | null, send: (a: Action) => void) {
  const { t } = useI18n();
  const meIdx = view.players.findIndex((p) => p.id === me);
  const mine = view.players[meIdx];
  const current = view.players[view.turn];
  const myTurn = view.phase === 'play' && current?.id === me;
  const stage = view.stage;
  const canAct = !busy;

  // Opponents in seating order, starting with the player after me
  const opponents = useMemo(() => {
    const n = view.players.length;
    const out = [];
    for (let i = 1; i < n; i++) out.push(view.players[(Math.max(0, meIdx) + i) % n]);
    return meIdx < 0 ? view.players : out;
  }, [view.players, meIdx]);

  const [pendingSetup, setPendingSetup] = useState<number[]>([]);
  useEffect(() => {
    if (view.phase !== 'setup') setPendingSetup([]);
  }, [view.phase, view.round]);

  const selectable = (cardId: number, up: boolean) => {
    if (!mine) return false;
    if (view.phase === 'setup') {
      if (up || pendingSetup.includes(cardId)) return false;
      const flippedIds = new Set(mine.grid.flat().filter((s) => s.up).map((s) => s.card.id));
      const inFlight = pendingSetup.filter((id) => !flippedIds.has(id)).length;
      return mine.setupFlips + inFlight < 2;
    }
    if (!canAct || !myTurn) return false;
    if (stage === 'deckDrawn' || stage === 'discardTaken') return true;
    if (stage === 'mustFlip') return !up;
    return false;
  };
  const onMyCard = (cardId: number) => {
    if (view.phase === 'setup') {
      setPendingSetup((prev) => (prev.includes(cardId) ? prev : [...prev, cardId]));
      return send({ a: 'flip', card: cardId });
    }
    if (stage === 'mustFlip') return send({ a: 'flip', card: cardId });
    send({ a: 'swap', card: cardId });
  };

  const deckActive = canAct && myTurn && stage === 'choose';
  const discardActive = canAct && myTurn && (stage === 'choose' || stage === 'deckDrawn');
  const onDeck = () => send({ a: 'drawDeck' });
  const onDiscard = () => {
    if (stage === 'choose') send({ a: 'takeDiscard' });
    else if (stage === 'deckDrawn') send({ a: 'toss' });
  };

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
  const canToss = myTurn && stage === 'deckDrawn';

  return {
    meIdx, mine, current, myTurn, stage, canAct, opponents,
    selectable, onMyCard, deckActive, discardActive, onDeck, onDiscard, canToss,
    status, tone, finalNote, toast, holder,
  };
}
