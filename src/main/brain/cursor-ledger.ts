// Cursor's cost without downloading the CSV each time (docs/research/research-cursor-cost.md §5.1-5.2, the user's choice
// "Stima + correzione CSV", 2026-10-11). Why: Cursor's ACP sends no tokens and no API is open to a personal account, but
// the exact token counts of every turn reach the machine: the `stop` hook (IDE and ACP chats: input_tokens,
// output_tokens, cache_read_tokens, cache_write_tokens) and the `result.usage` of `agent -p --output-format json|
// stream-json` runs. A tiny hook script (HOOK_SOURCE, installed by installHook) appends one JSON line per turn to a
// ledger shared by the stable and the dev app; this module prices each turn at list price times a factor per model,
// and corrects it with Cursor's usage export CSV when one is in Downloads:
// - today, up to the export time of a CSV exported today with rows of today, takes the CSV's exact dollars;
// - factor per model = CSV $ / ledger estimate on the full days it covers where the ledger saw >= 90% of the CSV's
//   tokens (a day before the hook, or with turns from elsewhere, says nothing about the price), applied to newer turns;
// - margin = the largest per-day gap left after the factor (no CSV yet: ±20%, list price alone ran +17% on the user's
//   data, research §5.3), shown as "stima ±x%" until a CSV confirms the day.
// Used by brain/usage.ts (top bar, Costi page) and brain/index.ts (installHook at start).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { modelKey, priceOf } from '../chats/cursor-prices';
import { romeDay } from './live';

/** One turn: tokens as billing counts them (input = only the uncached part). */
export interface LedgerRow {
  at: number;
  source: 'hook' | 'cli';
  conversationId: string | null;
  generationId: string | null;
  model: string | null;
  input: number; cacheWrite: number; cacheRead: number; output: number;
}
export interface CsvRow { at: number; model: string; usd: number; tokens: number }
export interface Calibration {
  /** the CSV the factors come from, its export time (file mtime) and its first row */
  csvFile: string; exportedAt: number; from: number;
  /** model key (cursor-prices table) → CSV $ / list-price estimate */
  factors: Record<string, number>;
  /** fraction, e.g. 0.06 = ±6% */
  margin: number;
}
export interface CursorDay {
  /** null = unknown: some turns not in a CSV have no price and none has one ("auto", a new model) */
  usd: number | null;
  /** the whole day is in a CSV (exact dollars) */
  exact: boolean;
  /** of the estimated part, as a fraction (0 when exact) */
  margin: number;
  /** turns the ledger has today, and those without a price (unknown model, "auto") */
  turns: number; unpriced: number;
  /** $ per Cursor conversation id (= the ACP session id of an app chat), estimated over the whole ledger read */
  chats: Record<string, number>;
  note: string;
}

export const NO_CSV_MARGIN = 0.2;
const MIN_MARGIN = 0.05;
const MIN_SEEN = 0.9; // share of a day's CSV tokens the ledger must hold for that day to calibrate
// third-party models on Teams/Enterprise pay the Cursor Token Rate on all tokens; Cursor's own models do not (research §5.1.4)
const TOKEN_RATE = 0.25;
const OWN_MODEL = /grok|composer/i;

/** The app's shared folder (stable and dev read the same ledger): %LOCALAPPDATA%/second-brain. */
export function ledgerDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'second-brain');
}
export const LEDGER_FILE = 'cursor-ledger.jsonl';
export const HOOK_FILE = path.join('hooks', 'cursor-usage.mjs');
export const CALIBRATION_FILE = 'cursor-calibration.json';

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A ledger line → row; null when it carries no tokens (a turn with unknown tokens is never counted as 0 $). */
export function parseLedgerLine(line: string): LedgerRow | null {
  let o: unknown;
  try { o = JSON.parse(line); } catch { return null; }
  if (!isObj(o) || typeof o.at !== 'number') return null;
  const r: LedgerRow = {
    at: o.at, source: o.source === 'cli' ? 'cli' : 'hook', conversationId: str(o.conversationId), generationId: str(o.generationId), model: str(o.model),
    input: n(o.input), cacheWrite: n(o.cacheWrite), cacheRead: n(o.cacheRead), output: n(o.output),
  };
  return r.input + r.cacheWrite + r.cacheRead + r.output > 0 ? r : null;
}

/** The ledger since a time, one row per generation (a CLI turn may also fire the hook). */
export function readLedger(file: string, since = 0): LedgerRow[] {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const seen = new Set<string>();
  const out: LedgerRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const r = line ? parseLedgerLine(line) : null;
    if (!r || r.at < since) continue;
    if (r.generationId) { if (seen.has(r.generationId)) continue; seen.add(r.generationId); }
    out.push(r);
  }
  return out;
}

/** List-price $ of one turn (before the factor), or null when the model has no known price ("auto", a new model). */
export function listUsd(r: LedgerRow): number | null {
  const p = priceOf(r.model);
  if (!p) return null;
  const rate = r.model && !OWN_MODEL.test(r.model) ? TOKEN_RATE : 0;
  return ((p.input + rate) * r.input + (p.cacheWrite + rate) * r.cacheWrite + (p.cacheRead + rate) * r.cacheRead + (p.output + rate) * r.output) / 1e6;
}

const factorOf = (cal: Calibration | null, model: string | null): number | null => (cal && model ? cal.factors[modelKey(model) ?? ''] ?? null : null);
const tokensOf = (r: LedgerRow): number => r.input + r.cacheWrite + r.cacheRead + r.output;

/** Cursor's usage export (Cursor dashboard → Usage → Export CSV): Date (UTC start), Model, Total Tokens, Cost. */
export function parseUsageCsv(text: string): CsvRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const cells = (l: string): string[] => { // quoted cells may hold commas and "" quotes
    const out: string[] = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]!;
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = cells(lines[0]!).map(h => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name.toLowerCase());
  const date = col('Date'), model = col('Model'), cost = col('Cost'), total = col('Total Tokens');
  if (date < 0 || cost < 0) return [];
  const num = (v: string | undefined) => Number(String(v ?? '').replace(/[$,\s]/g, '')) || 0;
  return lines.slice(1).map(cells).map(c => ({ at: Date.parse(c[date] ?? ''), model: c[model] ?? '', usd: num(c[cost]), tokens: num(c[total]) }))
    .filter(r => Number.isFinite(r.at));
}

/** The newest team-usage-events-*.csv in a folder (by mtime), or null. */
export function newestExport(dir: string): { file: string; mtime: number } | null {
  try {
    return fs.readdirSync(dir).filter(f => /^team-usage-events-.*\.csv$/i.test(f))
      .map(f => ({ file: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0] ?? null;
  } catch { return null; }
}

/** Factors and margin from a CSV and the ledger, on the days the CSV covers fully (after its first row's day, before
 *  its export day: the edge days may be partial). Per day and model, never per row (one turn can be several rows). */
export function calibrate(csv: CsvRow[], ledger: LedgerRow[], csvFile: string, exportedAt: number, prev: Calibration | null = null): Calibration {
  const from = csv.length ? Math.min(...csv.map(r => r.at)) : exportedAt;
  const first = romeDay(from), last = romeDay(exportedAt);
  const full = (t: number) => { const d = romeDay(t); return d > first && d < last; };
  type Sum = { csv: number; est: number; csvTok: number; estTok: number };
  const sums = new Map<string, Sum>(); // key = day|model
  const at = (day: string, key: string): Sum => { const k = `${day}|${key}`; let s = sums.get(k); if (!s) sums.set(k, s = { csv: 0, est: 0, csvTok: 0, estTok: 0 }); return s; };
  for (const r of csv) { const key = modelKey(r.model); if (key && full(r.at)) { const s = at(romeDay(r.at), key); s.csv += r.usd; s.csvTok += r.tokens; } }
  for (const r of ledger) { const key = modelKey(r.model), usd = listUsd(r); if (key && usd !== null && full(r.at)) { const s = at(romeDay(r.at), key); s.est += usd; s.estTok += tokensOf(r); } }
  // a day the ledger saw only in part (hook added mid-day, turns from another PC or a subagent) says nothing about the price
  const usable = (s: Sum) => s.csv > 0 && s.est > 0 && s.estTok >= MIN_SEEN * s.csvTok;
  const byModel = new Map<string, { csv: number; est: number }>();
  for (const [k, s] of sums) {
    if (!usable(s)) continue;
    const m = k.split('|')[1]!;
    const t = byModel.get(m) ?? { csv: 0, est: 0 };
    t.csv += s.csv; t.est += s.est; byModel.set(m, t);
  }
  const factors: Record<string, number> = { ...(prev?.factors ?? {}) };
  for (const [m, t] of byModel) factors[m] = Math.round((t.csv / t.est) * 1000) / 1000;
  // what the factor leaves: the worst day, all models together
  const days = new Map<string, { csv: number; est: number }>();
  for (const [k, s] of sums) {
    if (!usable(s)) continue;
    const [day, m] = k.split('|') as [string, string];
    const t = days.get(day) ?? { csv: 0, est: 0 };
    t.csv += s.csv; t.est += s.est * (factors[m] ?? 1); days.set(day, t);
  }
  const gaps = [...days.values()].map(d => Math.abs(d.csv / d.est - 1));
  const margin = gaps.length ? Math.max(MIN_MARGIN, Math.round(Math.max(...gaps) * 100) / 100) : prev?.margin ?? NO_CSV_MARGIN;
  return { csvFile, exportedAt, from, factors, margin };
}

export function readCalibration(file: string): Calibration | null {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8')) as Calibration;
    return isObj(c) && isObj(c.factors) && typeof c.exportedAt === 'number' && typeof c.margin === 'number' ? c : null;
  } catch { return null; }
}

/** Today's Cursor $: the CSV's exact rows up to its export time (when `exportedAt`, the CSV actually read, is from today
 *  and has rows of today), the ledger's estimate (list price x factor) for the turns that ended after it. The export
 *  time, not the newest row: the CSV dates a request by its start, the ledger a turn by its end, so the turn running
 *  at the export would be counted twice. If Cursor writes the CSV with a lag, the turns just before the export are
 *  missed (not verified for the CSV; research §5.4). */
export function cursorDay(ledger: LedgerRow[], cal: Calibration | null, csv: CsvRow[], now = Date.now(), exportedAt = 0): CursorDay {
  const today = romeDay(now);
  let covered = 0, csvUsd = 0; // the CSV has today's rows up to its export time
  if (exportedAt && romeDay(exportedAt) === today) {
    for (const r of csv) if (r.at <= exportedAt && romeDay(r.at) === today) { csvUsd += r.usd; covered = exportedAt; }
  }
  let est = 0, turns = 0, unpriced = 0, unfactored = false;
  const chats: Record<string, number> = {};
  for (const r of ledger) {
    const list = listUsd(r);
    const f = factorOf(cal, r.model);
    const v = list === null ? null : list * (f ?? 1);
    if (v !== null && r.conversationId) chats[r.conversationId] = Math.round(((chats[r.conversationId] ?? 0) + v) * 1e6) / 1e6;
    if (romeDay(r.at) !== today) continue;
    turns++;
    if (r.at <= covered) continue;
    if (v === null) { unpriced++; continue; }
    est += v;
    if (f === null) unfactored = true;
  }
  const exact = covered > 0 && est === 0 && unpriced === 0;
  const unknown = unpriced > 0 && est === 0; // nothing after the CSV has a price: any figure would only be a part
  // a model without its own factor is at list price: the CSV's margin does not hold for it
  const margin = exact || unknown ? 0 : Math.max(cal?.margin ?? NO_CSV_MARGIN, unfactored ? NO_CSV_MARGIN : 0);
  const pct = Math.round(margin * 100);
  const basis = cal ? `fattore dal CSV del ${ddmm(cal.exportedAt)}${unfactored ? ', listino per i modelli che non ha' : ''}` : 'prezzo di listino, nessun CSV ancora';
  const note = exact ? `Cursor: dal CSV delle ${hhmm(covered)}`
    : !turns && !covered ? 'Cursor: nessun turno registrato oggi (hook stop di Cursor)'
    : unknown ? `Cursor: oggi sconosciuto, ${unpriced} turni senza prezzo (modello "auto" o nuovo)${covered ? `; esatto fino alle ${hhmm(covered)}` : ''}`
    : `Cursor: stima ±${pct}% (${basis})${covered ? `, esatto fino alle ${hhmm(covered)}` : ''}${unpriced ? `, ${unpriced} turni senza prezzo esclusi` : ''}`;
  return { usd: unknown ? null : Math.round((csvUsd + est) * 1e6) / 1e6, exact, margin, turns, unpriced, chats, note };
}

const hhmm = (t: number) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(t));
const ddmm = (t: number) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit' }).format(new Date(t));

/** The hook Cursor runs at every `stop` (and that an `agent -p` runner may pipe its result line into). Plain Node, no
 *  imports from the app (it runs outside it), never blocks Cursor: any problem → no line, exit 0, empty answer. */
export const HOOK_SOURCE = `// second-brain: appends one line per Cursor turn (tokens, model, conversation) to cursor-ledger.jsonl beside this
// folder. Installed and kept up to date by the second-brain app (src/main/brain/cursor-ledger.ts): edits here are lost.
// Cursor stop hook: {conversation_id, generation_id, model, input_tokens (cache included), output_tokens,
// cache_read_tokens, cache_write_tokens}. An agent -p run: pipe its result line ({type:"result", usage:{inputTokens
// (uncached), outputTokens, cacheReadTokens, cacheWriteTokens}, session_id}) with --model <slug>.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const n = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  try {
    // one JSON object (the hook, -p json), or stream-json lines whose result line counts
    const text = raw.replace(/^\\uFEFF/, '').trim();
    let o = null;
    try { o = JSON.parse(text); } catch { /* stream-json */ }
    if (!o || (o.type && o.type !== 'result')) {
      const last = text.split(/\\r?\\n/).filter(l => /"type"\\s*:\\s*"result"/.test(l)).pop();
      o = last ? JSON.parse(last) : null;
    }
    const i = process.argv.indexOf('--model');
    let row = null;
    if (o && o.type === 'result' && o.usage) {
      const u = o.usage;
      row = { source: 'cli', conversationId: o.session_id || null, generationId: o.request_id || null, model: i > 0 ? process.argv[i + 1] : null,
        input: n(u.inputTokens), cacheWrite: n(u.cacheWriteTokens), cacheRead: n(u.cacheReadTokens), output: n(u.outputTokens) };
    } else if (o && typeof o.input_tokens === 'number') {
      const cw = n(o.cache_write_tokens), cr = n(o.cache_read_tokens);
      row = { source: 'hook', conversationId: o.conversation_id || null, generationId: o.generation_id || null, model: o.model || null,
        input: Math.max(n(o.input_tokens) - cr - cw, 0), cacheWrite: cw, cacheRead: cr, output: n(o.output_tokens) };
    }
    if (row && row.input + row.cacheWrite + row.cacheRead + row.output > 0) {
      const file = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'cursor-ledger.jsonl');
      fs.appendFileSync(file, JSON.stringify({ at: Date.now(), ...row }) + '\\n');
    }
  } catch { /* never block Cursor */ }
  process.stdout.write('{}');
});
`;

/** Writes the hook script beside the ledger when missing or outdated. Returns its path (for hooks.json). */
export function installHook(dir = ledgerDir()): string {
  const file = path.join(dir, HOOK_FILE);
  try { if (fs.readFileSync(file, 'utf8') === HOOK_SOURCE) return file; } catch { /* missing */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // write then rename: Cursor may run the script while the stable or the dev app rewrites it
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, HOOK_SOURCE);
  fs.renameSync(tmp, file);
  return file;
}

/** Everything for today in one call: ledger, newest CSV (recalibrating when it is new), today's figures. */
export function cursorToday(opts: { dir?: string; downloads?: string; now?: number } = {}): CursorDay & { calibration: Calibration | null } {
  const dir = opts.dir ?? ledgerDir(), now = opts.now ?? Date.now();
  const ledger = readLedger(path.join(dir, LEDGER_FILE), now - 60 * 864e5);
  const calFile = path.join(dir, CALIBRATION_FILE);
  let cal = readCalibration(calFile);
  const exp = newestExport(opts.downloads ?? path.join(os.homedir(), 'Downloads'));
  let csv: CsvRow[] = [];
  if (exp) {
    try { csv = parseUsageCsv(fs.readFileSync(exp.file, 'utf8')); } catch { csv = []; }
    if (csv.length && (!cal || cal.csvFile !== exp.file || cal.exportedAt !== exp.mtime)) {
      cal = calibrate(csv, ledger, exp.file, exp.mtime, cal);
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(calFile, JSON.stringify(cal, null, 1)); } catch { /* next time */ }
    }
  }
  return { ...cursorDay(ledger, cal, csv, now, exp && csv.length ? exp.mtime : 0), calibration: cal };
}
