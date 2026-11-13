// The app's own errors on Qualità (AppErrors.tsx; once the Dashboard's Errori view, ADR 0122), made readable (owner, 2026-10-19: "la parte delle statistiche errori proprio non ci
// siamo, non si capisce nulla"): recurring errors grouped instead of listed one by one. App and tool errors (the feed
// and the chats' error items, data.ts observedErrors) are grouped by a signature of their text (numbers, ids, paths,
// quotes and links removed) and tagged with a known cause (rate limit, overloaded service, full context, login,
// network, timeout, missing file, permission, MCP, tool, failed turn) that the page explains in plain Italian with
// what to do (the AI errors the user corrected are Qualità's own patterns, lib/stats.ts). Each group carries a 14-day count series for its trend. Pure: no React, no IPC; unit-tested in test/unit/dashboard-errors.test.ts.

export type Cause = 'rateLimit' | 'overloaded' | 'context' | 'auth' | 'timeout' | 'network' | 'notFound' | 'permission' | 'mcp' | 'turn' | 'tool' | 'other';
/** Most specific first: the first matching cause wins. */
const CAUSES: [Cause, RegExp][] = [
  ['rateLimit', /rate.?limit|\b429\b|too many requests|usage limit|limite (di |d['’])?(uso|richieste)|quota/i],
  ['overloaded', /overload|\b529\b|\b503\b|service unavailable|sovraccaric|temporarily unavailable/i],
  ['context', /prompt is too long|context (window|length|limit)|too many tokens|max.?tokens|contesto (pieno|troppo)/i],
  ['auth', /\b401\b|\b403\b|unauthori[sz]ed|forbidden|not logged|log ?in|authenticat|credenzial|accesso (negato|scaduto)|sign in/i],
  ['timeout', /timed? ?out|etimedout|timeout|scadut[oa]|troppo tempo/i],
  ['network', /econnrefused|econnreset|enotfound|network|fetch failed|socket hang|getaddrinfo|connessione|offline/i],
  ['notFound', /enoent|not found|no such file|non trovat|non esiste|cannot find/i],
  ['permission', /permission denied|eacces|eperm|not permitted|non consentit|rifiutat|negat[oa]/i],
  ['mcp', /\bmcp\b/i],
];

export interface ObservedLike { id: string; at: number; title: string; detail: string; source: string; chat?: string; role?: string; skills?: string[]; tool?: boolean; turn?: boolean }

export function causeOf(e: Pick<ObservedLike, 'detail' | 'tool' | 'turn'>): Cause {
  for (const [c, re] of CAUSES) if (re.test(e.detail)) return c;
  return e.turn ? 'turn' : e.tool ? 'tool' : 'other';
}

/** The text with what changes from one occurrence to the next taken out, so repeats of one error fall together. */
export function signature(text: string): string {
  return text.toLowerCase()
    .replace(/(["'«`]).*?(["'»`])/g, '<q>')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/(?:[a-z]:)?[\\/][\w .\-\\/]+/gi, '<path>')
    .replace(/\b[0-9a-f]{7,}\b/g, '<id>')
    .replace(/\d+([.,]\d+)?/g, '#')
    .replace(/\s+/g, ' ').trim().slice(0, 90);
}

const DAY = 864e5;
const dayIndex = (at: number, now: number, days: number): number => days - 1 - Math.floor((startOfDay(now) - startOfDay(at)) / DAY);
const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

export interface ErrorGroup {
  key: string; cause: Cause;
  /** the newest feed event's own title (an error the cause list does not know is named by it) */
  title: string | null;
  /** the newest occurrence's text, as an example */
  sample: string;
  count: number;
  /** counts per day, oldest first, the last = today */
  days: number[];
  firstAt: number; lastAt: number;
  /** where it happened: chat names, roles, skills in use, engines/sources */
  chats: string[]; roles: string[]; skills: string[]; sources: string[];
}

/** App and tool errors grouped by cause and signature, the most frequent first (ties: the most recent). */
export function groupErrors(rows: ObservedLike[], now: number, days = 14): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  const add = (list: string[], v: string | undefined) => { if (v && !list.includes(v)) list.push(v); };
  for (const e of [...rows].sort((a, b) => b.at - a.at)) {
    const cause = causeOf(e);
    // one group per cause when the cause is known (the wording varies); otherwise per signature
    const key = cause === 'other' || cause === 'tool' ? `${cause}:${signature(e.detail)}` : cause;
    const g: ErrorGroup = groups.get(key) ?? { key, cause, title: e.source === 'feed' ? e.title : null, sample: e.detail, count: 0, days: Array(days).fill(0), firstAt: e.at, lastAt: e.at, chats: [], roles: [], skills: [], sources: [] };
    g.count++;
    const i = dayIndex(e.at, now, days);
    if (i >= 0 && i < days) g.days[i]!++;
    g.firstAt = Math.min(g.firstAt, e.at); g.lastAt = Math.max(g.lastAt, e.at);
    add(g.chats, e.chat ?? e.title); add(g.roles, e.role); add(g.sources, e.source);
    for (const s of e.skills ?? []) add(g.skills, s);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

/** "up" when the last 7 days hold more than the 7 before, "down" when fewer, "flat" otherwise (14-day series). */
export function trendOf(days: number[]): 'up' | 'down' | 'flat' {
  const half = Math.floor(days.length / 2);
  const a = days.slice(0, half).reduce((s, x) => s + x, 0), b = days.slice(half).reduce((s, x) => s + x, 0);
  return b > a ? 'up' : b < a ? 'down' : 'flat';
}

/** The quietest streak: whole days since the newest error (null: none at all). */
export function daysSince(lastAt: number | null, now: number): number | null {
  return lastAt === null ? null : Math.max(0, Math.floor((startOfDay(now) - startOfDay(lastAt)) / DAY));
}
