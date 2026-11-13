// Flash's outcomes (ADR 0131): Flash (the read-only quick lane, ADR 0105) records no AgentRun, so it could never earn XP.
// Each answer now gets a lightweight outcome from what the user does next, with no model call and no prompt: within
// FLASH_SETTLE_MS of the answer, a correction to Flash («no, …», the "Correggi il pensiero" tag) or the same question
// again (re-asked) is a fail, the same question handed to the Orchestrator (typed, or «Fanne un lavoro») a partial (Flash
// is meant to send work there); otherwise the answer held: a success. It is an observed proxy, so it weighs little
// (TRUST.quick 0.3 on the performance) and earns little (FLASH_XP per success). A question is kept only as hashes of its
// words (never its text), bounded: FLASH_OPEN answers waiting, FLASH_DONE recent outcomes, totals beyond. Stored in
// agent-runs.json `flash` (runs.ts AgentRunStore); ChatManager feeds the events; standing.ts reads it.
import { isCorrection } from '../../shared/correction';

/** the window in which what the user does next decides the answer */
export const FLASH_SETTLE_MS = 5 * 60_000;
export const FLASH_OPEN = 20;
export const FLASH_DONE = 300;
const SIG_MAX = 32;
/** re-asked: this share of the question's words come back in the next question (and the other way round) */
export const REASK_OVERLAP = 0.6;
/** handed: this share of the question's words are in the Orchestrator's message */
export const HANDED_OVERLAP = 0.6;
/** a question this short says too little to compare */
const SIG_MIN = 3;

export type FlashVerdict = 'success' | 'partial' | 'fail';
export type FlashWhy = 'held' | 'corrected' | 'reasked' | 'handed';
export interface FlashOpen { askedAt: number; answeredAt: number; sig: string[] }
export interface FlashDone { at: number; verdict: FlashVerdict; why: FlashWhy }
export interface FlashLog {
  version: 1;
  /** the question being answered now */
  asking?: { at: number; sig: string[] };
  open: FlashOpen[];
  /** newest last */
  done: FlashDone[];
  /** every settled outcome, also the ones that fell out of `done` */
  total: { success: number; partial: number; fail: number };
}
export const emptyFlashLog = (): FlashLog => ({ version: 1, open: [], done: [], total: { success: 0, partial: 0, fail: 0 } });

/** a short, stable hash of one word (FNV-1a 32): the question is compared, never kept */
function hash(w: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
/** The words of a text that say something (3+ letters), hashed, unique, at most SIG_MAX. */
export function signature(text: string): string[] {
  const words = text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(words.map(hash))].slice(0, SIG_MAX);
}
/** the share of `a`'s words that are in `b` */
const within = (a: readonly string[], b: readonly string[]): number => { if (!a.length) return 0; const s = new Set(b); return a.filter(w => s.has(w)).length / a.length; };
/** a reply that says the answer was wrong (it, en, de), or the correction tag */
const NO = /^\s*(no[,.!:;\s]|non (è|e'|era) (cos[iì]|vero|giusto|corretto)|sbagliat|errat|non hai capito|wrong|that'?s not|not (right|correct|true)|incorrect|nein[,.!\s]|falsch|stimmt nicht)/i;
export const saysWrong = (text: string): boolean => isCorrection(text) || NO.test(text);

function settle(log: FlashLog, o: FlashOpen, verdict: FlashVerdict, why: FlashWhy, at: number): void {
  log.open = log.open.filter(x => x !== o);
  log.done.push({ at, verdict, why });
  if (log.done.length > FLASH_DONE) log.done.splice(0, log.done.length - FLASH_DONE);
  log.total[verdict]++;
}
/** Answers whose window passed with nothing against them: they held. */
export function settleDue(log: FlashLog, now: number): void {
  for (const o of [...log.open]) if (now - o.answeredAt >= FLASH_SETTLE_MS) settle(log, o, 'success', 'held', o.answeredAt + FLASH_SETTLE_MS);
}
/** The open answers still in their window, newest first. */
const live = (log: FlashLog, now: number): FlashOpen[] => log.open.filter(o => now - o.answeredAt < FLASH_SETTLE_MS).sort((a, b) => b.answeredAt - a.answeredAt);

/** The user asked Flash: a correction or the same question again decides the last answer; then this question waits. */
export function flashAsked(log: FlashLog, text: string, now: number): void {
  settleDue(log, now);
  const sig = signature(text), last = live(log, now)[0];
  if (last) {
    if (saysWrong(text)) settle(log, last, 'fail', 'corrected', now);
    else if (sig.length >= SIG_MIN && last.sig.length >= SIG_MIN && within(last.sig, sig) >= REASK_OVERLAP && within(sig, last.sig) >= REASK_OVERLAP) settle(log, last, 'fail', 'reasked', now);
  }
  log.asking = { at: now, sig };
}
/** Flash's turn ended with an answer to the waiting question. */
export function flashAnswered(log: FlashLog, now: number): void {
  settleDue(log, now);
  const q = log.asking;
  if (!q) return;
  delete log.asking;
  log.open.push({ askedAt: q.at, answeredAt: now, sig: q.sig });
  if (log.open.length > FLASH_OPEN) log.open.splice(0, log.open.length - FLASH_OPEN);
}
/** The user wrote to the Orchestrator: an open answer whose question is in it was handed over. */
export function flashHanded(log: FlashLog, text: string, now: number): void {
  settleDue(log, now);
  const sig = signature(text);
  const o = live(log, now).find(x => x.sig.length >= SIG_MIN && within(x.sig, sig) >= HANDED_OVERLAP);
  if (o) settle(log, o, 'partial', 'handed', now);
}

/** «Fanne un lavoro» (ADR 0209): the user asked Flash for the Orchestrator's brief; its newest open answer is handed over. */
export function flashBriefed(log: FlashLog, now: number): void {
  settleDue(log, now);
  const o = live(log, now)[0];
  if (o) settle(log, o, 'partial', 'handed', now);
}

const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const sigOk = (v: unknown): v is string[] => Array.isArray(v) && v.length <= SIG_MAX && v.every(w => typeof w === 'string' && /^[0-9a-z]{1,8}$/.test(w));
const VERDICTS: readonly FlashVerdict[] = ['success', 'partial', 'fail'];
const WHYS: readonly FlashWhy[] = ['held', 'corrected', 'reasked', 'handed'];
/** A stored log, or a fresh one when out of shape (never a reason to refuse agent-runs.json): entries out of shape go. */
export function readFlashLog(v: unknown): FlashLog {
  const r = v as Record<string, unknown> | null, out = emptyFlashLog();
  if (!r || typeof r !== 'object' || r.version !== 1) return out;
  const t = r.total as Record<string, unknown> | null;
  if (t && typeof t === 'object' && count(t.success) && count(t.partial) && count(t.fail)) out.total = { success: t.success, partial: t.partial, fail: t.fail };
  const a = r.asking as Record<string, unknown> | null;
  if (a && typeof a === 'object' && count(a.at) && sigOk(a.sig)) out.asking = { at: a.at, sig: [...a.sig] };
  if (Array.isArray(r.open)) for (const o of r.open.slice(-FLASH_OPEN) as Record<string, unknown>[]) {
    if (o && count(o.askedAt) && count(o.answeredAt) && sigOk(o.sig)) out.open.push({ askedAt: o.askedAt, answeredAt: o.answeredAt, sig: [...o.sig] });
  }
  if (Array.isArray(r.done)) for (const d of r.done.slice(-FLASH_DONE) as Record<string, unknown>[]) {
    if (d && count(d.at) && VERDICTS.includes(d.verdict as FlashVerdict) && WHYS.includes(d.why as FlashWhy)) out.done.push({ at: d.at, verdict: d.verdict as FlashVerdict, why: d.why as FlashWhy });
  }
  // the totals hold at least what is listed (a hand-edited file)
  for (const k of VERDICTS) out.total[k] = Math.max(out.total[k], out.done.filter(d => d.verdict === k).length);
  return out;
}
