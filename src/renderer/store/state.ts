// The app data state and its reducer, pure (no DOM, no bridge): main-process events and the initial loads become
// actions; every update keeps the references of the parts that did not change, so a tile that selects
// `items[chatId]` re-renders only when its own chat changes (streaming one chat never re-renders the others).
// Used by store.ts (the live store) and pinned by test/unit/state.test.ts.
import type { AppInfo, BrowserTab, ChatItem, ChatSummary, FeedEvent, PendingRequest, Settings, Usage } from '@shared/contract';
import { sameDay } from '../lib/format';

export interface AppState {
  ready: boolean;
  info: AppInfo | null;
  usage: Usage | null;
  chats: Readonly<Record<string, ChatSummary>>;
  /** creation order (stable: tiles never jump around when states change) */
  order: readonly string[];
  items: Readonly<Record<string, readonly ChatItem[]>>;
  /** open questions/permissions, oldest first */
  pending: readonly PendingRequest[];
  tabs: readonly BrowserTab[];
  /** newest first, capped */
  feed: readonly FeedEvent[];
  /** messages typed while a chat was busy, sent when it becomes idle */
  queued: Readonly<Record<string, readonly string[]>>;
  /** the app settings (mute per kind, do-not-disturb, view, theme), when main has them */
  settings: Settings | null;
}

export const initialState: AppState = { ready: false, info: null, usage: null, chats: {}, order: [], items: {}, pending: [], tabs: [], feed: [], queued: {}, settings: null };

export type Action =
  | { type: 'init'; chats: ChatSummary[]; pending: PendingRequest[]; tabs: BrowserTab[]; feed: FeedEvent[]; usage: Usage | null; info: AppInfo | null }
  | { type: 'items'; chatId: string; items: ChatItem[] }
  | { type: 'chat:updated'; chat: ChatSummary }
  | { type: 'chat:removed'; chatId: string }
  | { type: 'chat:item'; chatId: string; item: ChatItem; replace?: boolean }
  | { type: 'pending:added'; req: PendingRequest }
  | { type: 'pending:resolved'; chatId: string; requestId: string }
  | { type: 'browser:tabs'; tabs: BrowserTab[] }
  | { type: 'feed:events'; events: FeedEvent[] }
  | { type: 'usage'; usage: Usage }
  | { type: 'info'; info: AppInfo }
  | { type: 'queue'; chatId: string; text: string }
  | { type: 'unqueue'; chatId: string; index: number }
  | { type: 'settings'; settings: Settings };

export const MAX_ITEMS = 600;
export const MAX_FEED = 300;

const byAt = (a: { at: number }, b: { at: number }) => a.at - b.at;
const pendingKey = (p: { chatId: string; id: string }) => `${p.chatId}\u0000${p.id}`;

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'init': {
      const chats: Record<string, ChatSummary> = {};
      for (const c of a.chats) chats[c.id] = c;
      // keep chats that arrived by event while the initial load was in flight
      for (const id of s.order) if (!chats[id] && s.chats[id]) chats[id] = s.chats[id];
      const order = [...a.chats.map(c => c.id), ...s.order.filter(id => !a.chats.some(c => c.id === id))];
      const pending = dedupePending([...a.pending, ...s.pending]);
      return { ...s, ready: true, chats, order, pending, tabs: a.tabs, feed: mergeFeed(s.feed, a.feed), usage: a.usage ?? s.usage, info: a.info ?? s.info };
    }
    case 'info': return { ...s, info: a.info };
    case 'items': {
      const have = s.items[a.chatId] ?? [];
      const loaded = new Map(a.items.map(i => [i.id, i]));
      const fresh = new Map(have.map(i => [i.id, i]));
      // items that arrived by event during the load win (they are newer); the rest keep the loaded order
      const merged = [...a.items.map(i => fresh.get(i.id) ?? i), ...have.filter(i => !loaded.has(i.id))];
      return { ...s, items: { ...s.items, [a.chatId]: merged.slice(-MAX_ITEMS) } };
    }
    case 'chat:updated': {
      const prev = s.chats[a.chat.id];
      if (prev && shallowEqual(prev, a.chat)) return s;
      return { ...s, chats: { ...s.chats, [a.chat.id]: a.chat }, order: prev ? s.order : [...s.order, a.chat.id] };
    }
    case 'chat:removed': {
      if (!s.chats[a.chatId]) return s;
      const chats = { ...s.chats };
      delete chats[a.chatId];
      const items = { ...s.items };
      delete items[a.chatId];
      const queued = { ...s.queued };
      delete queued[a.chatId];
      return { ...s, chats, items, queued, order: s.order.filter(id => id !== a.chatId), pending: s.pending.filter(p => p.chatId !== a.chatId) };
    }
    case 'chat:item': {
      let list = s.items[a.chatId] ?? [];
      // the real user message replaces its optimistic copy (id "local:…", same text)
      if (a.item.kind === 'user' && !a.item.id.startsWith('local:')) {
        const text = a.item.text;
        list = list.filter(i => !(i.kind === 'user' && i.id.startsWith('local:') && i.text === text));
      }
      const at = list.findIndex(i => i.id === a.item.id);
      let next: ChatItem[];
      if (at >= 0) { next = [...list]; next[at] = a.item; }
      else next = [...list, a.item].slice(-MAX_ITEMS);
      return { ...s, items: { ...s.items, [a.chatId]: next } };
    }
    case 'pending:added': return { ...s, pending: dedupePending([...s.pending, a.req]) };
    case 'pending:resolved': {
      const pending = s.pending.filter(p => !(p.chatId === a.chatId && p.id === a.requestId));
      return pending.length === s.pending.length ? s : { ...s, pending };
    }
    case 'browser:tabs': return { ...s, tabs: a.tabs };
    case 'feed:events': return a.events.length ? { ...s, feed: mergeFeed(s.feed, a.events) } : s;
    case 'usage': return { ...s, usage: a.usage };
    case 'settings': return { ...s, settings: a.settings };
    case 'queue': {
      const t = a.text.trim();
      if (!t) return s;
      return { ...s, queued: { ...s.queued, [a.chatId]: [...(s.queued[a.chatId] ?? []), t] } };
    }
    case 'unqueue': {
      const q = s.queued[a.chatId];
      if (!q || a.index < 0 || a.index >= q.length) return s;
      return { ...s, queued: { ...s.queued, [a.chatId]: q.filter((_, i) => i !== a.index) } };
    }
  }
}

function dedupePending(list: PendingRequest[]): PendingRequest[] {
  const seen = new Map<string, PendingRequest>();
  for (const p of list) if (!seen.has(pendingKey(p))) seen.set(pendingKey(p), p);
  return [...seen.values()].sort(byAt);
}

function mergeFeed(have: readonly FeedEvent[], add: readonly FeedEvent[]): FeedEvent[] {
  const map = new Map<string, FeedEvent>();
  for (const e of have) map.set(e.id, e);
  for (const e of add) map.set(e.id, e);
  return [...map.values()].sort((a, b) => b.at - a.at).slice(0, MAX_FEED);
}

export function shallowEqual(a: object, b: object): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const x = (a as Record<string, unknown>)[k];
    const y = (b as Record<string, unknown>)[k];
    if (x === y) continue;
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => v === y[i])) continue;
    return false;
  }
  return true;
}

/** Arrays equal by element identity (for selectors that build lists). */
export function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((v, i) => v === b[i]));
}

// ---------- selectors (pure) ----------

export const isBusy = (c: ChatSummary) => c.state === 'running' || c.state === 'starting';

/** The queued message to send now: a chat that just went from busy/waiting to idle with something in its queue. */
export function toFlush(prev: ChatSummary | undefined, next: ChatSummary, queue: readonly string[] | undefined): string | null {
  if (!queue || queue.length === 0) return null;
  if (next.state !== 'idle' || next.pending > 0) return null;
  if (prev && prev.state === 'idle') return null;
  return queue[0] ?? null;
}

/** Corsie columns: waiting (oldest request first), working (creation order), finished today (newest first) and the
 *  older finished/closed chats ("Precedenti", newest first: restored chats can carry an old updatedAt). */
export function corsie(s: Pick<AppState, 'chats' | 'order' | 'pending'>, now: number): { waiting: ChatSummary[]; working: ChatSummary[]; done: ChatSummary[]; older: ChatSummary[] } {
  const oldest = new Map<string, number>();
  for (const p of s.pending) if (!oldest.has(p.chatId)) oldest.set(p.chatId, p.at);
  const waiting: ChatSummary[] = [];
  const working: ChatSummary[] = [];
  const done: ChatSummary[] = [];
  const older: ChatSummary[] = [];
  for (const id of s.order) {
    const c = s.chats[id];
    if (!c || c.isRegia) continue;
    if (c.state === 'waiting' || c.state === 'error' || c.pending > 0 || oldest.has(id)) waiting.push(c);
    else if (isBusy(c)) working.push(c);
    else if (sameDay(c.updatedAt, now)) done.push(c);
    else older.push(c);
  }
  waiting.sort((a, b) => (oldest.get(a.id) ?? a.updatedAt) - (oldest.get(b.id) ?? b.updatedAt));
  done.sort((a, b) => b.updatedAt - a.updatedAt);
  older.sort((a, b) => b.updatedAt - a.updatedAt);
  return { waiting, working, done, older };
}

export function runningCount(s: Pick<AppState, 'chats'>): number {
  let n = 0;
  for (const c of Object.values(s.chats)) if (isBusy(c)) n++;
  return n;
}

/** Today's spend: the brain's number when known, else the sum of this run's chats. */
export function todayCost(s: Pick<AppState, 'chats' | 'usage'>): number {
  if (s.usage) return s.usage.todayUsd;
  return Object.values(s.chats).reduce((a, c) => a + c.costUsd, 0);
}
