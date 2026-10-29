// The user's corrections, counted by the app itself (ADR 0197). Why: the Qualità card «Errori che hai dovuto trovare
// tu» read only ai-errors.md rows whose «visto da» named the owner, and the agents rarely write his name (186 rows had
// none), so it showed 0 every day while he corrected agents all the time (owner, 2026-10-29: «in questi ho sempre
// zero»). Here every message the user sends to a chat (chat:send) is classified when it is sent, zero tokens:
// «Correggi il pensiero» (the tag, shared/correction.ts), else the same decision as the brain's correction-catch hook
// (the local semantic detector, search/hybrid/corrections.ts, when its model is warm; the hook's CORRECTION regex
// otherwise; a CONFUSION-only match, «non capisco», is a question, not an error, and never counts here). A correction
// to a run whose agent had already reported is its own bucket (the run's `corrections.afterReport`, written here at
// last). Only counts per Rome day are kept, plus the titles of the chats corrected that day (to match ai-errors.md rows
// with no «visto da»), in userData/user-corrections.json for 90 days: never the message text. Read by brain/quality.ts
// (/api/quality); wired in wiring.ts and index.ts ('chat:send'). Unit tests: test/unit/brain/user-corrections.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentRun } from '../../shared/agents';
import type { UserCorrectionDay, UserCorrections } from '../../shared/contract';
import { isCorrection as isTagged } from '../../shared/correction';
import { log, errText } from '../log';

/** Copy of the brain template's ops/tools/signals-regex.mjs CORRECTION (the hook's fallback), pinned equal by the test. */
export const CORRECTION = /\b(no[,.!]|no$|non (così|va|è|devi|serve|funziona)(?![\wàèéìòù])|ti ho (già )?detto|te l'ho detto|sbagliat|di nuovo|ancora una volta|ma (perché|come mai)|mai più|ricordati|smett|basta\b)/i;

export const KEEP_DAYS = 90;
const CHATS_PER_DAY = 30;
const SAVE_DELAY_MS = 2000;

const romeDay = (t: number): string => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));

/** The user's own words: the app's bracketed notes and the correction tag line (paragraphs that start with «[») are not. */
export function ownWords(text: string): string {
  return String(text ?? '').replace(/\r\n/g, '\n').split(/\n\s*\n/)
    .map(p => p.trimStart().startsWith('[') ? p.split('\n').filter(l => !l.trimStart().startsWith('[')).join('\n') : p)
    .join('\n\n').trim();
}

export type MessageKind = 'tagged' | 'afterReport' | 'recognized' | 'none';
export interface MessageClass { kind: MessageKind; semantic: boolean }
/** The semantic detector's answer (search/hybrid/corrections.ts): ready false = not warm, busy or slow. */
export type Detect = (text: string) => Promise<{ ready: boolean; correction: boolean }>;

/** One message: the tag first; then the semantic detector when ready, else the hook's regex; `reported` = it went to a
 *  run whose agent had already reported. A detector failure falls back to the regex, never to "no". */
export async function classifyMessage(text: string, reported: boolean, detect?: Detect): Promise<MessageClass> {
  if (typeof text !== 'string' || !text.trim()) return { kind: 'none', semantic: false };
  if (isTagged(text)) return { kind: 'tagged', semantic: false };
  const own = ownWords(text);
  if (!own) return { kind: 'none', semantic: false };
  let semantic: boolean | null = null;
  if (detect) { try { const r = await detect(own); if (r.ready) semantic = r.correction; } catch { semantic = null; } }
  // the hook's rule: the semantic yes adds corrections the regex misses; an explicit regex match always counts
  const yes = semantic === true || CORRECTION.test(own);
  if (!yes) return { kind: 'none', semantic: semantic !== null };
  return { kind: reported ? 'afterReport' : 'recognized', semantic: semantic === true };
}

const emptyDay = (date: string): UserCorrectionDay => ({ date, messages: 0, tagged: 0, afterReport: 0, recognized: 0, semantic: 0, chats: [] });
const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);

/** The file's days, kept only when well formed. */
export function parseDays(text: string): { since: string | null; days: UserCorrectionDay[] } {
  const o = JSON.parse(text) as { since?: unknown; days?: unknown };
  const days = (Array.isArray(o.days) ? o.days : []).filter((d): d is Record<string, unknown> => !!d && typeof d === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String((d as { date?: unknown }).date)))
    .map(d => ({ date: String(d.date), messages: count(d.messages), tagged: count(d.tagged), afterReport: count(d.afterReport), recognized: count(d.recognized), semantic: count(d.semantic),
      chats: (Array.isArray(d.chats) ? d.chats : []).filter((c): c is string => typeof c === 'string').map(c => c.slice(0, 200)).slice(0, CHATS_PER_DAY) }));
  return { since: typeof o.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.since) ? o.since : null, days };
}

/** The runs' own correction counters by the Rome day each run started (only runs that count them: `corrections` set). */
export function runCorrectionsByDay(runs: readonly Pick<AgentRun, 'startedAt' | 'corrections'>[]): UserCorrections['runs'] {
  const m = new Map<string, { date: string; tagged: number; afterReport: number }>();
  for (const r of runs) {
    const c = r.corrections;
    if (!c || c.tagged + c.afterReport === 0 || !Number.isFinite(r.startedAt)) continue;
    const d = romeDay(r.startedAt), row = m.get(d) ?? { date: d, tagged: 0, afterReport: 0 };
    row.tagged += c.tagged; row.afterReport += c.afterReport;
    m.set(d, row);
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface UserCorrectionDeps {
  file: string;
  detect?: Detect;
  runs: () => readonly AgentRun[];
  now?: () => number;
}

/** The per-day store. `note` never throws: a lost count is logged, the send already happened. */
export class UserCorrectionStore {
  private days = new Map<string, UserCorrectionDay>();
  private since: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  constructor(private readonly d: UserCorrectionDeps) {
    this.now = d.now ?? Date.now;
    try {
      const f = parseDays(fs.readFileSync(d.file, 'utf8'));
      this.since = f.since;
      for (const day of f.days) this.days.set(day.date, day);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('quality', 'user corrections file unreadable', { cause: errText(e), hint: 'counting starts again today; the old file is replaced on the next message' });
    }
  }

  /** The user sent `text` to chat `chat` (its title); `reportedRunId` = the run whose agent had reported before it.
   *  Returns the class (tests), after counting it. */
  async note(text: string, chat: { title: string; reportedRunId: string | null }, onAfterReport?: (runId: string) => void): Promise<MessageClass> {
    try {
      const c = await classifyMessage(text, !!chat.reportedRunId, this.d.detect);
      const date = romeDay(this.now()), day = this.days.get(date) ?? emptyDay(date);
      this.since ??= date;
      day.messages++;
      if (c.kind !== 'none') {
        day[c.kind]++;
        if (c.semantic) day.semantic++;
        const title = String(chat.title ?? '').trim().slice(0, 200);
        if (title && !day.chats.includes(title) && day.chats.length < CHATS_PER_DAY) day.chats.push(title);
        if (c.kind === 'afterReport' && chat.reportedRunId) onAfterReport?.(chat.reportedRunId);
      }
      this.days.set(date, day);
      this.schedule();
      return c;
    } catch (e) {
      log.warn('quality', 'user message not counted', { cause: errText(e), hint: 'the Qualità page misses this one message; nothing else is affected' });
      return { kind: 'none', semantic: false };
    }
  }

  /** What /api/quality hands the page. */
  summary(): UserCorrections {
    let runs: readonly AgentRun[] = [];
    try { runs = this.d.runs(); } catch { runs = []; }
    return { since: this.since, byDay: [...this.days.values()].sort((a, b) => a.date.localeCompare(b.date)), runs: runCorrectionsByDay(runs) };
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, SAVE_DELAY_MS);
    this.timer.unref?.();
  }

  /** Writes now (also at shutdown): the last KEEP_DAYS days, atomically. */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const cut = romeDay(this.now() - KEEP_DAYS * 864e5);
    for (const k of [...this.days.keys()]) if (k < cut) this.days.delete(k);
    try {
      fs.mkdirSync(path.dirname(this.d.file), { recursive: true });
      const tmp = `${this.d.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ since: this.since, days: [...this.days.values()].sort((a, b) => a.date.localeCompare(b.date)) }));
      fs.renameSync(tmp, this.d.file);
    } catch (e) {
      log.warn('quality', 'user corrections not saved', { cause: errText(e), hint: 'check that userData is writable; the counts stay in memory until the app closes' });
    }
  }
}
