// The credit rule wired to the app's live data (ADR 0354): the usage panel's readings become the rule's readings (only
// a reading that names its pool: OpenCode's log fallback is shown on the panel and never read here), a level's pick asks
// the rule through `room` (and starts a reading when the pool looks stopped without a valid one), a new reading of another
// account or after a new login drops an old pause, the usage snapshot gets each engine's verdict for the limits panel,
// and a timer reads again when a pause or a spent window ends, without a restart. Used by wiring.ts; tests in
// test/unit/agents/credit-truth.test.ts.
import type { Harness, HarnessUsage, Usage } from '../../shared/contract';
import type { CreditReading, CreditVerdict } from '../../shared/credit-rule';
import { roomOf, type Room } from '../../shared/model-levels';
import { CreditBook, poolOf } from './credits';

export interface CreditUsage {
  usageReading?(pool: string): HarnessUsage | undefined;
  usageReadNow?(hs: readonly Harness[]): Promise<void>;
  onUsageReading?(fn: (pool: string, next: HarnessUsage, prev: HarnessUsage | undefined) => void): void;
  decorateUsage?(fn: (u: Usage) => Usage): void;
}

export interface CreditLiveDeps {
  file: string | null;
  usage: CreditUsage;
  /** something changed that may free a waiting chat: the credit-wait watch runs again */
  changed: () => void;
  now?: () => number;
  later?: (fn: () => void, ms: number) => { cancel(): void };
}

/** The engine a pool belongs to: `opencode:openai` → opencode. */
export const engineOfPool = (pool: string): Harness => pool.split(':')[0]! as Harness;

/** A panel reading as the rule's reading; null when it names no pool or comes from a log (no plan windows). */
export function readingOf(h: HarnessUsage | undefined): CreditReading | null {
  if (!h?.pool || h.source === 'log' || h.source === 'none') return null;
  return { at: h.at, ok: h.status === 'ok', pool: h.pool, account: h.account ?? null, windows: h.windows };
}

/** The shortest gap between two background reads a pick starts for one pool. */
export const KICK_MS = 30e3;

export interface CreditLive {
  book: CreditBook;
  verdict(engine: Harness, model: string | null, asker?: string): CreditVerdict;
  /** `ignoreError`: the user's own explicit pick skips an assumed pause once (ADR 0359) */
  room(engine: Harness, model: string | null, asker?: string, o?: { ignoreError?: boolean }): Room;
  /** before a pick: reads again the pools of these engines that look stopped (shared, at most FRESH_WAIT_MS) */
  fresh(models: readonly { engine: Harness; model: string | null }[]): Promise<void>;
  /** before a pick: the same for every pool the app knows */
  freshAll(): Promise<void>;
  /** a chat starts on (engine, model): if that pool is on probation, this chat is its one try */
  claim(engine: Harness, model: string | null, owner: string): void;
  /** the chat that claimed did not start on it: the probe is free again */
  release(engine: Harness, model: string | null, owner: string): void;
  observe(engine: Harness, model: string | null, errorText: string | null | undefined, isError: boolean, startedAt: number): void;
  retry(pool: string): Promise<CreditVerdict>;
  /** schedules the next read at the end of the nearest pause or spent window */
  schedule(): void;
  stop(): void;
}

export function creditLive(d: CreditLiveDeps): CreditLive {
  const now = d.now ?? Date.now;
  const later = d.later ?? ((fn, ms) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return { cancel: () => clearTimeout(t) }; });
  const book = new CreditBook(d.file, {
    reading: pool => readingOf(d.usage.usageReading?.(pool)),
    readable: pool => !!readingOf(d.usage.usageReading?.(pool)),
    read: async pools => { await d.usage.usageReadNow?.([...new Set(pools.map(engineOfPool))]); },
    now,
  }, now);
  let timer: { cancel(): void } | null = null, stopped = false;
  // a pick that finds a stopped pool reads it in the background and wakes the waiting chats: at most once per pool per
  // KICK_MS, on a macrotask (a throttled read resolves at once: without this the watch and the pick would call each other)
  const kicked = new Map<string, number>();
  const verdict = (engine: Harness, model: string | null, asker?: string, ignoreError = false) => book.verdict(poolOf(engine, model), model, asker, undefined, ignoreError);

  // the pools the panel and the timer look at: those the book has facts for and those with a reading
  const pools = (): string[] => {
    const all = new Set(book.list());
    for (const h of ['claude', 'cursor', 'codex', 'antigravity', 'antigravity:3p', 'opencode:openai', 'opencode:zen'] as const) if (d.usage.usageReading?.(h)) all.add(h);
    return [...all];
  };

  function schedule(): void {
    if (stopped) return;
    timer?.cancel(); timer = null;
    const t = now();
    const ends = pools().map(p => book.verdict(p, null)).filter(v => v.state === 'out' && v.until !== null && v.until > t).map(v => v.until!);
    if (!ends.length) return;
    const next = Math.min(...ends);
    timer = later(() => {
      timer = null;
      // at the end: read the engines whose pause or window ended, then tell the waiting chats (also when the read fails)
      const due = pools().filter(p => { const v = book.verdict(p, null); return v.state !== 'out' || v.until === null || v.until <= now(); });
      void (d.usage.usageReadNow?.([...new Set(due.map(engineOfPool))]) ?? Promise.resolve()).catch(() => undefined).finally(() => { d.changed(); schedule(); });
    }, Math.max(1000, next - t + 1000));
  }

  d.usage.onUsageReading?.((pool, next, prev) => {
    // another account, or a good reading right after a signed-out one (a new login): the old pause goes
    book.onReading(pool, { account: next.account ?? null, status: next.status, prevAccount: prev?.status === 'ok' ? prev.account ?? null : null });
    if (next.status === 'ok' && prev && (prev.status === 'unauthenticated' || prev.status === 'expired')) book.relogged(pool);
    schedule();
    d.changed();
  });

  d.usage.decorateUsage?.(u => {
    if (!u.harnesses) return u;
    const order: Record<string, number> = { out: 0, probation: 1, pace: 2, unknown: 3, free: 4 };
    return { ...u, harnesses: u.harnesses.map(h => {
      // the worst pool of this engine the app knows (OpenCode: each provider), so a skipped engine never shows only green
      const mine = [...new Set([h.pool ?? h.harness, ...pools().filter(p => engineOfPool(p) === h.harness)])];
      const vs = mine.map(p => ({ p, v: book.verdict(p, null) })).filter(x => x.v.state !== 'unknown' || x.p === (h.pool ?? h.harness));
      const worst = vs.sort((a, b) => order[a.v.state]! - order[b.v.state]!)[0];
      return worst ? { ...h, credit: { state: worst.v.state, why: worst.v.why, until: worst.v.until, pool: worst.p } } : h;
    }) };
  });

  return {
    book, verdict,
    room: (engine, model, asker, o) => {
      const v = verdict(engine, model, asker, o?.ignoreError === true);
      // a stopped pool without a valid reading: read it again now (shared, throttled); this pick goes on with what it knows
      const pool = poolOf(engine, model);
      if (v.reread && now() - (kicked.get(pool) ?? -Infinity) >= KICK_MS) {
        kicked.set(pool, now());
        void book.fresh([pool]).then(() => { later(() => d.changed(), 0); });
      }
      return roomOf(v);
    },
    fresh: async models => book.fresh(models.map(m => poolOf(m.engine, m.model))),
    freshAll: async () => book.fresh(pools()),
    claim: (engine, model, owner) => book.claim(poolOf(engine, model), owner, model),
    release: (engine, model, owner) => book.release(poolOf(engine, model), owner, model),
    observe: (engine, model, errorText, isError, startedAt) => {
      const pool = book.observe(engine, model, errorText, isError, startedAt);
      // a limit error: read the pool now (it says which window ended and when it comes back)
      if (isError && verdict(engine, model).reread) void book.fresh([pool]).then(() => { schedule(); d.changed(); });
      schedule();
    },
    retry: async pool => { const v = await book.retry(pool); schedule(); d.changed(); return v; },
    schedule,
    stop: () => { stopped = true; timer?.cancel(); },
  };
}
