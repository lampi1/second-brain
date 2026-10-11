// App-page side of the global layer (main/overlay.ts shows it above everything, browser tiles included). The app page
// is the one source of truth. Tier a: the open questions/permissions NOT already visible somewhere on screen (needs
// lane, the chat's own tile, the Regia's decision) and not postponed with Esc, oldest first. Tier b: important events
// (lib/notify.ts TOAST_KINDS) as at most two grouped toasts with one action, unless muted or do-not-disturb; they
// leave after 8 s. The model is pushed to main only when it changes. What the user does in the layer comes back here
// as overlay:action and goes through the same actions as everywhere else. Started by main.tsx; Ctrl+J uses focusLayer().
import type { OverlayAction, OverlayCard, OverlayModel, OverlayToast } from '@shared/contract';
import { sb } from '../sb';
import { app, answer, attemptOf, dndActive } from '../store/store';
import { dismissEventToasts, postpone, setRead, ui } from '../store/ui';
import { now } from './clock';
import { linkOfEvent, markRead, toastGroups, type ToastGroup } from './notify';

const TOAST_MS = 8000;
/** events already there when the app opened never toast (they are in the center): only what arrives while it is open */
let atStart: Set<string> | null = null;
let groups: ToastGroup[] = [];
const toneOf = (kind: string): OverlayToast['tone'] => (kind === 'error' || kind.endsWith('-error') || kind.endsWith('-blocked') ? 'err' : kind === 'budget' || kind === 'login' || kind === 'chat-waiting' ? 'warn' : kind === 'chat-done' ? 'ok' : 'info');

const keyOf = (r: { chatId: string; id: string }) => `${r.chatId}/${r.id}`;
let last = '';
let current: OverlayModel = { cards: [], waiting: 0, theme: 'system', density: 'comfortable' };
let focusKey: string | undefined;
let nonce = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Request keys whose panel is on screen in the app page (and not under a dialog). */
export function visibleRequestKeys(): Set<string> {
  const out = new Set<string>();
  if (ui.get().modal) return out; // a dialog covers the page: nothing below it counts as visible
  const W = window.innerWidth;
  const H = window.innerHeight;
  for (const el of document.querySelectorAll<HTMLElement>('[data-request-key]')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.right <= 0 || r.bottom <= 0 || r.left >= W || r.top >= H) continue;
    out.add(el.dataset.requestKey ?? '');
  }
  return out;
}

export function computeModel(): OverlayModel {
  const s = app.get();
  const u = ui.get();
  const visible = visibleRequestKeys();
  const cards: OverlayCard[] = [];
  for (const req of s.pending) {
    const key = keyOf(req);
    if (u.hidden.includes(req.chatId) || u.postponed.includes(key) || visible.has(key)) continue;
    const c = s.chats[req.chatId];
    cards.push({ key, req, chatTitle: c?.isRegia ? 'Regia' : (c?.title ?? 'Chat'), harness: c?.harness ?? 'claude', isRegia: !!c?.isRegia, attempt: attemptOf(key) });
  }
  if (focusKey && !cards.some(c => c.key === focusKey)) focusKey = undefined;
  // the card the keyboard is sent to (Ctrl+J) is the one shown in full
  if (focusKey) { const i = cards.findIndex(c => c.key === focusKey); if (i > 0) cards.unshift(...cards.splice(i, 1)); }
  const t = now();
  if (!atStart && s.ready) atStart = new Set(s.feed.map(e => e.id));
  groups = toastGroups(atStart ? s.feed.filter(e => !atStart!.has(e.id)) : [], {
    since: t - TOAST_MS, dismissed: new Set(u.toastDismissed), muted: s.settings?.mute ?? {}, dnd: dndActive(t),
    skipChats: new Set(s.pending.map(p => p.chatId)),
  });
  const toasts: OverlayToast[] = groups.map(g => ({
    id: g.id, kind: g.kind, label: g.label, title: g.title, detail: g.detail, count: g.count, tone: toneOf(g.kind),
    action: g.kind === 'chat-waiting' ? 'Rispondi' : 'Apri',
  }));
  return { cards, waiting: s.pending.length, theme: u.prefs.theme, density: u.prefs.density, ...(focusKey ? { focusKey, nonce } : {}), now: Math.floor(t / 15_000) * 15_000, toasts };
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

/** Is this request floating in the layer right now? */
export const inLayer = (key: string): boolean => current.cards.some(c => c.key === key);

/** Move the keyboard to the layer, on that card (Ctrl+J). Never called automatically. */
export function focusLayer(key: string): void {
  focusKey = key;
  nonce++;
  push();
  void sb.invoke('overlay:focus', { target: 'overlay' }).catch(() => {});
}

function onAction(a: OverlayAction, open: (chatId: string) => void, next: (from?: string) => void, openLink: (link: string) => void): void {
  const find = (key: string) => app.get().pending.find(p => keyOf(p) === key);
  if (a.kind === 'answer') { const req = find(a.key); if (req) void answer(req, a.answer); }
  else if (a.kind === 'postpone') { postpone(a.key); focusKey = undefined; void sb.invoke('overlay:focus', { target: 'app' }).catch(() => {}); }
  else if (a.kind === 'open') { const req = find(a.key); if (req) open(req.chatId); }
  else if (a.kind === 'next') next(a.from);
  else if (a.kind === 'toast') {
    const g = groups.find(x => x.id === a.id);
    if (g) {
      dismissEventToasts(g.ids);
      setRead(r => markRead(r, g.ids));
      if (a.act === 'open') {
        const req = g.chatId ? app.get().pending.find(p => p.chatId === g.chatId) : undefined;
        if (req && g.kind === 'chat-waiting') next(); else openLink(linkOfEvent(g.event));
      }
    }
  }
  scheduleLayer();
}

let started = false;
export function startLayer(open: (chatId: string) => void, next: (from?: string) => void, openLink: (link: string) => void): void {
  if (started) return;
  started = true;
  app.subscribe(scheduleLayer);
  ui.subscribe(scheduleLayer);
  sb.on('overlay:action', a => onAction(a, open, next, openLink));
  window.addEventListener('resize', scheduleLayer);
  setInterval(push, 800); // panels scrolled in/out of view, tiles resized: cheap and only sends on change
  scheduleLayer();
}
