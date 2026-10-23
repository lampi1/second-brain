// The working-line phrases of the day (owner, 2026-10-23, decision card: «Ogni giorno in automatico»): once a day, a
// while after the app opens, the lightest model of an engine that is on rewrites the dev jokes a working chat shows
// (lib/typing-line.ts), in the UI language, in the same silly style. One small request (no role text, no tools,
// agents/oneshot.ts `light`); each line is checked (one short line, no link, no markup) and a kind with too few good
// lines keeps the fixed ones of the code. A failed day is not tried again until the next one. Kept in
// userData/daily-phrases.json; IPC 'phrases:today', event 'phrases:changed'. Off in the tests and the demo. Used by
// wiring.ts and index.ts; tests: test/unit/daily-phrases.test.ts.
import path from 'node:path';
import type { DailyPhrases, Lang } from '../shared/contract';
import { readLocal, writeLocal } from './agents/local-store';
import { LANG_NAME } from './locale';
import { errText, log } from './log';

/** The kinds and how many lines each has in the code (renderer lib/typing-line.ts LINES). */
export const PHRASE_KINDS: Readonly<Record<string, number>> = { any: 16, fix: 6, build: 6, review: 6, qa: 6, cause: 6, ops: 6, runbook: 6, research: 6, write: 6, inbox: 6, plan: 6 };
const KIND_WORDS: Readonly<Record<string, string>> = {
  any: 'any task', fix: 'fixing a bug', build: 'building a feature', review: 'reviewing code', qa: 'testing', cause: 'finding the root cause of an error',
  ops: 'deploys, servers and environments', runbook: 'following a runbook or procedure', research: 'searching and reading', write: 'writing documents or mails',
  inbox: 'mail, tickets and the inbox', plan: 'planning work',
};
const MAX_LEN = 70;
const START_DELAY_MS = 90_000;
const CHECK_MS = 3600e3;

interface Stored { version: 1; day: string; lang: Lang; lines: Record<string, string[]>; triedDay?: string; triedLang?: Lang }

export interface PhrasesDeps {
  userData: string;
  lang: () => Lang;
  /** the one-shot request (lightest model, no tools): its text, or ok false */
  ask: (system: string, prompt: string) => Promise<{ ok: boolean; text: string; reason?: string }>;
  emit: () => void;
  now?: () => number;
}

export const phrasesDay = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The model's answer («kind | line» per line) as checked lines per kind; kinds with fewer than half their lines drop. */
export function parsePhrases(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*[-*]?\s*([a-z]+)\s*\|\s*(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const kind = m[1]!, line = m[2]!.replace(/^["“«]|["”»]$/g, '').trim();
    const want = PHRASE_KINDS[kind];
    if (!want || !line || line.length > MAX_LEN || /https?:|www\.|[<>`*_#[\]{}]/.test(line)) continue;
    const list = (out[kind] ??= []);
    if (list.length < want && !list.includes(line)) list.push(line);
  }
  for (const [kind, list] of Object.entries(out)) if (list.length < Math.ceil(PHRASE_KINDS[kind]! / 2)) delete out[kind];
  return out;
}

export function phrasesPrompt(lang: Lang): { system: string; prompt: string } {
  const system = 'You write the short funny lines a coding assistant app shows while an AI works. Answer only with the lines, nothing else.';
  const prompt = [
    `Write new lines in ${LANG_NAME[lang]} for today. Style: silly, a bit cringe developer jokes, like "Deleting the production DB… just kidding (maybe)…", "Searching Stack Overflow…", "Going to the toilet, back in a minute…", "Asking another AI, don't tell anyone…".`,
    `Each line: at most ${MAX_LEN - 10} characters, ends with "…", no emoji, no links, no names of real people or companies, nothing offensive.`,
    'Format: one line each, "kind | line". Kinds and how many lines:',
    ...Object.entries(PHRASE_KINDS).map(([k, n]) => `- ${k} (${KIND_WORDS[k]}): ${n}`),
  ].join('\n');
  return { system, prompt };
}

export class DailyPhrasesService {
  private data: Stored | null;
  private readonly file: string;
  private running = false;
  private timers: NodeJS.Timeout[] = [];
  constructor(private readonly d: PhrasesDeps) {
    this.file = path.join(d.userData, 'daily-phrases.json');
    let raw: Stored | undefined;
    try { raw = readLocal(this.file) as Stored | undefined; } catch { raw = undefined; }
    this.data = raw && raw.version === 1 && typeof raw.day === 'string' && raw.lines && typeof raw.lines === 'object' ? raw : null;
  }
  private now(): number { return this.d.now?.() ?? Date.now(); }
  /** Today's lines in the UI language, or null (the renderer shows the fixed ones). */
  today(): DailyPhrases | null {
    const day = phrasesDay(this.now()), lang = this.d.lang();
    return this.data && this.data.day === day && this.data.lang === lang && Object.keys(this.data.lines).length ? { day, lang, lines: this.data.lines } : null;
  }
  /** Rewrites the lines once a day (a failed day waits for the next one). */
  async ensure(): Promise<void> {
    const day = phrasesDay(this.now()), lang = this.d.lang();
    if (this.running || this.today() || (this.data?.triedDay === day && this.data.triedLang === lang)) return;
    this.running = true;
    try {
      const { system, prompt } = phrasesPrompt(lang);
      const r = await this.d.ask(system, prompt);
      const lines = r.ok ? parsePhrases(r.text) : {};
      const ok = Object.keys(lines).length > 0;
      this.data = ok ? { version: 1, day, lang, lines, triedDay: day, triedLang: lang } : { ...(this.data ?? { version: 1, day: '', lang, lines: {} }), triedDay: day, triedLang: lang };
      writeLocal(this.file, this.data);
      if (ok) { log.info('app', 'phrases of the day written', { data: { kinds: Object.keys(lines).length } }); this.d.emit(); }
      else log.warn('app', 'phrases of the day not written', { cause: r.reason ?? 'no usable line', hint: 'the fixed phrases stay; tried again tomorrow' });
    } catch (e) {
      log.warn('app', 'phrases of the day failed', { cause: errText(e), hint: 'the fixed phrases stay; tried again tomorrow' });
    } finally { this.running = false; }
  }
  start(): void {
    const first = setTimeout(() => { void this.ensure(); }, START_DELAY_MS);
    const every = setInterval(() => { void this.ensure(); }, CHECK_MS);
    first.unref?.(); every.unref?.();
    this.timers.push(first, every);
  }
  stop(): void { for (const t of this.timers) { clearTimeout(t); clearInterval(t); } this.timers = []; }
}
