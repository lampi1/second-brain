// One-time clean-up of the coordination journal's old auto-permitted permissions (ADR 0368). Until 2026-11-27 every
// permission the app's own gate allowed wrote a request, a decision and a delivery row (66,689 rows on the owner's PC,
// ~470 more an hour) that nothing ever reads again; they are no longer written (manager-requests.ts), and this removes
// the old ones: rows older than a day, PRUNE_BATCH at a time in their own short transaction, a pause between batches,
// starting a while after the app started (never in its start's rush, never one long write that holds the window).
// When a batch comes back short, the rows younger than a day (written in the day before the upgrade) wait: the job runs
// again a day later (or at the next start), and only when no such row is left at all is it marked done in
// coordination_meta and never runs again. Used by wiring.ts;
// pinned by test/unit/coordination-prune.test.ts with fake timers.
import { errText, log } from '../log';
import { timersFor } from '../timers';
import type { CoordinationStore } from './store';

export const PRUNE_KEY = 'prune:auto-permit:v1';
/** requests removed per transaction: a few milliseconds of the main thread each (scripts/bench-main-stalls.mjs) */
export const PRUNE_BATCH = 50;
/** the first batch, after the start's rush */
export const PRUNE_DELAY_MS = 3 * 60_000;
/** between two batches: the window gets its frames and the input in between */
export const PRUNE_GAP_MS = 1_000;
/** only rows older than this go */
export const PRUNE_AGE_MS = 86_400_000;
/** a pass that left younger rows behind runs again this much later */
export const PRUNE_AGAIN_MS = PRUNE_AGE_MS;

type Store = Pick<CoordinationStore, 'pruneAutoPermits' | 'autoPermitsLeft' | 'done' | 'markDone'>;
interface Timers { setTimeout: (cb: () => void, ms: number) => NodeJS.Timeout; clearTimeout: (h: NodeJS.Timeout | undefined | null) => void }

/** Schedules the clean-up; returns its stop (app quit: no batch runs after the store closed). */
export function pruneAutoPermitsLater(store: Store, opts: { now?: () => number; timers?: Timers; delayMs?: number } = {}): () => void {
  const timers = opts.timers ?? timersFor('coordination/prune'), now = opts.now ?? Date.now;
  let handle: NodeJS.Timeout | null = null, stopped = false, total = 0;
  const step = (): void => {
    handle = null;
    if (stopped) return;
    try {
      if (store.done(PRUNE_KEY)) return;
      const n = store.pruneAutoPermits(now() - PRUNE_AGE_MS, PRUNE_BATCH);
      total += n;
      if (n < PRUNE_BATCH) {
        const left = store.autoPermitsLeft();
        if (!left) store.markDone(PRUNE_KEY);
        log.info('workflows', 'old auto-permitted permissions removed from the journal', { data: { rows: total, again: left } });
        total = 0;
        if (left) schedule(PRUNE_AGAIN_MS); // the ones younger than a day, once they are old enough
        return;
      }
      schedule(PRUNE_GAP_MS);
    } catch (e) {
      log.warn('workflows', 'journal clean-up paused', { cause: errText(e), hint: 'it runs again at the next start; the old rows only cost space', data: { removed: total } });
    }
  };
  const schedule = (ms: number): void => { handle = timers.setTimeout(step, ms); handle.unref?.(); };
  schedule(opts.delayMs ?? PRUNE_DELAY_MS);
  return () => { stopped = true; if (handle) timers.clearTimeout(handle); handle = null; };
}
