// The live data store: window.sb events (chat:updated/item/removed, pending:added/resolved, browser:tabs,
// feed:events, usage) and the initial loads feed the pure reducer of state.ts; components read it through `useApp`
// with selectors, so streaming one chat re-renders only that chat's tile. The actions here are the only place the UI
// calls main (invoke), with optimistic updates and an error toast with the cause on failure.
// Used by every component; App.tsx calls startStore() once.
import type { Answer, ChatSummary, Effort, NewChat, PendingRequest, PermissionMode, SettingsPatch } from '@shared/contract';
import { sb } from '../sb';
import { createStore } from './createStore';
import { initialState, isBusy, reduce, toFlush, type Action, type AppState } from './state';
import { announce, hideChat, setPrefs, toast, ui } from './ui';

export const app = createStore<AppState>(initialState, { batch: true });
export const useApp = app.use;

export function dispatch(a: Action): void {
  const prev = app.get();
  const next = reduce(prev, a);
  if (next === prev) return;
  app.set(next);
  if (a.type === 'chat:updated') {
    const text = toFlush(prev.chats[a.chat.id], a.chat, next.queued[a.chat.id]);
    if (text !== null) { dispatch({ type: 'unqueue', chatId: a.chat.id, index: 0 }); void sendNow(a.chat.id, text); }
  }
  if (a.type === 'pending:added') {
    const c = next.chats[a.req.chatId];
    announce(`${c?.title ?? 'Una chat'} ti aspetta: ${a.req.title}`);
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
const fail = (what: string) => (e: unknown) => { toast(`${what}: ${errText(e)}`, 'err'); };

let started = false;
/** Subscribe to main's events (buffered until the first load lands), then load everything once. */
export function startStore(): void {
  if (started) return;
  started = true;
  let loaded = false;
  const buffer: Action[] = [];
  const put = (a: Action) => (loaded ? dispatch(a) : buffer.push(a));
  sb.on('chat:updated', chat => put({ type: 'chat:updated', chat }));
  sb.on('chat:removed', ({ chatId }) => put({ type: 'chat:removed', chatId }));
  sb.on('chat:item', ({ chatId, item, replace }) => put({ type: 'chat:item', chatId, item, replace }));
  sb.on('pending:added', req => put({ type: 'pending:added', req }));
  sb.on('pending:resolved', ({ chatId, requestId }) => put({ type: 'pending:resolved', chatId, requestId }));
  sb.on('browser:tabs', tabs => put({ type: 'browser:tabs', tabs }));
  sb.on('feed:events', events => put({ type: 'feed:events', events }));
  sb.on('usage', usage => put({ type: 'usage', usage }));
  const safe = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  syncSettings();
  void Promise.all([
    safe(sb.invoke('chat:list', undefined), []),
    safe(sb.invoke('chat:pending', undefined), []),
    safe(sb.invoke('browser:list', undefined), []),
    safe(sb.invoke('feed:list', undefined), []),
    safe(sb.invoke('app:usage', undefined), null),
    safe(sb.invoke('app:info', undefined), null),
  ]).then(([chats, pending, tabs, feed, usage, info]) => {
    dispatch({ type: 'init', chats, pending, tabs, feed, usage, info });
    loaded = true;
    for (const a of buffer.splice(0)) dispatch(a);
    for (const c of chats) void loadItems(c.id);
  });
}

/** View and theme live in the app settings too (config.json, ADR 0005/0008): read them at start, follow changes made
 *  elsewhere (an agent, another window) and save the user's own switches. localStorage keeps working without them. */
function syncSettings(): void {
  let known: { view: string; theme: string } | null = null;
  void sb.invoke('settings:get', undefined).then(s => {
    known = { view: s.view, theme: s.theme };
    dispatch({ type: 'settings', settings: s });
    setPrefs({ view: s.view === 'corsie' ? 'corsie' : 'mosaico', theme: s.theme });
  }).catch(() => {});
  sb.on('settings:changed', c => {
    dispatch({ type: 'settings', settings: c.settings });
    known = { view: c.settings.view, theme: c.settings.theme };
    if (c.key === 'view' || c.key === 'theme') setPrefs({ view: c.settings.view === 'corsie' ? 'corsie' : 'mosaico', theme: c.settings.theme });
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  ui.subscribe(() => {
    const p = ui.get().prefs;
    if (!known || (known.view === p.view && known.theme === p.theme)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const next = { view: p.view, theme: p.theme };
      known = next;
      void sb.invoke('settings:set', next).catch(() => {});
    }, 300);
  });
}

export async function loadItems(chatId: string): Promise<void> {
  try { dispatch({ type: 'items', chatId, items: await sb.invoke('chat:items', { chatId }) }); } catch { /* the tile shows its empty state */ }
}

export async function refreshInfo(): Promise<void> {
  try { dispatch({ type: 'info', info: await sb.invoke('app:info', undefined) }); } catch { /* keep the old one */ }
}

// ---------------------------------------------------------------- actions

async function sendNow(chatId: string, text: string, before?: ChatSummary, optimistic?: ChatSummary): Promise<void> {
  try { await sb.invoke('chat:send', { chatId, text }); }
  catch (e) {
    fail('Messaggio non inviato')(e);
    // roll back only our optimistic copy: a newer chat:updated from main (an error, a state) wins
    if (before && optimistic && app.get().chats[chatId] === optimistic) dispatch({ type: 'chat:updated', chat: before });
    dispatch({ type: 'queue', chatId, text });
  }
}

let localN = 0;
/** Enter in a chat input: send now, or queue it while the chat is busy or waiting on a request (sent when idle). */
export function send(chatId: string, text: string): 'sent' | 'queued' | 'empty' {
  const t = text.trim();
  if (!t) return 'empty';
  const c = app.get().chats[chatId];
  if (c && (isBusy(c) || c.state === 'waiting' || c.pending > 0)) { dispatch({ type: 'queue', chatId, text: t }); return 'queued'; }
  // optimistic: the message and the state pill change at once; main's own user item replaces the copy
  dispatch({ type: 'chat:item', chatId, item: { kind: 'user', id: `local:${++localN}`, at: Date.now(), text: t } });
  if (c) dispatch({ type: 'chat:updated', chat: { ...c, state: 'running' } });
  void sendNow(chatId, t, c, app.get().chats[chatId]);
  return 'sent';
}

export const unqueue = (chatId: string, index: number) => dispatch({ type: 'unqueue', chatId, index });

const attempts = new Map<string, number>();
/** How many times a request came back after a failed answer (the layer re-mounts its card, so it is answerable again). */
export const attemptOf = (key: string): number => attempts.get(key) ?? 0;

/** Answer a question/permission: removed at once (optimistic). If main refuses, it comes back answerable, unless main
 *  says it is no longer open (then it stays gone). Resolves true when main took the answer. */
export async function answer(req: PendingRequest, a: Answer): Promise<boolean> {
  dispatch({ type: 'pending:resolved', chatId: req.chatId, requestId: req.id });
  try { await sb.invoke('chat:answer', { chatId: req.chatId, requestId: req.id, answer: a }); return true; }
  catch (e) {
    const msg = errText(e);
    if (/non è più aperta|scaduta|no longer open/i.test(msg)) { toast(`Questa richiesta non è più aperta: ${msg}`, 'info'); return false; }
    const key = `${req.chatId}/${req.id}`;
    attempts.set(key, attemptOf(key) + 1);
    dispatch({ type: 'pending:added', req });
    fail('Risposta non inviata')(e);
    return false;
  }
}

export async function stop(chatId: string): Promise<void> {
  try { await sb.invoke('chat:stop', { chatId }); } catch (e) { fail('Non riesco a fermarla')(e); }
}

export async function stopAll(): Promise<number> {
  try {
    const n = await sb.invoke('chat:stopAll', undefined);
    toast(n === 1 ? 'Fermata 1 chat' : `Fermate ${n} chat`, 'ok');
    return n;
  } catch (e) { fail('Ferma tutto non riuscito')(e); return 0; }
}

export async function createChat(req: NewChat): Promise<ChatSummary | null> {
  try {
    const c = await sb.invoke('chat:create', req);
    dispatch({ type: 'chat:updated', chat: c });
    void loadItems(c.id);
    return c;
  } catch (e) { fail('Chat non creata')(e); return null; }
}

export async function setChat(chatId: string, patch: { model?: string; effort?: Effort; permissionMode?: PermissionMode; title?: string }): Promise<void> {
  const c = app.get().chats[chatId];
  if (c) dispatch({ type: 'chat:updated', chat: { ...c, ...patch, model: patch.model !== undefined ? patch.model || null : c.model } as ChatSummary });
  try { dispatch({ type: 'chat:updated', chat: await sb.invoke('chat:set', { chatId, ...patch }) }); }
  catch (e) { if (c) dispatch({ type: 'chat:updated', chat: c }); fail('Impostazione non salvata')(e); }
}

/** Close a chat with a 6-second undo: the tile disappears at once, the real close happens when the toast expires. */
export function closeChat(chatId: string): void {
  const c = app.get().chats[chatId];
  if (!c) return;
  hideChat(chatId, true);
  let undone = false;
  const timer = setTimeout(() => {
    if (undone) return;
    void sb.invoke('chat:close', { chatId }).catch(e => { hideChat(chatId, false); fail('Chat non chiusa')(e); }).then(() => hideChat(chatId, false));
  }, 6000);
  toast(`Chiusa «${c.title}»`, 'info', { label: 'Annulla', run: () => { undone = true; clearTimeout(timer); hideChat(chatId, false); } }, 6000);
}

export async function navigateTab(tabId: string, url: string): Promise<void> {
  try { await sb.invoke('browser:navigate', { tabId, url }); } catch (e) { fail('Pagina non aperta')(e); }
}
export async function goTab(tabId: string, dir: 'back' | 'forward' | 'reload'): Promise<void> {
  try { await sb.invoke('browser:go', { tabId, dir }); } catch (e) { fail('Comando non riuscito')(e); }
}

export async function cliLogin(harness: 'claude' | 'cursor'): Promise<void> {
  try { await sb.invoke('cli:login', { harness }); toast(`Login ${harness === 'claude' ? 'Claude' : 'Cursor'} aperto in un terminale`, 'info'); }
  catch (e) { fail('Login non aperto')(e); }
}

export async function cliCheck(harness: 'claude' | 'cursor'): Promise<void> {
  try {
    const st = await sb.invoke('cli:status', { harness, checkLogin: true });
    const info = app.get().info;
    if (info) dispatch({ type: 'info', info: { ...info, cli: { ...(info.cli ?? { claude: st, cursor: st }), [harness]: st } } });
  } catch (e) { fail('Controllo non riuscito')(e); }
}

/** The user's own change of a setting from the UI (logged as the user's), reflected at once. */
export async function setSetting(patch: SettingsPatch): Promise<void> {
  try { dispatch({ type: 'settings', settings: await sb.invoke('settings:set', patch) }); toast('Impostazione salvata', 'ok'); }
  catch (e) { fail('Impostazione non salvata')(e); }
}

/** Mute one kind (settings mute.<kind>: no toast, still in the center), with an undo. */
export async function muteKind(kind: string, label: string, muted = true): Promise<void> {
  try {
    const s = await sb.invoke('settings:set', { mute: { [kind]: muted } });
    dispatch({ type: 'settings', settings: s });
    if (muted) toast(`«${label}» silenziato: resta nelle notifiche, niente avvisi`, 'ok', { label: 'Annulla', run: () => { void muteKind(kind, label, false); } });
  } catch (e) { fail('Non riuscito')(e); }
}

/** Do not disturb until a time (settings dndUntil: no event toasts until then; never sounds anyway). null = off,
 *  which also clears the untimed `dnd` flag. */
export async function setDnd(until: number | null): Promise<void> {
  try {
    const s = await sb.invoke('settings:set', until === null ? { dnd: false, dndUntil: null } : { dndUntil: until });
    dispatch({ type: 'settings', settings: s });
    toast(until ? `Non disturbare fino alle ${new Date(until).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : 'Non disturbare disattivato', 'ok');
  } catch (e) { fail('Non riuscito')(e); }
}
export function dndUntil(): number | null { return app.get().settings?.dndUntil ?? null; }
/** Is do-not-disturb on now (untimed flag, or a time still ahead)? */
export function dndActive(nowMs: number): boolean {
  const s = app.get().settings;
  return !!s && (s.dnd || (!!s.dndUntil && s.dndUntil > nowMs));
}
/** Re-render when a timed do-not-disturb ends (main.tsx checks every minute). */
export function checkDnd(nowMs: number): void {
  const u = dndUntil();
  if (u && nowMs >= u) dispatch({ type: 'settings', settings: { ...app.get().settings!, dndUntil: null } });
}
