// The job ledger: a job = one chat started with a prompt, kept with its real cost and time (ADR 0053 removed the
// per-job cost/time estimate once shown next to them: measured on 178 chats it held only 47% of the time with a
// bigger median error than the median cost). The ledger is a JSON-lines file behind a pluggable store (default
// userData/jobs.jsonl). It starts from day one with a backfill from the brain's cost.mjs (per-chat $ and
// first-to-last-message span of the last 30 days). The prompt text is never stored: only its length and kind of work
// (shared/work-concepts.ts taskOf, the routing table's own kinds: ADR 0182; an older row's own kind is mapped on load). Used by brain/index.ts for 'estimate:record'; the chat manager records
// jobs and their actuals; the brain's estimates.mjs reads jobs.jsonl for its own routing table (brain-estimates.ts).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Effort, Harness, JobActual, JobRecordInput, TaskKind } from '../../shared/contract';
import { fromLedgerKind, taskOf, WORK_KINDS } from '../../shared/work-concepts';
import { log } from '../log';
import { runNode, type NodeRunner } from './node';
import { brainScript } from '../rules/tools';
import { engineOf, engines } from '../engines/registry';

// ── ledger ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface JobRecord {
  id: string;
  at: number;
  harness: Harness;
  model: string | null;
  effort: Effort | null;
  kind: TaskKind;
  promptChars: number | null;
  actual: JobActual | null;
  source: 'app' | 'backfill';
}

/** Where the ledger lives. Append-only JSON lines; the last line of an id wins. */
export interface JobStore { load(): JobRecord[]; append(r: JobRecord): void }

export class FileJobStore implements JobStore {
  constructor(readonly file: string) {}
  load(): JobRecord[] {
    let text = '';
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { return []; }
    const byId = new Map<string, JobRecord>();
    for (const l of text.split(/\r?\n/)) {
      if (!l.trim()) continue;
      try { const r = JSON.parse(l) as JobRecord; if (r && typeof r.id === 'string') byId.set(r.id, { ...r, kind: fromLedgerKind(r.kind) }); } catch { /* partial line */ }
    }
    return [...byId.values()];
  }
  append(r: JobRecord): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, `${JSON.stringify(r)}\n`);
  }
}

// ── backfill from cost.mjs ──────────────────────────────────────────────────────────────────────────────────────────
export const BACKFILL_DAYS = 30;
export const MAX_SPAN_MIN = 8 * 60; // a longer first-to-last span is a chat left open, not working time: no duration

/** cost.mjs --days N --json → past Claude jobs (one per chat). Chats possibly cut by the window start or still active
 *  (last message within the hour) are left out; a later backfill picks them up. */
export function backfillFromCost(j: unknown, o: { now: number; windowStartMs: number }): JobRecord[] {
  if (!j || typeof j !== 'object') return [];
  const chats = (j as { chats?: unknown }).chats;
  if (!chats || typeof chats !== 'object') return [];
  const out: JobRecord[] = [];
  for (const [sid, c] of Object.entries(chats as Record<string, Record<string, unknown>>)) {
    const usd = Number(c?.usd), from = Number(c?.from), to = Number(c?.to);
    if (!(usd > 0.005) || !Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (from < o.windowStartMs + 864e5 || to > o.now - 3600e3) continue;
    const title = String(c.title ?? '');
    const span = Math.max(1, Math.round((to - from) / 6e4));
    out.push({
      id: `claude:${sid}`, at: from, harness: 'claude', model: null, effort: null,
      kind: /^[0-9a-f]{8}$/.test(title) ? 'altro' : taskOf(title, '', undefined), promptChars: null,
      actual: { usd: Math.round(usd * 1000) / 1000, minutes: span <= MAX_SPAN_MIN ? span : null, tokensIn: null, tokensOut: null, turns: null },
      source: 'backfill',
    });
  }
  return out;
}

// ── input validation (the renderer sends it) ────────────────────────────────────────────────────────────────────────
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const n0 = (v: unknown, f: string): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`${f}: numero ≥ 0`);
  return v;
};
function checkActual(a: unknown): JobActual | null {
  if (a === null || a === undefined) return null;
  const x = a as Record<string, unknown>;
  return { usd: n0(x.usd, 'actual.usd') ?? 0, minutes: n0(x.minutes, 'actual.minutes'), ...(x.minutesKind === 'work' ? { minutesKind: 'work' as const } : {}), tokensIn: n0(x.tokensIn, 'actual.tokensIn'), tokensOut: n0(x.tokensOut, 'actual.tokensOut'), turns: n0(x.turns, 'actual.turns') };
}
export function checkHarness(h: unknown): Harness { if (typeof h !== 'string' || !engineOf(h)) throw new Error(`harness: ${engines().map(e => e.id).join(' | ')}`); return h; }
export function checkModel(m: unknown): string | null { if (m === null || m === undefined || m === '') return null; if (typeof m !== 'string' || m.length > 120) throw new Error('model: testo breve o null'); return m; }
export function checkEffort(e: unknown): Effort | null { if (e === null || e === undefined) return null; if (!EFFORTS.includes(e as Effort)) throw new Error('effort: low | medium | high | xhigh | max'); return e as Effort; }

export class Ledger {
  private jobs = new Map<string, JobRecord>();
  private backfilling = false;

  constructor(private store: JobStore, private metaFile: string | null = null) {
    for (const r of store.load()) this.jobs.set(r.id, r);
  }

  all(): JobRecord[] { return [...this.jobs.values()]; }

  /** Insert or update (same id: fields given override, the first time `at` stays). Claude jobs should use the id
   *  `claude:<sessionId>`, so the cost.mjs backfill and the app describe the same job once. */
  record(input: JobRecordInput, now = Date.now()): { id: string } {
    if (!input || typeof input !== 'object') throw new Error('lavoro: oggetto atteso');
    if (input.id !== undefined && (typeof input.id !== 'string' || !/^[\w:.-]{1,120}$/.test(input.id))) throw new Error('id: lettere, cifre, : . _ -');
    if (input.prompt !== undefined && (typeof input.prompt !== 'string' || input.prompt.length > 2e6)) throw new Error('prompt: testo');
    if (input.kind !== undefined && !(WORK_KINDS as readonly string[]).includes(input.kind)) throw new Error(`kind: ${WORK_KINDS.join(' | ')}`);
    const id = input.id ?? `job_${crypto.randomUUID()}`;
    const old = this.jobs.get(id);
    const r: JobRecord = {
      id, at: old?.at ?? now,
      harness: checkHarness(input.harness ?? old?.harness),
      model: input.model !== undefined ? checkModel(input.model) : old?.model ?? null,
      effort: input.effort !== undefined ? checkEffort(input.effort) : old?.effort ?? null,
      kind: input.kind ?? (input.prompt !== undefined ? taskOf('', input.prompt, undefined) : old?.kind ?? 'altro'),
      promptChars: input.prompt !== undefined ? input.prompt.length : old?.promptChars ?? null,
      actual: input.actual !== undefined ? checkActual(input.actual) : old?.actual ?? null,
      source: 'app',
    };
    this.jobs.set(id, r);
    this.store.append(r);
    return { id };
  }

  /** Imports past Claude chats from cost.mjs (at most once every 20 h). Never overwrites a job recorded by the app. */
  async backfill(root: string | null, node: NodeRunner, now = Date.now()): Promise<{ added: number; skipped: string | null }> {
    if (this.backfilling) return { added: 0, skipped: 'già in corso' };
    const script = root ? brainScript(root, 'ops/tools/cost.mjs') : null;
    if (!script || !fs.existsSync(script)) return { added: 0, skipped: 'il brain non ha ops/tools/cost.mjs' };
    let meta: { backfillAt?: number } = {};
    if (this.metaFile) try { meta = JSON.parse(fs.readFileSync(this.metaFile, 'utf8')) as typeof meta; } catch { /* first time */ }
    if (meta.backfillAt && now - meta.backfillAt < 20 * 3600e3) return { added: 0, skipped: 'fatto da meno di 20 ore' };
    this.backfilling = true;
    try {
      const r = await runNode(node, script, ['--days', String(BACKFILL_DAYS), '--json', '--no-cursor', '--summary'], root!, 300e3);
      let j: unknown = null;
      try { j = JSON.parse(r.stdout); } catch { /* below */ }
      if (!j) {
        log.warn('brain', r.killed ? 'estimates backfill: cost.mjs timed out after 300 s' : 'estimates backfill: cost.mjs gave no JSON', { data: { code: r.code, error: r.error, signal: r.signal ?? null, stderr: r.stderr.slice(0, 300) } });
        return { added: 0, skipped: r.killed ? 'cost.mjs troppo lento' : 'cost.mjs senza risposta' };
      }
      const from = Date.parse(`${String((j as { from?: unknown }).from ?? '')}T00:00:00+02:00`);
      const rows = backfillFromCost(j, { now, windowStartMs: Number.isFinite(from) ? from : now - BACKFILL_DAYS * 864e5 });
      let added = 0;
      for (const row of rows) {
        const old = this.jobs.get(row.id);
        if (old?.source === 'app') continue;
        if (old && JSON.stringify(old.actual) === JSON.stringify(row.actual) && old.kind === row.kind) continue;
        this.jobs.set(row.id, row);
        this.store.append(row);
        added++;
      }
      if (this.metaFile) try { fs.writeFileSync(this.metaFile, JSON.stringify({ backfillAt: now })); } catch { /* best effort */ }
      log.info('brain', 'estimates backfill done', { data: { chats: rows.length, added } });
      return { added, skipped: null };
    } finally { this.backfilling = false; }
  }
}
