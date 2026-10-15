// Kimi's tokens today, for the usage strip (UsageBar.tsx) and its panel. Why: the user runs Kimi chats too (ADR 0046)
// and wants their use in sight beside Claude and Cursor (2026-10-15). Source, checked on Kimi Code CLI 0.27 (2026-10-15):
// the CLI writes every model call's tokens into its own session files, <KIMI_CODE_HOME or ~/.kimi-code>/sessions/
// <workdir>/<session>/agents/<agent>/wire.jsonl, one JSON line per record, e.g.
//   {"type":"usage.record","model":"k3","usage":{"inputOther":642,"output":114,"inputCacheRead":0,"inputCacheCreation":0},"usageScope":"turn","time":1790466028500}
// Its ACP mode sends no usage_update and no PromptResponse.usage, so the files are the only local source. The plan's
// 5-hour / weekly quota is only on Kimi's API (/coding/v1/usages) behind the user's OAuth token, which the app never
// reads (AGENTS.md rule 2): it is said, not guessed (KIMI_PLAN_NOTE). No dollars: the plan is a subscription and Kimi
// publishes no per-token price for its coding models. Read-only, files changed in the last day only, each read only from
// where the last read stopped. Used by brain/usage.ts (UsageMonitor) and brain/index.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { KimiUsage } from '../../shared/contract';
import { romeDay } from './live';

export const KIMI_PLAN_NOTE = 'La quota del piano Kimi (5 ore e settimana) si legge solo dall\'API di Kimi con il tuo login, che l\'app non tocca: la vedi in una chat Kimi con /usage. Qui ci sono i token di oggi, dai file di sessione di Kimi.';

/** Kimi Code's data folder: KIMI_CODE_HOME, else ~/.kimi-code (as the CLI resolves it). */
export function kimiHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.KIMI_CODE_HOME || path.join(os.homedir(), '.kimi-code');
}

interface Tokens { input: number; cacheRead: number; cacheWrite: number; output: number }
interface FileSums { byModel: Record<string, Tokens>; calls: number; last: number | null }

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const zero = (): Tokens => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
const add = (a: Tokens, b: Tokens): Tokens => ({ input: a.input + b.input, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, output: a.output + b.output });
const total = (t: Tokens): number => t.input + t.cacheRead + t.cacheWrite + t.output;

/** The usage.record lines of one wire.jsonl that fall on `day` (Rome); any other line, or a broken one, is skipped. */
export function parseWire(text: string, day: string): FileSums {
  const out: FileSums = { byModel: {}, calls: 0, last: null };
  for (const line of text.split('\n')) {
    if (!line.includes('"usage.record"')) continue; // the other records hold prompts and replies: not even parsed
    let r: Record<string, unknown>;
    try { r = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    const time = n(r.time);
    if (r.type !== 'usage.record' || !time || romeDay(time) !== day || !r.usage || typeof r.usage !== 'object') continue;
    const u = r.usage as Record<string, unknown>;
    const t: Tokens = { input: n(u.inputOther), cacheRead: n(u.inputCacheRead), cacheWrite: n(u.inputCacheCreation), output: n(u.output) };
    if (!total(t)) continue;
    const model = typeof r.model === 'string' && r.model ? r.model : '?';
    out.byModel[model] = add(out.byModel[model] ?? zero(), t);
    out.calls++;
    out.last = Math.max(out.last ?? 0, time);
  }
  return out;
}

/** The wire.jsonl files under <home>/sessions changed since `since` (ms). */
function wireFiles(home: string, since: number): string[] {
  const files: string[] = [];
  const dirs = (p: string) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(p, d.name)); } catch { return []; } };
  for (const wd of dirs(path.join(home, 'sessions'))) {
    for (const session of dirs(wd)) {
      for (const agent of dirs(path.join(session, 'agents'))) {
        const f = path.join(agent, 'wire.jsonl');
        try { if (fs.statSync(f).mtimeMs >= since) files.push(f); } catch { /* no file */ }
      }
    }
  }
  return files;
}

const merge = (a: FileSums, b: FileSums): FileSums => {
  const byModel = { ...a.byModel };
  for (const [m, t] of Object.entries(b.byModel)) byModel[m] = add(byModel[m] ?? zero(), t);
  return { byModel, calls: a.calls + b.calls, last: a.last && b.last ? Math.max(a.last, b.last) : b.last ?? a.last };
};

/** The bytes of `f` from `from` up to its last complete line (the CLI appends whole lines; a half-written one waits). */
function readFrom(f: string, from: number, size: number): { text: string; end: number } {
  const fd = fs.openSync(f, 'r');
  try {
    const buf = Buffer.alloc(size - from);
    const got = fs.readSync(fd, buf, 0, buf.length, from);
    const nl = buf.lastIndexOf(0x0a, got - 1);
    return nl < 0 ? { text: '', end: from } : { text: buf.subarray(0, nl + 1).toString('utf8'), end: from + nl + 1 };
  } finally { fs.closeSync(fd); }
}

/** Reads Kimi's sessions for today; a file that grew is read only from where it was left (sessions run for hours). */
export class KimiReader {
  private cache = new Map<string, { end: number; day: string; sums: FileSums }>();

  constructor(private readonly home: string) {}

  /** null = no Kimi data folder on this machine (the strip then shows no Kimi). */
  today(now = Date.now()): KimiUsage | null {
    if (!fs.existsSync(this.home)) return null;
    const day = romeDay(now);
    const byModel: Record<string, Tokens> = {};
    let calls = 0, last: number | null = null;
    const seen = new Set<string>();
    // a Rome day lasts at most 25 h (the autumn clock change): a file untouched for 26 h cannot hold a record of today
    for (const f of wireFiles(this.home, now - 26 * 36e5)) {
      seen.add(f);
      let st: fs.Stats;
      try { st = fs.statSync(f); } catch { continue; }
      let c = this.cache.get(f);
      // a new day, or a file that shrank (rewritten): from the start
      if (c && (c.day !== day || st.size < c.end)) c = undefined;
      if (!c || st.size > c.end) {
        const from = c?.end ?? 0;
        let r: { text: string; end: number };
        try { r = readFrom(f, from, st.size); } catch { continue; }
        const sums = parseWire(r.text, day);
        c = { end: r.end, day, sums: c ? merge(c.sums, sums) : sums };
        this.cache.set(f, c);
      }
      for (const [m, t] of Object.entries(c.sums.byModel)) byModel[m] = add(byModel[m] ?? zero(), t);
      calls += c.sums.calls;
      if (c.sums.last) last = Math.max(last ?? 0, c.sums.last);
    }
    for (const f of this.cache.keys()) if (!seen.has(f)) this.cache.delete(f);
    const all = Object.values(byModel).reduce(add, zero());
    return {
      tokens: total(all), input: all.input, cacheRead: all.cacheRead, cacheWrite: all.cacheWrite, output: all.output, calls, lastAt: last,
      models: Object.entries(byModel).map(([model, t]) => ({ model, tokens: total(t) })).sort((a, b) => b.tokens - a.tokens),
      planNote: KIMI_PLAN_NOTE,
    };
  }
}
