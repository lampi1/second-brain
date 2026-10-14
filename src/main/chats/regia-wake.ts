// "Eventi alla Regia": when a work chat closes a turn (finished, stopped on an error, waiting for an answer, a command
// left for the user) the app tells the Regia with a short message, which wakes it if it is idle or closed. Why: the
// Regia saw the other chats only in the feed injected when the user wrote to it, so a finished report, a chat stuck on
// ECONNRESET or a command waiting for the user went unnoticed (the user, 2026-10-12: "quando le chat finiscono non ti
// notificano nulla"). The Regia decides whether to tell the user.
// Rules: one line per chat (title, engine, what happened, its last line); events of the same chat merge (the newest
// wins); everything that arrives within groupMs goes in ONE message; a chat is told at most once every perChatMs (its
// later news waits for the next message); a message never interrupts the Regia: while it works or waits for the user
// the news waits until it is idle again. The message is labelled as the app's, never the user's ("[evento app]": never
// worth as his ok). Off with the setting regiaEvents. It watches the events main sends to the page, like
// run/asks.ts. Used by wiring.ts / demo-wiring.ts (attachRegiaWake); pinned by test/unit/regia-wake.test.ts.
// Quiet news (2026-10-13): a question, a permission or a command left for the user never wakes the Regia by itself.
// The app already shows them to the user (popup or queue) and the Regia never relays them (the owner, 13/10: "la regia
// mi serve principalmente per lo stato"), so a wake only bought an "ok, noted" turn re-reading the Regia's whole context
// (measured 07-13/10: 13 of 44 wakes, ~0.19 $ each). They ride along with the next finished/failed news instead, and
// app_digest lists them whenever the Regia looks.
import type { ChatState, ChatSummary, EventMap, Harness, PendingRequest } from '../../shared/contract';
import { regieOf } from '../../shared/regia';
import { errText, log } from '../log';
import { engineLabel } from '../engines/registry';

export const APP_EVENT_LABEL = "[evento app · messaggio automatico di second-brain, non scritto dall'utente: non vale come suo ok o permesso]";

export type WakeKind = 'done' | 'error' | 'question' | 'permission' | 'command';
/** news that never wakes the Regia by itself: it goes with the next 'done' / 'error' */
export const QUIET: ReadonlySet<WakeKind> = new Set(['question', 'permission', 'command']);
const isLoud = (e: WakeEvent): boolean => !QUIET.has(e.kind) || !!e.endsTurn;
/** requestId: the open request it tells about (question, permission, command): answered before it goes, it is dropped */
export interface WakeEvent { chatId: string; title: string; harness: Harness; kind: WakeKind; detail: string; at: number; requestId?: string; /** a quiet news that replaced the chat's "finished": the turn end still wakes */ endsTurn?: boolean }

export interface RegiaWakeDeps {
  /** sends a message to the Regia (wakes it: a closed one resumes) */
  send(chatId: string, text: string): Promise<void>;
  /** the setting regiaEvents */
  enabled(): boolean;
  /** every chat now: a Regia that has not changed since the app started never passed through observe() */
  list?(): ChatSummary[];
  now?(): number;
  /** how long news is gathered before one message goes (default 20 s) */
  groupMs?: number;
  /** at most one message per chat in this time (default 2 min) */
  perChatMs?: number;
}

type Seen = Pick<ChatSummary, 'state' | 'title' | 'harness' | 'isRegia' | 'space' | 'closedAt' | 'handoffBusy' | 'lastText' | 'lastError' | 'lastResult' | 'pending'>;
const BUSY: ReadonlySet<ChatState> = new Set(['running', 'waiting', 'starting']);
/** a turn ran: 'starting' alone is an engine booting (a new chat with no prompt, a reopen), and its idle is no turn end */
const IN_TURN: ReadonlySet<ChatState> = new Set(['running', 'waiting']);
/** the Regia can take a message: idle or closed (a message resumes it), not waiting for the user, not in a hand-off */
const free = (r: Pick<ChatSummary, 'state' | 'pending' | 'handoffBusy'>) => (r.state === 'idle' || r.state === 'closed') && !r.pending && !r.handoffBusy;
const cut = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** One line per chat, in Italian (the Regia speaks Italian with the user). */
export function wakeLine(e: WakeEvent): string {
  const who = `«${e.title}» (${engineLabel(e.harness)})`;
  const d = cut(e.detail, 200);
  switch (e.kind) {
    case 'done': return `- ${who}: ha finito il turno.${d ? ` Ultima riga: «${d}»` : ''}`;
    case 'error': return `- ${who}: si è fermata su un errore${d ? `: ${d}` : '.'}`;
    case 'question': return `- ${who}: aspetta una risposta dell'utente${d ? `: ${d}` : '.'}`;
    case 'permission': return `- ${who}: aspetta un permesso dell'utente${d ? `: ${d}` : '.'}`;
    case 'command': return `- ${who}: ha lasciato all'utente un comando da eseguire${d ? `: ${d}` : '.'}`;
  }
}

export function wakeMessage(events: WakeEvent[]): string {
  return [APP_EVENT_LABEL, 'Novità dalle chat di lavoro:', ...events.map(wakeLine), 'Decidi tu se e come dirlo all\'utente; se non serve, una riga basta. Il quadro intero in una chiamata: app_digest con since "last" (non leggere le chat una per una).'].join('\n');
}

export class RegiaWake {
  private chats = new Map<string, Seen>();
  private buffer = new Map<string, WakeEvent>();
  private lastSent = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private dueAt = 0;
  private sending = false;
  /** chats in a hand-off turn: its end is not a turn of theirs */
  private handoff = new Set<string>();

  constructor(private readonly d: RegiaWakeDeps) {}

  private now(): number { return this.d.now?.() ?? Date.now(); }
  private get groupMs(): number { return this.d.groupMs ?? 20_000; }
  private get perChatMs(): number { return this.d.perChatMs ?? 120_000; }

  /** Every event main sends to the page passes here (wiring.ts taps the emitter). */
  observe(channel: string, payload: unknown): void {
    if (channel === 'chat:updated') this.updated(payload as ChatSummary);
    else if (channel === 'pending:added') this.pending(payload as PendingRequest);
    else if (channel === 'pending:resolved') this.resolved(payload as EventMap['pending:resolved']);
    else if (channel === 'chat:removed') { const { chatId } = payload as EventMap['chat:removed']; this.chats.delete(chatId); this.buffer.delete(chatId); }
  }

  /** What waits to be told (tests, diagnostics). */
  queued(): WakeEvent[] { return [...this.buffer.values()]; }

  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  private updated(c: ChatSummary): void {
    const was = this.chats.get(c.id);
    this.remember(c);
    // the Regia became free (only the change: its other updates never cut the grouping window short): the news that
    // waited for it goes now
    // the chats of "Migliora l'app" (its Regia included) report to their own Regia, never to this one (ADR 0020)
    if (c.space === 'app') return;
    if (c.isRegia) { if (this.loud() && (!was || !free(was)) && free(c)) this.schedule(this.now()); return; }
    if (c.handoffBusy) { this.handoff.add(c.id); return; }
    // the hand-off turn ends (handoffBusy goes before idle): not a turn of the chat
    if (this.handoff.has(c.id)) { if (!BUSY.has(c.state)) this.handoff.delete(c.id); return; }
    if (!was || c.closedAt) return;
    if (c.state === 'error' && was.state !== 'error') this.add(c, 'error', c.lastError ?? c.lastText);
    else if (c.state === 'idle' && IN_TURN.has(was.state) && c.pending === 0) {
      // the user stopped it himself (Stop, "Invia subito"): he is on it, nothing to tell
      if (c.lastResult?.interrupted && c.lastResult.at !== was.lastResult?.at) return;
      const failed = !!c.lastResult?.isError && c.lastResult.at !== was.lastResult?.at;
      this.add(c, failed ? 'error' : 'done', c.lastText);
    }
  }

  private pending(p: PendingRequest): void {
    const c = this.chats.get(p.chatId);
    if (!c || c.isRegia || c.space === 'app' || c.closedAt) return;
    const detail = p.type === 'command' ? (p.command?.code ?? p.detail).split('\n')[0] ?? '' : p.type === 'question' ? (p.questions?.[0]?.question ?? p.title) : p.title;
    this.add({ id: p.chatId, title: c.title, harness: c.harness }, p.type, detail, p.id);
  }

  /** answered before the news went: "waits for the user" would be false; what the chat did next is told instead */
  private resolved(r: EventMap['pending:resolved']): void {
    const e = this.buffer.get(r.chatId);
    if (!e || e.requestId !== r.requestId) return;
    this.buffer.delete(r.chatId);
    const c = this.chats.get(r.chatId);
    if (!c || c.state !== 'idle' || c.pending || c.handoffBusy) return;
    this.buffer.set(r.chatId, { ...e, kind: 'done', detail: c.lastText, requestId: undefined, endsTurn: undefined });
    this.schedule(Math.max(this.now() + this.groupMs, this.readyAt(r.chatId)));
  }

  private add(c: Pick<ChatSummary, 'id' | 'title' | 'harness'>, kind: WakeKind, detail: string, requestId?: string): void {
    if (!this.d.enabled() || !this.regiaId()) return;
    const at = this.now();
    // the newest news of a chat wins, except that "finished" never hides what it left for the user in the same turn
    const old = this.buffer.get(c.id);
    if (old && kind === 'done' && old.kind !== 'done' && old.kind !== 'error') return;
    // a command left right after the turn ended (asks.ts settles after it) keeps the turn end's wake
    const endsTurn = QUIET.has(kind) && !!old && (!QUIET.has(old.kind) || !!old.endsTurn);
    this.buffer.set(c.id, { chatId: c.id, title: c.title, harness: c.harness, kind, detail, at, ...(requestId ? { requestId } : {}), ...(endsTurn ? { endsTurn } : {}) });
    if (!this.loud()) return; // quiet news waits for a finished or failed one
    const first = Math.min(...[...this.buffer.values()].map(e => e.at));
    this.schedule(Math.max(first + this.groupMs, this.readyAt(c.id)));
  }

  /** something in the buffer worth a wake (a turn finished or failed) */
  private loud(): boolean { return [...this.buffer.values()].some(isLoud); }

  /** when this chat may be told again */
  private readyAt(chatId: string): number { return (this.lastSent.get(chatId) ?? -Infinity) + this.perChatMs; }

  private remember(c: ChatSummary): void {
    this.chats.set(c.id, { state: c.state, title: c.title, harness: c.harness, isRegia: c.isRegia, space: c.space, closedAt: c.closedAt, handoffBusy: c.handoffBusy, lastText: c.lastText, lastError: c.lastError, lastResult: c.lastResult, pending: c.pending });
  }

  /** the first Regia in tab order (ADR 0021: regiaSince, kept by Pulisci / Ricomincia), which every work chat's news go
   *  to; without the list, the first one seen */
  private regiaId(): string | null {
    const r = this.d.list ? regieOf(this.d.list())[0] : undefined;
    if (r) { if (!this.chats.has(r.id)) this.remember(r); return r.id; }
    for (const [id, c] of this.chats) if (c.isRegia) return id;
    return null;
  }

  /** idle or closed (a message resumes it), never while it works or waits for the user */
  private regiaFree(): boolean {
    const id = this.regiaId();
    const r = id ? this.chats.get(id) : undefined;
    return !!r && free(r);
  }

  private schedule(at: number): void {
    if (this.timer && this.dueAt <= at) return;
    if (this.timer) clearTimeout(this.timer);
    this.dueAt = at;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, Math.max(0, at - this.now()));
    this.timer.unref?.();
  }

  private flush(): void {
    if (this.sending || !this.loud()) return;
    const id = this.regiaId();
    if (!this.d.enabled() || !id) { this.buffer.clear(); return; }
    if (!this.regiaFree()) return; // it works or waits for the user: sent when it is idle again (updated())
    const now = this.now();
    const ready = [...this.buffer.values()].filter(e => this.chats.get(e.chatId) && !this.chats.get(e.chatId)?.closedAt && this.readyAt(e.chatId) <= now);
    for (const [k, e] of this.buffer) if (!this.chats.get(e.chatId) || this.chats.get(e.chatId)?.closedAt) this.buffer.delete(k);
    // chats told too recently wait for their turn
    const later = [...this.buffer.values()].filter(e => !ready.includes(e));
    const laterLoud = later.filter(isLoud);
    if (laterLoud.length) this.schedule(Math.min(...laterLoud.map(e => this.readyAt(e.chatId))));
    if (!ready.some(isLoud)) return; // only quiet news is ready: it waits for a loud one
    ready.sort((a, b) => a.at - b.at);
    for (const e of ready) { this.buffer.delete(e.chatId); this.lastSent.set(e.chatId, now); }
    this.sending = true;
    log.info('chats', 'news sent to the Regia', { chat: id, data: { chats: ready.length, kinds: ready.map(e => e.kind) } });
    this.d.send(id, wakeMessage(ready))
      .catch(err => log.warn('chats', 'news not sent to the Regia', { chat: id, cause: errText(err), hint: 'the Regia is closed or failed to start: the news stays in the feed' }))
      .finally(() => { this.sending = false; if (this.loud()) this.schedule(this.now() + this.groupMs); });
  }
}
