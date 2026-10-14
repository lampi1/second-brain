// The app data state and its reducer, pure (no DOM, no bridge): main-process events and the initial loads become
// actions; every update keeps the references of the parts that did not change, so a tile that selects
// `items[chatId]` re-renders only when its own chat changes (streaming one chat never re-renders the others).
// Used by store.ts (the live store) and pinned by test/unit/state.test.ts.
import type { AppInfo, BrowserTab, ChatItem, ChatSummary, FeedEvent, ImageAttachment, PendingRequest, Settings, Usage } from '@shared/contract';

/** A message waiting for its chat to be free: an id of its own (two equal texts stay two messages), text, images. */
export interface QueuedMsg { id: string; text: string; images?: readonly ImageAttachment[] }

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
  queued: Readonly<Record<string, readonly QueuedMsg[]>>;
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
  | { type: 'cli'; cli: NonNullable<AppInfo['cli']> }
  /** front: back at the head of the queue (a send that failed keeps its place) */
  | { type: 'queue'; chatId: string; msg: QueuedMsg; front?: boolean }
  | { type: 'unqueue'; chatId: string; id: string }
  /** "Invia subito": that queued message moves to the front, the others keep their order behind it */
  | { type: 'promote'; chatId: string; id: string }
  | { type: 'settings'; settings: Settings };

export const MAX_ITEMS = 600;
export const MAX_FEED = 300;

const byAt = (a: { at: number }, b: { at: number }) => a.at - b.at;
const pendingKey = (p: { chatId: string; id: string }) => `${p.chatId}\u0000${p.id}`;

/** A Cursor chat with no cost of its own gets the Cursor ledger's estimate for its session (Usage.cursorChats). */
export function withLedger(c: ChatSummary, u: Usage | null): ChatSummary {
  const v = c.harness === 'cursor' && c.costKnown === false && c.sessionId ? u?.cursorChats?.[c.sessionId] : undefined;
  if (v === c.costLedgerUsd) return c;
  if (v === undefined) { const { costLedgerUsd: _, ...rest } = c; return rest; }
  return { ...c, costLedgerUsd: v };
}

export function reduce(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'init': {
      const chats: Record<string, ChatSummary> = {};
      for (const c of a.chats) chats[c.id] = withLedger(c, a.usage);
      // keep chats that arrived by event while the initial load was in flight
      for (const id of s.order) if (!chats[id] && s.chats[id]) chats[id] = s.chats[id];
      const order = [...a.chats.map(c => c.id), ...s.order.filter(id => !a.chats.some(c => c.id === id))];
      const pending = dedupePending([...a.pending, ...s.pending]);
      return { ...s, ready: true, chats, order, pending, tabs: a.tabs, feed: mergeFeed(s.feed, a.feed), usage: a.usage ?? s.usage, info: a.info ?? s.info };
    }
    case 'info': return { ...s, info: a.info };
    case 'cli': return s.info ? { ...s, info: { ...s.info, cli: a.cli } } : s;
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
      const chat = withLedger(a.chat, s.usage);
      if (prev && shallowEqual(prev, chat)) return s;
      const chats = { ...s.chats, [a.chat.id]: chat };
      return { ...s, chats, order: prev ? s.order : [...s.order, a.chat.id] };
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
    case 'usage': {
      // Cursor chats whose engine reports no cost take today's ledger estimate (unchanged chats keep their reference)
      let chats = s.chats;
      for (const [id, c] of Object.entries(s.chats)) {
        const next = withLedger(c, a.usage);
        if (next.costLedgerUsd !== c.costLedgerUsd) chats = { ...chats, [id]: next };
      }
      return { ...s, usage: a.usage, chats };
    }
    case 'settings': return { ...s, settings: a.settings };
    case 'queue': {
      const text = a.msg.text.trim();
      if (!text && !a.msg.images?.length) return s;
      const q = s.queued[a.chatId] ?? [];
      if (q.some(m => m.id === a.msg.id)) return s;
      const msg = { ...a.msg, text };
      return { ...s, queued: { ...s.queued, [a.chatId]: a.front ? [msg, ...q] : [...q, msg] } };
    }
    case 'unqueue': {
      const q = s.queued[a.chatId];
      if (!q || !q.some(m => m.id === a.id)) return s;
      return { ...s, queued: { ...s.queued, [a.chatId]: q.filter(m => m.id !== a.id) } };
    }
    case 'promote': {
      const q = s.queued[a.chatId];
      const i = q ? q.findIndex(m => m.id === a.id) : -1;
      if (!q || i <= 0) return s;
      return { ...s, queued: { ...s.queued, [a.chatId]: [q[i]!, ...q.filter(m => m.id !== a.id)] } };
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
export function toFlush(prev: ChatSummary | undefined, next: ChatSummary, queue: readonly QueuedMsg[] | undefined): QueuedMsg | null {
  if (!queue || queue.length === 0) return null;
  if (next.state !== 'idle' || next.pending > 0) return null;
  if (prev && prev.state === 'idle') return null;
  return queue[0] ?? null;
}

/** Corsie columns: waiting (oldest request first) and working: the busy chats (creation order), then the finished
 *  ones still open (newest first) until they close by themselves (lib/autoclose.ts). */
export function corsie(s: Pick<AppState, 'chats' | 'order' | 'pending'>): { waiting: ChatSummary[]; working: ChatSummary[] } {
  const oldest = new Map<string, number>();
  for (const p of s.pending) if (!oldest.has(p.chatId)) oldest.set(p.chatId, p.at);
  const waiting: ChatSummary[] = [];
  const working: ChatSummary[] = [];
  const done: ChatSummary[] = [];
  for (const id of s.order) {
    const c = s.chats[id];
    if (!c || c.isRegia || c.closedAt || c.space === 'app') continue; // closed chats: the palette (Ctrl+K); app chats: their section
    if (c.state === 'waiting' || c.state === 'error' || c.pending > 0 || oldest.has(id)) waiting.push(c);
    else if (isBusy(c) || c.queued) working.push(c); // waiting in the CPU queue (ADR 0036): about to work, never "finite"
    else done.push(c);
  }
  waiting.sort((a, b) => (oldest.get(a.id) ?? a.updatedAt) - (oldest.get(b.id) ?? b.updatedAt));
  done.sort((a, b) => b.updatedAt - a.updatedAt);
  return { waiting, working: [...working, ...done] };
}

export function runningCount(s: Pick<AppState, 'chats'>): number {
  let n = 0;
  for (const c of Object.values(s.chats)) if (isBusy(c)) n++;
  return n;
}

/** Chats waiting in the CPU queue (ADR 0036), archived ones aside. */
export function queuedCount(s: Pick<AppState, 'chats'>): number {
  let n = 0;
  for (const c of Object.values(s.chats)) if (c.queued && !c.closedAt) n++;
  return n;
}

/** Today's spend: the brain's number when known, else the sum of this run's chats. */
export function todayCost(s: Pick<AppState, 'chats' | 'usage'>): number {
  if (s.usage) return s.usage.todayUsd;
  return Object.values(s.chats).reduce((a, c) => a + c.costUsd, 0);
}
