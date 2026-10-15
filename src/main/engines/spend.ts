// What the API engines cost this month, as the app computes it (ADR 0052). Why: the user's Claude Max plan includes monthly
// API credits (since 2026-10-07: 100 $ on Max 5x, 200 $ on Max 20x; they do not carry over), and Settings → Motori shows
// how much of them the app has used; the Messages API shows spend only to an Admin key, which the app never asks for.
// Every API request the app makes on the user's key adds here: the text-only calls (engines/text.ts: the judge, the
// report writer) and each turn of an API chat (wiring.ts onTurnEnd). The figure is list price × the usage each answer
// reports (chats/api.ts usageCost), so it is an estimate of the bill, not the bill. Kept in <userData>/api-spend.json,
// one line per month and engine (no prompts, no keys), the last 12 months. Used by wiring.ts and index.ts (engines:spend).
import fs from 'node:fs';
import path from 'node:path';
import type { ApiSpendInfo, ApiSpendLine, Harness } from '../../shared/contract';
import { errText, log } from '../log';

interface SpendFile { version: 1; months: Record<string, Record<Harness, ApiSpendLine>> }

const KEEP_MONTHS = 12;
const MONTH = /^\d{4}-\d{2}$/;

/** "2026-10": the month of a moment, local time. */
export const monthOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export class ApiSpend {
  private data: SpendFile;

  constructor(private readonly file: string) { this.data = this.read(); }

  /** One request or chat turn on an API engine; usd null = its model has no price (counted apart). */
  add(engine: Harness, usd: number | null, now = Date.now()): void {
    const m = monthOf(now);
    const month = this.data.months[m] ?? (this.data.months[m] = {});
    const line = month[engine] ?? (month[engine] = { usd: 0, calls: 0, unpriced: 0 });
    line.calls++;
    if (usd === null || !Number.isFinite(usd) || usd < 0) line.unpriced++;
    else line.usd = Math.round((line.usd + usd) * 1e6) / 1e6;
    this.write();
  }

  /** This month's spend per engine (engines with none are absent). */
  info(now = Date.now()): ApiSpendInfo {
    const m = monthOf(now);
    const engines: Record<Harness, ApiSpendLine> = {};
    for (const [id, l] of Object.entries(this.data.months[m] ?? {})) engines[id] = { usd: Math.round(l.usd * 100) / 100, calls: l.calls, unpriced: l.unpriced };
    return { month: m, measured: 'app', engines };
  }

  private read(): SpendFile {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<SpendFile>;
      const months: SpendFile['months'] = {};
      for (const [m, byEngine] of Object.entries(raw.months ?? {})) {
        if (!MONTH.test(m) || !byEngine || typeof byEngine !== 'object') continue;
        months[m] = {};
        for (const [id, l] of Object.entries(byEngine)) months[m][id] = { usd: num(l?.usd), calls: num(l?.calls), unpriced: num(l?.unpriced) };
      }
      return { version: 1, months };
    } catch { return { version: 1, months: {} }; }
  }

  private write(): void {
    const keep = Object.keys(this.data.months).sort().slice(-KEEP_MONTHS);
    this.data.months = Object.fromEntries(keep.map(m => [m, this.data.months[m]!]));
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      log.warn('engines', 'api spend not saved', { data: errText(e), cause: 'api-spend.json not writable', hint: 'check that the app data folder is writable' });
    }
  }
}
