import { useEffect, useRef, useState, type RefObject } from 'react';
import type { GameEvent, GameState, PeerHover, Step } from './game/types';
import type { Session } from './net/session';
import { domAnimator, type Animator } from './anim';

/**
 * Plays incoming steps one after another: animation on the old state,
 * then commit the new state, then wait for what the commit set in motion.
 * The animator decides how a step looks (2D DOM flights or the 3D table).
 */
export function useGame(session: Session | null, animator?: RefObject<Animator>) {
  const [view, setView] = useState<GameState | null>(null);
  const [lastEv, setLastEv] = useState<GameEvent | null>(null);
  const [hovers, setHovers] = useState<Record<string, PeerHover>>({});
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
    const offHovers = session.onHovers((h) => setHovers(h));
    const offSteps = session.onSteps((steps) => {
      queue.current.push(...steps);
      pump();
    });
    async function pump() {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      await Promise.resolve();
      while (queue.current.length && alive.current) {
        const step = queue.current.shift()!;
        const anim = animator?.current ?? domAnimator;
        // Catch up without animation when far behind or when the tab is in the background
        const skip = document.hidden || queue.current.length > 10 || step.ev.k === 'sync';
        try {
          if (!skip) await anim.before(step.ev, step.state, session!.pid);
        } catch { /* an animation must never block the game */ }
        if (!alive.current) break;
        anim.commit(step.ev, step.state, () => {
          setView(step.state);
          setLastEv(step.ev);
        }, skip);
        if (!skip) {
          try {
            await anim.after(step.ev, step.state);
          } catch { /* see above */ }
        }
      }
      running.current = false;
      if (alive.current) setBusy(false);
    }
    return () => {
      alive.current = false;
      offStatus();
      offHovers();
      offSteps();
    };
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  return { view, lastEv, hovers, status, busy };
}
