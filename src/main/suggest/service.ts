// The model part of the chat composer's inline suggestion (issue #167, ADR 0118). Why: typing a prompt is slow and
// repetitive; the renderer first tries its own zero-token sources (renderer/lib/composer-suggest.ts) and asks here only
// when they give nothing, after a typing pause. One call is small by construction: the smallest model (the brain's
// light tier on the Anthropic API engine, else Haiku), the line being typed and the chat's last message only (both cut
// and scrubbed of anything that looks like a credential, headline.ts scrub), at most SUGGEST_MAX_OUT output tokens,
// one request in flight per chat (a newer one, or the next key through cancel(), aborts it), and a cache per prefix
// that also serves the rest of an answer the user is typing along (zero tokens). A daily budget (settings
// suggestDailyUsd) stops the calls for the day; the spend is counted here (today, for Costi and Settings) and, as for
// every API call, in the month's engine spend (engines/text.ts). Never a call with suggestOn or suggestModel off, and
// never under SB_TEST, VITEST or SB_DEMO (calls: false from index.ts). State in <userData>/suggest.json (no prompts,
// only today's counters). Unit-tested in test/unit/suggest-service.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import {
  SUGGEST_LAST_MAX, SUGGEST_LINE_MAX, SUGGEST_MAX_OUT, SUGGEST_MODEL_MIN_LINE, continueCached,
  type SuggestAnswer, type SuggestRequest, type SuggestState,
} from '../../shared/composer-suggest';
import type { TextRequest, TextResult } from '../engines/text';
import { scrub } from '../headline';
import { errText, log } from '../log';

export const SUGGEST_FALLBACK_MODEL = 'claude-haiku-4-5';
const CACHE_MAX = 300;
const TIMEOUT_MS = 8_000;
/** list price of the smallest model per token, used only when an answer has no price (so the budget still holds) */
const EST_IN = 1 / 1e6, EST_OUT = 5 / 1e6;

export const SUGGEST_SYSTEM = [
  'You are the inline autocomplete of a chat input, like an IDE completion.',
  'Reply with ONLY the text that continues the current line right after its last character: a few words, at most one short sentence.',
  'Same language as the line. No quotes, no explanation, no line breaks. Start with a space when a new word begins.',
  'If there is no likely continuation, reply with a single "-".',
].join('\n');

export interface SuggestDeps {
  file: string;
  complete: (req: TextRequest, signal?: AbortSignal) => Promise<TextResult>;
  /** on = the whole feature (suggestOn), modelOn = its model part (suggestModel), dailyUsd = suggestDailyUsd */
  settings: () => { on: boolean; modelOn: boolean; dailyUsd: number };
  model: () => string;
  /** false = never calls a model (tests, demo) */
  calls: boolean;
  now?: () => number;
  timeoutMs?: number;
}

interface Day { day: string; calls: number; usd: number; cacheHits: number }
interface Entry { last: string; line: string; answer: string }

const dayOf = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** The model's answer → the suffix to show, or '' when it has nothing (a "-", empty, or only the line repeated). */
export function cleanAnswer(raw: string, line: string): string {
  let a = (raw.split(/\r?\n/).find(l => l.trim()) ?? '').replace(/\s+$/, '');
  a = a.replace(/^["«“'`]+|["»”'`]+$/g, '');
  if (a.trim() === '-' || !a.trim()) return '';
  // a model that wrote the whole line again: keep what comes after it
  const tail = line.trimStart();
  if (tail && a.trimStart().toLowerCase().startsWith(tail.toLowerCase()) && a.trim().length > tail.length) a = a.trimStart().slice(tail.length);
  // a line that already ends in a space needs no second one
  if (/\s$/.test(line)) a = a.trimStart();
  return a.trim() ? a.slice(0, SUGGEST_MAX_OUT * 3) : '';
}

export class ComposerSuggest {
  private today: Day;
  private cache = new Map<string, Entry>();
  private inflight = new Map<string, AbortController>();

  constructor(private readonly d: SuggestDeps) {
    this.today = { day: dayOf(this.now()), calls: 0, usd: 0, cacheHits: 0 };
    try {
      const raw = JSON.parse(fs.readFileSync(d.file, 'utf8')) as Partial<Day>;
      if (raw.day === this.today.day) this.today = { day: raw.day, calls: num(raw.calls), usd: num(raw.usd), cacheHits: num(raw.cacheHits) };
    } catch { /* first run or a broken file: today starts at zero */ }
  }

  private now(): number { return (this.d.now ?? Date.now)(); }
  private day(): Day {
    const day = dayOf(this.now());
    if (this.today.day !== day) this.today = { day, calls: 0, usd: 0, cacheHits: 0 };
    return this.today;
  }

  state(): SuggestState {
    const t = this.day(), s = this.d.settings();
    return { day: t.day, calls: t.calls, usd: Math.round(t.usd * 1e6) / 1e6, cacheHits: t.cacheHits, budgetUsd: s.dailyUsd, modelOn: s.on && s.modelOn, model: this.d.model() };
  }

  /** The next key in that chat's input: its request in flight (if any) is aborted, its answer ignored. */
  cancel(chatId: string): void {
    const c = this.inflight.get(chatId);
    if (c) { c.abort(); this.inflight.delete(chatId); }
  }

  private lookup(last: string, line: string): string | null | undefined {
    const exact = this.cache.get(`${last}\u0000${line}`);
    if (exact) { this.touch(exact); return exact.answer || null; }
    for (const e of this.cache.values()) {
      if (e.last !== last || !e.answer) continue;
      const rest = continueCached(e.line, e.answer, line);
      if (rest) return rest;
    }
    return undefined;
  }

  private touch(e: Entry): void { const k = `${e.last}\u0000${e.line}`; this.cache.delete(k); this.cache.set(k, e); }
  private remember(e: Entry): void {
    this.touch(e);
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
  }

  async suggest(req: SuggestRequest): Promise<SuggestAnswer> {
    const set = this.d.settings();
    if (!this.d.calls || !set.on || !set.modelOn) return { text: null, cached: false, reason: 'off' };
    const chatId = String(req.chatId ?? '').slice(0, 200);
    const line = scrub(String(req.line ?? '').split(/\r?\n/).pop()!.slice(-SUGGEST_LINE_MAX));
    const last = scrub(String(req.lastMessage ?? '').replace(/\s+/g, ' ').trim().slice(-SUGGEST_LAST_MAX));
    this.cancel(chatId);
    if (line.trim().length < SUGGEST_MODEL_MIN_LINE) return { text: null, cached: false, reason: 'short' };
    const hit = this.lookup(last, line);
    if (hit !== undefined) {
      this.day().cacheHits++;
      return hit ? { text: hit, cached: true } : { text: null, cached: true, reason: 'empty' };
    }
    if (this.day().usd >= set.dailyUsd) return { text: null, cached: false, reason: 'budget' };
    const ctl = new AbortController();
    this.inflight.set(chatId, ctl);
    const prompt = `${last ? `Last message in the chat:\n${last}\n\n` : ''}Current line (continue right after its end):\n${line}`;
    const signal = AbortSignal.any([ctl.signal, AbortSignal.timeout(this.d.timeoutMs ?? TIMEOUT_MS)]);
    const r = await this.d.complete({ purpose: 'composer-suggest', model: this.d.model(), maxTokens: SUGGEST_MAX_OUT, system: SUGGEST_SYSTEM, prompt }, signal).catch((e: unknown): TextResult => ({ ok: false, error: errText(e) }));
    if (this.inflight.get(chatId) === ctl) this.inflight.delete(chatId);
    if ('unavailable' in r && r.unavailable) return { text: null, cached: false, reason: 'unavailable' };
    const answered = r.ok || r.usd !== undefined;
    // a request stopped after it was sent (typing on, timeout) may still be billed: counted at the estimate, so a fast
    // typist cannot run past the daily cap with calls that never report a cost
    if (answered || signal.aborted) this.spent(r.ok ? r.usd : r.usd ?? null, r.ok ? r.usage : null, prompt.length);
    if (ctl.signal.aborted) return { text: null, cached: false, reason: 'cancelled' };
    if (!r.ok) {
      log.info('suggest', 'no model suggestion', { data: { why: r.error } });
      return { text: null, cached: false, reason: 'error' };
    }
    const answer = cleanAnswer(r.text, line);
    this.remember({ last, line, answer });
    return answer ? { text: answer, cached: false } : { text: null, cached: false, reason: 'empty' };
  }

  private spent(usd: number | null, usage: { input: number; output: number } | null, promptChars: number): void {
    const t = this.day();
    const cost = usd !== null && Number.isFinite(usd) && usd >= 0 ? usd
      : usage ? usage.input * EST_IN + usage.output * EST_OUT : (promptChars / 3) * EST_IN + SUGGEST_MAX_OUT * EST_OUT;
    t.calls++;
    t.usd += cost;
    this.save();
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.d.file), { recursive: true });
      fs.writeFileSync(this.d.file, JSON.stringify(this.today));
    } catch (e) { log.warn('suggest', 'state not saved', { data: errText(e), cause: 'suggest.json not writable', hint: 'check that the app data folder is writable' }); }
  }
}
