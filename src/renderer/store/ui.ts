// UI state (not data): view, maximized tile, focus mode, open dialog, the current place (chat grid, a brain page, the
// map) with its back/forward history, the notification center and its read state, the Regia widget (expanded, size,
// tab, when its replies were last seen; ADR 0021, 0028), toasts, the tile
// to flash/focus, the chat whose hand-off dialog is open, and the preferences the app remembers across restarts (view, density, theme, sidebar, the Regia widget,
// tile sizes, sections, last new-chat choices) in localStorage (the app's own file:// page, kept in userData).
// Used by every component and by App.tsx's keyboard and ui:command handlers.
import type { Effort, Harness, PermissionMode } from '@shared/contract';
import { BRAIN_PAGES, type BrainPageId } from '../brain';
import { emptyRead, type ReadState } from '../lib/notify';
import { now } from '../lib/clock';
import { DEFAULT_V, type DockSize } from '../lib/regia-dock';
import { createStore } from './createStore';

export type View = 'mosaico' | 'corsie';
export type Density = 'comfortable' | 'compact';
export type Theme = 'system' | 'light' | 'dark';
export type Modal = 'palette' | 'newChat' | 'shortcuts' | 'confirm' | 'settings' | 'regiaRenew' | 'handoff' | 'credentials' | 'stato' | 'visual';
export { BRAIN_PAGES, type BrainPageId };
export const isBrainPage = (id: string): id is BrainPageId => BRAIN_PAGES.some(p => p.id === id);
export const pageLabel = (id: string): string => (id === 'workspace' ? 'Chat' : id === 'mappa' ? 'Mappa 3D' : BRAIN_PAGES.find(p => p.id === id)?.label ?? id);
export const placeLabel = (p: Place): string => `${pageLabel(p.page)}${p.arg ? ` · ${p.arg}` : ''}${p.element ? ` · ${p.element.replace(/^chat-/, '')}` : ''}`;

/** A place in the app: the chat grid, a brain page or the full-screen map; `element` = what to highlight there. */
/** A place in the app: the chat grid, a brain page or the full-screen map. `arg` is what the page shows inside
 *  ("esplora" → a file, "costi" → a period; "mappa" → "tutto", "flat" or a piece to focus); `element` = what to
 *  highlight on the chat grid. */
export interface Place { page: 'workspace' | 'mappa' | BrainPageId; arg?: string | null; element?: string | null }

export interface Prefs {
  view: View;
  density: Density;
  theme: Theme;
  /** the Regia widget bottom-right (ADR 0028): expanded or the collapsed bar; the expanded size (null = the default);
   *  the tab shown; when the user last saw its replies (the bar's unread count starts there) */
  regiaOpen: boolean;
  regiaSize: DockSize | null;
  /** the default size's version the saved regiaSize was made under (lib/regia-dock.ts DEFAULT_V): an older one is dropped */
  regiaSizeV: number;
  regiaTab: string | null;
  regiaSeenAt: number;
  /** Mosaico column/row fractions, per column/row count ("3" → [0.3, 0.4, 0.3]) */
  cols: Record<string, number[]>;
  rows: Record<string, number[]>;
  /** chat | browser split of the focus mode and of Corsie's "big browser" pair */
  pairSplit: number;
  feedOpen: boolean;
  newChat: { harness: Harness; cwd: string; model: string; effort: Effort | ''; permissionMode: PermissionMode | '' };
  lastFocus: string | null;
  /** the left navigation shows only icons */
  navCollapsed: boolean | null;
  /** "Nascondi browser" (Ctrl+Shift+B): browser tiles off screen, the chats take the room; the tabs keep working parked */
  browsersHidden: boolean;
  /** Mosaico: width of the browser zone (right of the chats), as a fraction of the area */
  browserZone: number;
}

export interface Toast { id: number; text: string; tone: 'info' | 'ok' | 'warn' | 'err'; action?: { label: string; run: () => void }; ttl: number }
export interface ConfirmSpec { title: string; body: string; items?: string[]; confirmLabel: string; danger?: boolean; onConfirm: () => void }

export interface UiState {
  prefs: Prefs;
  maximized: string | null;      // tile key: 'regia' | 'chat:<id>' | 'browser:<id>'
  focusMode: string | null;      // chat id
  focused: string | null;        // tile key that has the keyboard focus
  modal: Modal | null;
  confirm: ConfirmSpec | null;
  regiaRenew: { chatId: string; to: Harness } | null; // the new-Regia dialog: which Regia, which engine preselected
  handoffChat: string | null;    // the chat whose hand-off the 'handoff' dialog shows
  handoffSession: string | null; // set: the note one cold continuation started from (read only, ADR 0031)
  ctxHidden: Record<string, number>; // long-chat notice hidden by the user, per chat: the context size when hidden
  page: BrainPageId | null;      // a brain page replaces the view (the Regia overlay floats over it too)
  pageArg: string | null;        // what the page shows inside (a file, a period, a tab)
  map: boolean;                  // the full-screen 3D map
  mapArg: string | null;         // "tutto" (every file), "flat" (the 2D list) or a piece to focus
  history: Place[];              // back/forward (Alt+←/→); the recent places in the palette
  hist: number;
  center: boolean;               // the notification center panel
  newChatRegia: boolean;         // the "Nuova chat" dialog opened as "Nuova Regia" (the overlay's +)
  read: ReadState;               // what was read / seen (badges, center), remembered
  highlight: { id: string; n: number } | null;
  toastDismissed: string[];      // event ids whose toast was closed or used
  pair: string | null;           // Corsie: tab shown big next to its chat
  open: Record<string, string>;  // Corsie: column → chat expanded by hand
  lanePeek: boolean;             // focus mode: the lane shown on Ctrl+J
  toasts: Toast[];
  flash: { key: string; n: number } | null;
  focusReq: { chatId: string; n: number } | null;
  hidden: string[];              // chats being closed (undo toast running)
  closing: string[];             // chats fading out before they are archived (auto-close)
  regiaFirst: string | null;     // the request the Regia widget shows first (Ctrl+J asked for it), else the oldest
  layerHeld: string | null;      // the global layer's card that has the keyboard (Ctrl+J took it there): the one popup until answered, "Rispondi dopo" or the app is back
  later: boolean;                // "Rispondi dopo" is on (main/later.ts, mirrored by lib/later.ts): every request waits in "Da rispondere", no popup
  announce: string;              // screen-reader live region
  qwin: QWin;                    // the questions window ("Domande in finestra", QuestionsWindow.tsx)
}

/** The questions window: open = called as the "Da rispondere" queue (Ctrl+J, the counter, "Rispondi" on a tile): it
 *  shows even with "Domande in finestra" off, until the queue is empty or set aside again; first = the request shown
 *  first; call = a new nonce when the user asks for it (it shows at once, typing or not, and takes the keyboard);
 *  shown = on screen now (the browser views hide under it). */
export interface QWin { open: boolean; first: string | null; call: number; shown: boolean }

const PREFS_KEY = 'sb.prefs.v1';
export const defaultPrefs: Prefs = {
  view: 'mosaico', density: 'comfortable', theme: 'system', regiaOpen: false, regiaSize: null, regiaSizeV: DEFAULT_V, regiaTab: null, regiaSeenAt: 0, cols: {}, rows: {}, pairSplit: 0.42, feedOpen: true,
  newChat: { harness: 'claude', cwd: '', model: '', effort: '', permissionMode: '' }, lastFocus: null, navCollapsed: null,
  browsersHidden: false, browserZone: 0.3,
};
const READ_KEY = 'sb.read.v1';
function readRead(): ReadState {
  try {
    const r = JSON.parse(localStorage.getItem(READ_KEY) ?? 'null') as Partial<ReadState> | null;
    if (!r) return emptyRead;
    const seen: Record<string, number> = r.seen && typeof r.seen === 'object' ? { ...r.seen } : {};
    return { readAllAt: Number(r.readAllAt) || 0, readIds: Array.isArray(r.readIds) ? r.readIds.map(String).slice(-500) : [], seen };
  } catch { return emptyRead; }
}

/** The remembered prefs, each field checked; `at` = now, the unread count's start when none was saved. */
export function loadPrefs(raw: string | null, at = Date.now()): Prefs {
  if (!raw) return { ...defaultPrefs, regiaSeenAt: at };
  try {
    // regiaRect: the floating panel's place before ADR 0028, dropped
    const { regiaRect: _old, ...p } = JSON.parse(raw) as Partial<Prefs> & { regiaRect?: unknown };
    return {
      ...defaultPrefs, ...p,
      view: p.view === 'corsie' ? 'corsie' : 'mosaico',
      density: p.density === 'compact' ? 'compact' : 'comfortable',
      theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'system',
      newChat: { ...defaultPrefs.newChat, ...(p.newChat ?? {}) },
      cols: p.cols && typeof p.cols === 'object' ? p.cols : {},
      rows: p.rows && typeof p.rows === 'object' ? p.rows : {},
      browsersHidden: p.browsersHidden === true,
      regiaOpen: p.regiaOpen === true,
      // a size saved under an older default goes back to the new default once (ADR 0028, 2026-10-13: wider and lower)
      regiaSize: p.regiaSizeV === DEFAULT_V ? sizeOf(p.regiaSize) : null,
      regiaSizeV: DEFAULT_V,
      regiaTab: typeof p.regiaTab === 'string' ? p.regiaTab : null,
      regiaSeenAt: typeof p.regiaSeenAt === 'number' && Number.isFinite(p.regiaSeenAt) ? p.regiaSeenAt : at,
      browserZone: typeof p.browserZone === 'number' && p.browserZone >= 0.15 && p.browserZone <= 0.7 ? p.browserZone : defaultPrefs.browserZone,
    };
  } catch { return { ...defaultPrefs, regiaSeenAt: at }; }
}

const sizeOf = (v: unknown): DockSize | null => {
  const r = v as Partial<DockSize> | null;
  return r && typeof r === 'object' && [r.w, r.h].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0) ? { w: r.w!, h: r.h! } : null;
};

function readPrefs(): Prefs {
  try { return loadPrefs(localStorage.getItem(PREFS_KEY)); } catch { return { ...defaultPrefs, regiaSeenAt: Date.now() }; }
}

export const ui = createStore<UiState>({
  prefs: readPrefs(), maximized: null, focusMode: null, focused: null, modal: null, confirm: null, regiaRenew: null, handoffChat: null, handoffSession: null, ctxHidden: {}, page: null, pair: null, open: {},
  lanePeek: false, toasts: [], flash: null, focusReq: null, hidden: [], closing: [], regiaFirst: null, layerHeld: null, later: false, announce: '', qwin: { open: false, first: null, call: 0, shown: false },
  map: false, pageArg: null, mapArg: null, history: [{ page: 'workspace' }], hist: 0, center: false, newChatRegia: false, read: readRead(), highlight: null, toastDismissed: [],
});

export function setRead(fn: (r: ReadState) => ReadState): void {
  ui.set(s => ({ ...s, read: fn(s.read) }));
  try { localStorage.setItem(READ_KEY, JSON.stringify(ui.get().read)); } catch { /* storage off */ }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function setPrefs(patch: Partial<Prefs>): void {
  ui.set(s => ({ ...s, prefs: { ...s.prefs, ...patch } }));
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(savePrefs, 150);
}
function savePrefs(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(ui.get().prefs)); } catch { /* storage off: keep in memory */ }
}
// the window closed within the 150 ms (a resize, then ✕): the last change is still saved
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (saveTimer) savePrefs(); });

export const setView = (view: View) => { setPrefs({ view }); ui.set(s => ({ ...s, maximized: null, pair: null })); };
/** "Nascondi browser" on/off (remembered); a browser shown big (Corsie pair, maximized) closes with it. */
export function toggleBrowsers(): void {
  const hide = !ui.get().prefs.browsersHidden;
  setPrefs({ browsersHidden: hide });
  ui.set(s => ({ ...s, pair: hide ? null : s.pair, maximized: hide && s.maximized?.startsWith('browser:') ? null : s.maximized, announce: hide ? 'Browser nascosti: continuano a lavorare' : 'Browser visibili' }));
}
export const toggleView = () => setView(ui.get().prefs.view === 'mosaico' ? 'corsie' : 'mosaico');
export const openModal = (modal: Modal) => ui.set(s => ({ ...s, modal, newChatRegia: false }));
/** "Nuova chat" as "Nuova Regia" (the overlay's +): name instead of title, no first message needed */
export const openNewRegia = () => ui.set(s => ({ ...s, modal: 'newChat', newChatRegia: true }));
export const closeModal = () => ui.set(s => ({ ...s, modal: null, confirm: null, regiaRenew: null, newChatRegia: false }));
export const openRegiaRenew = (regiaRenew: { chatId: string; to: Harness }) => ui.set(s => ({ ...s, modal: 'regiaRenew', regiaRenew }));
export const askConfirm = (confirm: ConfirmSpec) => ui.set(s => ({ ...s, modal: 'confirm', confirm }));
export const openHandoff = (chatId: string, session?: string) => ui.set(s => ({ ...s, modal: 'handoff', handoffChat: chatId, handoffSession: session ?? null }));
/** The × of the long-chat notice: hidden until the context grows by another quarter of the threshold (any tile of it). */
export const hideCtxNotice = (chatId: string, tokens: number) => ui.set(s => ({ ...s, ctxHidden: { ...s.ctxHidden, [chatId]: tokens } }));
export const setMaximized = (key: string | null) => ui.set(s => ({ ...s, maximized: key }));
export const setFocused = (key: string | null) => { if (ui.get().focused !== key) ui.set(s => ({ ...s, focused: key })); };
/** Low level: show a page (or the grid with null) without touching the history (use actions.go). */
export const openPage = (page: BrainPageId | null, arg: string | null = null) => ui.set(s => ({ ...s, page, pageArg: page ? arg : null, map: false, maximized: null }));
export const setMap = (map: boolean, arg: string | null = null) => ui.set(s => ({ ...s, map, mapArg: map ? arg : null }));
export const setCenter = (center: boolean) => ui.set(s => ({ ...s, center }));
/** The Regia widget expanded (the panel) or collapsed (the bar); remembered. Both ways its replies count as seen: what
 *  the open panel showed is read, the bar counts only what arrives after. */
export const setRegiaOpen = (regiaOpen: boolean) => { if (ui.get().prefs.regiaOpen !== regiaOpen) { setPrefs({ regiaOpen, regiaSeenAt: now() }); savePrefs(); } }; // a click, not a drag: saved at once
/** The Regia tab shown (a Regia's chat id); remembered. */
export const setRegiaTab = (regiaTab: string) => { if (ui.get().prefs.regiaTab !== regiaTab) setPrefs({ regiaTab }); };
let hlN = 0;
export const highlight = (id: string) => ui.set(s => ({ ...s, highlight: { id, n: ++hlN } }));
export const dismissEventToasts = (ids: string[]) => ui.set(s => ({ ...s, toastDismissed: [...new Set([...s.toastDismissed, ...ids])].slice(-500) }));
export const setFocusMode = (chatId: string | null) => ui.set(s => ({ ...s, focusMode: chatId, maximized: null, lanePeek: false }));
export const setPair = (tabId: string | null) => ui.set(s => ({ ...s, pair: tabId }));
export const openInColumn = (column: string, chatId: string) => ui.set(s => ({ ...s, open: { ...s.open, [column]: chatId } }));
export const setLanePeek = (lanePeek: boolean) => ui.set(s => ({ ...s, lanePeek }));
export const announce = (text: string) => ui.set(s => ({ ...s, announce: text }));

let flashN = 0;
export const flashTile = (key: string) => ui.set(s => ({ ...s, flash: { key, n: ++flashN } }));
/** Ask the chat's tile to focus its input once rendered (palette jump, ui:command focus, new chat). */
export const requestFocus = (chatId: string) => ui.set(s => ({ ...s, focusReq: { chatId, n: ++flashN } }));

let toastN = 0;
const MAX_TOASTS = 2; // calm notifications: a new one replaces the oldest
export function toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action'], ttl = action ? 6000 : 4000): number {
  const id = ++toastN;
  ui.set(s => ({ ...s, toasts: [...s.toasts, { id, text, tone, action, ttl }].slice(-MAX_TOASTS) }));
  setTimeout(() => dismissToast(id), ttl);
  return id;
}
export const dismissToast = (id: number) => ui.set(s => (s.toasts.some(t => t.id === id) ? { ...s, toasts: s.toasts.filter(t => t.id !== id) } : s));

export const setRegiaFirst = (key: string | null) => ui.set(s => (s.regiaFirst === key ? s : { ...s, regiaFirst: key }));
export const setLayerHeld = (key: string | null) => ui.set(s => (s.layerHeld === key ? s : { ...s, layerHeld: key }));
export const setLater = (on: boolean) => ui.set(s => (s.later === on ? s : { ...s, later: on }));
export const setClosing = (chatId: string, on: boolean) => ui.set(s => ({ ...s, closing: on ? [...new Set([...s.closing, chatId])] : s.closing.filter(id => id !== chatId) }));
export const hideChat = (chatId: string, hidden: boolean) => ui.set(s => ({ ...s, hidden: hidden ? [...s.hidden, chatId] : s.hidden.filter(id => id !== chatId) }));

/** Is something covering the whole window (browser views must hide)? A dialog or the full-screen map. */
export const coversWorkspace = (s: UiState) => s.modal !== null || s.map;

/** The questions window closes: "Rispondi dopo" (lib/later.ts) or the queue it was called for is empty. */
export const parkQuestions = () => ui.set(s => (s.qwin.open || s.qwin.first ? { ...s, qwin: { ...s.qwin, open: false, first: null } } : s));
/** Show the questions window now as the queue (Ctrl+J, the counter, "Apri" on a tile), with this request first. */
export const callQuestions = (key: string | null) => ui.set(s => ({ ...s, qwin: { ...s.qwin, open: true, first: key, call: s.qwin.call + 1 } }));
export const setQuestionsShown = (shown: boolean) => { if (ui.get().qwin.shown !== shown) ui.set(s => ({ ...s, qwin: { ...s.qwin, shown } })); };
