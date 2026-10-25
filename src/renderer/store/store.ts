// The live data store: window.sb events (chat:updated/item/removed, pending:added/resolved, browser:tabs,
// feed:events, usage) and the initial loads feed the pure reducer of state.ts; components read it through `useApp`
// with selectors, so streaming one chat re-renders only that chat's tile. The actions here are the only place the UI
// calls main (invoke), with optimistic updates and an error toast with the cause on failure.
// Used by every component; App.tsx calls startStore() once.
import type { Answer, ChatSummary, CliStatus, Effort, HandoffInfo, Harness, ImageAttachment, NewChat, PendingRequest, PermissionMode, RoutedNewChat, SettingsPatch } from '@shared/contract';
import { sb as rawSb } from '../sb';
import {trackBridge} from '../lib/tracked-bridge';
let localActions=0;
// All store IPC actions, including optimistic pending removal, hold the checkpoint until completion.
const sb=trackBridge(rawSb,delta=>{localActions+=delta;});
import {updateIsFrozen} from '../lib/update-barrier';
import { createStore } from './createStore';
import { t, locale } from '../i18n';
import { connectAutoClose } from './auto-close';
import { initialState, isBusy, reduce, toFlush, type Action, type AppState, type QueuedMsg } from './state';
import { announce, hideChat, hideTab, setPrefs, toast,toastKey, ui } from './ui';
import { noteLine, UNDO_MS, type NoteKind } from '../lib/sendable';
import { setMark, type Mark } from '../lib/marks';
import { canCorrectAtNextStep, cleanQuote, correctionBlocked, correctionText } from '../lib/correction';
import { now as clockNow } from '../lib/clock';
import { costHistory } from '../lib/live-costs';

export const app = createStore<AppState>(initialState, { batch: true });
/** How often streamed text reaches the screen (startStore). */
export const STREAM_MS = 100;
export const useApp = app.use;

export function dispatch(a: Action): void {
  const prev = app.get();
  const next = reduce(prev, a);
  if (next === prev) return;
  app.set(next);
  if (a.type === 'chat:updated') {
    // a message still on its way to main: an idle reported meanwhile is older than it (the turn it starts reports
    // running once main has it), so the queue waits for its own turn (sendNow's end checks again)
    const msg = inFlight.has(a.chat.id) ? null : toFlush(prev.chats[a.chat.id], a.chat, next.queued[a.chat.id]);
    if (msg) flushOne(a.chat.id, msg);
    // free again with only notes to tell (a Mandato or Non serve while it worked): one message for all of them
    else if (isFree(a.chat) && !(prev.chats[a.chat.id] && isFree(prev.chats[a.chat.id]!))) tellNotes(a.chat.id);
  }
  if (a.type === 'pending:added') {
    const c = next.chats[a.req.chatId];
    announce(t('appText.store.waitsForYou', { title: c?.title ?? t('appText.store.aChat'), req: a.req.title }));
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
const fail = (what: string) => (e: unknown) => { toast(`${what}: ${errText(e)}`, 'err'); };

/** Explicit user request: reading the result remains free of inference. */
export async function synthesizeResult(runId: string): Promise<boolean> {
  try { await sb.invoke('chat:synthesize', { runId }); return true; }
  catch (e) { fail(t('chat.resultSynthesize'))(e); return false; }
}

let started = false;
/** Subscribe to main's events (buffered until the first load lands), then load everything once. */
export function startStore(): void {
  if (started) return;
  started = true;
  connectAutoClose({
    get: () => sb.invoke('chat:autoCloseGet', undefined),
    presence: holds => sb.invoke('chat:autoClosePresence', { holds }),
    keep: (chatId, keep) => sb.invoke('chat:autoCloseKeep', { chatId, keep }),
    listen: accept => sb.on('chat:autoCloseStatus', accept),
  });
  let loaded = false;
  const buffer: Action[] = [];
  const now = (a: Action) => (loaded ? dispatch(a) : buffer.push(a));
  // Streamed text comes as new versions of the same item (main sends one per chat every ~100 ms): they are applied
  // together every STREAM_MS, so every chat that changed shows its new words in the same single render, a step at a
  // time instead of word by word ("Lag nell'app", owner 2026-10-12). Anything else first applies what is held, so
  // the order on screen never changes (a chat never reads "finito" above words still to come).
  const held = new Map<string, Action>();
  let heldTimer: ReturnType<typeof setTimeout> | null = null;
  const release = () => {
    if (heldTimer) { clearTimeout(heldTimer); heldTimer = null; }
    const all = [...held.values()];
    held.clear();
    for (const a of all) now(a);
  };
  const put = (a: Action) => { if (held.size) release(); now(a); };
  // each chat's cost over time: the live total needs what it was when cost.mjs last read (lib/live-costs.ts)
  sb.on('chat:updated', chat => { costHistory.note(chat.id, chat.costUsd, Date.now()); put({ type: 'chat:updated', chat }); });
  sb.on('chat:removed', ({ chatId }) => { costHistory.forget(chatId); put({ type: 'chat:removed', chatId }); });
  sb.on('chat:item', ({ chatId, item, replace }) => {
    if (!replace) { put({ type: 'chat:item', chatId, item, replace }); return; }
    held.set(`${chatId}/${item.id}`, { type: 'chat:item', chatId, item, replace });
    heldTimer ??= setTimeout(release, STREAM_MS);
  });
  sb.on('pending:added', req => put({ type: 'pending:added', req }));
  sb.on('pending:resolved', ({ chatId, requestId }) => put({ type: 'pending:resolved', chatId, requestId }));
  sb.on('browser:tabs', tabs => put({ type: 'browser:tabs', tabs }));
  sb.on('feed:events', events => put({ type: 'feed:events', events }));
  sb.on('usage', usage => put({ type: 'usage', usage }));
  sb.on('cli:ready', cli => put({ type: 'cli', cli }));
  sb.on('engines:changed', engines => put({ type: 'engines', engines }));
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
    for (const c of chats) costHistory.note(c.id, c.costUsd, Date.now());
    dispatch({ type: 'init', chats, pending, tabs, feed, usage, info });
    loaded = true;
    for (const a of buffer.splice(0)) dispatch(a);
    for (const c of chats) void loadItems(c.id);
  });
}

/** The theme lives in the app settings too (config.json, ADR 0005/0008): read it at start, follow changes made
 *  elsewhere (an agent, another window) and save the user's own switches. localStorage keeps working without them. */
let settingsPending=false;
function syncSettings(): void {
  let known: string | null = null;
  void sb.invoke('settings:get', undefined).then(s => {
    known = s.theme;
    dispatch({ type: 'settings', settings: s });
    setPrefs({ theme: s.theme });
  }).catch(() => {});
  let timer: ReturnType<typeof setTimeout> | null = null;
  sb.on('settings:changed', c => {
    dispatch({ type: 'settings', settings: c.settings });
    // a newer local choice is waiting to be saved: an older echo (light, then dark at once) must not undo it
    if (timer) return;
    known = c.settings.theme;
    if (c.key === 'theme') setPrefs({ theme: c.settings.theme });
  });
  ui.subscribe(() => {
    const p = ui.get().prefs;
    if (known === null) return;
    // back to the saved value before the pending save (light, then dark at once): that save must not happen
    if (known === p.theme) { if (timer) { clearTimeout(timer); timer = null; settingsPending=false; } return; }
    if (timer) clearTimeout(timer);
    settingsPending=true;
    timer = setTimeout(() => {
      timer = null;settingsPending=false;
      known = p.theme;
      void sb.invoke('settings:set', { theme: p.theme }).catch(() => {});
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

/** Chats with a message sent to main whose chat:send has not returned yet (how many). Main reports the turn's
 *  "running" before it returns (same IPC pipe, in order), so until then the chat counts as busy: a message typed
 *  meanwhile is queued, never sent past the queue, and an idle the old turn reported late flushes nothing. */
const inFlight = new Map<string, number>();
const busyNow = (chatId: string, c: ChatSummary | undefined): boolean => inFlight.has(chatId) || (!!c && (isBusy(c) || c.state === 'waiting' || c.pending > 0));

/** The first queued message leaves (the chat went free): shown running at once, like a message sent by hand. */
function flushOne(chatId: string, msg: QueuedMsg): void {
  if(updateIsFrozen())return;
  dispatch({ type: 'unqueue', chatId, id: msg.id });
  const before = app.get().chats[chatId];
  if (before) dispatch({ type: 'chat:updated', chat: { ...before, state: 'running' } });
  void sendNow(chatId, withNotes(chatId, msg), before, app.get().chats[chatId]);
}

async function sendNow(chatId: string, msg: QueuedMsg, before?: ChatSummary, optimistic?: ChatSummary): Promise<void> {
  inFlight.set(chatId, (inFlight.get(chatId) ?? 0) + 1);
  const done = () => { const n = (inFlight.get(chatId) ?? 1) - 1; if (n > 0) inFlight.set(chatId, n); else inFlight.delete(chatId); };
  try {
    await sb.invoke('chat:send', { chatId, text: msg.text, ...(msg.images?.length ? { images: [...msg.images] } : {}), ...(msg.voice ? { voice: true } : {}) });
    done();
    // main took it and the chat is free again (a turn that already ended, a hand-off turn): the queue goes on
    const c = app.get().chats[chatId], next = app.get().queued[chatId]?.[0];
    if (c && next && !busyNow(chatId, c)) flushOne(chatId, next);
    else tellNotes(chatId); // notes that came while it was on its way (tellNotes checks the chat is free)
  } catch (e) {
    fail(t('appText.store.notSent'))(e);
    // roll back only our optimistic copy: a newer chat:updated from main (an error, a state) wins
    if (before && optimistic && app.get().chats[chatId] === optimistic) dispatch({ type: 'chat:updated', chat: before });
    // images main refused would fail the same way at every retry: the text goes back without them
    const refused = !!msg.images?.length && /^(Immagine \d+:|Immagini|Troppe immagini)/.test(errText(e));
    const back: QueuedMsg = refused ? { id: msg.id, text: msg.text, ...(msg.voice ? { voice: true as const } : {}) } : msg;
    // back at the head of the queue: it goes before the messages queued after it
    if (back.text || back.images?.length) dispatch({ type: 'queue', chatId, msg: back, front: true });
    done(); // after the roll back: its idle flushes nothing, the failed message stays first (no retry loop)
  }
}

let localN = 0;
/** Enter in a chat input: send now, or queue it while the chat is busy or waiting on a request (sent when idle).
 *  images: pasted or dropped screenshots (lib/images.ts); a message may be images only. */
export function send(chatId: string, text: string, images: readonly ImageAttachment[] = [], opts: { voice?: boolean } = {}): 'sent' | 'queued' | 'empty' {
  if(updateIsFrozen())return 'empty';
  const own = text.trim();
  if (!own && !images.length) return 'empty';
  const c = app.get().chats[chatId];
  // queued: the notes stay apart and ride on it when it leaves (the flush: withNotes), so removing it loses none
  const voice = opts.voice ? { voice: true as const } : {};
  if (busyNow(chatId, c)) { dispatch({ type: 'queue', chatId, msg: { id: `q:${++localN}`, text: own, ...(images.length ? { images } : {}), ...voice } }); return 'queued'; }
  // the notes waiting for this chat ride on the user's message
  return sendOut(chatId, [own, takeNotes(chatId).join('\n')].filter(Boolean).join('\n\n'), images, c, !!opts.voice);
}

/** Send now (the chat is free): the optimistic copy, then main. */
function sendOut(chatId: string, t: string, images: readonly ImageAttachment[], c: ChatSummary | undefined, voice = false): 'sent' {
  const msg: QueuedMsg = { id: `q:${++localN}`, text: t, ...(images.length ? { images } : {}), ...(voice ? { voice: true as const } : {}) };
  // optimistic: the message and the state pill change at once; main's own user item replaces the copy
  const thumbs = images.flatMap(im => (im.thumb ? [im.thumb] : []));
  dispatch({ type: 'chat:item', chatId, item: { kind: 'user', id: `local:${++localN}`, at: Date.now(), text: t, ...(images.length ? { images: images.length } : {}), ...(thumbs.length ? { thumbs } : {}) } });
  if (c) dispatch({ type: 'chat:updated', chat: { ...c, state: 'running' } });
  void sendNow(chatId, msg, c, app.get().chats[chatId]);
  return 'sent';
}

// ---------------------------------------------------------------- notes: what the user did with a block (ADR 0038)

/** A note for the chat: "[Mandato] …" (told now if the chat is idle, else with its next message), "[Copiato] …" (only
 *  with the user's next message: copying is not sending), "[Non serve] …" (a command card dismissed: like Mandato). */
interface Note { key: string; kind: NoteKind; line: string }
const notes = new Map<string, Note[]>();
const undos = new Map<string, { timer: ReturnType<typeof setTimeout>; before: Mark | null }>();

// free = idle, nothing asked, no hand-off being written (like main/run/results.ts)
const isFree = (c: ChatSummary): boolean => c.state === 'idle' && !c.pending && !c.handoffBusy;
const tellable = (chatId: string): boolean => !!notes.get(chatId)?.some(n => n.kind !== 'copied');
function takeNotes(chatId: string): string[] {
  const list = notes.get(chatId) ?? [];
  notes.delete(chatId);
  return list.map(n => n.line);
}
function withNotes(chatId: string, msg: QueuedMsg): QueuedMsg {
  const extra = takeNotes(chatId);
  return extra.length ? { ...msg, text: [msg.text, extra.join('\n')].filter(Boolean).join('\n\n') } : msg;
}
function addNote(chatId: string, n: Note): void {
  // one note per block: Mandato replaces its Copiato
  notes.set(chatId, [...(notes.get(chatId) ?? []).filter(x => x.key !== n.key), n]);
  const c = app.get().chats[chatId];
  if (n.kind !== 'copied' && c && isFree(c)) tellNotes(chatId);
}
/** A free chat with a note that must be told (Mandato, Non serve): one short message with every waiting note. Never
 *  queued, and a closed chat is never woken by it (the notes go with its next message). */
function tellNotes(chatId: string): void {
  if(updateIsFrozen())return;
  const c = app.get().chats[chatId];
  if (!c || !isFree(c) || inFlight.has(chatId) || !tellable(chatId)) return; // a message on its way: after its reply
  sendOut(chatId, takeNotes(chatId).join('\n'), [], c);
}

/** Copia on a text-to-send block: "Copiato hh:mm" on the block; the chat hears it with the user's next message. */
export function markCopied(chatId: string, key: string, code: string): void {
  if (undos.has(key)) return; // a Mandato being undone stays the block's mark
  const m = setMark(key, { kind: 'copied', at: clockNow() });
  if (m?.kind === 'sent') { setMark(key, m); return; } // already sent: copying again changes nothing
  addNote(chatId, { key, kind: 'copied', line: noteLine('copied', code) });
}

/** Mandato: the block shows "Mandato ✓ hh:mm" at once; the chat is told after UNDO_MS (undoSent cancels it). */
export function markSent(chatId: string, key: string, code: string): void {
  if (undos.has(key)) return;
  const before = setMark(key, { kind: 'sent', at: clockNow() });
  const timer = setTimeout(() => {
    undos.delete(key);
    addNote(chatId, { key, kind: 'sent', line: noteLine('sent', code) });
  }, UNDO_MS);
  undos.set(key, { timer, before });
}

/** Annulla within UNDO_MS: the block gets its previous mark back and the chat hears nothing. */
export function undoSent(key: string): boolean {
  const u = undos.get(key);
  if (!u) return false;
  clearTimeout(u.timer);
  undos.delete(key);
  setMark(key, u.before);
  return true;
}
export const canUndo = (key: string): boolean => undos.has(key);

export const unqueue = (chatId: string, id: string) => dispatch({ type: 'unqueue', chatId, id });

/** "Invia subito" on a queued message: it moves to the front of the queue and the chat's turn is interrupted (Claude:
 *  stream-json `interrupt`; Cursor: ACP `session/cancel`, open panels answered "cancelled"). The message itself is
 *  sent by the one flush path above, when the chat reports idle after the interrupt: sent exactly once, never lost
 *  (if the interrupt fails it stays first in the queue and goes when the turn ends). Order with several queued: the
 *  chosen one first, then the others in the order they were typed, one per turn as before. A chat that is not busy
 *  (e.g. a message re-queued after a failed send) gets it at once, with no interrupt. Messages the engine itself
 *  already holds (sent by an agent over app_send_to_chat) are kept, not cancelled: they were sent earlier and go first.
 *  Resolves 'sent' | 'interrupting' (the flush will send it) | 'failed' (still queued) | 'none' (no such message). */
let queuedActions=0;
export async function sendQueuedNow(chatId:string,id:string):Promise<'sent'|'interrupting'|'failed'|'none'>{
  if(updateIsFrozen())return 'failed';queuedActions++;try{return await sendQueuedNowImpl(chatId,id);}finally{queuedActions--;}
}
async function sendQueuedNowImpl(chatId: string, id: string): Promise<'sent' | 'interrupting' | 'failed' | 'none'> {
  if(updateIsFrozen())return 'failed';
  const s = app.get();
  const msg = s.queued[chatId]?.find(m => m.id === id);
  if (!msg) return 'none';
  const c = s.chats[chatId];
  if (!busyNow(chatId, c)) {
    dispatch({ type: 'unqueue', chatId, id });
    send(chatId, msg.text, msg.images ?? [], { voice: !!msg.voice });
    return 'sent';
  }
  dispatch({ type: 'promote', chatId, id });
  try { await sb.invoke('chat:stop', { chatId, keepQueued: true }); return 'interrupting'; }
  catch (e) { fail(t('appText.store.interruptFailed'))(e); return 'failed'; }
}

/** "Correggi il pensiero" (ADR 0058, lib/correction.ts): a sentence of the chat's reasoning and the user's fix.
 *  stop = the turn is interrupted and the correction runs next (the "Invia subito" path: first in the queue, sent once by
 *  the flush when the chat reports idle); step = Claude only: sent into the running turn, the CLI reads it after its next
 *  tool step (no work lost, but a turn with no more tools reads it only at its end). A chat no longer busy gets it as a
 *  normal message. Refused (nothing sent) while the chat waits on a question or permission: the stop would cancel it.
 *  Resolves what happened, or the reason it was refused. */
export async function correctThought(chatId: string, quote: string, fix: string, mode: 'stop' | 'step'): Promise<{ done: 'sent' | 'stopping' | 'step' | 'failed' } | { blocked: string }> {
  if(updateIsFrozen())return {blocked:t('appText.store.correctionUpdating')};
  const text = correctionText(quote, fix);
  if (!cleanQuote(quote) || !fix.trim()) return { blocked: t('appText.store.writeCorrection') };
  const s = app.get();
  const c = s.chats[chatId];
  const why = correctionBlocked(c, s.pending.some(p => p.chatId === chatId));
  if (why) return { blocked: why };
  if (!busyNow(chatId, c)) { send(chatId, text); return { done: 'sent' }; }
  if (mode === 'step' && canCorrectAtNextStep(c)) {
    // main delivers a message into a running turn at once (manager.send: midTurn); a failure puts it first in the queue
    void sendNow(chatId, { id: `q:${++localN}`, text });
    return { done: 'step' };
  }
  dispatch({ type: 'queue', chatId, msg: { id: `q:${++localN}`, text }, front: true });
  try { await sb.invoke('chat:stop', { chatId, keepQueued: true }); return { done: 'stopping' }; }
  catch (e) { fail(t('appText.store.correctionStopFailed'))(e); return { done: 'failed' }; }
}

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
    if (/non è più aperta|scaduta|no longer open/i.test(msg)) { toast(t('appText.store.requestClosed', { error: msg }), 'info'); return false; }
    const key = `${req.chatId}/${req.id}`;
    attempts.set(key, attemptOf(key) + 1);
    dispatch({ type: 'pending:added', req });
    fail(t('appText.store.answerNotSent'))(e);
    return false;
  }
}

/** A Strategist's proposed plan (ADR 0108): «Approva e parti», or «Cambia qualcosa» with what to change; false = not sent. */
export async function planDecide(chatId: string, decision: 'approve' | 'change', at: number, text?: string): Promise<boolean> {
  try { await sb.invoke('chat:plan', { chatId, decision, at, ...(decision === 'change' ? { text } : {}) }); return true; }
  catch (e) { fail(t('appText.store.planAnswerNotSent'))(e); return false; }
}

/** "Comando da eseguire" → Esegui: the block runs in the chat that proposed it (main checks it is a block of that
 *  message; confirmProd = the second click on a production one). main resolves the request when the run starts; the
 *  output stays under the block in that chat. Resolves true when it started. */
export async function runCommand(req: PendingRequest, confirmProd = false): Promise<boolean> {
  const c = req.command;
  if (!c) return false;
  try {
    await sb.invoke('run:start', { chatId: req.chatId, itemId: c.itemId, code: c.code, lang: c.lang, ...(confirmProd ? { confirmProd: true } : {}) });
    const chat = app.get().chats[req.chatId];
    toast(t('appText.store.commandStarted', { chat: chat?.isOrchestrator ? 'Orchestrator' : `«${chat?.title ?? ''}»` }), 'ok');
    return true;
  } catch (e) {
    // the card comes back usable everywhere (the layer re-mounts it: its key carries the attempt)
    const key = `${req.chatId}/${req.id}`;
    attempts.set(key, attemptOf(key) + 1);
    dispatch({ type: 'pending:added', req });
    fail(t('appText.store.commandNotStarted'))(e);
    return false;
  }
}

/** "Non serve" on a command request: gone at once; back if main refuses for another reason than "no longer open". */
export async function dismissCommand(req: PendingRequest): Promise<void> {
  dispatch({ type: 'pending:resolved', chatId: req.chatId, requestId: req.id });
  try {
    await sb.invoke('run:dismiss', { chatId: req.chatId, requestId: req.id });
    // the chat learns the user will not run it (the user, 2026-10-13: "devi capire meglio da sola quando finisco")
    if (req.command) addNote(req.chatId, { key: `cmd:${req.chatId}/${req.id}`, kind: 'dismissed', line: noteLine('dismissed', req.command.code) });
  } catch (e) {
    if (/non è più aperta/i.test(errText(e))) return;
    const key = `${req.chatId}/${req.id}`;
    attempts.set(key, attemptOf(key) + 1);
    dispatch({ type: 'pending:added', req });
    fail(t('appText.store.dismissFailed'))(e);
  }
}

export async function stop(chatId: string): Promise<void> {
  try { await sb.invoke('chat:stop', { chatId }); } catch (e) { fail(t('appText.store.stopFailed'))(e); }
}

export async function stopAll(): Promise<number> {
  try {
    const n = await sb.invoke('chat:stopAll', undefined);
    toast(t('appText.store.stopped', { n }), 'ok');
    return n;
  } catch (e) { fail(t('appText.store.stopAllFailed'))(e); return 0; }
}

export async function createChat(req: NewChat): Promise<ChatSummary | null> {
  try {
    const c = await sb.invoke('chat:create', req);
    dispatch({ type: 'chat:updated', chat: c });
    void loadItems(c.id);
    return c;
  } catch (e) { fail(t('appText.store.chatNotCreated'))(e); return null; }
}

/** A chat whose engine, model and effort the routing table picks in main ("Nuova chat", a new Orchestrator; ADR 0032). */
export async function createRoutedChat(req: RoutedNewChat): Promise<ChatSummary | null> {
  try {
    const c = await sb.invoke('chat:createRouted', req);
    dispatch({ type: 'chat:updated', chat: c });
    void loadItems(c.id);
    return c;
  } catch (e) { fail(t('appText.store.chatNotCreated'))(e); return null; }
}

/** The Orchestrator, made once on the engine the user picked (main: single-flight, in the brain folder; an existing
 *  one is returned as is). null = failed (told). */
export async function ensureOrchestrator(harness: Harness): Promise<ChatSummary | null> {
  try {
    const c = await sb.invoke('orchestrator:ensure', { harness });
    dispatch({ type: 'chat:updated', chat: c });
    void loadItems(c.id);
    return c;
  } catch (e) { fail(t('appText.store.orchestratorNotCreated'))(e); return null; }
}

export async function setChat(chatId: string, patch: { model?: string; effort?: Effort; permissionMode?: PermissionMode; title?: string; workStatus?: 'assigned'|'waiting-mail'|'completed' }): Promise<void> {
  const c = app.get().chats[chatId];
  if (c) dispatch({ type: 'chat:updated', chat: { ...c, ...patch, model: patch.model !== undefined ? patch.model || null : c.model } as ChatSummary });
  try { dispatch({ type: 'chat:updated', chat: await sb.invoke('chat:set', { chatId, ...patch }) }); }
  catch (e) { if (c) dispatch({ type: 'chat:updated', chat: c }); fail(t('appText.store.settingNotSaved'))(e); }
}

// ---- long chats: the hand-off note and "Riprendi" (a new chat that starts from it)

/** The chat writes its hand-off now (one short turn; the app builds one itself when the chat cannot). */
export async function writeHandoff(chatId: string): Promise<HandoffInfo | null> {
  const c = app.get().chats[chatId];
  if (c) dispatch({ type: 'chat:updated', chat: { ...c, handoffBusy: true } });
  try {
    const h = await sb.invoke('chat:handoff', { chatId });
    toast(t(h.source === 'chat' ? 'appText.store.handoffSaved' : 'appText.store.handoffAutoSaved'), 'ok');
    return h;
  } catch (e) {
    const now = app.get().chats[chatId];
    if (now?.handoffBusy) { const { handoffBusy: _, ...rest } = now; dispatch({ type: 'chat:updated', chat: rest }); }
    fail(t('appText.store.handoffNotWritten'))(e);
    return null;
  }
}

export async function readHandoff(chatId: string, session?: string | null): Promise<HandoffInfo | null> {
  try { return await sb.invoke('chat:handoffRead', { chatId, ...(session ? { session } : {}) }); } catch (e) { fail(t('appText.store.handoffNotRead'))(e); return null; }
}

const continuing = new Set<string>();

/** "Riprendi": opens the new chat (main writes the hand-off first when needed) and returns it. The old chat shows
 *  handoffBusy meanwhile (its buttons off); a second click while the first runs does nothing. */
/** «Annulla l'ultimo turno» (ADR 0103): the chat's files back as they were before its last turn. */
export async function undoTurn(chatId: string): Promise<void> {
  try {
    const r = await sb.invoke('chat:undoTurn', { chatId });
    toast(t('chat.menu.undoTurnDone', { restored: r.restored, removed: r.removed }), 'ok');
  } catch (e) { fail(t('chat.menu.undoTurn'))(e); }
}

export async function continueChat(chatId: string): Promise<ChatSummary | null> {
  if (continuing.has(chatId)) return null;
  continuing.add(chatId);
  const old = app.get().chats[chatId];
  if (old) dispatch({ type: 'chat:updated', chat: { ...old, handoffBusy: true } });
  try {
    const c = await sb.invoke('chat:continue', { chatId });
    dispatch({ type: 'chat:updated', chat: c });
    void loadItems(c.id);
    toast(t('appText.store.resumedIn', { title: c.title }), 'ok');
    return c;
  } catch (e) {
    fail(t('appText.store.resumeFailed'))(e);
    return null;
  } finally {
    continuing.delete(chatId);
    const now = app.get().chats[chatId];
    if (now?.handoffBusy) { const { handoffBusy: _, ...rest } = now; dispatch({ type: 'chat:updated', chat: rest }); }
  }
}

/** Close a chat at once (#168): the tile goes, main archives it now (its engine stops, its queued work is dropped, its
 *  run ends), and «Annulla» on the 6-second toast reopens it from its transcript; when the toast expires it leaves the
 *  app for good (chat:close). A chat already closing (hidden, its undo still running) is left alone: a second Ctrl+W or
 *  click starts nothing. A chat maximized or in focus mode leaves that view too (those views show it whatever the
 *  hidden list says); Annulla puts it back, unless another tile took that view in the meantime. */
const pendingCloses=new Set<ReturnType<typeof setTimeout>>();
export function closeChat(chatId: string): void {
  if(updateIsFrozen())return;
  const c = app.get().chats[chatId];
  const u = ui.get();
  if (!c || u.hidden.includes(chatId)) return;
  const wasMax = u.maximized === `chat:${chatId}` ? u.maximized : null;
  const wasFocus = u.focusMode === chatId ? chatId : null;
  if (wasMax || wasFocus) ui.set(s => ({ ...s, maximized: wasMax ? null : s.maximized, focusMode: wasFocus ? null : s.focusMode, lanePeek: wasFocus ? false : s.lanePeek }));
  hideChat(chatId, true);
  let undone = false;
  const closing = sb.invoke('chat:archive', { chatId, auto: false, undoable: true }).then(chat => { if (!undone) dispatch({ type: 'chat:updated', chat }); return true; },
    e => { hideChat(chatId, false); fail(t('chat.close.failed'))(e); return false; });
  const timer = setTimeout(() => {
    pendingCloses.delete(timer);
    if (undone) return;
    void closing.then(ok => ok ? sb.invoke('chat:close', { chatId }) : undefined).catch(fail(t('chat.close.failed'))).finally(() => hideChat(chatId, false));
  }, 6000);
  pendingCloses.add(timer);
  toast(t('chat.close.done', { title: c.title }), 'info', { label: t('chat.close.undo'), run: () => {
    undone = true; clearTimeout(timer); pendingCloses.delete(timer);
    void closing.then(ok => ok ? sb.invoke('chat:reopen', { chatId }).then(chat => dispatch({ type: 'chat:updated', chat })) : undefined)
      .catch(fail(t('chat.close.reopenFailed'))).finally(() => hideChat(chatId, false));
    if ((wasMax || wasFocus) && !ui.get().maximized && !ui.get().focusMode) ui.set(s => ({ ...s, maximized: wasMax, focusMode: wasFocus }));
  } }, 6000);
}

/** Close a browser tab like a chat (✕, Ctrl+W, Ctrl+W inside its page): it closes at once (#168; its agent then gets
 *  "The user closed tab …" at its next call, main browser/closed.ts), and «Annulla» on the 6-second toast opens the
 *  same page again, for the same chat and environment. A tab already closing is left alone; a maximized tab leaves
 *  that view, Annulla puts the new one there unless another tile took it meanwhile. */
export function closeTab(tabId: string): void {
  if(updateIsFrozen())return;
  const tab = app.get().tabs.find(x => x.id === tabId);
  const u = ui.get();
  if (!tab || u.hiddenTabs.includes(tabId)) return;
  const wasMax = u.maximized === `browser:${tabId}` ? u.maximized : null;
  if (wasMax) ui.set(s => ({ ...s, maximized: null }));
  hideTab(tabId, true);
  const closing = sb.invoke('browser:close', { tabId }).then(() => true, e => { hideTab(tabId, false); fail(t('chat.close.tabFailed'))(e); return false; });
  const timer = setTimeout(() => { pendingCloses.delete(timer); hideTab(tabId, false); }, 6000);
  pendingCloses.add(timer);
  toast(t('chat.close.tabDone', { title: tab.title || tab.url }), 'info', { label: t('chat.close.undo'), run: () => {
    clearTimeout(timer); pendingCloses.delete(timer);
    const owner = tab.ownerChatId && app.get().chats[tab.ownerChatId] && !app.get().chats[tab.ownerChatId]!.closedAt ? tab.ownerChatId : null;
    void closing.then(ok => ok ? sb.invoke('browser:open', { url: tab.url, ownerChatId: owner, ...(tab.env ? { env: tab.env } : {}) }).then(next => {
      if (wasMax && !ui.get().maximized) ui.set(s => ({ ...s, maximized: `browser:${next.id}` }));
    }) : undefined).catch(fail(t('chat.close.reopenFailed'))).finally(() => hideTab(tabId, false));
  } }, 6000);
}

export async function navigateTab(tabId: string, url: string): Promise<void> {
  try { await sb.invoke('browser:navigate', { tabId, url }); } catch (e) { fail(t('appText.store.pageNotOpened'))(e); }
}
export async function goTab(tabId: string, dir: 'back' | 'forward' | 'reload'): Promise<void> {
  try { await sb.invoke('browser:go', { tabId, dir }); } catch (e) { fail(t('appText.store.commandFailed'))(e); }
}

/** The engines app:info lists (empty before it arrives); read here, not through lib/engines.ts, which imports this module. */
const knownEngines = () => app.get().info?.engines ?? [];

export async function cliLogin(harness: Harness): Promise<void> {
  const label = knownEngines().find(e => e.id === harness)?.label ?? harness;
  try { await sb.invoke('cli:login', { harness }); toast(t('appText.store.loginOpened', { label }), 'info'); }
  catch (e) { fail(t('appText.store.loginNotOpened'))(e); }
}

/** One CLI's status when app:info has none yet (the check at start still running, or its event missed): asks
 *  cli:status; null = no answer within ms or a failed check ("non verificato"). Once every engine's CLI answered, app:info
 *  keeps them (the top bar's login warning reads it too). Used by the Nuova chat dialog. */
const fetched: Partial<Record<Harness, CliStatus>> = {};
export async function cliFetch(harness: Harness, ms = 20000): Promise<CliStatus | null> {
  const st = await Promise.race([
    sb.invoke('cli:status', { harness }).catch(() => null),
    new Promise<null>(r => setTimeout(() => r(null), ms)),
  ]);
  if (st) keepCli(harness, st);
  return st;
}
/** A fresh status into app:info; while it has none, only once every engine app:info lists answered (never one CLI's
 *  status standing in for another's). */
function keepCli(harness: Harness, st: CliStatus): void {
  fetched[harness] = st;
  const cli = app.get().info?.cli;
  if (cli) { dispatch({ type: 'cli', cli: { ...cli, [harness]: st } }); return; }
  const ids = knownEngines().map(e => e.id);
  if (ids.length && ids.every(h => fetched[h])) dispatch({ type: 'cli', cli: Object.fromEntries(ids.map(h => [h, fetched[h]!])) });
}

export async function cliCheck(harness: Harness): Promise<void> {
  try {
    keepCli(harness, await sb.invoke('cli:status', { harness, checkLogin: true }));
  } catch (e) { fail(t('appText.store.checkFailed'))(e); }
}

/** The user's own change of a setting from the UI (logged as the user's), reflected at once. */
export async function setSetting(patch: SettingsPatch): Promise<void> {
  try { dispatch({ type: 'settings', settings: await sb.invoke('settings:set', patch) }); toastKey('essential.saved', 'ok'); }
  catch (e) { fail(t('appText.store.settingNotSaved'))(e); }
}

/** Mute one kind (settings mute.<kind>: no toast, still in the center), with an undo. */
export async function muteKind(kind: string, label: string, muted = true): Promise<void> {
  try {
    const s = await sb.invoke('settings:set', { mute: { [kind]: muted } });
    dispatch({ type: 'settings', settings: s });
    if (muted) toast(t('appText.store.muted', { label }), 'ok', { label: t('appText.store.undo'), run: () => { void muteKind(kind, label, false); } });
  } catch (e) { fail(t('appText.store.failed'))(e); }
}

/** Do not disturb until a time (settings dndUntil: no event toasts until then; never sounds anyway). null = off,
 *  which also clears the untimed `dnd` flag. */
export async function setDnd(until: number | null): Promise<void> {
  try {
    const s = await sb.invoke('settings:set', until === null ? { dnd: false, dndUntil: null } : { dndUntil: until });
    dispatch({ type: 'settings', settings: s });
    toast(until ? t('appText.store.dndUntil', { time: new Date(until).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }) : t('appText.store.dndOff'), 'ok');
  } catch (e) { fail(t('appText.store.failed'))(e); }
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

/** Pending local effects have no replay ledger: an update must wait rather than duplicate or discard them. */
export function updateStoreProblem():string|null{
  const state=app.get();
  if(!state.ready)return t('appText.store.updateWaitLoad');
  if(Object.values(state.queued).some(queue=>queue.length))return t('appText.store.updateQueued');
  if(settingsPending||localActions||pendingCloses.size||queuedActions||inFlight.size||undos.size||notes.size)return t('appText.store.updateBusy');
  if(state.pending.length)return t('appText.store.updatePending');
  return null;
}
