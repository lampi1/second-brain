// The commands the user just ran from a question card (ADR 0259, the owner 2026-11-10: «ripensa anche l'esegui deve
// essere perfetto»): Esegui answers the card, and the card leaves at once (main resolves the request on run:start), so
// the run itself shows in a small strip at the bottom of the window: running with the time and the last output line,
// then «Fatto» (gone after a few seconds) or the error with Riprova. Only the runs started here, never every run.
// Pure state, no React here; components/RunWatch.tsx draws it. Used by CommandRequest.tsx (watch) and RunWatch.tsx.
import { useSyncExternalStore } from 'react';
import type { PendingRequest } from '@shared/contract';

export interface Watched { key: string; req: PendingRequest; at: number }

let list: Watched[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const l of [...listeners]) l(); };

/** at most this many strips at once: the oldest goes first */
const MAX = 3;

export const watchKey = (r: Pick<PendingRequest, 'chatId'> & { command?: { itemId: string; code: string } }): string =>
  `${r.chatId}|${r.command?.itemId ?? ''}|${r.command?.code ?? ''}`;

/** A command request the user ran: its run shows in the strip. */
export function watchRun(req: PendingRequest, now = Date.now()): void {
  if (!req.command) return;
  const key = watchKey(req);
  list = [...list.filter(w => w.key !== key), { key, req, at: now }].slice(-MAX);
  emit();
}

export function unwatchRun(key: string): void {
  const next = list.filter(w => w.key !== key);
  if (next.length === list.length) return;
  list = next;
  emit();
}

export const watchedRuns = (): readonly Watched[] => list;

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function useWatchedRuns(): readonly Watched[] { return useSyncExternalStore(subscribe, () => list); }
