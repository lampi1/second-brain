// The credit book (ADR 0218, rewritten by ADR 0354 on 2026-11-25: «i limiti dei motori seguono i dati veri»): for each
// pool the app spends on (an engine, and each provider inside OpenCode: `openai/…` and the free `opencode/…` Zen models are
// two pools) the facts the one rule needs, and nothing else: the last limit error and the short pause it opened, the
// start of the last turn that worked, a probe in flight, the account the error was seen on (a hash, never the address).
// The verdict is shared/credit-rule.ts creditVerdict over these facts and the pool's last usage reading (the usage panel's,
// brain/usage.ts UsageMonitor.reading): no rule lives here. Here: a limit error opens or extends the pause (nextError), a
// clean turn started after the error frees the pool, a probe is claimed by one chat only, a new account or login drops
// an old pause, `fresh` reads again (one read per engine at a time, shared, with a short time limit) the pools that look
// stopped without a valid reading, `retry` is the limits panel's «Riprova ora». Saved in <userData>/credits.json; the
// file of before (version 1, a cool-down that doubled up to a day) is still read: a saved pause becomes a short one.
// Used by wiring.ts (room of a level's pick, turn ends, the panel, the reset timer); tests in
// test/unit/agents/credits.test.ts and test/unit/agents/credit-truth.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { Harness } from '../../shared/contract';
import { PROBE_TTL_MS, SHORT_PAUSE_MS, creditVerdict, nextError, type CreditError, type CreditReading, type CreditVerdict } from '../../shared/credit-rule';
import { errText, log } from '../log';
import { renameWithRetry } from './local-store';

/** The pool a chat on `engine` with `model` spends from: OpenCode's provider prefix splits its pools. */
export function poolOf(engine: Harness, model: string | null | undefined): string {
  if (engine !== 'opencode') return engine;
  const prefix = String(model ?? '').trim().split('/')[0]!.toLowerCase();
  if (!prefix || !String(model).includes('/')) return 'opencode:default';
  return `opencode:${prefix === 'opencode' ? 'zen' : prefix}`;
}

// Only the providers' own words for a plan or credit that is gone: generic words (billing, quota, 429, rate limit) also
// fit a short throttle the engine retries, or a task about invoices (review of 2026-11-01).
const LIMIT_TEXT = /(usage limit (?:has been |was )?reached|free usage limit|hit your (?:usage )?limit|insufficient[_ ]quota|exceeded your current quota|credit balance is too low|out of credits|subscribe to .{1,80} to keep going)/i;
/** Does an engine's error text say the provider's credit or plan limit is gone? Network errors, throttles and model
 *  refusals are not limits. */
export function limitSignal(text: string | null | undefined): boolean {
  const t = String(text ?? '');
  return !!t && LIMIT_TEXT.test(t) && !/ECONNRESET|ETIMEDOUT|socket|PING timed out/i.test(t.slice(0, 400));
}

const LOG_TIME = /^timestamp=(\S+)/;
/** OpenCode's log lines → for each provider, the last limit error and the last stream start (ms). */
export function readOpencodeLog(text: string): Map<string, { limitAt: number | null; streamAt: number | null }> {
  const out = new Map<string, { limitAt: number | null; streamAt: number | null }>();
  for (const line of text.split('\n')) {
    const provider = line.match(/providerID=([\w.-]+)/)?.[1];
    if (!provider) continue;
    const at = Date.parse(line.match(LOG_TIME)?.[1] ?? '');
    if (!Number.isFinite(at)) continue;
    const row = out.get(provider) ?? { limitAt: null, streamAt: null };
    if (/level=ERROR/.test(line) && limitSignal(line.match(/error\.error=(.*)$/)?.[1] ?? '')) row.limitAt = Math.max(row.limitAt ?? 0, at);
    else if (/message=stream\b/.test(line) && !/level=ERROR/.test(line)) row.streamAt = Math.max(row.streamAt ?? 0, at);
    out.set(provider, row);
  }
  return out;
}

/** One OpenCode provider's state from its log facts, for the limits panel only (no reading: ADR 0354): exhausted when its last stream ended on a limit error; ok when a
 *  stream started more than two minutes after the last limit error (it would have failed by now); else unknown. */
export function opencodeState(pool: string, facts: { limitAt: number | null; streamAt: number | null } | undefined, now: number): { pool: string; status: 'exhausted' | 'ok' | 'unknown'; source: 'log'; at: number; note?: string } | null {
  if (!facts) return null;
  const base = { pool, source: 'log' as const, at: now };
  if (facts.limitAt !== null && (facts.streamAt === null || facts.limitAt >= facts.streamAt - 2 * 60e3)) return { ...base, status: 'exhausted', note: 'il log di OpenCode dice limite raggiunto', at: facts.limitAt };
  if (facts.streamAt !== null && now - facts.streamAt > 2 * 60e3) return { ...base, status: 'ok', note: 'ultimo uso senza errore di limite' };
  return { ...base, status: 'unknown' };
}


/** What the book keeps of a pool. */
export interface PoolFacts {
  pool: string;
  account: string | null;
  error: CreditError | null;
  workedFrom: number | null;
  probe: { owner: string; at: number } | null;
}

export interface CreditBookDeps {
  /** the pool's last usage reading (the usage panel's); null = none, or the engine is not readable */
  reading(pool: string): CreditReading | null;
  /** reads the engine of these pools again now (UsageMonitor.readNow): one read per engine at a time, never throws */
  read?(pools: readonly string[]): Promise<void>;
  /** the pools whose engine has a usage reading at all (their pause cap is 1 hour, else a day) */
  readable?(pool: string): boolean;
  now?: () => number;
}

/** How long a launch waits for a fresh reading before it goes on with what is known. */
export const FRESH_WAIT_MS = 2500;

export class CreditBook {
  private pools = new Map<string, PoolFacts>();
  private reading = new Map<string, Promise<void>>();

  constructor(private readonly file: string | null, private readonly d: CreditBookDeps, private readonly clock: () => number = d.now ?? Date.now) {
    if (file) this.read();
  }

  facts(pool: string): PoolFacts | null { const f = this.pools.get(pool); return f ? structuredClone(f) : null; }

  /** The one rule's verdict for a pool now (asker = the chat that asks: a probe is its own). */
  verdict(pool: string, model: string | null, asker?: string, fmt?: (at: number) => string): CreditVerdict {
    const f = this.pools.get(pool);
    const reading = this.d.reading(pool);
    return creditVerdict({ pool, account: f?.account ?? null, model, reading, error: f?.error ?? null, workedFrom: f?.workedFrom ?? null, probe: f?.probe ?? null }, this.clock(), { ...(asker ? { asker } : {}), ...(fmt ? { fmt } : {}) });
  }

  /** A chat starts on a pool on probation: it is the one that tries; the others take the next model until it reports. */
  claim(pool: string, owner: string): void {
    if (this.verdict(pool, null, owner).state !== 'probation') return;
    const f = this.pools.get(pool) ?? this.empty(pool);
    if (f.probe && f.probe.owner === owner) return;
    this.set({ ...f, probe: { owner, at: this.clock() } });
  }

  /** A chat that claimed the probe did not start there after all: the next one may try. */
  release(pool: string, owner: string): void {
    const f = this.pools.get(pool);
    if (f?.probe?.owner === owner) this.set({ ...f, probe: null });
  }

  /** A limit error seen in a chat's turn (`startedAt` = the turn's start): the pool pauses, see nextError. */
  signal(pool: string, startedAt: number, text = ''): void {
    const now = this.clock(), f = this.pools.get(pool) ?? this.empty(pool);
    const error = nextError(f.error, now, startedAt, this.d.readable?.(pool) ?? false, f.workedFrom);
    const account = this.d.reading(pool)?.account ?? f.account;
    this.set({ ...f, account, error, probe: null });
    log.info('agents', 'credit pool paused by a limit error', { data: { pool, pauseMin: Math.round(error.pauseMs / 60e3), same: error.pauseFrom !== now, text: String(text).replace(/\s+/g, ' ').slice(0, 80) } });
  }

  /** A turn on the pool ended without a limit error: it proves the pool works if it started after the last error. */
  worked(pool: string, startedAt: number): void {
    const f = this.pools.get(pool);
    if (!f) return;
    if (f.workedFrom !== null && f.workedFrom >= startedAt && !f.probe) return;
    this.set({ ...f, workedFrom: Math.max(f.workedFrom ?? 0, startedAt), probe: f.error && startedAt <= f.error.at ? f.probe : null });
  }

  /** A turn's end on an engine: a limit error is a signal, a clean end a proof that the pool works. */
  observe(engine: Harness, model: string | null, errorText: string | null | undefined, isError: boolean, startedAt: number): string {
    const pool = poolOf(engine, model);
    // only the engine's own error notices of a failed turn count, never the agent's prose (TurnEndInfo.errorText)
    if (isError && limitSignal(errorText)) this.signal(pool, startedAt, String(errorText));
    else if (!isError) this.worked(pool, startedAt);
    return pool;
  }

  /** A new reading of a pool: another account, or a login after a signed-out reading, drops the old pause. */
  onReading(pool: string, r: { account: string | null; status: string; prevAccount?: string | null }): void {
    const f = this.pools.get(pool);
    if (!f?.error) return;
    // the account the error was seen on; unknown then, the one of the reading before this one
    const was = f.account ?? r.prevAccount ?? null;
    if (r.status === 'ok' && r.account && was && r.account !== was) {
      this.set({ ...f, account: r.account, error: null, probe: null });
      log.info('agents', 'credit pause dropped: another account', { data: { pool } });
    }
  }
  /** The user logged in again (a signed-out reading, then a good one): the old pause goes. */
  relogged(pool: string): void {
    const f = this.pools.get(pool);
    if (f?.error) { this.set({ ...f, error: null, probe: null }); log.info('agents', 'credit pause dropped: new login', { data: { pool } }); }
  }

  /** Reads again, once and shared, the pools that look stopped and whose reading is not valid; waits at most `ms`. */
  async fresh(pools: readonly string[], ms = FRESH_WAIT_MS): Promise<void> {
    const due = [...new Set(pools)].filter(p => this.verdict(p, null).reread);
    if (!due.length || !this.d.read) return;
    // one read at a time per pool: pools already being read share it, the others get their own
    const start = due.filter(p => !this.reading.has(p));
    if (start.length) {
      const p = this.d.read(start).catch(e => { log.warn('agents', 'credit reading failed', { cause: errText(e), hint: 'the pick uses the known state', data: { pools: start } }); })
        .finally(() => { for (const x of start) if (this.reading.get(x) === p) this.reading.delete(x); });
      for (const x of start) this.reading.set(x, p);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all(due.map(p => this.reading.get(p))), new Promise<void>(res => { timer = setTimeout(res, ms); (timer as { unref?: () => void }).unref?.(); })]);
    if (timer) clearTimeout(timer);
  }

  /** «Riprova ora» on the limits panel: reads again; if the pool is still stopped by an error (not by a spent window),
   *  its pause ends now and one chat tries. */
  async retry(pool: string): Promise<CreditVerdict> {
    await this.d.read?.([pool]).catch(() => undefined);
    const v = this.verdict(pool, null), f = this.pools.get(pool);
    if (v.state === 'out' && v.source === 'error' && f?.error && !(f.probe && this.clock() - f.probe.at < PROBE_TTL_MS)) {
      const now = this.clock();
      this.set({ ...f, error: { ...f.error, pauseFrom: now - f.error.pauseMs, at: Math.min(f.error.at, now - f.error.pauseMs) }, probe: null });
    }
    return this.verdict(pool, null);
  }

  /** The pools the book knows, for the panel and the reset timer. */
  list(): string[] { return [...this.pools.keys()]; }

  private empty(pool: string): PoolFacts { return { pool, account: null, error: null, workedFrom: null, probe: null }; }

  private set(f: PoolFacts): void {
    this.pools.set(f.pool, f);
    this.write();
  }

  private read(): void {
    try {
      const j = JSON.parse(fs.readFileSync(this.file!, 'utf8')) as { version?: number; pools?: unknown[] };
      for (const v of Array.isArray(j.pools) ? j.pools : []) {
        const s = v as Record<string, unknown>;
        if (typeof s.pool !== 'string' || !/^[a-z][\w:.-]{0,60}$/.test(s.pool)) continue;
        const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x) ? x : null;
        if (j.version === 2) {
          const e = s.error as Record<string, unknown> | null | undefined;
          const error = e && num(e.at) !== null && num(e.pauseFrom) !== null && num(e.pauseMs) !== null ? { at: num(e.at)!, pauseFrom: num(e.pauseFrom)!, pauseMs: Math.max(SHORT_PAUSE_MS, num(e.pauseMs)!) } : null;
          const p = s.probe as Record<string, unknown> | null | undefined;
          this.pools.set(s.pool, { pool: s.pool, account: typeof s.account === 'string' && /^[a-f0-9]{8,64}$/.test(s.account) ? s.account : null, error, workedFrom: num(s.workedFrom),
            probe: p && typeof p.owner === 'string' && num(p.at) !== null ? { owner: p.owner.slice(0, 80), at: num(p.at)! } : null });
          continue;
        }
        // version 1 (ADR 0218): an «exhausted» pool becomes a short pause from when it was written; the rule then reads
        // its reading again (a saved 24 h cool-down is not kept: ADR 0354 «migrazione»)
        const at = num(s.at);
        if (s.status === 'exhausted' && at !== null) this.pools.set(s.pool, { pool: s.pool, account: null, error: { at, pauseFrom: at, pauseMs: SHORT_PAUSE_MS }, workedFrom: null, probe: null });
      }
    } catch { /* first start or a broken file: an empty book, the turns fill it */ }
  }

  private write(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 2, pools: [...this.pools.values()] }, null, 1));
      renameWithRetry(tmp, this.file);
    } catch (e) {
      log.warn('agents', 'credits.json not written', { cause: errText(e), hint: 'check that the app data folder is writable; the credit states stay in memory' });
    }
  }
}

/** The last bytes of OpenCode's log (~/.local/share/opencode/log/opencode.log): enough for today's errors. */
export async function opencodeLogTail(home: string, bytes = 512 * 1024): Promise<string | null> {
  const file = path.join(home, '.local', 'share', 'opencode', 'log', 'opencode.log');
  try {
    const fh = await fs.promises.open(file, 'r');
    try {
      const { size } = await fh.stat();
      const start = Math.max(0, size - bytes);
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally { await fh.close(); }
  } catch { return null; }
}
