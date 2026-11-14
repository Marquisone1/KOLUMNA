import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { GameEvent, GameState, Step } from './game/types';
import type { Session } from './net/session';
import { afterDelay, animateBefore, commitSound, measureCards, playLayoutShift, restoreHidden } from './anim';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Plays incoming steps one after another: flight animation on the old state,
 * then commit the new state, then a short pause for CSS transitions.
 */
export function useGame(session: Session | null) {
  const [view, setView] = useState<GameState | null>(null);
  const [lastEv, setLastEv] = useState<GameEvent | null>(null);
  const [status, setStatus] = useState(session?.status ?? 'closed');
  const [busy, setBusy] = useState(false);
  const queue = useRef<Step[]>([]);
  const running = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!session) return;
    setStatus(session.status);
    const offStatus = session.onStatus(() => setStatus(session.status));
    const offSteps = session.onSteps((steps) => {
      queue.current.push(...steps);
      pump();
    });
    async function pump() {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      while (queue.current.length && alive.current) {
        const step = queue.current.shift()!;
        // Catch up without animation when far behind or when the tab is in the background
        const skip = document.hidden || queue.current.length > 10 || step.ev.k === 'sync';
        try {
          if (!skip) await animateBefore(step.ev, session!.pid);
        } catch { /* an animation must never block the game */ }
        const before = skip ? null : measureCards();
        flushSync(() => {
          setView(step.state);
          setLastEv(step.ev);
        });
        restoreHidden();
        if (!skip) {
          if (before && step.ev.k !== 'deal') playLayoutShift(before);
          commitSound(step.ev);
          await wait(afterDelay(step.ev));
        }
      }
      running.current = false;
      if (alive.current) setBusy(false);
    }
    return () => {
      alive.current = false;
      offStatus();
      offSteps();
    };
  }, [session]);

  return { view, lastEv, status, busy };
}
