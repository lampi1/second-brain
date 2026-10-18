// The brain's own table (<brain>/ops/state/estimates.json, written by ops/tools/estimates.mjs from every past
// transcript: real work time, $, the chat title's area and kind). ADR 0053 removed the user-facing cost/time estimate
// (measured on 178 chats it held only 47% of the time with a bigger median error than the median cost); what is left
// here feeds the model-routing table (brain/routing.ts): the kind/area rules (areaOf, used by routeChat and isAppChat)
// and the refreshed table itself (table(), schedule(), run a little after each turn ends, at most every 5 minutes, by
// brain/index.ts's recordJob). No model is ever called: the table is refreshed by running the script (incremental,
// < 1 s warm).
import { timersFor } from '../timers';
const { setTimeout, clearTimeout } = timersFor('brain/brain-estimates');
import fs from 'node:fs';
import path from 'node:path';
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
