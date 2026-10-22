// App-page side of the global layer (main/overlay.ts shows it above everything, browser tiles included). The app page
// is the one source of truth. Tier a: the open questions/permissions NOT already visible somewhere on screen (needs
// lane, the chat's own tile, the Orchestrator's decision), oldest first; requests postponed with "Rispondi dopo" stay
// in "Da rispondere" (lib/later.ts); cards also wait while another request popup is on screen (the Orchestrator widget's card, the questions window): at most one popup at a
// time (the user, 2026-10-13: two popups of questions at once, one of them "appeso" on the Orchestrator). Tier b: important events
// (lib/notify.ts TOAST_KINDS) as at most two grouped toasts with one action, unless muted or do-not-disturb; they
// leave after 8 s. No waiting strip: what waits is counted by the top bar's "Da rispondere" (the user, 2026-10-14:
// "c'è già in alto il «da rispondere» che va benissimo quello"). All stay off the Orchestrator widget's corner (`avoid`, ADR 0028). A DevOps alert plays a short chime as it arrives (feed:events,
// lib/chime.ts, setting tasks.sound), and so does every new request, "Rispondi dopo" or not (ADR 0035). The model is pushed to main only when it changes. What the user does in the layer comes back here
// as overlay:action and goes through the same actions as everywhere else. Started by main.tsx; Ctrl+J uses focusLayer().
import type { OverlayAction, OverlayCard, OverlayModel, OverlayToast } from '@shared/contract';
import { chatName } from '@shared/orchestrator';
import { sb } from '../sb';
import { app, answer, attemptOf, dismissCommand, dndActive, runCommand } from '../store/store';
import { dismissEventToasts, setLayerHeld, setRead, ui } from '../store/ui';
import { answerLater, openQueue, requestPostponed } from './later';
import { now } from './clock';
import { columnSize, viewport } from './orchestrator-dock';
import { questionsModalOn } from './questions';
import { linkOfEvent, markRead, toastGroups, type ToastGroup } from './notify';
import { playChime, requestChimes, toChime } from './chime';
import { engineOf } from './engines';
import { lang, t } from '../i18n';

const TOAST_MS = 8000;
/** requests arriving within this window ring once */
const REQUEST_RING_MS = 400;
/** events already there when the app opened never toast (they are in the center): only what arrives while it is open */
let atStart: Set<string> | null = null;
let groups: ToastGroup[] = [];
/** event ids that already chimed (an event sent twice chimes once) */
const chimed = new Set<string>();
const toneOf = (kind: string): OverlayToast['tone'] => (kind === 'error' || kind === 'chat-failed' || kind.endsWith('-error') || kind.endsWith('-blocked') ? 'err' : kind === 'budget' || kind === 'login' || kind === 'chat-waiting' || kind === 'task-alert' ? 'warn' : kind === 'chat-done' ? 'ok' : 'info');

const keyOf = (r: { chatId: string; id: string }) => `${r.chatId}/${r.id}`;
let last = '';
let current: OverlayModel = { cards: [], waiting: 0, theme: 'system', density: 'comfortable' };
let focusKey: string | undefined;
let nonce = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Is this request panel on screen in the app page? */
function onScreen(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) return false;
  // inside a list that scrolls (a tile's requests): scrolled out of it is not on screen
  const box = el.closest<HTMLElement>('.tile-requests')?.getBoundingClientRect();
  return !(box && (r.bottom <= box.top || r.top >= box.bottom));
}

/** Request keys whose panel is on screen in the app page (and not under a dialog). */
export function visibleRequestKeys(): Set<string> {
  const out = new Set<string>();
  if (ui.get().modal) return out; // a dialog covers the page: nothing below it counts as visible
  if (!app.get().pending.length) return out; // no request anywhere: no panel to look for (and no forced layout)
  for (const el of document.querySelectorAll<HTMLElement>('[data-request-key]')) if (onScreen(el)) out.add(el.dataset.requestKey ?? '');
  // a collapsed Grindhouse strip shows its requests as its "waits for you" pill: on screen, they do not float
  for (const el of document.querySelectorAll<HTMLElement>('[data-waits-keys]')) if (onScreen(el)) for (const k of (el.dataset.waitsKeys ?? '').split(' ')) if (k) out.add(k);
  return out;
}

/** The key of the request card the Orchestrator widget shows on screen (it floats like the layer), if any. */
export function orchestratorCardOnScreen(): string | null {
  if (ui.get().modal || !app.get().pending.length) return null;
  const el = [...document.querySelectorAll<HTMLElement>('[data-orchestrator-overlay] [data-request-key]')].find(onScreen);
  return el?.dataset.requestKey ?? null;
}

/** A request popup is on screen in the app page: the Orchestrator widget's card or the questions window. Then the layer shows
 *  no card: never two popups at once. */
export const popupOnScreen = (): boolean => ui.get().qwin.shown || orchestratorCardOnScreen() !== null;

/** Would this request float in the layer, were no other popup on screen? (Ctrl+J to it: the popup moves there.) */
export const floatsBehindPopup = (key: string): boolean => computeModel(true).cards.some(c => c.key === key);

export function computeModel(ignorePopup = false): OverlayModel {
  const s = app.get();
  const u = ui.get();
  const visible = visibleRequestKeys();
  const cards: OverlayCard[] = [];
  // "Domande in finestra": the questions window shows them all (QuestionsWindow.tsx), the layer keeps only the toasts;
  // the same while the Orchestrator widget shows a request card (one popup at a time), unless the user is answering here
  // (the layer has the keyboard on a card still open: the Orchestrator's card waits instead, OrchestratorTile.tsx)
  const held = !!u.layerHeld && s.pending.some(p => keyOf(p) === u.layerHeld);
  for (const req of questionsModalOn(s) || (!ignorePopup && !held && popupOnScreen()) ? [] : s.pending) {
    const key = keyOf(req);
    if (requestPostponed(key) || u.hidden.includes(req.chatId) || visible.has(key)) continue;
    const c = s.chats[req.chatId];
    cards.push({ key, req, chatTitle: c ? chatName(c) : 'Chat', harness: c?.harness ?? 'claude', engine: (c && engineOf(c.harness)) ?? null, isOrchestrator: !!c?.isOrchestrator, attempt: attemptOf(key) });
  }
  if (focusKey && !cards.some(c => c.key === focusKey)) focusKey = undefined;
  // the card the keyboard is sent to (Ctrl+J) is the one shown in full
  if (focusKey) { const i = cards.findIndex(c => c.key === focusKey); if (i > 0) cards.unshift(...cards.splice(i, 1)); }
  const at = now();
  if (!atStart && s.ready) atStart = new Set(s.feed.map(e => e.id));
  groups = toastGroups(atStart ? s.feed.filter(e => !atStart!.has(e.id)) : [], {
    since: at - TOAST_MS, dismissed: new Set(u.toastDismissed), muted: s.settings?.mute ?? {}, dnd: dndActive(at),
    skipChats: new Set(s.pending.map(p => p.chatId)),
  });
  const toasts: OverlayToast[] = groups.map(g => ({
    id: g.id, kind: g.kind, label: g.label, title: g.title, detail: g.detail, count: g.count, tone: toneOf(g.kind),
    action: g.kind === 'chat-waiting' ? t('appText.layer.answer') : t('appText.layer.open'),
  }));
  const v = viewport();
  const size = columnSize(u.prefs.orchestratorSize, v, u.page === 'home' && !u.map);
  const reserve = { right: size.w, bottom: 0, top: 0 };
  // Workspace padding is relative to the shell. Native bounds need the absolute occupied bottom, including banners.
  const avoid = {...reserve,...(reserve.top?{top:v.top+reserve.top}:{})};
  return { cards, waiting: s.pending.length, avoid, theme: u.prefs.theme, lang: lang(), density: u.prefs.density, ...(focusKey ? { focusKey, nonce } : {}), now: Math.floor(at / 15_000) * 15_000, toasts };
}

function push(): void {
  timer = null;
  current = computeModel();
  const k = JSON.stringify(current);
  if (k === last) return;
  last = k;
  void sb.invoke('overlay:model', current).catch(() => { last = ''; });
}

/** After the DOM settles (a frame), recompute: lane/tiles may have just mounted or unmounted. */
export function scheduleLayer(): void {
  if (timer) return;
  timer = setTimeout(() => requestAnimationFrame(push), 30);
}

/** Is this request floating in the layer right now? Computed afresh (a push may still be scheduled: the Orchestrator's card
 *  that just came on screen must count). */
export const inLayer = (key: string): boolean => { push(); return current.cards.some(c => c.key === key); };

/** Move the keyboard to the layer, on that card (Ctrl+J). Never called automatically. */
export function focusLayer(key: string): void {
  focusKey = key;
  setLayerHeld(key);
  nonce++;
  push();
  void sb.invoke('overlay:focus', { target: 'overlay' }).catch(() => {});
}

function onAction(a: OverlayAction, open: (chatId: string) => void, next: (from?: string) => void, openLink: (link: string) => void): void {
  const find = (key: string) => app.get().pending.find(p => keyOf(p) === key);
  if (a.kind === 'answer') { const req = find(a.key); if (req) void answer(req, a.answer); }
  else if (a.kind === 'postpone') { answerLater(a.key); focusKey = undefined; void sb.invoke('overlay:focus', { target: 'app' }).catch(() => {}); }
  else if (a.kind === 'open') { const req = find(a.key); if (req) open(req.chatId); }
  else if (a.kind === 'run') { const req = find(a.key); if (req) void runCommand(req, !!a.confirmProd); }
  else if (a.kind === 'dismiss') { const req = find(a.key); if (req) void dismissCommand(req); }
  else if (a.kind === 'next') next(a.from);
  else if (a.kind === 'toast') {
    const g = groups.find(x => x.id === a.id);
    if (g) {
      dismissEventToasts(g.ids);
      setRead(r => markRead(r, g.ids));
      if (a.act === 'open') {
        const req = g.chatId ? app.get().pending.find(p => p.chatId === g.chatId) : undefined;
        if (req && g.kind === 'chat-waiting') openQueue(keyOf(req)); else openLink(linkOfEvent(g.event));
      }
    }
  }
  scheduleLayer();
}

let started = false;
export function startLayer(open: (chatId: string) => void, next: (from?: string) => void, openLink: (link: string) => void): void {
  if (started) return;
  started = true;
  // streamed text changes only `items`, which the layer never shows: recomputing on each of those frames was wasted
  // work; panels that scroll in or out of view are still caught by the 800 ms pass below
  let seen = app.get();
  app.subscribe(() => {
    const s = app.get();
    const same = (Object.keys(s) as (keyof typeof s)[]).every(k => k === 'items' || s[k] === seen[k]);
    seen = s;
    if (!same) scheduleLayer();
  });
  ui.subscribe(scheduleLayer);
  sb.on('overlay:action', a => onAction(a, open, next, openLink));
  // the chime on arrival: a minimized window repaints the toasts late (throttled timers), the IPC event is not
  sb.on('feed:events', evs => {
    const s = app.get();
    const ring = toChime(evs, chimed, { soundOn: s.settings?.tasks?.sound !== false, muted: s.settings?.mute ?? {}, dnd: dndActive(now()) });
    if (ring.length) { for (const id of ring) chimed.add(id); playChime(); }
  });
  // every new request rings once (several arriving together ring once), also while "Rispondi dopo" keeps them quiet
  let ringing: ReturnType<typeof setTimeout> | null = null;
  sb.on('pending:added', () => {
    const s = app.get();
    if (ringing || !requestChimes({ soundOn: s.settings?.tasks?.sound !== false, muted: s.settings?.mute ?? {}, dnd: dndActive(now()) })) return;
    ringing = setTimeout(() => { ringing = null; playChime(); }, REQUEST_RING_MS);
  });
  window.addEventListener('resize', scheduleLayer);
  window.addEventListener('focus', () => setLayerHeld(null)); // the keyboard is back in the app: the layer holds nothing
  setInterval(push, 800); // panels scrolled in/out of view, tiles resized: cheap and only sends on change
  scheduleLayer();
}
