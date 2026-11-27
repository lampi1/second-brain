// The coordination journal's speed fixes (ADR 0368): projectionRequests reads only the open requests, cached until a
// write (this connection's or another's); pruneAutoPermits removes only old, delivered, gate-allowed permissions; the
// clean-up runs in small batches on fake timers, marks itself done and stops at app quit. Real SQLite in a temp folder,
// no sleeps or wall-clock thresholds.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CoordinationStore, proposalHash } from '../../src/main/coordination/store';
import { PRUNE_AGAIN_MS, PRUNE_AGE_MS, PRUNE_BATCH, PRUNE_DELAY_MS, PRUNE_GAP_MS, PRUNE_KEY, pruneAutoPermitsLater } from '../../src/main/coordination/prune';
import { closeAppDbs } from '../../src/main/app-db';
import type { DecisionActor, RequestKey } from '../../src/main/coordination/model';

const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); closeAppDbs(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-coord-prune-')); dirs.push(dir);
  const file = path.join(dir, 'app.db');
  return { file, store: new CoordinationStore(file) };
}
const keyOf = (id: string): RequestKey => ({ originalRequestId: id, jobId: 'chat:c', chatId: 'c', runId: null, taskVersion: 1, proposalRevision: 1, proposalHash: proposalHash({ id }) });
/** a request answered and delivered, as the manager journals one */
function answered(store: CoordinationStore, id: string, at: number, actor: DecisionActor, allow = true, kind: 'permission' | 'question' = 'permission') {
  const key = keyOf(id);
  store.register({ key, kind, at, payload: {} });
  const d = store.resolve(key, actor, kind === 'permission' ? { kind: 'permission', allow } : { kind: 'question', answers: {} });
  store.finishDelivery(store.beginDelivery(d.id).id, 'delivered');
}
const auto: DecisionActor = { kind: 'policy', policy: 'auto-permit' };

describe('the open requests a projection reads', () => {
  it('are only the open ones, and a write by this or another connection is seen at once', () => {
    const { store, file } = fixture();
    answered(store, 'closed', 1, auto);
    store.register({ key: keyOf('open-1'), kind: 'question', at: 2, payload: {} });
    expect(store.projectionRequests().map(r => r.key.originalRequestId)).toEqual(['open-1']);
    const first = store.projectionRequests();
    expect(store.projectionRequests()).toBe(first); // nothing changed: the cached rows
    store.register({ key: keyOf('open-2'), kind: 'question', at: 3, payload: {} });
    expect(store.projectionRequests().map(r => r.key.originalRequestId)).toEqual(['open-2', 'open-1']);
    const other = new CoordinationStore(file);
    other.resolve(keyOf('open-2'), { kind: 'user', channel: 'pc' }, { kind: 'question', answers: {} });
    // accepted but not delivered: still open, now with its decision
    expect(store.projectionRequests().find(r => r.key.originalRequestId === 'open-2')?.decision).toBeDefined();
    other.cancelPending('c', 'open-1');
    expect(store.projectionRequests().map(r => r.key.originalRequestId)).toEqual(['open-2']);
    other.close();
  });
});

describe('pruneAutoPermits', () => {
  it('removes only old, delivered permissions the app gate allowed', () => {
    const { store } = fixture();
    const now = 10 * PRUNE_AGE_MS, old = now - 2 * PRUNE_AGE_MS;
    answered(store, 'auto-old', old, auto);
    answered(store, 'role-old', old + 1, { kind: 'policy', policy: 'role-gate' });
    answered(store, 'auto-new', now - 1000, auto);
    answered(store, 'user-old', old + 2, { kind: 'user', channel: 'pc' });
    answered(store, 'refused-old', old + 3, auto, false);
    answered(store, 'away-old', old + 4, { kind: 'policy', policy: 'away' });
    answered(store, 'question-old', old + 5, auto, true, 'question');
    store.register({ key: keyOf('pending-old'), kind: 'permission', at: old + 6, payload: {} });
    expect(store.pruneAutoPermits(now - PRUNE_AGE_MS, 10)).toBe(2);
    expect(store.requests().map(r => r.key.originalRequestId).sort()).toEqual(['auto-new', 'away-old', 'pending-old', 'question-old', 'refused-old', 'user-old']);
    expect(store.pruneAutoPermits(now - PRUNE_AGE_MS, 10)).toBe(0);
    expect(store.autoPermitsLeft()).toBe(true); // auto-new, younger than a day
    expect(store.pruneAutoPermits(now, 10)).toBe(1);
    expect(store.autoPermitsLeft()).toBe(false);
  });
  it('takes at most one batch per call', () => {
    const { store } = fixture();
    for (let i = 0; i < 5; i++) answered(store, `a${i}`, i, auto);
    expect(store.pruneAutoPermits(100, 2)).toBe(2);
    expect(store.pruneAutoPermits(100, 2)).toBe(2);
    expect(store.pruneAutoPermits(100, 2)).toBe(1);
    expect(store.requests()).toEqual([]);
  });
});

describe('pruneAutoPermitsLater', () => {
  const fake = (batches: number[], left: boolean[] = []) => {
    const calls: number[] = [];
    let done = false;
    const store = { pruneAutoPermits: (before: number, batch: number) => { calls.push(before); expect(batch).toBe(PRUNE_BATCH); return batches.shift() ?? 0; },
      autoPermitsLeft: () => left.shift() ?? false,
      done: () => done, markDone: (k: string) => { expect(k).toBe(PRUNE_KEY); done = true; } };
    return { store, calls, isDone: () => done };
  };
  const timers = { setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms), clearTimeout: (h: NodeJS.Timeout | undefined | null) => { if (h) clearTimeout(h); } };

  it('waits for the start rush, runs a batch at a time with a pause between, then marks itself done', () => {
    vi.useFakeTimers();
    const f = fake([PRUNE_BATCH, PRUNE_BATCH, 3]);
    pruneAutoPermitsLater(f.store, { now: () => PRUNE_AGE_MS + 50, timers });
    vi.advanceTimersByTime(PRUNE_DELAY_MS - 1);
    expect(f.calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(f.calls).toEqual([50]); // rows older than a day only
    vi.advanceTimersByTime(PRUNE_GAP_MS);
    vi.advanceTimersByTime(PRUNE_GAP_MS);
    expect(f.calls).toHaveLength(3);
    expect(f.isDone()).toBe(true);
    vi.advanceTimersByTime(PRUNE_GAP_MS * 10);
    expect(f.calls).toHaveLength(3);
  });
  it('rows younger than a day wait: a day later it runs again, and is done only when none is left', () => {
    vi.useFakeTimers();
    let t = PRUNE_AGE_MS;
    const f = fake([3, 2], [true, false]);
    pruneAutoPermitsLater(f.store, { now: () => t, timers });
    vi.advanceTimersByTime(PRUNE_DELAY_MS);
    expect(f.calls).toHaveLength(1);
    expect(f.isDone()).toBe(false);
    vi.advanceTimersByTime(PRUNE_AGAIN_MS - 1);
    expect(f.calls).toHaveLength(1);
    t += PRUNE_AGAIN_MS;
    vi.advanceTimersByTime(1);
    expect(f.calls).toEqual([0, PRUNE_AGAIN_MS]);
    expect(f.isDone()).toBe(true);
  });
  it('never runs once done, and nothing runs after its stop', () => {
    vi.useFakeTimers();
    const f = fake([PRUNE_BATCH, PRUNE_BATCH]);
    f.store.markDone(PRUNE_KEY);
    pruneAutoPermitsLater(f.store, { timers });
    vi.advanceTimersByTime(PRUNE_DELAY_MS);
    expect(f.calls).toEqual([]);
    const g = fake([PRUNE_BATCH, PRUNE_BATCH, PRUNE_BATCH]);
    const stop = pruneAutoPermitsLater(g.store, { timers });
    vi.advanceTimersByTime(PRUNE_DELAY_MS);
    stop();
    vi.advanceTimersByTime(PRUNE_GAP_MS * 10);
    expect(g.calls).toHaveLength(1);
  });
  it('a failing batch pauses the clean-up until the next start, without marking it done', () => {
    vi.useFakeTimers();
    let n = 0;
    const store = { pruneAutoPermits: () => { n++; throw new Error('database is locked'); }, autoPermitsLeft: () => true, done: () => false, markDone: () => { throw new Error('not done'); } };
    pruneAutoPermitsLater(store, { timers });
    vi.advanceTimersByTime(PRUNE_DELAY_MS + PRUNE_GAP_MS * 5);
    expect(n).toBe(1);
  });
});
