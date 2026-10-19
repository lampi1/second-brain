// Fatto as a log (ADR 0079, issue #85): what was done, newest first, grouped by day, each entry with what, who, when
// and a link. Pure: built from the brain's day reports (day.mjs --json: PRs, work items, the diary's outcomes, Claude
// and Cursor chats) and the app's own chats (chat:list), merged so one chat is listed once. Who: "Tu" for the user's
// PRs, work items and diary lines, the agent's name or the engine for a chat. Used by pages/Fatto.tsx; tested by
// test/unit/brain-ui/done-log.test.ts.
import type { ChatSummary } from '@shared/contract';
import type { DayReport, DayRow } from '../types';
import { firstClause } from './text';

/** The diary tags that count as an outcome (the rest, lessons and frictions, stay in the diary). */
export const DONE_TAGS = /fatto|verificato|decisione/i;

export type LogKind = 'pr-merged' | 'pr-open' | 'work-item' | 'done' | 'decision' | 'chat';
export interface LogEntry {
  key: string;
  day: string;          // YYYY-MM-DD
  time: string;         // HH:MM, '' when the source has none
  kind: LogKind;
  what: string;
  who: string;
  area: string;
  url?: string;
  /** an app chat: the link opens it in the app */
  chatId?: string;
  state?: string;
}
export interface LogDay { day: string; entries: LogEntry[] }

export interface WhoNames { you: string; claude: string; cursor: string }
const HHMM = /^(\d{1,2}):(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');
const clockOf = (s: string | undefined): string => { const m = HHMM.exec((s ?? '').trim()); return m ? `${pad(Number(m[1]))}:${m[2]}` : ''; };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The local day (YYYY-MM-DD) and clock (HH:MM) of a time in ms. */
export function localDay(ms: number): { day: string; time: string } {
  const d = new Date(ms);
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** One row of a day report as a log entry, or null when it is no outcome (a lesson or friction line of the diary). */
export function rowEntry(r: DayRow, day: string, i: number, names: WhoNames): LogEntry | null {
  const base = { key: `${day}|${r.kind}|${i}`, day, area: r.area, ...(r.url ? { url: r.url } : {}) };
  if (r.kind === 'pr-unita') return { ...base, kind: 'pr-merged', time: clockOf(r.time), what: r.title, who: names.you };
  if (r.kind === 'pr-aperta') return { ...base, kind: 'pr-open', time: clockOf(r.time), what: r.title, who: names.you };
  if (r.kind === 'work-item') return { ...base, kind: 'work-item', time: clockOf(r.time), what: r.title, who: names.you, ...(r.state ? { state: r.state } : {}) };
  if (r.kind === 'diario') {
    if (!DONE_TAGS.test(r.tag ?? '')) return null;
    return { ...base, kind: /decisione/i.test(r.tag ?? '') ? 'decision' : 'done', time: clockOf(r.time), what: firstClause(r.title), who: names.you };
  }
  if (r.kind === 'chat') return { ...base, kind: 'chat', time: clockOf(r.to), what: r.title, who: names.claude };
  if (r.kind.startsWith('chat-')) {
    // a line of the Cursor/Claude chat list: "Cursor · Title · folder · finito"
    const parts = r.title.split(' · ');
    const engine = /^cursor$/i.test(parts[0] ?? '') ? names.cursor : /^claude$/i.test(parts[0] ?? '') ? names.claude : /cursor/.test(r.kind) ? names.cursor : names.claude;
    const what = (/^(cursor|claude)$/i.test(parts[0] ?? '') ? parts.slice(1) : parts).filter(p => !/^(finito|attivo|in corso)$/i.test(p.trim()))[0] ?? r.title;
    return { ...base, kind: 'chat', time: '', what: what.trim(), who: engine };
  }
  return null;
}

/** A chat of the app that did some work: its last finished turn (or its last update when closed). */
export function chatEntry(c: ChatSummary, engineName: (h: string) => string): LogEntry | null {
  if (c.isOrchestrator) return null;
  const at = c.lastResult && !c.lastResult.isError && !c.lastResult.interrupted ? c.lastResult.at : c.work?.status === 'completed' ? c.work.updatedAt : null;
  if (!at) return null;
  const { day, time } = localDay(at);
  return { key: `chat|${c.id}`, day, time, kind: 'chat', what: c.title || c.lastText || c.id, who: c.agent?.name ?? engineName(c.harness), area: '', chatId: c.id };
}

const minutes = (t: string) => { const m = HHMM.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
/** Newest first; entries without a time after the timed ones, in their report order. */
const byTimeDesc = (a: LogEntry, b: LogEntry) => minutes(b.time) - minutes(a.time);

/** The log: `days` newest first, each with its report's outcomes and the app's chats of that day, one entry per chat
 *  (an app chat with the same title as a report chat gives it its in-app link and its agent's name). */
export function buildLog(days: string[], reports: Readonly<Record<string, DayReport | undefined>>, chats: readonly ChatSummary[] | null,
  names: WhoNames, engineName: (h: string) => string): LogDay[] {
  const app = (chats ?? []).map(c => chatEntry(c, engineName)).filter((e): e is LogEntry => !!e);
  return [...days].sort().reverse().map(day => {
    const rows = (reports[day]?.rows ?? []).map((r, i) => rowEntry(r, day, i, names)).filter((e): e is LogEntry => !!e);
    const mine = app.filter(e => e.day === day);
    const used = new Set<string>();
    const merged = rows.map(e => {
      if (e.kind !== 'chat') return e;
      const twin = mine.find(a => !used.has(a.key) && norm(a.what) === norm(e.what));
      if (!twin) return e;
      used.add(twin.key);
      return { ...e, chatId: twin.chatId, who: twin.who, time: e.time || twin.time };
    });
    const entries = [...merged, ...mine.filter(a => !used.has(a.key))]
      .map((e, i) => ({ e, i })).sort((x, y) => byTimeDesc(x.e, y.e) || x.i - y.i).map(x => x.e);
    return { day, entries };
  });
}

/** The days to show: `from` and the `count - 1` days before it. */
export function lastDays(from: string, count: number, shift: (d: string, n: number) => string): string[] {
  return Array.from({ length: Math.max(1, count) }, (_, i) => shift(from, -i));
}
