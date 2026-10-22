// UI state (not data): maximized tile, focus mode, open dialog, the current place (a brain page, the Grindhouse with the agents, the
// map) with its back/forward history, the notification center and its read state, the Orchestrator widget (expanded, size,
// tab, when its replies were last seen; ADR 0021, 0028), toasts, the tile
// to flash/focus, the chat whose hand-off dialog is open, and the preferences the app remembers across restarts (density, theme, the Orchestrator column,
// tile sizes, sections, last new-chat choices) in localStorage (the app's own file:// page, kept in userData).
// Used by every component and by App.tsx's keyboard and ui:command handlers.
import type { Effort, Harness, PermissionMode } from '@shared/contract';
import { readFileViewArg } from '@shared/file-view';
import {readAppearance,type AppearancePreference} from '@shared/appearance';
import { BRAIN_PAGES, type BrainPageId } from '../brain';
import { emptyRead, type ReadState } from '../lib/notify';
import { now } from '../lib/clock';
import { DEFAULT_V, type DockSize } from '../lib/orchestrator-dock';
import { createStore } from './createStore';
import { parseHubArg } from '../lib/memory-hub';
import{t,type TextKey}from'../i18n';
import { emptyViewer, type ViewerState } from '../lib/viewer-stack';

export type Density = 'comfortable' | 'compact';
export type Theme = 'system' | 'light' | 'dark';
export type Modal = 'palette' | 'shortcuts' | 'confirm' | 'settings' | 'orchestratorRenew' | 'handoff' | 'credentials' | 'stato' | 'visual' | 'setup';
export { BRAIN_PAGES, type BrainPageId };
export const isBrainPage = (id: string): id is BrainPageId => id==='file'||BRAIN_PAGES.some(p => p.id === id);
export const pageLabel = (id: string): string => (id==='file'?t('viewer.title'): id === 'mappa' ? t('appText.ui.map3d') : BRAIN_PAGES.find(p => p.id === id)?.label ?? id);
export const placeLabel = (p: Place): string => {const file=p.page==='file'||p.page==='esplora'?readFileViewArg(p.arg??undefined):null;const hub=p.page==='memoria'&&p.arg?parseHubArg(p.arg):null;const arg=file?`${file.path}${file.line?`:${file.line}`:''}`:hub?[t(`mh.tab.${hub.tab}`),hub.rest].filter(Boolean).join(' · '):p.arg;return `${p.page==='file'||p.page==='esplora'?t('viewer.title'):pageLabel(p.page)}${arg ? ` · ${arg}` : ''}${p.element ? ` · ${p.element.replace(/^chat-/, '')}` : ''}`;};

/** A place in the app: a brain page (the Grindhouse, 'home', holds the agents) or the full-screen map. `arg` is what the page shows inside
 *  ("esplora" → a file, "costi" → a period; "mappa" → "tutto", "flat" or a piece to focus); `element` = what to
 *  highlight there (a chat or tab strip in the Grindhouse). */
export interface Place { page: 'mappa' | 'esplora' | BrainPageId; arg?: string | null; element?: string | null }

export interface Prefs {
  /** the work profile's id (shared/work-profiles.ts): which Brain pages the sidebar shows; absent = all of them */
  workProfile?: string;
  appearance:AppearancePreference;
  chatPanelsV:0|1|2;
  chatExpanded:Record<string,boolean>;
  /** an expanded strip shows its browsers beside it only when the user opened them (owner, 18/10: collapsed by default) */
  browserOpen:Record<string,boolean>;
  /** parents whose delegated children are folded, in the Grindhouse and the sidebar tree alike (lib/chat-tree.ts) */
  treeCollapsed:Record<string,boolean>;
  density: Density;
  theme: Theme;
  /** the Orchestrator widget bottom-right (ADR 0028): expanded or the collapsed bar; the expanded size (null = the default);
   *  the tab shown; when the user last saw its replies (the bar's unread count starts there) */
  orchestratorOpen: boolean;
  orchestratorSize: DockSize | null;
  /** the default size's version the saved orchestratorSize was made under (lib/orchestrator-dock.ts DEFAULT_V): an older one is dropped */
  orchestratorSizeV: number;
  orchestratorSeenAt: number;
  /** chat | browser split of the focus mode */
  pairSplit: number;
  newChat: { harness: Harness; cwd: string; model: string; effort: Effort | ''; permissionMode: PermissionMode | '' };
  lastFocus: string | null;
}

export interface Toast { id: number; text: string;labelKey?:TextKey; tone: 'info' | 'ok' | 'warn' | 'err'; action?: { label: string; run: () => void }; ttl: number;expiresAt:number }
export interface ConfirmSpec { title: string; body: string; items?: string[]; confirmLabel: string; danger?: boolean; onConfirm: () => void }

export interface UiState {
  prefs: Prefs;
  maximized: string | null;      // tile key: 'orchestrator' | 'chat:<id>' | 'browser:<id>'
  focusMode: string | null;      // chat id
  focused: string | null;        // tile key that has the keyboard focus
  modal: Modal | null;
  confirm: ConfirmSpec | null;
  orchestratorRenew: { chatId: string; to: Harness } | null; // the new-Orchestrator dialog: which Orchestrator, which engine preselected
  handoffChat: string | null;    // the chat whose hand-off the 'handoff' dialog shows
  handoffSession: string | null; // set: the note one cold continuation started from (read only, ADR 0031)
  ctxHidden: Record<string, number>; // long-chat notice hidden by the user, per chat: the context size when hidden
  page: BrainPageId;             // the page on screen; 'home' (the Grindhouse) holds the agents' strips and focus mode
  pageArg: string | null;        // what the page shows inside (a file, a period, a tab)
  map: boolean;                  // the full-screen 3D map
  mapArg: string | null;         // "tutto" (every file), "flat" (the 2D list) or a piece to focus
  history: Place[];              // back/forward (Alt+←/→); the recent places in the palette
  hist: number;
  center: boolean;               // the notification center panel
  read: ReadState;               // what was read / seen (badges, center), remembered
  highlight: { id: string; n: number } | null;
  toastDismissed: string[];      // event ids whose toast was closed or used
  lanePeek: boolean;             // focus mode: the lane shown on Ctrl+J
  toasts: Toast[];
  flash: { key: string; n: number } | null;
  focusReq: { chatId: string; n: number } | null;
  hidden: string[];              // chats being closed (undo toast running)
  hiddenTabs: string[];          // browser tabs being closed (undo toast running)
  closing: string[];             // chats fading out before they are archived (auto-close)
  later: boolean;                // "Rispondi dopo" is on (main/later.ts, mirrored by lib/later.ts): every request waits in "Da rispondere", no popup
  announce: string;              // screen-reader live region
  qwin: QWin;                    // the questions window (QuestionsWindow.tsx, always on)
  viewer: ViewerState;           // the file viewer overlay over the page (components/viewer/ViewerOverlay.tsx, lib/viewer-stack.ts)
}

/** The questions window: open = called as the "Da rispondere" queue (Ctrl+J, the counter, "Rispondi" on a tile): it
 *  shows the postponed requests too, until the queue is empty or set aside again; first = the request shown
 *  first; call = a new nonce when the user asks for it (it shows at once, typing or not, and takes the keyboard);
 *  shown = on screen now (the browser views hide under it); aside = stepped aside for a file opened from it (the viewer
 *  in front, the window a pill until it is called again or the page changes; QuestionsWindow.tsx). */
export interface QWin { open: boolean; first: string | null; call: number; shown: boolean; aside?: boolean }

const PREFS_KEY = 'sb.prefs.v1';
export const defaultPrefs: Prefs = {
  appearance:readAppearance(null),chatPanelsV:2,chatExpanded:{},browserOpen:{},treeCollapsed:{},
  density: 'comfortable', theme: 'dark', orchestratorOpen: true, orchestratorSize: null, orchestratorSizeV: DEFAULT_V, orchestratorSeenAt: 0, pairSplit: 0.42,
  newChat: { harness: 'claude', cwd: '', model: '', effort: '', permissionMode: '' }, lastFocus: null,
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

/** A remembered per-chat on/off map: valid ids and booleans only, the latest 1000. */
const flags=(raw:unknown):Record<string,boolean>=>raw&&typeof raw==='object'&&!Array.isArray(raw)?Object.fromEntries(Object.entries(raw).filter(([id,value])=>/^[a-zA-Z0-9_-]{1,120}$/.test(id)&&typeof value==='boolean').slice(-1000)):{};

/** The remembered prefs, each field checked; `at` = now, the unread count's start when none was saved. */
export function loadPrefs(raw: string | null, at = Date.now()): Prefs {
  if (!raw) return { ...defaultPrefs, orchestratorSeenAt: at };
  try {
    // Retired and dropped: orchestratorRect (the floating panel before ADR 0028); view, cols, rows, browserZone (the Mosaico and
    // Corsie views); navCollapsed (the icon-only sidebar); orchestratorPlacement, orchestratorTopHeight (the Orchestrator at the top);
    // browsersHidden (the retired "hide browsers" switch, #82: an opened browser always shows); feedOpen (the Orchestrator's
    // "Novità" feed, replaced by "N novità in attesa", #88); role (a composition of pages and agents, now workProfile).
    const { orchestratorRect: _a, view: _b, cols: _c, rows: _d, browserZone: _e, navCollapsed: _f, orchestratorPlacement: _g, orchestratorTopHeight: _h, browsersHidden: _i, feedOpen: _j, role: _k, workProfile, ...p } =
      JSON.parse(raw) as Partial<Prefs> & Record<'orchestratorRect' | 'view' | 'cols' | 'rows' | 'browserZone' | 'navCollapsed' | 'orchestratorPlacement' | 'orchestratorTopHeight' | 'browsersHidden' | 'feedOpen' | 'role', unknown>;
    return {
      ...defaultPrefs, ...p,
      appearance:readAppearance(p.appearance),
      chatPanelsV:p.chatPanelsV===2?2:p.chatPanelsV===1?1:0,
      chatExpanded:flags(p.chatExpanded),
      browserOpen:flags(p.browserOpen),
      treeCollapsed:flags(p.treeCollapsed),
      density: p.density === 'compact' ? 'compact' : 'comfortable',
      theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'system',
      newChat: { ...defaultPrefs.newChat, ...(p.newChat ?? {}) },
      orchestratorOpen: p.orchestratorOpen === true,
      // a size saved under an older default goes back to the new default once (ADR 0028, 2026-10-13: wider and lower)
      orchestratorSize: p.orchestratorSizeV === DEFAULT_V ? sizeOf(p.orchestratorSize) : null,
      orchestratorSizeV: DEFAULT_V,
      orchestratorSeenAt: typeof p.orchestratorSeenAt === 'number' && Number.isFinite(p.orchestratorSeenAt) ? p.orchestratorSeenAt : at,
      ...(typeof workProfile === 'string' ? { workProfile } : {}),
    };
  } catch { return { ...defaultPrefs, orchestratorSeenAt: at }; }
}

const sizeOf = (v: unknown): DockSize | null => {
  const r = v as Partial<DockSize> | null;
  return r && typeof r === 'object' && [r.w, r.h].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0) ? { w: r.w!, h: r.h! } : null;
};

function readPrefs(): Prefs {
  try { return loadPrefs(localStorage.getItem(PREFS_KEY)); } catch { return { ...defaultPrefs, orchestratorSeenAt: Date.now() }; }
}

export const ui = createStore<UiState>({
  prefs: readPrefs(), maximized: null, focusMode: null, focused: null, modal: null, confirm: null, orchestratorRenew: null, handoffChat: null, handoffSession: null, ctxHidden: {}, page: 'home',
  lanePeek: false, toasts: [], flash: null, focusReq: null, hidden: [], hiddenTabs: [], closing: [], later: false, announce: '', qwin: { open: false, first: null, call: 0, shown: false }, viewer: emptyViewer,
  map: false, pageArg: null, mapArg: null, history: [{ page: 'home' }], hist: 0, center: false, read: readRead(), highlight: null, toastDismissed: [],
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
export function savePrefs(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(ui.get().prefs)); } catch { /* storage off: keep in memory */ }
}
/** The work profile, saved at once (a stale choice from another window cannot overwrite a newer one: `expected`). */
export function saveWorkProfile(id: string | undefined, expected: string | undefined): void {
  const current = ui.get().prefs;
  if (current.workProfile !== expected) throw new Error('Work profile changed; choose again.');
  const { workProfile: _w, ...rest } = current;
  const next: Prefs = id === undefined ? rest : { ...rest, workProfile: id };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  ui.set(s => ({ ...s, prefs: next }));
}
/** Expansion is independent of transcript/draft state. Collapsing never unmounts the input or item list. */
export function setChatExpanded(id:string,expanded:boolean):void{
  setPrefs({chatExpanded:{...ui.get().prefs.chatExpanded,[id]:expanded}});
}
/** Show or hide a strip's own browsers beside it; showing them expands the strip too. */
export function setBrowserOpen(id:string,open:boolean):void{
  const {chatExpanded,browserOpen}=ui.get().prefs;
  setPrefs({browserOpen:{...browserOpen,[id]:open},...(open&&chatExpanded[id]!==true?{chatExpanded:{...chatExpanded,[id]:true}}:{})});
}
/** Fold or unfold a parent's delegated children (saved: the tree comes back as it was after a restart). */
export function setTreeCollapsed(id:string,collapsed:boolean):void{
  const next={...ui.get().prefs.treeCollapsed};
  if(collapsed)next[id]=true;else delete next[id];
  setPrefs({treeCollapsed:next});
}
// the window closed within the 150 ms (a resize, then ✕): the last change is still saved
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (saveTimer) savePrefs(); });

export const openModal = (modal: Modal) => ui.set(s => ({ ...s, modal }));
export const closeModal = () => ui.set(s => ({ ...s, modal: null, confirm: null, orchestratorRenew: null }));
export const openOrchestratorRenew = (orchestratorRenew: { chatId: string; to: Harness }) => ui.set(s => ({ ...s, modal: 'orchestratorRenew', orchestratorRenew }));
export const askConfirm = (confirm: ConfirmSpec) => ui.set(s => ({ ...s, modal: 'confirm', confirm }));
export const openHandoff = (chatId: string, session?: string) => ui.set(s => ({ ...s, modal: 'handoff', handoffChat: chatId, handoffSession: session ?? null }));
/** The × of the long-chat notice: hidden until the context grows by another quarter of the threshold (any tile of it). */
export const hideCtxNotice = (chatId: string, tokens: number) => ui.set(s => ({ ...s, ctxHidden: { ...s.ctxHidden, [chatId]: tokens } }));
export const setMaximized = (key: string | null) => ui.set(s => ({ ...s, maximized: key }));
export const setFocused = (key: string | null) => { if (ui.get().focused !== key) ui.set(s => ({ ...s, focused: key })); };
/** Low level: show a page without touching the history (use actions.go). */
export const openPage = (page: BrainPageId, arg: string | null = null) => ui.set(s => ({ ...s, page, pageArg: arg, map: false, maximized: null }));
export const setMap = (map: boolean, arg: string | null = null) => ui.set(s => ({ ...s, map, mapArg: map ? arg : null }));
export const setCenter = (center: boolean) => ui.set(s => ({ ...s, center }));
/** The Orchestrator widget expanded (the panel) or collapsed (the bar); remembered. Both ways its replies count as seen: what
 *  the open panel showed is read, the bar counts only what arrives after. */
export const setOrchestratorOpen = (orchestratorOpen: boolean) => { if (ui.get().prefs.orchestratorOpen !== orchestratorOpen) { setPrefs({ orchestratorOpen, orchestratorSeenAt: now() }); savePrefs(); } }; // a click, not a drag: saved at once
/** The Orchestrator tab shown (an Orchestrator's chat id); remembered. */
let hlN = 0;
export const highlight = (id: string) => ui.set(s => ({ ...s, highlight: { id, n: ++hlN } }));
export const dismissEventToasts = (ids: string[]) => ui.set(s => ({ ...s, toastDismissed: [...new Set([...s.toastDismissed, ...ids])].slice(-500) }));
export const setFocusMode = (chatId: string | null) => ui.set(s => ({ ...s, focusMode: chatId, maximized: null, lanePeek: false }));
export const setLanePeek = (lanePeek: boolean) => ui.set(s => ({ ...s, lanePeek }));
export const announce = (text: string) => ui.set(s => ({ ...s, announce: text }));

let flashN = 0;
export const flashTile = (key: string) => ui.set(s => ({ ...s, flash: { key, n: ++flashN } }));
/** Ask the chat's tile to focus its input once rendered (palette jump, ui:command focus, new chat). */
export const requestFocus = (chatId: string) => ui.set(s => ({ ...s, focusReq: { chatId, n: ++flashN } }));

let toastN = 0;
const MAX_TOASTS = 2; // calm notifications: a new one replaces the oldest
const toastTimers=new Map<number,ReturnType<typeof setTimeout>>();
export function toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action'], ttl = action ? 6000 : 4000): number {
  return pushToast(text,tone,action,ttl);
}
/** Render translated notifications in the current language, including a language change's own acknowledgement. */
export function toastKey(labelKey:TextKey,tone:Toast['tone']='info'):number{return pushToast('',tone,undefined,4000,labelKey);}
function pushToast(text:string,tone:Toast['tone'],action:Toast['action'],ttl:number,labelKey?:TextKey):number{
  expireToasts();
  const same=ui.get().toasts.find(item=>item.text===text&&item.labelKey===labelKey&&item.tone===tone&&(!item.action&&!action||item.action?.run===action?.run&&item.action?.label===action?.label));
  if(same)return same.id; // A repeat never extends its original deadline or replaces a different undo operation.
  ttl=Number.isFinite(ttl)?Math.max(0,Math.min(30000,ttl)):4000;
  const id = ++toastN;
  const next=[...ui.get().toasts,{id,text,labelKey,tone,action,ttl,expiresAt:Date.now()+ttl}].slice(-MAX_TOASTS);
  for(const old of ui.get().toasts)if(!next.some(item=>item.id===old.id))clearToastTimer(old.id);
  ui.set(s=>({...s,toasts:next}));
  toastTimers.set(id,setTimeout(()=>dismissToast(id),ttl));
  return id;
}
function clearToastTimer(id:number){const timer=toastTimers.get(id);if(timer!==undefined)clearTimeout(timer);toastTimers.delete(id);}
export function dismissToast(id:number){clearToastTimer(id);ui.set(s=>s.toasts.some(item=>item.id===id)?{...s,toasts:s.toasts.filter(item=>item.id!==id)}:s);}
/** Real wall-clock deadlines are independent of the frozen demo clock and catch up on focus/visibility changes. */
export function expireToasts(){for(const item of ui.get().toasts)if(item.expiresAt<=Date.now())dismissToast(item.id);}

export const setLater = (on: boolean) => ui.set(s => (s.later === on ? s : { ...s, later: on }));
export const setClosing = (chatId: string, on: boolean) => ui.set(s => ({ ...s, closing: on ? [...new Set([...s.closing, chatId])] : s.closing.filter(id => id !== chatId) }));
export const hideChat = (chatId: string, hidden: boolean) => ui.set(s => ({ ...s, hidden: hidden ? [...s.hidden, chatId] : s.hidden.filter(id => id !== chatId) }));
export const hideTab = (tabId: string, hidden: boolean) => ui.set(s => ({ ...s, hiddenTabs: hidden ? [...s.hiddenTabs, tabId] : s.hiddenTabs.filter(id => id !== tabId) }));

/** Is something covering the whole window (browser views must hide)? A dialog, the full-screen map or the file viewer. */
export const coversWorkspace = (s: UiState) => s.modal !== null || s.map || s.viewer.open;
/** The file viewer overlay (low level: actions.ts openViewer, closeViewer, viewerStep, toggleViewerFull). */
export const setViewer = (fn: (v: ViewerState) => ViewerState) => ui.set(s => { const viewer = fn(s.viewer); return viewer === s.viewer ? s : { ...s, viewer }; });

/** The questions window closes: "Rispondi dopo" (lib/later.ts) or the queue it was called for is empty. */
export const parkQuestions = () => ui.set(s => (s.qwin.open || s.qwin.first ? { ...s, qwin: { ...s.qwin, open: false, first: null } } : s));
/** Show the questions window now as the queue (Ctrl+J, the counter, "Apri" on a tile), with this request first. */
export const callQuestions = (key: string | null) => ui.set(s => ({ ...s, qwin: { ...s.qwin, open: true, first: key, call: s.qwin.call + 1, aside: false } }));
/** A file link clicked in the questions window: the window steps aside (a pill, nothing answered or put off) so the
 *  viewer it opened is in front; Ctrl+J, the pill or leaving the file page bring it back. */
export const setQuestionsAside = (aside: boolean) => { if (!!ui.get().qwin.aside !== aside) ui.set(s => ({ ...s, qwin: { ...s.qwin, aside } })); };
export const setQuestionsShown = (shown: boolean) => { if (ui.get().qwin.shown !== shown) ui.set(s => ({ ...s, qwin: { ...s.qwin, shown } })); };

/** Synchronous checkpoint of the actual in-memory preferences/read state; storage failures must propagate. */
export function checkpointUi():Record<string,string>{
  if(saveTimer)clearTimeout(saveTimer);saveTimer=null;
  const prefs=JSON.stringify(ui.get().prefs),read=JSON.stringify(ui.get().read);
  localStorage.setItem(PREFS_KEY,prefs);localStorage.setItem(READ_KEY,read);
  return {[PREFS_KEY]:prefs,[READ_KEY]:read};
}
export function restoreCheckpointUi():void{ui.set(state=>({...state,prefs:readPrefs(),read:readRead()}));}
