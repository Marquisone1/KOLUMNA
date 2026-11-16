// Everything the 3D table needs before it looks right: its code, the room, the card fonts,
// the character models. Started early (on the start screen) and awaited behind a loading
// screen when the table opens, so nothing pops in after the fact.

type Listener = (done: number, total: number) => void;

const tasks = new Map<string, Promise<unknown>>();
let done = 0;
const listeners = new Set<Listener>();

function track(name: string, start: () => Promise<unknown>) {
  if (tasks.has(name)) return tasks.get(name)!;
  const p = start()
    .catch((e) => console.warn('Kolumna: could not preload', name, e))
    .finally(() => {
      done++;
      listeners.forEach((l) => l(done, tasks.size));
    });
  tasks.set(name, p);
  listeners.forEach((l) => l(done, tasks.size));
  return p;
}

/** Start loading everything; safe to call more than once */
export function preload3d(): Promise<void> {
  track('table', () => import('./Table3D'));
  track('room', () => import('./rooms/Bar'));
  track('fonts', () => import('./textures').then((m) => m.loadCardFonts()));
  track('characters', () => import('./characters').then((m) => m.preloadCharacters()));
  track('sounds', () => import('../../audio').then((m) => m.loadSamples()));
  return Promise.all(tasks.values()).then(() => undefined);
}

export function preloadProgress(cb: Listener): () => void {
  listeners.add(cb);
  cb(done, Math.max(tasks.size, 1));
  return () => { listeners.delete(cb); };
}
