// A chat's time and cost estimate from the brain's own table (<brain>/ops/state/estimates.json, written by
// ops/tools/estimates.mjs from every past transcript: real work time, $, the chat title's area and kind). The brain
// measures which grouping (all chats, area, kind, area+kind) estimated the past chats best and with what mean error;
// the app follows that grouping and shows the error beside the estimate (the user, 2026-10-13: "stima onesta
// automatica"). No model is ever called: the table is refreshed by running the script (incremental, < 1 s warm) a
// little after each turn ends, at most every 5 minutes. The range is the honest 80% one when the table is calibrated
// (ADR 0030), and each job's estimate is recorded in the brain's outcomes.jsonl before it ran, for the shared
// self-improvement loop. Used by brain/index.ts for 'estimate:get' and the job's first turn end (wiring.ts).
import fs from 'node:fs';
import path from 'node:path';
import type { Effort, Estimate, EstimateResult, Harness } from '../../shared/contract';
import { log } from '../log';
import { runNode, type NodeRunner } from './node';

interface Stats { low: number; mid: number; high: number }
interface Group { n: number; min: Stats; usd: Stats }
export interface BrainTable {
  updated: string;
  best?: {
    name: string; order: string[]; errMin: number | null; errUsd: number | null; tested: number;
    /** 80% range = median × e^±q (split conformal on the past estimates' log errors); inMin = how often it held, on `covered` chats */
    range80?: { qMin: number | null; qUsd: number | null; inMin: number | null; inUsd?: number | null; covered: number };
  };
  groups: Record<string, Group>;
  kinds?: [string, string, string][];
}
/** low/high: the 80% range when the table has its calibration (cover 0.8, held = measured coverage), else p25-p75 (cover 0.5) */
export interface BrainEstimate {
  n: number; label: string; min: Stats; usd: Stats; errMin: number | null; errUsd: number | null;
  cover: 0.8 | 0.5; held: { min: number; usd: number | null; n: number } | null; policy: string | null; version: string; area: string; kind: string;
}

const LABEL: Record<string, string> = { 'area+tipo': 'stessa area e tipo', tipo: 'stesso tipo', area: 'stessa area', tutte: 'tutte le chat' };

/** The kind a text names, with the rules the table carries (the brain's estimates.mjs KINDS); null for none. */
function kindWord(s: string, kinds: BrainTable['kinds']): string | null {
  for (const [k, src, flags] of kinds ?? []) { try { if (new RegExp(src, flags).test(s)) return k; } catch { /* a bad rule is skipped */ } }
  return null;
}

/** Area of a chat title, the same rule as the brain's estimates.mjs: "Alfa · …" → Alfa, "Pers · App: …" → "Pers · App",
 *  a label that names a kind ("Fix · …") → altro. */
export function areaOf(title: string, kinds: BrainTable['kinds']): string {
  const t = String(title ?? '').trim();
  if (/^regia\b/i.test(t)) return 'Regia';
  const m = t.match(/^([A-Za-zÀ-ú-]{2,12}) · (.*)$/);
  if (!m || kindWord(m[1]!, kinds)) return 'altro';
  return m[1] + (m[1] === 'Pers' && /^(App|second-brain)\b/i.test(m[2]!) ? ' · App' : '');
}

/** Kind of work: the label when it names one ("QA · …"), else the words after it. */
export function kindOf(title: string, kinds: BrainTable['kinds']): string {
  const t = String(title ?? ''), m = t.match(/^([^·]{1,14}) · (.*)$/);
  return (m && kindWord(m[1]!, kinds)) ?? kindWord(m ? m[2]! : t, kinds) ?? 'altro';
}

/** The app's placeholder titles say nothing about the job. */
const PLACEHOLDER = /^(Nuova chat|Fork)$/;

/** The estimate for a title along the grouping that measured best; null without a group of enough chats. */
export function lookup(t: BrainTable | null, title: string): BrainEstimate | null {
  if (!t?.groups) return null;
  const area = PLACEHOLDER.test(title.trim()) ? 'altro' : areaOf(title, t.kinds);
  const kind = PLACEHOLDER.test(title.trim()) ? 'altro' : kindOf(title, t.kinds);
  const key: Record<string, string> = { 'area+tipo': `area+tipo:${area}|${kind}`, tipo: `tipo:${kind}`, area: `area:${area}`, tutte: 'tutte' };
  const r = t.best?.range80, qMin = r?.qMin, qUsd = r?.qUsd;
  const ok = (q: number | null | undefined): q is number => typeof q === 'number' && Number.isFinite(q);
  const cal = ok(qMin) && ok(qUsd);
  // the same floors as the brain's policy (ops/improve/policies/estimates.mjs): 0.5 min, 0.05 $
  const around = (s: Stats, q: number, floor: number): Stats => ({ low: Math.max(s.mid, floor) * Math.exp(-q), mid: s.mid, high: Math.max(s.mid, floor) * Math.exp(q) });
  for (const g of t.best?.order ?? ['area+tipo', 'tipo', 'area', 'tutte']) {
    const x = t.groups[key[g] ?? ''];
    if (!x) continue;
    return {
      n: x.n, label: LABEL[g] ?? g, area, kind,
      min: cal ? around(x.min, qMin, 0.5) : x.min, usd: cal ? around(x.usd, qUsd, 0.05) : x.usd,
      errMin: t.best?.errMin ?? null, errUsd: t.best?.errUsd ?? null, policy: t.best?.name ?? null, version: t.updated,
      cover: cal ? 0.8 : 0.5, held: cal && typeof r?.inMin === 'number' && r.covered > 0 ? { min: r.inMin, usd: typeof r.inUsd === 'number' ? r.inUsd : null, n: r.covered } : null,
    };
  }
  return null;
}

/** ONE estimator (2026-10-13): with the brain's table the estimate is the brain's, or "stima senza dati" when it has
 *  no group of enough chats; the app ledger's keyword estimate is only the fallback without a brain table. The brain's
 *  covers every past chat (not only those run in the app), has real work time, and states its measured error. */
export function withBrain(e: EstimateResult, b: BrainEstimate | null, hasTable = false): EstimateResult {
  if (!b) return hasTable ? { ...e, estimate: null, basis: { count: 0, scope: 'brain:none', label: 'stima senza dati: meno di 5 chat simili' } } : e;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    ...e,
    estimate: {
      usdLow: r2(b.usd.low), usdHigh: r2(b.usd.high), minLow: Math.round(b.min.low), minHigh: Math.round(b.min.high), from: 'brain', label: b.label, errMin: b.errMin, errUsd: b.errUsd,
      usdMid: r2(b.usd.mid), minMid: Math.round(b.min.mid), cover: b.cover, held: b.held,
      // what the brain's loop records: the policy's own numbers and the table they came from (not the UI's rounding)
      pred: { policy: b.policy, version: b.version, min: b.min, usd: b.usd },
    },
    basis: { count: b.n, scope: `brain:${b.label}`, label: `da ${b.n} chat passate: ${b.label}` },
  };
}

/** A chat's estimate as the brain's self-improvement loop records it (ops/improve/lib.mjs observe(): one JSON line in
 *  <brain>/ops/state/improve/outcomes.jsonl). Written once per job at its first turn end, with `at` = when the job
 *  started, so the prediction is the one made BEFORE the chat ran; estimates.mjs --update adds the measured outcome.
 *  Only the prompt's length, never its text. Null when the estimate is not the brain's (nothing to learn from). */
export interface PredictionInput { id: string; at: number; harness: Harness; model: string | null; effort: Effort | null; title: string; promptChars: number | null; estimate: Estimate | null }
export function predictionLine(p: PredictionInput, t: BrainTable | null): Record<string, unknown> | null {
  const e = p.estimate, x = e?.pred;
  if (!t || e?.from !== 'brain' || !x) return null;
  if (!/^[\w:.-]{1,120}$/.test(p.id) || !Number.isFinite(p.at)) return null;
  const placeholder = PLACEHOLDER.test(p.title.trim());
  return {
    id: p.id, at: p.at, domain: 'estimates',
    item: { harness: p.harness, model: p.model, effort: p.effort, area: placeholder ? 'altro' : areaOf(p.title, t.kinds), kind: placeholder ? 'altro' : kindOf(p.title, t.kinds), promptChars: p.promptChars },
    predicted: {
      policy: x.policy, version: x.version, cover: e.cover ?? 0.5,
      value: { min: x.min.mid, usd: x.usd.mid }, low: { min: x.min.low, usd: x.usd.low }, high: { min: x.min.high, usd: x.usd.high },
    },
    ts: Date.now(),
  };
}

export const REFRESH_DELAY = 60e3, REFRESH_MIN_GAP = 5 * 60e3;

/** Reads the brain's table (re-read only when the file changes) and refreshes it after turns end. */
export class BrainEstimates {
  private cached: { mtime: number; t: BrainTable | null } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRun = 0;

  constructor(private root: () => string | null, private node: NodeRunner) {}

  private file(): string | null { const r = this.root(); return r ? path.join(r, 'ops', 'state', 'estimates.json') : null; }
  private script(): string | null { const r = this.root(); const s = r ? path.join(r, 'ops', 'tools', 'estimates.mjs') : null; return s && fs.existsSync(s) ? s : null; }

  table(): BrainTable | null {
    const f = this.file();
    if (!f) return null;
    let mtime: number;
    try { mtime = fs.statSync(f).mtimeMs; } catch { return null; }
    if (this.cached?.mtime !== mtime) {
      let t: BrainTable | null = null;
      try { t = JSON.parse(fs.readFileSync(f, 'utf8')) as BrainTable; } catch { /* being written: next time */ }
      this.cached = { mtime, t };
    }
    return this.cached.t;
  }

  estimate(title: string | undefined): BrainEstimate | null {
    return title ? lookup(this.table(), title) : null;
  }

  /** Appends the job's pre-run prediction to the brain's outcomes.jsonl (once per id: the brain keeps the first). */
  recordPrediction(p: PredictionInput): boolean {
    const r = this.root(), line = predictionLine(p, this.table());
    if (!r || !line) return false;
    const file = path.join(r, 'ops', 'state', 'improve', 'outcomes.jsonl');
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
      return true;
    } catch (e) {
      log.warn('brain', 'estimate prediction not recorded', { cause: e instanceof Error ? e.message : String(e), hint: 'check that <brain>/ops/state/improve is writable' });
      return false;
    }
  }

  /** A turn ended: rescan a little later (turns of several chats collapse into one run), never more than every 5 min. */
  schedule(now = Date.now()): void {
    if (this.timer || !this.script()) return;
    const wait = Math.max(REFRESH_DELAY, this.lastRun + REFRESH_MIN_GAP - now);
    this.timer = setTimeout(() => { this.timer = null; void this.refresh(); }, wait);
    this.timer.unref?.();
  }

  async refresh(): Promise<boolean> {
    const script = this.script(), root = this.root();
    if (!script || !root || this.running) return false;
    this.running = true; this.lastRun = Date.now();
    try {
      const r = await runNode(this.node, script, ['--update'], root, 300e3);
      if (r.code !== 0) log.warn('brain', 'estimates.mjs --update failed', { data: { code: r.code, error: r.error, stderr: r.stderr.slice(0, 300) } });
      return r.code === 0;
    } finally { this.running = false; }
  }

  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
