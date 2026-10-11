// Notification rules, pure: which tier a feed event belongs to (questions/permissions are the global layer; important
// events get a short toast; everything else only the notification center and badges), which nav section a kind
// counts for (badges), unread counting against what was seen/read, toast grouping, and the internal link of an event.
// Used by lib/layer.ts (toasts), Sidebar.tsx (badges), NotificationCenter.tsx; pinned by test/unit/notify.test.ts.
import type { FeedEvent } from '@shared/contract';

/** Kinds that deserve a toast (tier b). Everything else is tier c (center + badges only). */
export const TOAST_KINDS = new Set(['chat-waiting', 'chat-done', 'error', 'sync-blocked', 'sync-error', 'budget', 'mail-blocked', 'login']);

export type Tier = 'toast' | 'quiet';
export const tierOf = (kind: string): Tier => (TOAST_KINDS.has(kind) ? 'toast' : 'quiet');

/** Nav section a kind counts for: brain page ids, or 'workspace' (the chat grid). */
export function sectionOf(kind: string): string | null {
  if (kind === 'idea') return 'idee';
  if (kind === 'reflection') return 'spunti';
  if (kind === 'error' || kind === 'win' || kind === 'playbook' || kind === 'proposal') return 'qualita';
  if (kind === 'budget') return 'costi';
  if (kind.startsWith('chat-')) return 'workspace';
  if (kind.startsWith('mail')) return 'collabora';
  if (kind.startsWith('sync-')) return 'home';
  return null;
}

/** Sections whose badge is a warning (amber), not a plain count. */
export const WARN_SECTIONS = new Set(['costi']);

export interface ReadState { readAllAt: number; readIds: string[]; seen: Record<string, number> }
export const emptyRead: ReadState = { readAllAt: 0, readIds: [], seen: {} };

export const isUnread = (e: FeedEvent, r: ReadState): boolean => !e.away && e.at > r.readAllAt && !r.readIds.includes(e.id);

/** Unread per section: events after the last visit of that section, not read in the center. */
export function badges(feed: readonly FeedEvent[], r: ReadState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of feed) {
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
    if (e.at < opts.since || e.away || tierOf(e.kind) !== 'toast' || opts.muted[e.kind]) continue;
    if (e.kind === 'chat-waiting' && e.chatId && opts.skipChats?.has(e.chatId)) continue; // its question is already on screen
    if (opts.dismissed.has(e.id)) continue;
    const key = `${e.kind}|${e.chatId ?? ''}`;
    const g = groups.get(key);
    if (g) { g.count++; g.ids.push(e.id); continue; } // feed is newest first: the first one met is the newest
    groups.set(key, { id: key, kind: e.kind, label: e.label, title: e.title, detail: e.detail, count: 1, at: e.at, chatId: e.chatId, event: e, ids: [e.id] });
  }
  return [...groups.values()].sort((a, b) => b.at - a.at).slice(0, opts.max ?? 2);
}

/** Where an event leads: its chat on the grid, else the brain file it is about (Esplora), else its section. */
export function linkOfEvent(e: Pick<FeedEvent, 'id' | 'kind' | 'chatId' | 'file'>): string {
  if (e.chatId) return `sb://workspace/chat-${e.chatId}`;
  if (e.file) return `sb://esplora/${e.file}`;
  const sec = sectionOf(e.kind);
  return sec && sec !== 'workspace' ? `sb://${sec}` : 'sb://home';
}

export interface Link { page: string; element: string | null }
/** sb://<page>/<element-id> → parts; null when it is not an internal link. */
export function parseLink(text: string): Link | null {
  const m = /^sb:\/\/([a-z0-9-]+)(?:\/([^\s?#]+?))?\/?$/.exec(text.trim());
  return m ? { page: m[1]!, element: m[2] ?? null } : null;
}
export const makeLink = (page: string, element?: string | null) => `sb://${page}${element ? `/${element}` : ''}`;
