// Counters of how the app's Claude chats use their context (ADR 0031), from the API usage every engine reports (zero
// tokens): calls, calls over 200k, cold cache re-writes over 100k, compactions, the list-price $ of the first calls
// after an auto-compaction (ADR 0186 dropped the cold notes' and the continuation's counters: no page read them), and the prompt cache per
// kind of chat (read, written, uncached; and on each session's first call, whether it found its prefix cached). Why: the owner decided
// (13/10) on measured numbers and wants to see whether the fix holds. Kept in <userData>/context-stats.json (saved a
// few seconds after a change), notable events logged on scope chats; app_state shows the snapshot. Used by manager.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { CacheKind, CacheTotals, ContextStats } from '../../shared/contract';
import { errText, log } from '../log';

const OVER = 200_000;
const COLD = 100_000;

const zeroCache = (): CacheTotals => ({ calls: 0, read: 0, write: 0, input: 0, firstCalls: 0, firstRead: 0, firstWrite: 0 });
const emptyCache = (): Record<CacheKind, CacheTotals> => ({ orchestrator: zeroCache(), root: zeroCache(), child: zeroCache() });
const empty = (now: number): ContextStats => ({
  since: now, calls: 0, over200k: 0, coldRewrites: 0, compactions: 0, afterCompaction: { calls: 0, usd: 0 }, cache: emptyCache(),
});
const totals = (v: unknown): CacheTotals => {
  const o = (v ?? {}) as Record<string, unknown>;
  return { calls: n(o.calls), read: n(o.read), write: n(o.write), input: n(o.input), firstCalls: n(o.firstCalls), firstRead: n(o.firstRead), firstWrite: n(o.firstWrite) };
};

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const pair = (v: unknown): { calls: number; usd: number } => { const o = (v ?? {}) as Record<string, unknown>; return { calls: n(o.calls), usd: n(o.usd) }; };

export class ContextCounters {
  private s: ContextStats;
  private timer: NodeJS.Timeout | null = null;
  readonly file: string;

  constructor(userData: string, now = Date.now()) {
    this.file = path.join(userData, 'context-stats.json');
    this.s = this.load() ?? empty(now);
  }

  /** One API call; after = it is one of the first calls after a continuation or a compaction. */
  call(chatId: string, c: { context: number; cacheWrite: number; usd: number; cacheRead?: number; input?: number }, after: 'continuation' | 'compaction' | null, cache?: { kind: CacheKind; first: boolean }): void {
    this.s.calls++;
    if (cache) {
      const t = (this.s.cache ??= emptyCache())[cache.kind];
      t.calls++; t.read += c.cacheRead ?? 0; t.write += c.cacheWrite; t.input += c.input ?? 0;
      if (cache.first) {
        t.firstCalls++; t.firstRead += c.cacheRead ?? 0; t.firstWrite += c.cacheWrite;
        log.info('chats', 'context: first call of a session', { chat: chatId, data: { kind: cache.kind, cacheRead: c.cacheRead ?? 0, cacheWrite: c.cacheWrite, input: c.input ?? 0 } });
      }
    }
    if (c.context > OVER) this.s.over200k++;
    if (c.cacheWrite > COLD) {
      this.s.coldRewrites++;
      log.info('chats', 'context: cache re-written', { chat: chatId, data: { context: c.context, cacheWrite: c.cacheWrite, usd: round(c.usd), after } });
    }
    if (after === 'compaction') { const p = this.s.afterCompaction; p.calls++; p.usd = round(p.usd + c.usd); }
    this.save();
  }

  compaction(chatId: string, pre: number | null, post: number | null): void {
    this.s.compactions++;
    log.info('chats', 'context: compacted', { chat: chatId, data: { pre, post } });
    this.save();
  }

  /** A cold hand-off note written or used: logged only (ADR 0186 dropped its counters). */
  note(chatId: string, what: 'written' | 'used', data: Record<string, unknown> = {}): void {
    log.info('chats', `context: cold note ${what}`, { chat: chatId, data });
  }

  snapshot(): ContextStats {
    const s = this.s;
    return { ...s, afterCompaction: { ...s.afterCompaction }, cache: structuredClone(s.cache ?? emptyCache()) };
  }

  /** Writes now (the app quits). */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.s), 'utf8');
      fs.renameSync(`${this.file}.tmp`, this.file);
    } catch (e) {
      log.warn('chats', 'context-stats.json not saved', { cause: errText(e), hint: 'the counters go on in memory; check that userData is writable' });
    }
  }

  private save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 5000);
    this.timer.unref?.();
  }

  private load(): ContextStats | null {
    try {
      const o = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      if (!n(o.since)) return null;
      return {
        since: n(o.since), calls: n(o.calls), over200k: n(o.over200k), coldRewrites: n(o.coldRewrites), compactions: n(o.compactions),
        afterCompaction: pair(o.afterCompaction),
        cache: { orchestrator: totals((o.cache as Record<string, unknown> | undefined)?.orchestrator), root: totals((o.cache as Record<string, unknown> | undefined)?.root), child: totals((o.cache as Record<string, unknown> | undefined)?.child) },
      };
    } catch { return null; }
  }
}

const round = (v: number): number => Math.round(v * 1e6) / 1e6;
