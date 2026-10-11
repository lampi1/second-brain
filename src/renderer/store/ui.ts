// UI state (not data): view, maximized tile, focus mode, open dialog, the current place (chat grid, a brain page, the
// map) with its back/forward history, the notification center and its read state, the docked Regia, toasts, the tile
// to flash/focus, and the preferences the app remembers across restarts (view, density, theme, sidebar, Regia width,
// tile sizes, sections, last new-chat choices) in localStorage (the app's own file:// page, kept in userData).
// Used by every component and by App.tsx's keyboard and ui:command handlers.
import type { Effort, Harness, PermissionMode } from '@shared/contract';
import { BRAIN_PAGES, type BrainPageId } from '../brain';
import { emptyRead, type ReadState } from '../lib/notify';
import { createStore } from './createStore';

export type View = 'mosaico' | 'corsie';
export type Density = 'comfortable' | 'compact';
export type Theme = 'system' | 'light' | 'dark';
export type Modal = 'palette' | 'newChat' | 'shortcuts' | 'confirm' | 'settings';
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
  regiaWidth: number | null;
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
  page: BrainPageId | null;      // a brain page replaces the view (the Regia is then docked on demand)
  pageArg: string | null;        // what the page shows inside (a file, a period, a tab)
  map: boolean;                  // the full-screen 3D map
  mapArg: string | null;         // "tutto" (every file), "flat" (the 2D list) or a piece to focus
  history: Place[];              // back/forward (Alt+←/→); the recent places in the palette
  hist: number;
  center: boolean;               // the notification center panel
  regiaDock: boolean;            // the Regia docked on a page (Ctrl+R)
  read: ReadState;               // what was read / seen (badges, center), remembered
  highlight: { id: string; n: number } | null;
  toastDismissed: string[];      // event ids whose toast was closed or used
  keep: string[];                // finished chats kept in the mosaic (not folded)
  pair: string | null;           // Corsie: tab shown big next to its chat
  open: Record<string, string>;  // Corsie: column → chat expanded by hand
  lanePeek: boolean;             // focus mode: the lane shown on Ctrl+J
  toasts: Toast[];
  flash: { key: string; n: number } | null;
  focusReq: { chatId: string; n: number } | null;
  hidden: string[];              // chats being closed (undo toast running)
  postponed: string[];           // request keys sent back to "Ti aspettano" from the global layer (Esc)
  announce: string;              // screen-reader live region
}

const PREFS_KEY = 'sb.prefs.v1';
export const defaultPrefs: Prefs = {
  view: 'mosaico', density: 'comfortable', theme: 'system', regiaWidth: null, cols: {}, rows: {}, pairSplit: 0.42, feedOpen: true,
  newChat: { harness: 'claude', cwd: '', model: '', effort: '', permissionMode: '' }, lastFocus: null, navCollapsed: null,
};
const READ_KEY = 'sb.read.v1';
function readRead(): ReadState {
  try {
    const r = JSON.parse(localStorage.getItem(READ_KEY) ?? 'null') as Partial<ReadState> | null;
    if (!r) return emptyRead;
    return { readAllAt: Number(r.readAllAt) || 0, readIds: Array.isArray(r.readIds) ? r.readIds.map(String).slice(-500) : [], seen: r.seen && typeof r.seen === 'object' ? r.seen : {} };
  } catch { return emptyRead; }
}

export function loadPrefs(raw: string | null): Prefs {
  if (!raw) return defaultPrefs;
  try {
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...defaultPrefs, ...p,
      view: p.view === 'corsie' ? 'corsie' : 'mosaico',
      density: p.density === 'compact' ? 'compact' : 'comfortable',
      theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'system',
      newChat: { ...defaultPrefs.newChat, ...(p.newChat ?? {}) },
      cols: p.cols && typeof p.cols === 'object' ? p.cols : {},
      rows: p.rows && typeof p.rows === 'object' ? p.rows : {},
    };
  } catch { return defaultPrefs; }
}

function readPrefs(): Prefs {
  try { return loadPrefs(localStorage.getItem(PREFS_KEY)); } catch { return defaultPrefs; }
}

export const ui = createStore<UiState>({
  prefs: readPrefs(), maximized: null, focusMode: null, focused: null, modal: null, confirm: null, page: null, keep: [], pair: null, open: {},
  lanePeek: false, toasts: [], flash: null, focusReq: null, hidden: [], postponed: [], announce: '',
  map: false, pageArg: null, mapArg: null, history: [{ page: 'workspace' }], hist: 0, center: false, regiaDock: false, read: readRead(), highlight: null, toastDismissed: [],
});

export function setRead(fn: (r: ReadState) => ReadState): void {
  ui.set(s => ({ ...s, read: fn(s.read) }));
  try { localStorage.setItem(READ_KEY, JSON.stringify(ui.get().read)); } catch { /* storage off */ }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function setPrefs(patch: Partial<Prefs>): void {
  ui.set(s => ({ ...s, prefs: { ...s.prefs, ...patch } }));
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(ui.get().prefs)); } catch { /* storage off: keep in memory */ } }, 150);
}

export const setView = (view: View) => { setPrefs({ view }); ui.set(s => ({ ...s, maximized: null, pair: null })); };
export const toggleView = () => setView(ui.get().prefs.view === 'mosaico' ? 'corsie' : 'mosaico');
export const openModal = (modal: Modal) => ui.set(s => ({ ...s, modal }));
export const closeModal = () => ui.set(s => ({ ...s, modal: null, confirm: null }));
export const askConfirm = (confirm: ConfirmSpec) => ui.set(s => ({ ...s, modal: 'confirm', confirm }));
export const setMaximized = (key: string | null) => ui.set(s => ({ ...s, maximized: key }));
export const setFocused = (key: string | null) => { if (ui.get().focused !== key) ui.set(s => ({ ...s, focused: key })); };
/** Low level: show a page (or the grid with null) without touching the history (use actions.go). */
export const openPage = (page: BrainPageId | null, arg: string | null = null) => ui.set(s => ({ ...s, page, pageArg: page ? arg : null, map: false, maximized: null }));
export const setMap = (map: boolean, arg: string | null = null) => ui.set(s => ({ ...s, map, mapArg: map ? arg : null }));
export const setCenter = (center: boolean) => ui.set(s => ({ ...s, center }));
export const setRegiaDock = (regiaDock: boolean) => ui.set(s => ({ ...s, regiaDock }));
let hlN = 0;
export const highlight = (id: string) => ui.set(s => ({ ...s, highlight: { id, n: ++hlN } }));
export const dismissEventToasts = (ids: string[]) => ui.set(s => ({ ...s, toastDismissed: [...new Set([...s.toastDismissed, ...ids])].slice(-500) }));
export const setFocusMode = (chatId: string | null) => ui.set(s => ({ ...s, focusMode: chatId, maximized: null, lanePeek: false }));
export const setPair = (tabId: string | null) => ui.set(s => ({ ...s, pair: tabId }));
export const keepChat = (chatId: string) => ui.set(s => (s.keep.includes(chatId) ? s : { ...s, keep: [...s.keep, chatId] }));
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

export const postpone = (key: string) => ui.set(s => (s.postponed.includes(key) ? s : { ...s, postponed: [...s.postponed, key] }));
export const hideChat = (chatId: string, hidden: boolean) => ui.set(s => ({ ...s, hidden: hidden ? [...s.hidden, chatId] : s.hidden.filter(id => id !== chatId) }));

/** Is something covering the whole window (browser views must hide)? A dialog or the full-screen map. */
export const coversWorkspace = (s: UiState) => s.modal !== null || s.map;
