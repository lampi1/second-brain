// The credit left in each source the app spends on (ADR 0218, «Balanced mode»): a pool per engine, and per provider inside
// OpenCode (`openai/…` and the free `opencode/…` Zen models are two pools). Why: the owner, 2026-11-01, wants delegations
// spread across his providers in proportion to the credit each has left, and a quick choice that checks the credits
// «solo quando serve». So the state of every pool is cached with the moment it was read (<userData>/credits.json); a pick
// reads only the cache (no network, no process, no file); `needsCheck` says when a local check is due (missing, stale,
// exhausted past its reset or cool-down, a costly delegation on an old state); a limit error in a chat's turn (`limitSignal`)
// writes the state at once. Local checks only: Claude's plan windows from the usage monitor, OpenCode's own log. Cursor,
// Codex and the API engines are not readable here: they are learnt from their errors, then retried on probation.
// Used by agents/balanced-mode.ts and wiring.ts; tests in test/unit/agents/credits.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { Harness } from '../../shared/contract';
import { errText, log } from '../log';

export type PoolStatus = 'ok' | 'low' | 'exhausted' | 'unknown' | 'probation';
export interface PoolState {
  pool: string;
  status: PoolStatus;
  /** the share of the credit left, 0..1; null = not readable */
  left: number | null;
  /** when the credit renews (ms); null = not known */
  resetsAt: number | null;
  /** the length of the pool's period (ms), to weigh how soon it renews */
  periodMs: number;
  source: 'limits' | 'log' | 'signal' | 'turn' | 'none';
  /** when this state was read or written (ms) */
  at: number;
  /** an exhausted pool with no known reset waits this long before probation; doubles at each new failure */
  coolMs?: number;
  note?: string;
}

const HOUR = 3600e3, DAY = 24 * HOUR;
/** A state older than this is checked again before a pick that needs it. */
export const STALE_MS = 30 * 60e3;
/** A costly delegation (tier top) wants a state no older than this. */
export const COSTLY_STALE_MS = 5 * 60e3;
export const COOL_MIN_MS = HOUR, COOL_MAX_MS = DAY;
/** The balanced picks the deficit pick compares with the targets. */
export const PICK_WINDOW_MS = DAY;
/** Below this share left a pool counts as low (it still takes work, in proportion). */
const LOW_LEFT = 0.15;

/** The assumed period of each pool when nothing better is known (ADR 0218 §1). */
export function periodOf(pool: string): number {
  if (pool === 'claude') return 7 * DAY;
  if (pool === 'opencode:zen') return DAY;
  if (pool === 'opencode:openai' || pool === 'codex') return 7 * DAY;
  return 30 * DAY;
}

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

/** Claude's plan windows (brain/usage.ts Limits) as a pool state: the binding window decides. */
export function claudeState(limits: { fiveHourPct: number | null; fiveHourResetsAt: number | null; weekPct: number | null; weekResetsAt: number | null; at: number } | null, now: number): PoolState {
  if (!limits || (limits.fiveHourPct === null && limits.weekPct === null)) return { pool: 'claude', status: 'unknown', left: null, resetsAt: null, periodMs: periodOf('claude'), source: 'none', at: now, note: 'limiti del piano non ancora letti' };
  const five = limits.fiveHourPct ?? 0, week = limits.weekPct ?? 0;
  const byWeek = week >= five;
  const used = Math.min(100, Math.max(five, week)) / 100;
  const left = Math.max(0, 1 - used);
  const resetsAt = byWeek ? limits.weekResetsAt : limits.fiveHourResetsAt;
  return { pool: 'claude', status: left <= 0.01 ? 'exhausted' : left < LOW_LEFT ? 'low' : 'ok', left, resetsAt, periodMs: byWeek ? 7 * DAY : 5 * HOUR, source: 'limits', at: now,
    note: byWeek ? 'finestra di 7 giorni' : 'finestra di 5 ore' };
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

/** One OpenCode provider's state from its log facts: exhausted when its last stream ended on a limit error; ok when a
 *  stream started more than two minutes after the last limit error (it would have failed by now); else unknown. */
export function opencodeState(pool: string, facts: { limitAt: number | null; streamAt: number | null } | undefined, now: number): PoolState | null {
  if (!facts) return null;
  const base = { pool, left: null, resetsAt: null, periodMs: periodOf(pool), source: 'log' as const, at: now };
  if (facts.limitAt !== null && (facts.streamAt === null || facts.limitAt >= facts.streamAt - 2 * 60e3)) return { ...base, status: 'exhausted', note: 'il log di OpenCode dice limite raggiunto', at: facts.limitAt };
  if (facts.streamAt !== null && now - facts.streamAt > 2 * 60e3) return { ...base, status: 'ok', note: 'ultimo uso senza errore di limite' };
  return { ...base, status: 'unknown' };
}

const openCodeProviderPool = (provider: string): string => `opencode:${provider === 'opencode' ? 'zen' : provider}`;

export interface CreditProbes {
  /** Claude's plan windows as the usage monitor holds them (in memory) */
  claudeLimits?: () => Parameters<typeof claudeState>[0];
  /** the tail of OpenCode's log (a local file); null = not there */
  opencodeLog?: () => Promise<string | null>;
}

/** The cached state of every pool, the local checks and the signals. */
export class CreditBook {
  private pools = new Map<string, PoolState>();
  private picks: { pool: string; at: number }[] = [];
  private checking: Promise<void> | null = null;

  constructor(private readonly file: string | null, private readonly probes: CreditProbes = {}, private readonly now: () => number = Date.now) {
    if (file) this.read();
  }

  /** The state a pick uses: the cache, with an ended cool-down or reset turned into probation. Never a check. */
  state(pool: string): PoolState | null {
    const s = this.pools.get(pool);
    if (!s) return null;
    if (s.status === 'exhausted' && this.recovered(s)) return { ...s, status: 'probation' };
    return s;
  }

  list(): PoolState[] { return [...this.pools.keys()].map(k => this.state(k)!); }

  /** The pools of the balanced picks of the last 24 h (the deficit pick's history), oldest first. */
  recentPicks(): string[] {
    const from = this.now() - PICK_WINDOW_MS;
    return this.picks.filter(p => p.at >= from).map(p => p.pool);
  }

  /** An balanced pick went to this pool (recorded right after its chat was created). */
  recordPick(pool: string): void {
    const from = this.now() - PICK_WINDOW_MS;
    this.picks = [...this.picks.filter(p => p.at >= from), { pool, at: this.now() }].slice(-500);
    this.write();
  }

  private recovered(s: PoolState): boolean {
    const t = this.now();
    if (s.resetsAt !== null) return t >= s.resetsAt;
    return t - s.at >= (s.coolMs ?? COOL_MIN_MS);
  }

  /** Is a local check due for this pool before a pick? (ADR 0218 §2) */
  needsCheck(pool: string, opts: { costly?: boolean } = {}): boolean {
    const s = this.pools.get(pool);
    if (!s) return true;
    const age = this.now() - s.at;
    if (s.status === 'exhausted') return this.recovered(s);
    if (age > STALE_MS) return true;
    return !!opts.costly && age > COSTLY_STALE_MS;
  }

  /** A limit error seen in a chat's turn: the pool is exhausted now, with a longer cool-down when it was already. */
  signal(pool: string, text: string): void {
    const was = this.state(pool);
    // a pool that fails again on probation (or again inside its cool-down) waits twice as long next time
    const coolMs = was && (was.status === 'probation' || was.status === 'exhausted') ? Math.min(COOL_MAX_MS, (was.coolMs ?? COOL_MIN_MS) * 2) : COOL_MIN_MS;
    this.set({ pool, status: 'exhausted', left: 0, resetsAt: was?.source === 'limits' && was.resetsAt && was.resetsAt > this.now() ? was.resetsAt : null, periodMs: was?.periodMs ?? periodOf(pool),
      source: 'signal', at: this.now(), coolMs, note: String(text).replace(/\s+/g, ' ').trim().slice(0, 160) });
    log.info('agents', 'credit pool exhausted by a chat error', { data: { pool, coolMin: Math.round(coolMs / 60e3) } });
  }

  /** A turn on the pool ended without a limit error: a probation or unknown pool works again. */
  worked(pool: string): void {
    const s = this.state(pool);
    // ok/low keep their read state; exhausted is still in its cool-down (a turn that started before the error)
    if (s && s.status !== 'probation' && s.status !== 'unknown') return;
    this.set({ pool, status: 'ok', left: s?.left ?? null, resetsAt: s?.resetsAt ?? null, periodMs: s?.periodMs ?? periodOf(pool), source: 'turn', at: this.now(), note: 'un turno è andato a buon fine' });
  }

  /** A turn's end on an engine: a limit error is a signal, a clean end a proof that the pool works. */
  observe(engine: Harness, model: string | null, errorText: string | null | undefined, isError: boolean): void {
    const pool = poolOf(engine, model);
    // only the engine's own error notices of a failed turn count, never the agent's prose (TurnEndInfo.errorText)
    if (isError && limitSignal(errorText)) this.signal(pool, String(errorText));
    else if (!isError) this.worked(pool);
  }

  /** Runs the local checks of the pools that need one (one check at a time; never throws). */
  async refresh(pools: readonly string[], opts: { costly?: boolean } = {}): Promise<void> {
    // a check already running covers other pools: wait for it, then check what of ours is still due (one at a time)
    for (;;) {
      if (this.checking) { await this.checking; continue; }
      const due = pools.filter(p => this.needsCheck(p, opts));
      if (!due.length) return;
      this.checking = this.check(due).finally(() => { this.checking = null; });
      await this.checking;
      return;
    }
  }

  private async check(due: readonly string[]): Promise<void> {
    const now = this.now();
    const touched = new Set<string>();
    const put = (s: PoolState) => { this.set(s); touched.add(s.pool); };
    try {
      if (due.includes('claude') && this.probes.claudeLimits) {
        const limits = this.probes.claudeLimits();
        const s = claudeState(limits, now);
        const was = this.pools.get('claude');
        // a limit error newer than the windows' reading wins until the windows are read again after it
        const signalNewer = was?.status === 'exhausted' && was.source === 'signal' && (!limits || limits.at < was.at);
        if (s.source === 'limits' && !signalNewer) put(s);
      }
      const oc = due.filter(p => p.startsWith('opencode:'));
      if (oc.length && this.probes.opencodeLog) {
        const text = await this.probes.opencodeLog();
        const facts = text ? readOpencodeLog(text) : new Map<string, { limitAt: number | null; streamAt: number | null }>();
        const byPool = new Map([...facts].map(([prov, f]) => [openCodeProviderPool(prov), f]));
        for (const pool of oc) {
          const s = opencodeState(pool, byPool.get(pool), now);
          const was = this.pools.get(pool);
          // a state newer than the log's fact (a signal, a probation, a clean turn) is kept
          if (s && !(was && was.at > s.at)) put(s.status === 'exhausted' && was?.coolMs ? { ...s, coolMs: was.coolMs } : s);
        }
      }
      // what no probe answered: first sight = unknown; an exhausted pool past its cool-down = probation; else the same
      // state, checked now (so the next pick does not check again)
      for (const pool of due) {
        if (touched.has(pool)) continue;
        const s = this.pools.get(pool);
        if (!s) this.set({ pool, status: 'unknown', left: null, resetsAt: null, periodMs: periodOf(pool), source: 'none', at: now, note: 'credito non leggibile: si impara dagli errori di limite' });
        else if (s.status === 'exhausted') { if (this.recovered(s)) this.set({ ...s, status: 'probation', resetsAt: null, at: now, note: 'dopo il limite: la prossima chat è di prova' }); }
        else this.set({ ...s, at: now });
      }
    } catch (e) {
      log.warn('agents', 'credit check failed', { cause: errText(e), hint: 'the pick uses the cached credit states; check the app data folder and OpenCode log permissions', data: { pools: due } });
    }
  }

  private set(s: PoolState): void {
    this.pools.set(s.pool, s);
    this.write();
  }

  private read(): void {
    try {
      const j = JSON.parse(fs.readFileSync(this.file!, 'utf8')) as { version?: number; pools?: unknown[]; picks?: unknown[] };
      for (const v of Array.isArray(j.picks) ? j.picks.slice(-500) : []) {
        const p = v as { pool?: unknown; at?: unknown };
        if (typeof p.pool === 'string' && /^[a-z][\w:.-]{0,60}$/.test(p.pool) && typeof p.at === 'number') this.picks.push({ pool: p.pool, at: p.at });
      }
      for (const v of Array.isArray(j.pools) ? j.pools : []) {
        const s = v as Partial<PoolState>;
        if (typeof s.pool !== 'string' || !/^[a-z][\w:.-]{0,60}$/.test(s.pool) || !['ok', 'low', 'exhausted', 'unknown', 'probation'].includes(String(s.status)) || typeof s.at !== 'number') continue;
        this.pools.set(s.pool, { pool: s.pool, status: s.status as PoolStatus, left: typeof s.left === 'number' ? Math.min(1, Math.max(0, s.left)) : null,
          resetsAt: typeof s.resetsAt === 'number' ? s.resetsAt : null, periodMs: typeof s.periodMs === 'number' && s.periodMs > 0 ? s.periodMs : periodOf(s.pool),
          source: (['limits', 'log', 'signal', 'turn', 'none'] as const).find(x => x === s.source) ?? 'none', at: s.at,
          ...(typeof s.coolMs === 'number' ? { coolMs: s.coolMs } : {}), ...(typeof s.note === 'string' ? { note: s.note.slice(0, 160) } : {}) });
      }
    } catch { /* first start or a broken file: an empty cache, the checks fill it */ }
  }

  private write(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, pools: [...this.pools.values()], picks: this.picks }, null, 1));
      fs.renameSync(tmp, this.file);
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
