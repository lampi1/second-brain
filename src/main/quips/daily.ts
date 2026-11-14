// The little people's lines of the day (ADR 0305; the owner, 2026-11-14: «ogni giorno dovrebbero cambiare … un modello
// minuscolo per farlo, tipo la frase del giorno ma deve essere tutto molto vario»). Once a day, for the language the
// app is shown in, the lightest model of an engine the user turned on writes new lines for every role and moment
// (agents/oneshot.ts, light: no role text, no tools, no file; three small calls, the roles in three parts), with a theme
// of the day and the lines of the last days to stay away from. What it writes is text for a bubble and nothing else:
// shared/agent-quips.ts parseDailyQuips keeps only plain short lines for known roles and moments. The lines are kept
// in userData/quips-daily.json for DAILY_KEEP_DAYS days and said newest first (at most DAILY_MAX for a moment), so the
// choice grows for a week and then turns over; the fixed lines in code are always there (no engine, no network, a day nothing usable came back).
// Never more than DAILY_TRIES tries a day per language, none while the setting quipsDaily is off. The renderer asks
// through IPC agents:quips (lib/daily-quips.ts). Built by wiring.ts; none in the demo.
import fs from 'node:fs';
import path from 'node:path';
import type { Lang } from '../../shared/contract';
import { QUIP_CHARACTER, QUIP_KINDS, QUIP_ROLES, QUIP_X_KINDS, QUIP_X_REST, cleanDailyQuips, fixedQuips, mergeDailyQuips, parseDailyQuips, type DailyQuips, type QuipKind, type QuipRole } from '../../shared/agent-quips';
import type { OneShotRequest, OneShotResult } from '../agents/oneshot';
import { localDay } from '../jobs/scheduler';
import { errText, log } from '../log';

/** How many days of lines are kept and said. */
export const DAILY_KEEP_DAYS = 7;
/** How many times a day the model is asked for a language, when the first answer was not whole. */
export const DAILY_TRIES = 2;
/** The pause between two tries, in ms. */
export const DAILY_RETRY_MS = 30 * 60_000;
/** The roles of one call: three parts, each answer well inside a light job's limit (a trial of four roles at once
 *  came back whole but near it: about 5200 characters). */
export const DAILY_BATCHES: readonly (readonly QuipRole[])[] = [['orchestrator', 'strategist', 'scout'], ['artisan', 'sentinel'], ['herald', 'plain']];
/** How many lines are asked for a moment. */
export const dailyCount = (kind: QuipKind): number => (kind === 'work' ? 8 : 3);

const LANGUAGE: Record<Lang, string> = { it: 'Italian', en: 'English', de: 'German' };
const MOMENT: Record<QuipKind, string> = {
  work: 'any work, no tool the app can name', think: 'it is thinking', wait: "it waits for the user's answer", err: 'its job failed', done: 'it finished its job', idle: 'nothing to do, it rests',
  read: 'it reads a file', edit: 'it edits a file', run: 'it runs a shell command', test: 'it runs the tests', search: 'it searches the code', web: 'it reads a web page',
  delegate: 'it hands work to another agent', pat: 'the user patted its head', whack: 'the user whacked it with a stick',
};

export const DAILY_SYSTEM = (lang: Lang): string => `You write the lines of the day for the little cartoon people of a desktop app for developers. Each person is the role of an AI agent and says one line in a tiny speech bubble about what it is doing. Write every line in ${LANGUAGE[lang]}.
Humour: programmers' in-jokes, nonsense, a little macabre, cringe on purpose. Each role speaks strictly in its own character. Nothing about real people, groups of people or real tragedies; no slurs, no sex.
Every line: 2 to 4 words, at most 24 characters, plain text (letters, digits, simple punctuation), no emoji, no quotation marks, no markdown. No line twice.
In the moments ${QUIP_X_KINDS.join(', ')} exactly one line per row contains the placeholder {x} once: the app writes the real file, command, search or site in its place (for example Refund.cs or git). That line: at most ${QUIP_X_REST} characters besides {x}. No {x} in any other line or moment.
Answer with rows only, one per role and moment, exactly in this form and nothing else:
role.moment: line | line | line`;

/** The request for some roles: the day and its theme, the characters, the moments with how many lines each, and lines
 *  said in the last days to stay away from. */
export function dailyPrompt(roles: readonly QuipRole[], lang: Lang, at: number, recent: readonly string[]): string {
  const day = new Date(at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return [
    `Today is ${day}. First choose a theme of the day by yourself (a film genre, a trade, the weather, an age of history, a dish, a sport: anything, different every day) and let it colour today's lines without naming it in every one.`,
    'Roles and their characters:', ...roles.map(r => `- ${r}: ${QUIP_CHARACTER[r]}`),
    'Moments (what the agent is doing when the line is said) and how many lines each row has:', ...QUIP_KINDS.map(k => `- ${k} (${dailyCount(k)}): ${MOMENT[k]}`),
    `Write ${roles.length * QUIP_KINDS.length} rows: ${roles.map(r => `${r}.${QUIP_KINDS[0]}`).join(', ')} and so on for every moment.`,
    ...(recent.length ? ['Said in the last days: do not repeat these lines or their jokes.', recent.join(' | ')] : []),
  ].join('\n');
}

/** `v` 2: the lines kept under 1 were written for the characters before ADR 0306, so that file is not read. */
interface Stored { v: 2; days: Record<string, Partial<Record<Lang, DailyQuips>>>; tries: Record<string, number> }
export interface DailyQuipsDeps {
  /** userData/quips-daily.json */
  file: string;
  /** agents/oneshot.ts runOnce (tests: a fake engine) */
  runOnce(req: OneShotRequest): Promise<OneShotResult>;
  /** the setting quipsDaily */
  on(): boolean;
  now?: () => number;
}
const isLang = (v: unknown): v is Lang => v === 'it' || v === 'en' || v === 'de';
/** How many of a role's moments must have lines for its day to be whole: an answer cut short is asked again. */
export const DAILY_WHOLE_KINDS = 12;
const whole = (lines: DailyQuips | undefined, roles: readonly QuipRole[]): boolean =>
  roles.every(r => !!lines?.[r]?.work?.length && QUIP_KINDS.filter(k => lines[r]?.[k]?.length).length >= DAILY_WHOLE_KINDS);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export class DailyQuipsService {
  private readonly busy = new Map<Lang, Promise<void>>();
  private readonly triedAt = new Map<Lang, number>();
  constructor(private readonly d: DailyQuipsDeps) {}
  private now(): number { return (this.d.now ?? Date.now)(); }

  /** The file as it may be used: every line checked like a model's answer (the file is not trusted), only days and
   *  counters that are what they should be. No file, or one that is not ours: an empty store. A file that is there
   *  but cannot be read now throws: nothing is asked and nothing is written over it. */
  private read(): Stored {
    const out: Stored = { v: 2, days: {}, tries: {} };
    let text: string;
    try { text = fs.readFileSync(this.d.file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return out; throw e; }
    let v: unknown;
    try { v = JSON.parse(text); } catch { return out; }
    const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null);
    const o = obj(v), days = obj(o?.days), tries = obj(o?.tries);
    if (o?.v !== 2 || !days) return out;
    for (const [day, of] of Object.entries(days)) {
      const langs = obj(of);
      if (!DAY_KEY.test(day) || !langs) continue;
      for (const [lang, lines] of Object.entries(langs)) if (isLang(lang)) (out.days[day] ??= {})[lang] = cleanDailyQuips(lines, lang);
    }
    for (const [k, n] of Object.entries(tries ?? {})) if (DAY_KEY.test(k.slice(0, 10)) && typeof n === 'number' && Number.isFinite(n) && n >= 0) out.tries[k] = n;
    return out;
  }
  private write(s: Stored): void {
    // only the last days up to today stay: older lines and their counters leave with them, and so does a day after
    // today (a clock that ran ahead). Today's counter always stays: a clock set back does not ask again for ever.
    const today = localDay(this.now());
    const keep = Object.keys(s.days).filter(k => k <= today).sort().slice(-DAILY_KEEP_DAYS), first = keep[0] ?? today;
    const out: Stored = { v: 2, days: Object.fromEntries(keep.map(k => [k, s.days[k]!])), tries: Object.fromEntries(Object.entries(s.tries).filter(([k]) => k.slice(0, 10) >= first && k.slice(0, 10) <= today)) };
    fs.mkdirSync(path.dirname(this.d.file), { recursive: true });
    const tmp = `${this.d.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, this.d.file);
  }
  /** The kept lines of a language, the newest day first (at most DAILY_MAX for a moment: the oldest give way). */
  private pool(s: Stored, lang: Lang): DailyQuips {
    let out: DailyQuips = {};
    for (const day of Object.keys(s.days).sort().reverse()) {
      const lines = s.days[day]?.[lang];
      if (lines) out = mergeDailyQuips(out, lines);
    }
    return out;
  }
  private due(s: Stored, lang: Lang): boolean {
    const day = localDay(this.now());
    if (!this.d.on() || whole(s.days[day]?.[lang], QUIP_ROLES)) return false;
    return (s.tries[`${day}:${lang}`] ?? 0) < DAILY_TRIES && this.now() - (this.triedAt.get(lang) ?? -Infinity) >= DAILY_RETRY_MS;
  }

  /** The lines to say now, and whether today's are still to be written (then `ensure` writes them). Reads only. */
  get(lang: unknown): { lines: DailyQuips; pending: boolean } {
    if (!isLang(lang)) return { lines: {}, pending: false };
    const s = this.read();
    return { lines: this.d.on() ? this.pool(s, lang) : {}, pending: this.busy.has(lang) || this.due(s, lang) };
  }
  /** Writes today's lines when they are due (one job at a time per language), then gives the lines to say. */
  async ensure(lang: unknown): Promise<{ lines: DailyQuips; pending: boolean }> {
    if (!isLang(lang)) return { lines: {}, pending: false };
    let job = this.busy.get(lang);
    if (!job && this.due(this.read(), lang)) {
      job = this.write1(lang).catch(e => { log.warn('quips', 'lines of the day not written', { cause: errText(e) }); }).finally(() => { this.busy.delete(lang); });
      this.busy.set(lang, job);
    }
    await job;
    return this.get(lang);
  }

  private async write1(lang: Lang): Promise<void> {
    const at = this.now(), day = localDay(at), key = `${day}:${lang}`;
    this.triedAt.set(lang, at);
    // the try is counted before the model is asked: a crash in the middle does not ask again for ever
    let s = this.read();
    s.tries[key] = (s.tries[key] ?? 0) + 1;
    this.write(s);
    const said = this.pool(s, lang);
    for (const roles of DAILY_BATCHES) {
      if (whole(s.days[day]?.[lang], roles)) continue;
      const r = await this.d.runOnce({ agentId: 'herald', purpose: 'phrases', light: true, system: DAILY_SYSTEM(lang), prompt: dailyPrompt(roles, lang, at, recentLines(said, lang, roles)), maxOutputTokens: 2400, timeoutMs: 120_000 });
      if (!r.ok) {
        log.warn('quips', 'lines of the day not written', { cause: r.reason ?? 'unknown', hint: r.noEngine ? 'turn on an engine for agents in Impostazioni → Motori' : 'the fixed lines are said; it tries once more later today' });
        if (r.noEngine) return;
        continue;
      }
      const got = parseDailyQuips(r.text, lang), mine: DailyQuips = Object.fromEntries(roles.filter(role => got[role]).map(role => [role, got[role]!]));
      s = this.read();
      (s.days[day] ??= {})[lang] = mergeDailyQuips(s.days[day]?.[lang] ?? {}, mine);
      this.write(s);
      log.info('quips', 'lines of the day written', { data: { lang, roles, lines: count(mine), costUsd: r.costUsd, model: r.model } });
    }
  }
}

const count = (lines: DailyQuips): number => QUIP_ROLES.reduce((n, role) => n + QUIP_KINDS.reduce((m, kind) => m + (lines[role]?.[kind]?.length ?? 0), 0), 0);
/** A sample of what the asked roles say already, for the model to stay away from: each one's last `work` lines of
 *  the day and a few of its fixed ones (they show the tone too). */
function recentLines(pool: DailyQuips, lang: Lang, roles: readonly QuipRole[]): string[] {
  return roles.flatMap(role => [...(pool[role]?.work ?? []).slice(0, 8), ...fixedQuips(role, 'work', lang).slice(0, 3)]);
}
