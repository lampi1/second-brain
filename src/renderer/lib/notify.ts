// Notification rules, pure: which tier a feed event belongs to (questions/permissions are the global layer; what needs
// the user now gets a short toast; everything else only the notification center), which events count for the bell
// (actionable only) and for the nav badges, unread counting against what was seen/read, toast grouping, and the
// internal link of an event. Policy (the user, 2026-10-13: "le notifiche sono troppe e non le guardo mai"): only what
// needs his action now interrupts him; the rest is a pull-only list. DevOps: a mention or a change on his own things
// (devops-alert, main/devops/model.ts isAlert) interrupts with a toast and a short sound; other DevOps news stay quiet
// (ADR 0029).
// Used by lib/layer.ts (toasts), Sidebar.tsx (badges), NotificationCenter.tsx; pinned by test/unit/notify.test.ts.
import type { FeedEvent } from '@shared/contract';

/** Kinds that deserve a toast (tier b): the user is needed now. A budget event only at 100 % (priority urgent);
 *  chat-failed = a chat's turn ended with an error. Everything else is tier c (center only). */
export const TOAST_KINDS = new Set(['chat-waiting', 'chat-failed', 'budget', 'login', 'devops-alert']);

/** Kinds that need an action from the user: the only ones the bell counts. */
export const ACTIONABLE_KINDS = new Set([...TOAST_KINDS, 'question', 'sync-blocked', 'sync-error', 'mail-blocked']);

/** Kinds kept in the center's list only: no bell, no badge, no toast. */
export const SILENT_KINDS = new Set(['now', 'done', 'decision', 'proposal', 'mail', 'sync-ok', 'playbook', 'chat-closed']);

/** Kinds with no sidebar badge (besides the silent ones): logged for a look later, never a call to act. */
const NO_BADGE = new Set(['error', 'win', 'idea', 'reflection', 'chat-done']);

type Ev = Pick<FeedEvent, 'kind'> & Partial<Pick<FeedEvent, 'priority'>>;

export type Tier = 'toast' | 'quiet';
export function tierOf(e: Ev | string): Tier {
  const { kind, priority } = typeof e === 'string' ? { kind: e, priority: undefined } : e;
  if (!TOAST_KINDS.has(kind)) return 'quiet';
  return kind === 'budget' && priority !== 'urgent' ? 'quiet' : 'toast';
}

/** Does the event ask something of the user (bell count)? A budget alert only at 100 %; a question only while its chat
 *  still has an open request (`open`: chat ids with pending questions/permissions; answered in the layer = done). */
export function isActionable(e: Ev & Partial<Pick<FeedEvent, 'chatId'>>, open?: ReadonlySet<string>): boolean {
  if (!ACTIONABLE_KINDS.has(e.kind)) return false;
  if (e.kind === 'budget') return e.priority === 'urgent';
  if (e.kind === 'question' && open) return !!e.chatId && open.has(e.chatId);
  return true;
}

/** Nav section a kind counts for: brain page ids, or 'workspace' (the chat grid). */
export function sectionOf(kind: string): string | null {
  if (kind === 'idea') return 'idee';
  if (kind === 'reflection') return 'idee';
  if (kind === 'error' || kind === 'win' || kind === 'playbook' || kind === 'proposal') return 'qualita';
  if (kind === 'budget') return 'costi';
  if (kind.startsWith('chat-')) return 'workspace';
  // sync-* (the brain's own sync) had Oggi's badge, mail-* had Comunicazione's; both pages are gone: center only
  if (kind === 'devops' || kind === 'devops-alert') return 'devops';
  return null;
}

/** The `who` of an idea event written by the AI (main/brain/live.ts). */
export const AI_WHO = "dell'IA";

/** Sections whose badge is a warning (amber), not a plain count. */
export const WARN_SECTIONS = new Set(['costi']);

export interface ReadState { readAllAt: number; readIds: string[]; seen: Record<string, number> }
export const emptyRead: ReadState = { readAllAt: 0, readIds: [], seen: {} };

export const isUnread = (e: FeedEvent, r: ReadState): boolean => !e.away && e.at > r.readAllAt && !r.readIds.includes(e.id);

/** Unread per section: events after the last visit of that section, not read in the center. */
/** Unread events the bell counts: actionable ones only. */
export const bellCount = (feed: readonly FeedEvent[], r: ReadState, open?: ReadonlySet<string>): number => feed.filter(e => isActionable(e, open) && isUnread(e, r)).length;

export function badges(feed: readonly FeedEvent[], r: ReadState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of feed) {
    if (SILENT_KINDS.has(e.kind) || NO_BADGE.has(e.kind)) continue;
    const sec = sectionOf(e.kind);
    if (!sec || !isUnread(e, r) || e.at <= (r.seen[sec] ?? 0)) continue;
    out[sec] = (out[sec] ?? 0) + 1;
  }
  return out;
}

export function markRead(r: ReadState, ids: string[]): ReadState {
  const set = new Set([...r.readIds, ...ids]);
  return { ...r, readIds: [...set].slice(-500) };
}
export const markAllRead = (r: ReadState, now: number): ReadState => ({ ...r, readAllAt: now, readIds: [] });
export const visitSection = (r: ReadState, section: string, now: number): ReadState => ({ ...r, seen: { ...r.seen, [section]: now } });

export interface ToastGroup { id: string; kind: string; label: string; title: string; detail: string; count: number; at: number; chatId?: string; event: FeedEvent; ids: string[] }

/** Important events not dismissed (by event id: a later event of the same kind shows again) and not muted, grouped by
 *  kind + chat, newest first, at most `max`. */
export function toastGroups(feed: readonly FeedEvent[], opts: { since: number; dismissed: ReadonlySet<string>; muted: Readonly<Record<string, boolean>>; dnd: boolean; max?: number; skipChats?: ReadonlySet<string> }): ToastGroup[] {
  if (opts.dnd) return [];
  const groups = new Map<string, ToastGroup>();
  for (const e of feed) {
    if (e.at < opts.since || e.away || tierOf(e) !== 'toast' || opts.muted[e.kind]) continue;
    if (e.kind === 'chat-waiting' && e.chatId && opts.skipChats?.has(e.chatId)) continue; // its question is already on screen
    if (opts.dismissed.has(e.id)) continue;
    const key = `${e.kind}|${e.chatId ?? ''}`;
    const g = groups.get(key);
    if (g) { g.count++; g.ids.push(e.id); continue; } // feed is newest first: the first one met is the newest
    groups.set(key, { id: key, kind: e.kind, label: e.label, title: e.title, detail: e.detail, count: 1, at: e.at, chatId: e.chatId, event: e, ids: [e.id] });
  }
  return [...groups.values()].sort((a, b) => b.at - a.at).slice(0, opts.max ?? 2);
}

/** Where an event leads: its chat on the grid; an idea or reflection to Idee filtered by its author (the AI's: "Dall'IA");
 *  else the brain file it is about (Esplora), else its section (none: the workspace). */
export function linkOfEvent(e: Pick<FeedEvent, 'id' | 'kind' | 'chatId' | 'file' | 'who'>): string {
  if (e.chatId) return `sb://workspace/chat-${e.chatId}`;
  if (e.kind === 'reflection' || (e.kind === 'idea' && e.who === AI_WHO)) return 'sb://idee/ia';
  if (e.kind === 'idea') return 'sb://idee/mie';
  if (e.file) return `sb://esplora/${e.file}`;
  const sec = sectionOf(e.kind);
  return sec && sec !== 'workspace' ? `sb://${sec}` : 'sb://workspace';
}

export interface Link { page: string; element: string | null }
/** sb://<page>/<element-id> → parts; null when it is not an internal link. */
export function parseLink(text: string): Link | null {
  const m = /^sb:\/\/([a-z0-9-]+)(?:\/([^\s?#]+?))?\/?$/.exec(text.trim());
  return m ? { page: m[1]!, element: m[2] ?? null } : null;
}
export const makeLink = (page: string, element?: string | null) => `sb://${page}${element ? `/${element}` : ''}`;
