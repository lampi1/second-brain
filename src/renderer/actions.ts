// App-level actions that combine the data store, the UI store and DOM focus: going places (chat grid, brain pages, the
// map) with back/forward history and internal links (sb://<page>/<element>, highlighted on arrival), jump to a chat,
// the next thing that needs the user (Ctrl+J), stop (one / all with a confirm only when more than one is running),
// maximize, focus mode, Esc backing out one level, the docked Regia, and the ui:command event from main.
// Used by App.tsx (keyboard), the command palette, the sidebar, the notification center, the top bar and the tiles.
import type { EventMap, PendingRequest } from '@shared/contract';
import { sb } from './sb';
import { freezeClock, now } from './lib/clock';
import { setReporting } from './lib/viewports';
import { focusLayer, inLayer, visibleRequestKeys } from './lib/layer';
import { makeLink, parseLink, visitSection } from './lib/notify';
import { corsie, isBusy } from './store/state';
import { app, stop, stopAll } from './store/store';
import {
  askConfirm, flashTile, highlight, isBrainPage, keepChat, openInColumn, openModal, openPage, requestFocus, setCenter, setFocusMode, setLanePeek, setMap, setMaximized,
  setPair, setRead, setRegiaDock, setView, toast, ui, type Place,
} from './store/ui';

export const regiaId = (): string | null => {
  const s = app.get();
  return s.order.find(id => s.chats[id]?.isRegia) ?? null;
};

export const reqKey = (r: Pick<PendingRequest, 'chatId' | 'id'>) => `${r.chatId}/${r.id}`;

// ---------------------------------------------------------------- places, history, links

const samePlace = (a: Place | undefined, b: Place) => !!a && a.page === b.page && (a.arg ?? null) === (b.arg ?? null) && (a.element ?? null) === (b.element ?? null);

/** A brain target ("esplora/now.md", "costi/30", "mappa/tutto") or a page id → a place. */
export function placeOf(target: string): Place | null {
  const [head = '', ...rest] = target.replace(/^#/, '').split('/');
  const page = ALIAS[head] ?? head;
  const arg = rest.join('/') || null;
  if (page === 'workspace') return { page: 'workspace', element: arg };
  if (page === 'mappa' || isBrainPage(page)) return { page: page as Place['page'], arg };
  return null;
}

/** onNavigate of the brain pages and of the map: every move goes through the history. */
export function goTarget(target: string): void {
  const p = placeOf(target);
  if (p) go(p); else toast(`Pagina sconosciuta: ${target}`, 'warn');
}

/** Old page names (app-control docs, links made before) → today's ids. */
const ALIAS: Record<string, string> = { oggi: 'home', diario: 'fatto', grid: 'workspace', chat: 'workspace', chats: 'workspace', map: 'mappa' };

/** Go to a place: the chat grid, a brain page or the map; `element` is highlighted for 1.5 s on arrival. */
export function go(place: Place, opts: { push?: boolean } = {}): void {
  const page = (ALIAS[place.page] ?? place.page) as Place['page'];
  if (page !== 'workspace' && page !== 'mappa' && !isBrainPage(page)) { toast(`Pagina sconosciuta: ${place.page}`, 'warn'); return; }
  const target: Place = { page, arg: place.arg ?? null, element: place.element ?? null };
  if (page === 'mappa') setMap(true, target.arg ?? null);
  else { setMap(false); openPage(page === 'workspace' ? null : page, target.arg ?? null); }
  if (page !== 'mappa') setRead(r => visitSection(visitSection(r, page, now()), page === 'adesso' ? 'workspace' : page, now()));
  if (opts.push !== false) {
    ui.set(s => {
      if (samePlace(s.history[s.hist], target)) return s;
      const history = [...s.history.slice(0, s.hist + 1), target].slice(-50);
      return { ...s, history, hist: history.length - 1 };
    });
  }
  if (target.element) reveal(target.element);
}

/** Bring an element on screen (a folded chat tile, a collapsed column) and highlight it. */
export function reveal(element: string): void {
  const chat = /^chat-(.+)$/.exec(element)?.[1];
  const c = chat ? app.get().chats[chat] : undefined;
  if (chat && c && !c.isRegia) {
    if (ui.get().prefs.view === 'mosaico') keepChat(chat);
    else {
      const cols = corsie(app.get(), now());
      openInColumn(cols.waiting.some(x => x.id === chat) ? 'waiting' : cols.working.some(x => x.id === chat) ? 'working' : 'done', chat);
    }
  }
  highlight(element);
}

export function back(): void {
  if (ui.get().hist <= 0) return;
  ui.set(s => ({ ...s, hist: s.hist - 1 }));
  go(ui.get().history[ui.get().hist]!, { push: false });
}
export function forward(): void {
  const u = ui.get();
  if (u.hist >= u.history.length - 1) return;
  ui.set(s => ({ ...s, hist: s.hist + 1 }));
  go(ui.get().history[ui.get().hist]!, { push: false });
}

/** The recent distinct places, newest first (palette "Recenti"). */
export function recentPlaces(max = 8): Place[] {
  const out: Place[] = [];
  for (const p of [...ui.get().history].reverse()) if (!out.some(x => samePlace(x, p))) out.push(p);
  return out.slice(0, max);
}

/** sb://<page>/<element>: navigate there. False when the text is not an internal link. */
export function openLink(text: string): boolean {
  const l = parseLink(text);
  if (!l) return false;
  const page = (ALIAS[l.page] ?? l.page) as Place['page'];
  go(page === 'workspace' ? { page, element: l.element } : { page, arg: l.element });
  return true;
}

/** The link of where the user is now: the page, and the focused tile on the chat grid. */
export function currentLink(): string {
  const u = ui.get();
  if (u.map) return makeLink('mappa', u.mapArg);
  if (u.page) return makeLink(u.page, u.pageArg);
  const f = u.focused;
  const el = !f ? null : f === 'regia' ? 'regia' : f.startsWith('chat:') ? `chat-${f.slice(5)}` : f.startsWith('browser:') ? `tab-${f.slice(8)}` : null;
  return makeLink('workspace', el);
}

export async function copyLink(link: string = currentLink()): Promise<void> {
  try { await navigator.clipboard.writeText(link); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = link;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(`Link copiato: ${link}`, 'ok');
}

/** Ctrl+R: the Regia from anywhere. On the chat grid, its input; on a page, the map or in focus mode, the docked panel. */
export function toggleRegia(): void {
  const u = ui.get();
  if (!u.page && !u.map && !u.focusMode) { focusTile(0); return; }
  setRegiaDock(!u.regiaDock);
  if (!u.regiaDock) { const r = regiaId(); if (r) requestFocus(r); }
}

export const toggleCenter = () => setCenter(!ui.get().center);

// ---------------------------------------------------------------- chats and requests

/** Bring a chat on screen (unfold, expand its column, leave other maximized tiles) and focus its input. */
export function focusChat(chatId: string): void {
  const s = app.get();
  const c = s.chats[chatId];
  if (!c) return;
  const u = ui.get();
  if (c.isRegia) {
    if (u.page || u.map || u.focusMode) { setRegiaDock(true); requestFocus(chatId); return; } // the Regia comes to the page
    if (u.maximized && u.maximized !== 'regia') setMaximized(null);
    flashTile('regia');
    requestFocus(chatId);
    return;
  }
  if (u.page || u.map) go({ page: 'workspace' });
  if (u.focusMode && u.focusMode !== chatId) setFocusMode(chatId);
  if (u.maximized && u.maximized !== `chat:${chatId}`) setMaximized(null);
  if (u.prefs.view === 'mosaico') keepChat(chatId);
  else {
    setPair(null);
    const cols = corsie(s, now());
    const col = cols.waiting.some(x => x.id === chatId) ? 'waiting' : cols.working.some(x => x.id === chatId) ? 'working' : 'done';
    openInColumn(col, chatId);
  }
  flashTile(`chat:${chatId}`);
  requestFocus(chatId);
}

/** Focus a request card: in the global layer if it floats there, else where it is on screen, else go and show it. */
export function focusRequest(req: PendingRequest): void {
  // floating in the global layer (not visible elsewhere): the keyboard goes there, the page stays where it is
  if (inLayer(reqKey(req))) { focusLayer(reqKey(req)); return; }
  // already on screen (lane, tile, Regia): just take it, nothing moves
  const sel = `[data-request-key="${CSS.escape(reqKey(req))}"]`;
  const here = visibleRequestKeys().has(reqKey(req)) ? document.querySelector<HTMLElement>(`${sel}[data-lane]`) ?? document.querySelector<HTMLElement>(sel) : null;
  // the keyboard may be in the global layer (Ctrl+J pressed there): bring it back first, else Enter answers the layer card
  void sb.invoke('overlay:focus', { target: 'app' }).catch(() => {});
  if (here) { here.focus(); here.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
  const c = app.get().chats[req.chatId];
  const u = ui.get();
  if (c?.isRegia && (u.page || u.map || u.focusMode)) setRegiaDock(true);
  else if (u.page || u.map) go({ page: 'workspace' });
  if (u.focusMode && u.focusMode !== req.chatId && !c?.isRegia) setLanePeek(true);
  if (u.prefs.view === 'corsie' && c && !c.isRegia) { setPair(null); openInColumn('waiting', req.chatId); }
  if (u.maximized && u.maximized !== `chat:${req.chatId}` && u.prefs.view === 'corsie') setMaximized(null);
  flashTile(c?.isRegia ? 'regia' : `chat:${req.chatId}`);
  let tries = 0;
  const find = () => {
    const el = document.querySelector<HTMLElement>(`${sel}[data-lane]`) ?? document.querySelector<HTMLElement>(sel);
    if (el) { el.focus(); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
    if (++tries < 10) requestAnimationFrame(find);
  };
  find(); // at once when the card is already on screen (the next key must land on it), else after the next frames
}

/** Ctrl+J: the oldest request first; pressed again, the next one. `from`: the card the cycle goes on from (the layer
 *  passes the one it shows, since the app page's own focus is elsewhere then). */
export function nextThing(from?: string): void {
  const hidden = new Set(ui.get().hidden);
  const list = app.get().pending.filter(p => !hidden.has(p.chatId));
  if (!list.length) { toast('Niente ti aspetta adesso', 'ok'); return; }
  const active = from ?? (document.activeElement as HTMLElement | null)?.closest?.('[data-request-key]')?.getAttribute('data-request-key');
  const i = list.findIndex(p => reqKey(p) === active);
  focusRequest(list[(i + 1) % list.length]!);
}

const chatOfTile = (key: string | null): string | null => {
  if (!key) return null;
  if (key === 'regia') return regiaId();
  return key.startsWith('chat:') ? key.slice(5) : null;
};

export function stopFocused(): void {
  const id = chatOfTile(ui.get().focused);
  const c = id ? app.get().chats[id] : undefined;
  if (!c) { toast('Seleziona prima una chat (clic o Ctrl+K)', 'info'); return; }
  if (!isBusy(c) && c.state !== 'waiting') { toast(`«${c.title}» non sta lavorando`, 'info'); return; }
  void stop(c.id);
}

/** ■ Ferma tutto: no confirm for a single chat (cheap), a confirm when several are running. */
export function stopAllAsk(): void {
  const busy = Object.values(app.get().chats).filter(isBusy);
  if (busy.length === 0) { toast('Nessuna chat al lavoro', 'info'); return; }
  if (busy.length === 1) { void stopAll(); return; }
  askConfirm({
    title: `Fermare ${busy.length} chat al lavoro?`, body: 'Il turno in corso di ognuna si interrompe (anche un comando in esecuzione). Le chat restano aperte.',
    items: busy.map(c => c.title), confirmLabel: `Ferma ${busy.length} chat`, danger: true, onConfirm: () => { void stopAll(); },
  });
}

export function toggleMaximize(key?: string | null): void {
  const k = key ?? ui.get().focused ?? ui.get().prefs.lastFocus;
  if (!k) { toast('Seleziona prima una tessera', 'info'); return; }
  setMaximized(ui.get().maximized === k ? null : k);
}

export function toggleFocusMode(): void {
  const u = ui.get();
  if (u.focusMode) { setFocusMode(null); return; }
  const s = app.get();
  const id = chatOfTile(u.focused) ?? s.order.find(x => s.chats[x] && !s.chats[x]!.isRegia && isBusy(s.chats[x]!)) ?? s.order.find(x => s.chats[x] && !s.chats[x]!.isRegia);
  if (!id || s.chats[id]?.isRegia) { toast('Seleziona una chat per la modalità focus', 'info'); return; }
  if (u.page || u.map) go({ page: 'workspace' });
  setFocusMode(id);
  requestFocus(id);
}

/** Esc: back out one level. Returns false when there was nothing to back out of. */
export function escapeOne(): boolean {
  const u = ui.get();
  if (u.center) { setCenter(false); return true; }
  if (u.map) { setMap(false); return true; }
  if (u.lanePeek) { setLanePeek(false); return true; }
  if (u.maximized) { const k = u.maximized; setMaximized(null); flashTile(k); return true; }
  if (u.pair) { setPair(null); return true; }
  if (u.regiaDock && (u.page || u.focusMode)) { setRegiaDock(false); return true; }
  if (u.page) { go({ page: 'workspace' }); return true; }
  if (u.focusMode) { setFocusMode(null); return true; }
  return false;
}

/** Ctrl+0 = the Regia, Ctrl+1 = back to the chat grid (from anywhere), Ctrl+2-9 = the (n-1)-th chat tile on screen. */
export function focusTile(index: number): void {
  if (index === 0) { const r = regiaId(); if (r) focusChat(r); return; }
  if (index === 1) {
    const u = ui.get();
    if (u.center) setCenter(false);
    if (u.maximized) setMaximized(null);
    if (u.focusMode) setFocusMode(null);
    go({ page: 'workspace' });
    return;
  }
  const el = document.querySelector<HTMLElement>(`[data-chat-index="${index - 1}"]`);
  const id = el?.dataset.chatId;
  if (id) focusChat(id);
}

/** ui:command from main (app-control MCP, notifications): view, focus, maximize, restore, page (workspace | mappa | a
 *  brain page id), link (sb://…), notifications, back, forward, palette, next; and for tools/tests: clock (frozen demo
 *  time), layout off|on (stop/resume reporting browser view rects). */
export function uiCommand(cmd: EventMap['ui:command']): void {
  const v = cmd.value ?? '';
  switch (cmd.action) {
    case 'view': if (v === 'mosaico' || v === 'corsie') setView(v); break;
    case 'focus': focusChat(v); break;
    case 'maximize': {
      const s = app.get();
      setFocusMode(null);
      if (s.chats[v]) setMaximized(s.chats[v]!.isRegia ? 'regia' : `chat:${v}`);
      else if (s.tabs.some(t => t.id === v)) setMaximized(`browser:${v}`);
      break;
    }
    case 'restore': setMaximized(null); setFocusMode(null); setPair(null); go({ page: 'workspace' }); break;
    case 'page': { const p = placeOf(v); if (p) go(p); break; }
    case 'link': openLink(v); break;
    case 'notifications': setCenter(v !== 'off'); break;
    case 'back': back(); break;
    case 'forward': forward(); break;
    case 'palette': openModal('palette'); break;
    case 'next': nextThing(); break;
    case 'clock': freezeClock(Number(v)); break;
    case 'layout': setReporting(v !== 'off'); break;
    default: break;
  }
}
