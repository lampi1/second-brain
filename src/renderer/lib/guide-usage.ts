// «Per te» on the Guida (ADR 0196): which concept cards this user needs most, at zero tokens, from what the app already
// sees on this machine: the "?" explanations opened with a Guida card (HelpTip's `guide`), the cards opened on the page,
// the questions the user wrote to the Orchestrator that name a card's distinctive title word, and the errors of a card's
// area in the Log. Counters live in localStorage (per viewer, like the other UI prefs; lost storage = no section). The
// recorders are tiny and import nothing heavy: HelpTip and the chat store call them on every page. The ranking (forYou)
// is pure and gets the cards from its caller (the Guida loads them). Tests: test/unit/guide-usage.test.ts.
import type { LogEvent } from '@shared/activity-log';

const KEY = 'sb.guideUsage.v1';
const ASKED_MAX = 40;
const TEXT_MAX = 240;

export interface GuideUsage {
  /** "?" opens with a Guida card, by card id */
  help: Record<string, number>;
  /** cards opened on the Guida, by card id */
  open: Record<string, number>;
  /** the user's last questions to the Orchestrator (text only, cut), newest last */
  asked: string[];
}
const empty = (): GuideUsage => ({ help: {}, open: {}, asked: [] });

export function readUsage(): GuideUsage {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<GuideUsage> | null;
    if (!raw || typeof raw !== 'object') return empty();
    const counts = (v: unknown) => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([, n]) => Number.isFinite(n) && (n as number) > 0)) as Record<string, number>;
    return { help: counts(raw.help), open: counts(raw.open), asked: Array.isArray(raw.asked) ? raw.asked.filter((x): x is string => typeof x === 'string').slice(-ASKED_MAX) : [] };
  } catch { return empty(); }
}
function write(u: GuideUsage): void {
  try { localStorage.setItem(KEY, JSON.stringify(u)); } catch { /* storage off: no «Per te» */ }
}
const bump = (field: 'help' | 'open', id: string) => {
  if (!id || id.length > 80) return;
  const u = readUsage(); u[field][id] = (u[field][id] ?? 0) + 1; write(u);
};
export const noteHelpOpen = (cardId: string): void => bump('help', cardId);
export const noteCardOpen = (cardId: string): void => bump('open', cardId);
/** A message the user sent to the Orchestrator: kept only when it asks something. */
export function noteOrchestratorText(text: string): void {
  if (typeof text !== 'string' || !text.includes('?')) return;
  const u = readUsage();
  u.asked = [...u.asked, text.slice(0, TEXT_MAX)].slice(-ASKED_MAX);
  write(u);
}

/** What forYou needs of a card: its id and its titles in every language. */
export interface UsageCard { id: string; titles: readonly string[] }
export interface ForYou { id: string; score: number; why: { help: number; open: number; asked: number; errors: number } }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const wordsOf = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(w => w.length >= 5);

/** Each card's words that no other card's title has (so «Orchestrator», in two titles, names neither). */
export function distinctiveWords(cards: readonly UsageCard[]): Map<string, string[]> {
  const seen = new Map<string, Set<string>>();
  for (const c of cards) for (const w of new Set(c.titles.flatMap(wordsOf))) (seen.get(w) ?? seen.set(w, new Set()).get(w)!).add(c.id);
  const out = new Map<string, string[]>();
  for (const c of cards) out.set(c.id, [...new Set(c.titles.flatMap(wordsOf))].filter(w => seen.get(w)!.size === 1));
  return out;
}

/** The Log's kinds that belong to a card's area. */
const KIND_CARD: Partial<Record<LogEvent['kind'], string>> = { classifier: 'classifiers', estimate: 'costs', memory: 'memory-hub', brain: 'brain', task: 'runs' };

/** Errors per card: an error event of a kind that maps to a card, or whose title names a card's distinctive word. */
export function errorsByCard(events: readonly Pick<LogEvent, 'kind' | 'level' | 'title'>[], cards: readonly UsageCard[]): Record<string, number> {
  const words = distinctiveWords(cards), out: Record<string, number> = {};
  for (const e of events) {
    if (e.level !== 'error' && e.kind !== 'error') continue;
    const hits = new Set<string>();
    const k = KIND_CARD[e.kind]; if (k) hits.add(k);
    const toks = new Set(wordsOf(e.title ?? ''));
    for (const [id, ws] of words) if (ws.some(w => toks.has(w))) hits.add(id);
    for (const id of hits) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

/** The top cards for this user: a "?" opened or a question asked weighs most (they were stuck), an error of the area
 *  next, a card opened least. No signal = an empty list (the page shows no section). */
export function forYou(usage: GuideUsage, errors: Readonly<Record<string, number>>, cards: readonly UsageCard[], n = 3): ForYou[] {
  const words = distinctiveWords(cards);
  const asked: Record<string, number> = {};
  for (const text of usage.asked) {
    const toks = new Set(wordsOf(text));
    for (const [id, ws] of words) if (ws.some(w => toks.has(w))) asked[id] = (asked[id] ?? 0) + 1;
  }
  return cards.map((c, i) => {
    const why = { help: usage.help[c.id] ?? 0, open: usage.open[c.id] ?? 0, asked: asked[c.id] ?? 0, errors: errors[c.id] ?? 0 };
    return { id: c.id, i, why, score: why.help * 3 + why.asked * 3 + Math.min(why.errors, 5) * 2 + why.open };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, n).map(({ id, score, why }) => ({ id, score, why }));
}
