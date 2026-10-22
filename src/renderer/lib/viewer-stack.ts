// The file viewer overlay's session (the owner, 2026-10-22: «il viewer non in un'altra pagina ma in una modale o un
// overlay che si può espandere a tutto schermo»): what it shows (a file, or a before/after pair of screenshots) and the
// back/forward list of everything opened in it since the app started. The list outlives a close, so reopening the
// viewer and pressing back reaches the files seen before. Pure state transitions; the state lives in store/ui.ts
// (`viewer`) and actions.ts drives it. Pinned by test/unit/viewer-stack.test.ts.

/** One side of a before/after pair: a local file main reads (app:askImage) or an image already in hand (a data: URL). */
export interface Shot { path?: string; src?: string; caption: string }
export type ViewerEntry =
  | { kind: 'file'; arg: string }
  | { kind: 'shots'; before: Shot; after: Shot; title?: string };
export interface ViewerState { open: boolean; stack: ViewerEntry[]; at: number; full: boolean }

/** At most this many entries are kept (the oldest go first). */
export const VIEWER_STACK_MAX = 40;
export const emptyViewer: ViewerState = { open: false, stack: [], at: -1, full: false };

const key = (e: ViewerEntry): string => e.kind === 'file' ? `f:${e.arg}` : `s:${e.before.path ?? e.before.src ?? ''}|${e.after.path ?? e.after.src ?? ''}`;
export const sameEntry = (a: ViewerEntry | undefined, b: ViewerEntry | undefined): boolean => !!a && !!b && key(a) === key(b);
export const currentEntry = (v: ViewerState): ViewerEntry | null => (v.open ? v.stack[v.at] ?? null : null);

/** Show `e`: the same entry already on screen stays as it is; otherwise it goes after the current one (what was ahead is dropped). */
export function pushEntry(v: ViewerState, e: ViewerEntry): ViewerState {
  if (sameEntry(v.stack[v.at], e)) return v.open ? v : { ...v, open: true };
  const stack = [...v.stack.slice(0, v.at + 1), e].slice(-VIEWER_STACK_MAX);
  return { ...v, open: true, stack, at: stack.length - 1 };
}
/** One step back (-1) or forward (+1) in the list; nothing beyond its ends. */
export function stepEntry(v: ViewerState, d: -1 | 1): ViewerState {
  const at = v.at + d;
  return !v.open || at < 0 || at >= v.stack.length ? v : { ...v, at };
}
export const canStep = (v: ViewerState, d: -1 | 1): boolean => v.open && v.at + d >= 0 && v.at + d < v.stack.length;
