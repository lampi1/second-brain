// App-page side of the global layer (main/overlay.ts shows it above everything, browser tiles included). The app page
// is the one source of truth. Requests no longer float here: every open question, permission and command is answered
// in the questions window (QuestionsWindow.tsx, always on since 2026-10-22). What stays: important events
// (lib/notify.ts TOAST_KINDS) as at most two grouped toasts with one action, unless muted or do-not-disturb; they
// leave after 8 s, off the Orchestrator widget's corner (`avoid`, ADR 0028). A DevOps alert plays a short chime as it
// arrives (feed:events, lib/chime.ts, setting tasks.sound), and so does every new request (ADR 0035). The model is pushed
// to main only when it changes; what the user does in the layer comes back as overlay:action. Started by main.tsx.
import type { OverlayAction, OverlayCard, OverlayModel, OverlayToast } from '@shared/contract';
import { sb } from '../sb';
import { app, answer, dismissCommand, dndActive, runCommand } from '../store/store';
import { dismissEventToasts, setLayerHeld, setRead, ui } from '../store/ui';
import { answerLater, openQueue } from './later';
import { now } from './clock';
import { columnSize, viewport } from './orchestrator-dock';
import { linkOfEvent, markRead, toastGroups, type ToastGroup } from './notify';
import { playChime, requestChimes, toChime } from './chime';
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
let timer: ReturnType<typeof setTimeout> | null = null;

export function computeModel(): OverlayModel {
  const s = app.get();
  const u = ui.get();
  // every request is answered in the questions window (always on since 2026-10-22): the layer keeps only the toasts
  const cards: OverlayCard[] = [];
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
  return { cards, waiting: s.pending.length, avoid, theme: u.prefs.theme, lang: lang(), density: u.prefs.density, now: Math.floor(at / 15_000) * 15_000, toasts };
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

function onAction(a: OverlayAction, open: (chatId: string) => void, next: (from?: string) => void, openLink: (link: string) => void): void {
  const find = (key: string) => app.get().pending.find(p => keyOf(p) === key);
  if (a.kind === 'answer') { const req = find(a.key); if (req) void answer(req, a.answer); }
  else if (a.kind === 'postpone') { answerLater(a.key); void sb.invoke('overlay:focus', { target: 'app' }).catch(() => {}); }
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
