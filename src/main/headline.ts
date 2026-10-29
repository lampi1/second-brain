// The Grindhouse's headline (SPEC 18; the user, 2026-10-17: "deve far spaccare dalle risate"): one absurd, slightly
// macabre line built on the day's real events. About once an hour (and at start when the last try is older than an
// hour), only while the window is on screen (never for an app idle in the tray), a model on the Anthropic API engine
// (engines/text.ts: the user's API credits, its spend counted there too) gets a compact digest: the chats' titles,
// states and last lines, now.md's lines, today's journal tail, the latest ai-errors lines, today's chat cost; never a
// file beyond those lines, and every line scrubbed of anything that looks like a credential. It writes 5 candidates
// and picks the funniest (one request, hard cap 1500 tokens); the last 30 lines are sent back so it never repeats.
// Today only its saved line and month spend are read (the Battito writes Memoria's headline once a day, pulse/service.ts,
// ADR 0102); start() is not called. Off with pulse.headline.on. A failure, a timeout or no API key keeps the previous line (source previous), else a line of the
// built-in list (source builtin): get() never waits for a model, so the Home renders at once. State in
// <userData>/headline.json; what it spent this month is shown in Costi. Unit-tested in test/unit/headline.test.ts.
import { timersFor } from './timers';
const { setInterval, clearInterval } = timersFor('headline');
import fs from 'node:fs';
import path from 'node:path';
import type { Effort, HeadlineState, Lang } from '../shared/contract';
import type { TextRequest, TextResult } from './engines/text';
import { errText, log } from './log';
import { LANG_NAME } from './locale';

export const HEADLINE_MODEL = 'claude-opus-5-5';
export const HEADLINE_EFFORT: Effort = 'low';
export const HEADLINE_MAX_TOKENS = 1500;
const HOUR = 3_600_000;
const TICK_MS = 5 * 60_000;
const TIMEOUT_MS = 90_000;
const RECENT = 30;
const MAX_LINE = 160;
const DIGEST_MAX = 6000;

/** The app's own lines: before the first answer, with the headline off, or when every refresh failed. */
export const BUILTIN: Record<Lang, readonly string[]> = {
  it: [
    'Oggi gli agenti lavorano sodo. Uno ha chiesto le ferie: gli abbiamo dato un riavvio.',
    'Il budget sta benissimo. Ha solo smesso di rispondere al telefono.',
    'Ogni chat in attesa è un’anima che aspetta un «sì» che non arriverà mai.',
    'Nessun agente è stato maltrattato oggi. Due sono stati compattati, ma con affetto.',
    'Il test è rosso anche su main. Almeno siamo coerenti.',
    'L’Orchestrator dice che va tutto bene. L’Orchestrator dice sempre che va tutto bene.',
    'Un agente ha trovato la causa del bug: era un altro agente.',
    'Contesto a 199.000 token: si respira l’aria rarefatta della compattazione.',
    'Abbiamo chiesto all’AI di non sbagliare più. Ha preso nota in ai-errors.md.',
    'Il cimitero delle chat chiuse si allarga. Fiori freschi su «fix definitivo v3».',
    'Il token più caro è quello speso a dire «hai ragione, scusa».',
    'Oggi si fa il merge. Domani si piange. Dopodomani si scrive l’ADR.',
  ],
  en: [
    'The agents are working hard today. One asked for a holiday: we gave it a restart.',
    'The budget is doing great. It just stopped answering the phone.',
    'Every waiting chat is a soul waiting for a «yes» that will never come.',
    'No agent was harmed today. Two were compacted, but lovingly.',
    'The test is red on main too. At least we are consistent.',
    'The Orchestrator says everything is fine. The Orchestrator always says everything is fine.',
    'An agent found the cause of the bug: it was another agent.',
    'Context at 199,000 tokens: you can feel the thin air of compaction.',
    'We asked the AI to stop making mistakes. It took a note in ai-errors.md.',
    'The graveyard of closed chats keeps growing. Fresh flowers on «final fix v3».',
    'The most expensive token is the one spent saying «you are right, sorry».',
    'Today we merge. Tomorrow we cry. The day after, we write the ADR.',
  ],
  de: [
    'Die Agenten arbeiten heute hart. Einer wollte Urlaub: Wir haben ihn neu gestartet.',
    'Dem Budget geht es bestens. Es hebt nur nicht mehr ab.',
    'Jeder wartende Chat ist eine Seele, die auf ein «Ja» wartet, das nie kommt.',
    'Heute wurde kein Agent misshandelt. Zwei wurden komprimiert, aber liebevoll.',
    'Der Test ist auch auf main rot. Wenigstens sind wir konsequent.',
    'Der Orchestrator sagt, alles passt. Der Orchestrator sagt immer, alles passt.',
    'Ein Agent hat die Ursache des Bugs gefunden: Es war ein anderer Agent.',
    'Kontext bei 199.000 Token: Man spürt die dünne Luft der Komprimierung.',
    'Wir haben die KI gebeten, keine Fehler mehr zu machen. Sie hat es in ai-errors.md notiert.',
    'Der Friedhof der geschlossenen Chats wächst. Frische Blumen auf «endgültiger Fix v3».',
    'Der teuerste Token ist der, mit dem man «du hast recht, sorry» sagt.',
    'Heute wird gemergt. Morgen wird geweint. Übermorgen schreiben wir das ADR.',
  ],
};
const LOCALE: Record<Lang, string> = { it: 'it-IT', en: 'en-GB', de: 'de-AT' };
const TODAY: Record<Lang, string> = { it: 'Oggi', en: 'Today', de: 'Heute' };
export { LANG_NAME };

/** One line of the built-in list, the same for a whole hour (a frozen demo always shows the same one). */
export const builtinLine = (lang: Lang, now: number): string => { const l = BUILTIN[lang]; return l[Math.floor(now / HOUR) % l.length]!; };

const one = (s: string, n = MAX_LINE): string => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Removes what looks like a credential or a personal address from a line before it leaves the machine. */
export function scrub(s: string): string {
  return s
    // DB_PASSWORD=x, "token": "x", la password è x: the name as a suffix too, quoted, or followed by a verb
    .replace(/([\w-]*(?:password|passwd|pwd|token|secret|api[_-]?key|bearer|authorization)[\w-]*)["']?(?:\s*[:=]\s*|\s+(?:è|e'|is|was|era|vale)\s+|\s+)["']?[^\s"',;]+/gi, '$1 ***')
    .replace(/\b(sk|pk|rk)-[\w-]{6,}/g, '***')
    .replace(/\bgh[pousr]_\w{16,}/g, '***')
    .replace(/\bxox[abprs]-[\w-]{8,}/g, '***')
    .replace(/\bAKIA[0-9A-Z]{12,}/g, '***')
    .replace(/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, '***')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '***@***')
    .replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, '***');
}

export interface DigestChat { title: string; state: string; lastText: string; costUsd: number }
export interface DigestInput {
  now: number; lang: Lang;
  chats: DigestChat[];
  /** now.md's lines, today's journal, ai-errors.md: raw text, only their last lines are used */
  nowMd: string; journal: string; aiErrors: string;
  recent: string[];
}

const lastLines = (text: string, n: number, keep: (l: string) => boolean = l => !!l): string[] =>
  text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && keep(l)).slice(-n).map(l => scrub(one(l)));

/** The prompt: the day's facts, compact and scrubbed, plus the lines already used. */
export function buildPrompt(d: DigestInput): { system: string; prompt: string } {
  const day = new Date(d.now).toLocaleString(LOCALE[d.lang], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const chats = d.chats.slice(-15).map(c => `- ${scrub(one(c.title, 80))} · ${c.state} · ${scrub(one(c.lastText || '-', 120))} · $${c.costUsd.toFixed(2)}`);
  const cost = d.chats.reduce((n, c) => n + (Number.isFinite(c.costUsd) ? c.costUsd : 0), 0);
  const parts = [
    `${TODAY[d.lang]}: ${day}.`,
    chats.length ? `Chats (title · state · last line · cost):\n${chats.join('\n')}` : 'Chats: none open.',
    `Cost of the chats so far: $${cost.toFixed(2)}.`,
  ];
  const nowLines = lastLines(d.nowMd, 10, l => l.startsWith('-'));
  if (nowLines.length) parts.push(`What every chat is doing (now.md):\n${nowLines.join('\n')}`);
  const journal = lastLines(d.journal, 10);
  if (journal.length) parts.push(`Today's journal (last lines):\n${journal.join('\n')}`);
  const errors = lastLines(d.aiErrors, 8, l => l.startsWith('-') || l.startsWith('|'));
  if (errors.length) parts.push(`Mistakes the AI made and the user corrected (latest):\n${errors.join('\n')}`);
  let prompt = parts.join('\n\n');
  if (prompt.length > DIGEST_MAX) prompt = `${prompt.slice(0, DIGEST_MAX - 1)}…`;
  if (d.recent.length) prompt += `\n\nAlready used, never repeat nor paraphrase:\n${d.recent.slice(-RECENT).map(l => `- ${l}`).join('\n')}`;
  const system = [
    'You write the one-line headline of a developer\'s personal dashboard, the "Grindhouse", where his AI agents work. The user is called Brother.',
    'It must make him laugh out loud: absurd, slightly macabre (agents dying, chats in the graveyard, budgets bleeding, endless loops), dry and specific.',
    'Build it on the real events below (chat titles, stuck or failing agents, AI mistakes he corrected, costs, the day and hour); a generic joke is a failure.',
    'Gentle self-irony only: never mean about real people, no slurs. Never quote paths, ids, e-mail addresses or anything that looks like a credential.',
    `At most 140 characters, one or two sentences, no hashtags, no emoji, no surrounding quotes. Write in ${LANG_NAME[d.lang]}.`,
    'Write 5 different candidates, then pick the funniest. Answer with JSON only: {"candidates": ["...", "..."], "best": <index>}.',
  ].join('\n');
  return { system, prompt };
}

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The model's answer → the line to show (the best candidate not used lately, else the next one), or null. */
export function pickLine(answer: string, recent: string[]): string | null {
  const a = answer.indexOf('{'), b = answer.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let j: unknown;
  try { j = JSON.parse(answer.slice(a, b + 1)); } catch { return null; }
  const o = j && typeof j === 'object' ? (j as { candidates?: unknown; best?: unknown }) : {};
  const all = Array.isArray(o.candidates) ? o.candidates : [];
  const lines = all.map(c => (typeof c === 'string' ? one(c.replace(/^["«“']+|["»”']+$/g, ''), 200) : '')).filter(l => l.length >= 8);
  if (!lines.length) return null;
  const used = new Set(recent.map(norm));
  const best = typeof o.best === 'number' && Number.isInteger(o.best) ? all[o.best] : undefined;
  const order = typeof best === 'string' ? [one(best.replace(/^["«“']+|["»”']+$/g, ''), 200), ...lines] : lines;
  return order.find(l => l.length >= 8 && !used.has(norm(l))) ?? null;
}

interface Store {
  text?: string; at?: number; model?: string;
  /** the last refresh failed after a good one: the line on screen is the previous one */
  failed?: boolean;
  triedAt?: number;
  recent: string[];
  spend: { month: string; usd: number; calls: number };
}

export interface HeadlineDeps {
  file: string;
  complete: (req: TextRequest, signal?: AbortSignal) => Promise<TextResult>;
  /** on = the Battito's headline setting (pulse.headline.on; the legacy headlineOn/headlineModel/headlineEffort were
   *  removed, ADR 0102: their opt-out migrates there in brain/config.ts); model and effort only for a direct refresh */
  settings: () => { on?: boolean; model?: string; effort?: Effort | '' };
  lang: () => Lang;
  /** the digest's raw material (main: chats, the brain's files); any part may be empty */
  material: () => Omit<DigestInput, 'now' | 'lang' | 'recent'>;
  /** the window is on screen (visible, not minimized): an app idle in the tray never spends */
  visible: () => boolean;
  emit: (s: HeadlineState) => void;
  now?: () => number;
  /** false = never calls a model (demo, tests): the built-in list only */
  calls?: boolean;
  timeoutMs?: number;
}

const monthOf = (t: number): string => new Date(t).toISOString().slice(0, 7);

export class Headline {
  private s: Store;
  private running: Promise<HeadlineState> | null = null;
  private timer: NodeJS.Timeout | null = null;
  constructor(private readonly d: HeadlineDeps) {
    this.s = { recent: [], spend: { month: monthOf(this.now()), usd: 0, calls: 0 } };
    try {
      const raw = JSON.parse(fs.readFileSync(d.file, 'utf8')) as Partial<Store>;
      this.s = {
        ...(typeof raw.text === 'string' && raw.text ? { text: raw.text } : {}),
        ...(typeof raw.at === 'number' ? { at: raw.at } : {}),
        ...(typeof raw.model === 'string' ? { model: raw.model } : {}),
        ...(raw.failed === true ? { failed: true } : {}),
        ...(typeof raw.triedAt === 'number' ? { triedAt: raw.triedAt } : {}),
        recent: Array.isArray(raw.recent) ? raw.recent.filter((l): l is string => typeof l === 'string').slice(-RECENT) : [],
        spend: raw.spend && typeof raw.spend.month === 'string' && Number.isFinite(raw.spend.usd) && Number.isFinite(raw.spend.calls) ? raw.spend : this.s.spend,
      };
    } catch { /* first run, or a broken file: start empty */ }
  }

  private now(): number { return (this.d.now ?? Date.now)(); }
  private on(): boolean { return this.d.calls !== false && this.d.settings().on !== false; }
  private model(): string { return this.d.settings().model || HEADLINE_MODEL; }

  /** The line on screen now: never waits for a model. */
  get(): HeadlineState {
    const now = this.now();
    const spend = this.s.spend.month === monthOf(now) ? this.s.spend : { usd: 0, calls: 0 };
    const base = { model: this.model(), monthUsd: Math.round(spend.usd * 10000) / 10000, monthCalls: spend.calls };
    if (this.s.text && this.on()) return { text: this.s.text, source: this.s.failed ? 'previous' : 'model', at: this.s.at ?? null, ...base };
    return { text: builtinLine(this.d.lang(), now), source: 'builtin', at: null, ...base };
  }

  /** A refresh is due: on, and the last try (good or not) is at least an hour old. */
  due(): boolean { return this.on() && (this.s.triedAt === undefined || this.now() - this.s.triedAt >= HOUR); }

  start(): void {
    const tick = () => { if (this.due() && this.d.visible()) void this.refresh(); };
    tick();
    this.timer = setInterval(tick, TICK_MS);
    this.timer.unref?.();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Asks the model for a new line (one request at a time); whatever happens, the state on screen after it. */
  refresh(): Promise<HeadlineState> {
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run(): Promise<HeadlineState> {
    const now = this.now();
    this.s.triedAt = now;
    this.save();
    const set = this.d.settings();
    const req: TextRequest = { purpose: 'headline', model: this.model(), effort: set.effort || HEADLINE_EFFORT, maxTokens: HEADLINE_MAX_TOKENS, prompt: '' };
    try {
      const { system, prompt } = buildPrompt({ ...this.d.material(), now, lang: this.d.lang(), recent: this.s.recent });
      const r = await this.d.complete({ ...req, system, prompt }, AbortSignal.timeout(this.d.timeoutMs ?? TIMEOUT_MS));
      if (!('unavailable' in r && r.unavailable)) this.spent(now, 'usd' in r ? r.usd ?? null : null);
      const line = r.ok ? pickLine(r.text, this.s.recent) : null;
      if (line) {
        this.s = { ...this.s, text: line, at: now, model: r.ok ? r.model : req.model, failed: false, recent: [...this.s.recent, line].slice(-RECENT) };
        log.info('headline', 'new line', { data: { model: req.model } });
      } else {
        if (this.s.text) this.s.failed = true;
        const why = r.ok ? 'no usable candidate' : 'unavailable' in r && r.unavailable ? r.reason : r.error;
        log.info('headline', 'refresh kept the previous line', { data: { why } });
      }
    } catch (e) {
      if (this.s.text) this.s.failed = true;
      log.warn('headline', 'refresh failed', { data: errText(e) });
    }
    this.save();
    const state = this.get();
    this.d.emit(state);
    return state;
  }

  private spent(now: number, usd: number | null): void {
    const month = monthOf(now);
    const s = this.s.spend.month === month ? this.s.spend : { month, usd: 0, calls: 0 };
    this.s.spend = { month, usd: s.usd + (usd ?? 0), calls: s.calls + 1 };
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.d.file), { recursive: true });
      fs.writeFileSync(this.d.file, JSON.stringify(this.s));
    } catch (e) { log.warn('headline', 'state not saved', { data: errText(e) }); }
  }
}
