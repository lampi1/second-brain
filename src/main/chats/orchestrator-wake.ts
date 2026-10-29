// "Eventi all'Orchestrator": when a work chat closes a turn (finished, stopped on an error, waiting for an answer, a command
// left for the user) the app tells the Orchestrator with a short message, which wakes it if it is idle or closed. Why: the
// Orchestrator saw the other chats only in the feed injected when the user wrote to it, so a finished report, a chat stuck on
// ECONNRESET or a command waiting for the user went unnoticed (the user, 2026-10-12: "quando le chat finiscono non ti
// notificano nulla"). The Orchestrator decides whether to tell the user.
// One line per chat (title, engine, what happened, its last line); events of the same chat merge (the newest wins); a
// chat is told at most once every perChatMs. WHEN it goes is the one rule of orchestrator-delivery.ts, shared with the mail
// (mail.ts): a failure at once, a turn end within the group window, all together in ONE message; while the Orchestrator works
// the news goes into its running turn; while it waits for the user or is in a hand-off only a failure goes. The message
// is labelled as the app's, never the user's ("[evento app]": never worth as his ok). Off with the setting orchestratorEvents. It watches the events main sends to the page, like
// run/asks.ts. Used by wiring.ts / demo-wiring.ts (attachOrchestratorWake); pinned by test/unit/orchestrator-wake.test.ts.
// Quiet news (2026-10-13): a question, a permission or a command left for the user never wakes the Orchestrator by itself.
// The app already shows them to the user (popup or queue) and the Orchestrator never relays them (the owner, 13/10: "l’Orchestrator
// mi serve principalmente per lo stato"), so a wake only bought an "ok, noted" turn re-reading the Orchestrator's whole context
// (measured 07-13/10: 13 of 44 wakes, ~0.19 $ each). They ride along with the next finished/failed news instead, and
// app_digest lists them whenever the Orchestrator looks.
// Delegated chats (ADR 0083): a chat another role delegated (parentId) reports to its parent, not to the Orchestrator, which
// sees only its state changes: started, waiting for the user, finished, failed, never a line of what it says (no detail).
// Its "finished" rides along (silent) unless the user wrote to it: its result goes to its parent (2026-10-20).
// A turn that gave its result with agent_report adds no "finished": the result already reached its parent or the
// Orchestrator as a message, and a second wake for it was a turn for nothing (the owner, 2026-10-20).
// What the Orchestrator does with the news is in its rules (orchestrator-role.ts WAKE_RULE), sent once per session: a
// wake carries the label and the news only.
// The user wrote in a work chat himself (ADR 0083, 'user-message'): quiet news with the chat, its role and parent, the
// time and the user's own words (cut to ~300 characters; his words are not the child's content), so the Orchestrator
// never plans against what he told a chat. It rides along with the next delivery, is counted in the held news, and is
// kept beside the chat's status news (its own slot: a "finished" never replaces it).
// A root chat's clean agent_report (done, every criterion met, no question) is quiet news too (cleanReport, 2026-10-20):
// the user reads the result in the chat; the Orchestrator gets the summary with its next turn instead of a turn of its own.
// It comes after the chat's turn ended (ChatManager holds it, #123); for a result the user waits for, the Orchestrator's
// chat also shows the app's «ha la risposta che aspettavi» notice, still with no turn of the Orchestrator's own.
// Held news on the tile (#88): what waits in the buffer is listed for the user (heldNews(), held-news.ts sends it to the
// page as "N novità in attesa"); reading it never sends anything to the Orchestrator and changes no rule above.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readLocal, writeLocal } from '../agents/local-store';
import { timersFor } from '../timers';
const { setTimeout, clearTimeout } = timersFor('chats/orchestrator-wake');
import type { ChatState, ChatSummary, EventMap, Harness, HeldNewsItem, PendingRequest } from '../../shared/contract';
import { errText, log } from '../log';
import { engineLabel, engineOf } from '../engines/registry';
import { heldWhy, newsClass, passes, ORCHESTRATOR_GROUP_MS, ORCHESTRATOR_PER_CHAT_MS, orchestratorGate, type DeliveryClass, type OrchestratorGate } from './orchestrator-delivery';

export const APP_EVENT_LABEL = "[evento app · messaggio automatico di second-brain, non scritto dall'utente: non vale come suo ok o permesso]";

export type WakeKind = 'done' | 'error' | 'question' | 'permission' | 'command' | 'started' | 'user-message';
/** news that never wakes the Orchestrator by itself: it goes with the next 'done' / 'error' */
export const QUIET: ReadonlySet<WakeKind> = new Set(['question', 'permission', 'command', 'started', 'user-message']);
/** the buffer's slot of an event: the user's messages beside the chat's status */
const slotOf = (e: Pick<WakeEvent, 'chatId' | 'kind' | 'report' | 'eventId' | 'at'>): string => e.kind === 'user-message' ? `${e.chatId}#user:${e.eventId ?? e.at}` : e.report ? `${e.chatId}#report` : e.chatId;
/** the rule's gate for this Orchestrator: Cursor (ACP) takes no message mid-turn */
const gateOf = (r: Pick<ChatSummary, 'state' | 'pending' | 'handoffBusy' | 'harness'>): OrchestratorGate => orchestratorGate(r, engineOf(r.harness)?.kind !== 'acp');
const classOf = (e: WakeEvent): DeliveryClass => e.kind === 'user-message' || e.silent ? 'quiet' : newsClass(e.kind, e.endsTurn);
const isLoud = (e: WakeEvent): boolean => classOf(e) !== 'quiet';
/** requestId: the open request it tells about (question, permission, command): answered before it goes, it is dropped */
export interface WakeEvent { eventId?: string; seq?: number; chatId: string; title: string; harness: Harness; kind: WakeKind; detail: string; at: number; /** a root chat's clean agent_report (cleanReport): its role and summary, quiet */ report?: { role: string }; /** a delegated chat: its role and its parent's title (status only, never its text) */ child?: { role: string; parent: string }; requestId?: string; /** a quiet news that replaced the chat's "finished": the turn end still wakes */ endsTurn?: boolean; /** a delegated chat's "finished" with nothing of the user's beside it: no text (ADR 0083) and its result goes to its parent, so it rides along and never wakes */ silent?: boolean }

export interface WakeSubmissionReceipt { submitted(): void; failed(error: unknown): void }
export interface OrchestratorWakeDeps {
  /** True for ChatManager: queue admission is not an engine submission acknowledgment. */
  receiptAcknowledgement?: boolean;
  userData?: string;
  /** sends a message to the Orchestrator (wakes it: a closed one resumes) */
  send(chatId: string, text: string, receipt?: WakeSubmissionReceipt): Promise<void>;
  /** the setting orchestratorEvents */
  enabled(): boolean;
  /** every chat now: an Orchestrator that has not changed since the app started never passed through observe() */
  list?(): ChatSummary[];
  now?(): number;
  /** how long news is gathered before one message goes (default ORCHESTRATOR_GROUP_MS) */
  groupMs?: number;
  /** at most one message per chat in this time (default ORCHESTRATOR_PER_CHAT_MS) */
  perChatMs?: number;
}

type Seen = Pick<ChatSummary, 'state' | 'title' | 'harness' | 'isOrchestrator' | 'closedAt' | 'handoffBusy' | 'lastText' | 'lastError' | 'lastResult' | 'pending' | 'parentId' | 'agent'> & { turnResultAt: number; reportedTurn: boolean };
const BUSY: ReadonlySet<ChatState> = new Set(['running', 'waiting', 'starting']);
/** a turn ran: 'starting' alone is an engine booting (a new chat with no prompt, a reopen), and its idle is no turn end */
const IN_TURN: ReadonlySet<ChatState> = new Set(['running', 'waiting']);
const cut = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** One line per chat, in Italian (the Orchestrator speaks Italian with the user). */
export function wakeLine(e: WakeEvent): string {
  const who = e.child ? `«${e.title}» (${e.child.role}, delegata da «${e.child.parent}»)` : `«${e.title}» (${engineLabel(e.harness)})`;
  const d = e.child || e.kind === 'user-message' ? '' : cut(e.detail, 200);
  switch (e.kind) {
    case 'done': return e.report ? `- «${e.title}» (${e.report.role}): ha consegnato: «${cut(e.detail, 200)}»` : `- ${who}: ha finito il turno.${d ? ` Ultima riga: «${d}»` : ''}`;
    case 'error': return `- ${who}: si è fermata su un errore${d ? `: ${d}` : '.'}`;
    case 'question': return `- ${who}: aspetta una risposta dell'utente${d ? `: ${d}` : '.'}`;
    case 'permission': return `- ${who}: aspetta un permesso dell'utente${d ? `: ${d}` : '.'}`;
    case 'command': return `- ${who}: ha lasciato all'utente un comando da eseguire${d ? `: ${d}` : '.'}`;
    case 'started': return `- ${who}: è partita.`;
    case 'user-message': return `- ${who}: l'utente ci ha scritto direttamente (${new Date(e.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}): «${e.detail}».`;
  }
}

/** The label and the news only: what to do with it is in the Orchestrator's rules (orchestrator-role.ts WAKE_RULE),
 *  sent once per session instead of with every wake (the owner, 2026-10-20: no text twice). */
export function wakeMessage(events: WakeEvent[]): string {
  return [APP_EVENT_LABEL, 'Novità dalle chat di lavoro:', ...events.map(wakeLine)].join('\n');
}

export class OrchestratorWake {
  private chats = new Map<string, Seen>();
  private buffer = new Map<string, WakeEvent>();
  private lastSent = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private dueAt = 0;
  private sending = false;
  /** chats in a hand-off turn: its end is not a turn of theirs */
  private handoff = new Set<string>();
  /** held-news.ts: told when what waits may have changed (#88) */
  private listener: (() => void) | null = null;
  private toldEmpty = true;
  /** Flash chats (ADR 0105): their requests are the user's own, never news */
  private quick = new Set<string>();

  constructor(private readonly d: OrchestratorWakeDeps) {
    if (!d.userData) return;
    try {
      const saved = readLocal(path.join(d.userData, 'orchestrator-outbox.json')) as { events?: WakeEvent[] } | undefined;
      if (Array.isArray(saved?.events)) for (const event of saved.events) {
        if (event && typeof event.chatId === 'string' && typeof event.title === 'string' && typeof event.detail === 'string' && typeof event.at === 'number' && ['done','error','question','permission','command','started','user-message'].includes(event.kind)) this.buffer.set(slotOf(event), event);
      }
    } catch (e) { log.warn('chats', 'news outbox unreadable', { cause: errText(e), hint: 'canonical results remain in the run ledger' }); }
    for (const chat of d.list?.() ?? []) this.remember(chat);
    this.reschedule();
  }

  private persist(): void {
    if (!this.d.userData) return;
    try { writeLocal(path.join(this.d.userData, 'orchestrator-outbox.json'), { events: this.queued() }); }
    catch (e) { log.warn('chats', 'news outbox not saved', { cause: errText(e), hint: 'the next update retries' }); }
  }

  private now(): number { return this.d.now?.() ?? Date.now(); }
  private get groupMs(): number { return this.d.groupMs ?? ORCHESTRATOR_GROUP_MS; }
  private get perChatMs(): number { return this.d.perChatMs ?? ORCHESTRATOR_PER_CHAT_MS; }

  /** Every event main sends to the page passes here (wiring.ts taps the emitter). */
  observe(channel: string, payload: unknown): void {
    if (channel === 'chat:updated') this.updated(payload as ChatSummary);
    else if (channel === 'pending:added') this.pending(payload as PendingRequest);
    else if (channel === 'pending:resolved') this.resolved(payload as EventMap['pending:resolved']);
    else if (channel === 'chat:removed') { const { chatId } = payload as EventMap['chat:removed']; this.chats.delete(chatId); this.buffer.delete(chatId); for (const [key, event] of this.buffer) if (event.chatId === chatId) this.buffer.delete(key); this.buffer.delete(`${chatId}#report`); }
    else return;
    this.changed();
  }

  /** held-news.ts listens: called when the buffer or the Orchestrator's state may have changed (never twice for "nothing") */
  onHeldChange(fn: () => void): void { this.listener = fn; }

  /** What waits to be told, for the user's eyes (the Orchestrator's tile, #88): every queued news of an open chat, with why it
   *  waits at the Orchestrator's gate now. Reading it sends nothing. */
  heldNews(): HeldNewsItem[] {
    const id = this.orchestratorId(), r = id ? this.chats.get(id) : undefined;
    if (!id || !r || !this.buffer.size || !this.d.enabled()) return [];
    const gate = gateOf(r);
    return this.queued().filter(e => { const c = this.chats.get(e.chatId); return !!c && !c.closedAt; })
      .map(e => ({ orchestratorId: id, chatId: e.chatId, title: e.title, kind: e.kind, at: e.at, why: heldWhy(gate, classOf(e), r) }));
  }

  private changed(): void {
    this.persist();
    if (!this.listener) return;
    const empty = !this.buffer.size;
    if (empty && this.toldEmpty) return;
    this.toldEmpty = empty;
    this.listener();
  }

  /** What waits to be told (tests, diagnostics). */
  queued(): WakeEvent[] { return [...this.buffer.values()]; }
  /** How much queued news the Orchestrator's gate holds now (it works or waits for the user; tests, diagnostics). */
  held(): number { const r = this.orchestrator(); return r ? this.queued().filter(e => !passes(gateOf(r), classOf(e))).length : 0; }

  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  private updated(c: ChatSummary): void {
    const was = this.chats.get(c.id);
    this.remember(c);
    // the Orchestrator's gate changed (only the change: its other updates never cut the grouping window short): what it now
    // lets through is timed again (it started working: all goes into its turn; it is free again: what waited goes)
    if (c.isOrchestrator) { if (this.buffer.size && (!was || gateOf(was) !== gateOf(c))) this.schedule(this.now()); return; }
    // Flash (ADR 0105) is the user's quick lane, never work the Orchestrator follows
    if (c.quick) return;
    // the maintenance research (ADR 0132) ends in cards for the user, never news for the Orchestrator
    if (c.research) return;
    if (c.handoffBusy) { this.handoff.add(c.id); return; }
    // the hand-off turn ends (handoffBusy goes before idle): not a turn of the chat
    if (this.handoff.has(c.id)) { if (!BUSY.has(c.state)) this.handoff.delete(c.id); return; }
    if (!was) { if (c.parentId && !c.closedAt) this.add(c, 'started', ''); return; }
    if (c.closedAt) return;
    if (c.state === 'error' && was.state !== 'error') this.add(c, 'error', c.lastError ?? c.lastText);
    else if (c.state === 'idle' && IN_TURN.has(was.state) && c.pending === 0) {
      // the user stopped it himself (Stop, "Invia subito"): he is on it, nothing to tell
      if (c.lastResult?.interrupted && c.lastResult.at > was.turnResultAt) return;
      const failed = !!c.lastResult?.isError && c.lastResult.at > was.turnResultAt;
      // it gave its result with agent_report in this turn: that already reached its parent or the Orchestrator (the
      // owner, 2026-10-20: the same news twice was a second Orchestrator turn for nothing)
      if (!failed && this.chats.get(c.id)?.reportedTurn) return;
      // a chat the app itself started (a sampled independent review): the app reads its verdict, the Orchestrator never asked for it
      if (!failed && c.run?.startedBy === 'app') return;
      this.add(c, failed ? 'error' : 'done', c.lastText);
    }
  }

  private pending(p: PendingRequest): void {
    // a chat with no update since the app started is not seen yet (its request comes before its 'waiting'): read it from
    // the list, so its quiet news is not lost (#88: a quiet permission is counted, and rides along as the rule says)
    const known = this.chats.get(p.chatId);
    const listed = known ? undefined : this.d.list?.().find(x => x.id === p.chatId);
    if (listed) this.remember(listed);
    const c = known ?? listed;
    if (!c || c.isOrchestrator || c.closedAt || this.quick.has(p.chatId)) return;
    const detail = p.type === 'command' ? (p.command?.code ?? p.detail).split('\n')[0] ?? '' : p.type === 'question' ? (p.questions?.[0]?.question ?? p.title) : p.title;
    this.add({ id: p.chatId, title: c.title, harness: c.harness, parentId: c.parentId, agent: c.agent }, p.type, detail, p.id);
  }

  /** The user typed in a work chat (ChatManager.onUserWrote): quiet news with his words; every message has a stable event ID and survives until delivered. */
  userMessage(n: { eventId?: string; seq?: number; chatId: string; title: string; role: string | null; parentTitle: string | null; text: string; at?: number }): void {
    if (!this.d.enabled() || !this.orchestratorId()) return;
    const known = this.chats.get(n.chatId), listed = known ? undefined : this.d.list?.().find(x => x.id === n.chatId);
    if (listed) this.remember(listed);
    const c = known ?? listed;
    // Flash (ADR 0105) is the user's own quick lane: what he writes there is never news (once «Hai scritto · Lampo», #123)
    if (!c || c.isOrchestrator || c.closedAt || this.quick.has(n.chatId)) return;
    const e: WakeEvent = { eventId: n.eventId ?? randomUUID(), ...(n.seq !== undefined ? { seq: n.seq } : {}), chatId: n.chatId, title: n.title, harness: c.harness, kind: 'user-message', detail: n.text, at: n.at ?? this.now(),
      ...(n.parentTitle !== null ? { child: { role: n.role ?? 'ruolo', parent: n.parentTitle } } : {}) };
    this.buffer.set(slotOf(e), e);
    this.reschedule();
    this.changed();
  }

  /** A root chat's clean result (ChatManager.onCleanReport): quiet news with its summary, never a turn of its own; it rides
   *  along with the next delivery (the user's next message injects it into that turn). False = not taken (off, no
   *  Orchestrator): the caller sends the result as a message. */
  cleanReport(n: { chatId: string; title: string; role: string; summary: string; at?: number; workflow?: boolean }): boolean {
    if (!this.d.enabled() || !this.orchestratorId()) return false;
    const known = this.chats.get(n.chatId), listed = known ? undefined : this.d.list?.().find(x => x.id === n.chatId);
    if (listed) this.remember(listed);
    const c = known ?? listed;
    if (!c || c.isOrchestrator) return false;
    const e: WakeEvent = { chatId: n.chatId, title: n.title, harness: c.harness, kind: 'done', detail: cut(n.summary, 300), at: n.at ?? this.now(), report: { role: n.role }, silent: !n.workflow };
    this.buffer.set(slotOf(e), e);
    // the chat's plain "finished" of the same turn says less than the report
    if (this.buffer.get(n.chatId)?.kind === 'done') this.buffer.delete(n.chatId);
    this.reschedule();
    this.changed();
    return true;
  }

  /** The user opened this chat from "N novità in attesa" and read it (#123): its queued news only rides along, quiet, and
   *  never wakes the Orchestrator (the owner, 2026-10-21: «per risparmiare token»). A later event of the chat is news again. */
  seen(chatId: string): void {
    let changed = false;
    for (const [k, e] of this.buffer) if (e.chatId === chatId && !e.silent) { this.buffer.set(k, { ...e, silent: true, endsTurn: undefined }); changed = true; }
    if (changed) { this.reschedule(); this.changed(); }
  }

  /** answered before the news went: "waits for the user" would be false; what the chat did next is told instead */
  private resolved(r: EventMap['pending:resolved']): void {
    const e = this.buffer.get(r.chatId);
    if (!e || e.requestId !== r.requestId) return;
    this.buffer.delete(r.chatId);
    const c = this.chats.get(r.chatId);
    if (!c || c.state !== 'idle' || c.pending || c.handoffBusy || c.reportedTurn) return;
    this.buffer.set(r.chatId, { ...e, kind: 'done', detail: e.child ? '' : c.lastText, at: this.now(), requestId: undefined, endsTurn: undefined, silent: (!!e.child && !this.queued().some(event => event.chatId === r.chatId && event.kind === 'user-message')) || undefined });
    this.reschedule();
  }

  private add(c: Pick<ChatSummary, 'id' | 'title' | 'harness' | 'parentId' | 'agent'>, kind: WakeKind, detail: string, requestId?: string): void {
    if (!this.d.enabled() || !this.orchestratorId()) return;
    const at = this.now();
    // the newest news of a chat wins, except that "finished" never hides what it left for the user in the same turn
    const old = this.buffer.get(c.id);
    // a clean report has its own slot (cleanReport): a later error or request never hides it, its turn end adds nothing
    const quietReport = this.buffer.get(`${c.id}#report`);
    if (kind === 'done' && quietReport && quietReport.at > (this.chats.get(c.id)?.turnResultAt ?? 0)) return;
    if (old && kind === 'done' && old.kind !== 'done' && old.kind !== 'error' && old.kind !== 'started') return;
    // a command left right after the turn ended (asks.ts settles after it) keeps the turn end's wake
    const endsTurn = QUIET.has(kind) && !!old && (!QUIET.has(old.kind) || !!old.endsTurn);
    const parent = c.parentId ? this.chats.get(c.parentId)?.title ?? this.d.list?.().find(x => x.id === c.parentId)?.title ?? '?' : null;
    const child = parent !== null ? { role: c.agent?.name ?? 'ruolo', parent } : undefined;
    const silent = !!child && kind === 'done' && !this.queued().some(event => event.chatId === c.id && event.kind === 'user-message');
    this.buffer.set(c.id, { chatId: c.id, title: c.title, harness: c.harness, kind, detail: child ? '' : detail, at, ...(child ? { child } : {}), ...(requestId ? { requestId } : {}), ...(endsTurn ? { endsTurn } : {}), ...(silent ? { silent } : {}) });
    this.reschedule();
  }

  /** When the next message may go through this gate (Infinity: nothing can). The group window starts at the first
   *  loud news; quiet news never wakes an idle Orchestrator by itself (the owner, 13/10), it rides along. */
  private nextDue(gate: OrchestratorGate): number {
    const all = [...this.buffer.values()];
    const firstLoud = Math.min(...all.filter(isLoud).map(e => e.at));
    let due = Infinity;
    for (const e of all) {
      const cls = classOf(e);
      if (!passes(gate, cls)) continue;
      const base = gate === 'inject' || cls === 'now' ? e.at : cls === 'group' ? firstLoud + this.groupMs : Infinity;
      due = Math.min(due, Math.max(base, this.readyAt(slotOf(e))));
    }
    return due;
  }

  private reschedule(): void {
    const r = this.orchestrator();
    if (!r) return;
    const due = this.nextDue(gateOf(r));
    if (Number.isFinite(due)) this.schedule(due);
  }

  /** when this chat (its slot) may be told again */
  private readyAt(slot: string): number { return (this.lastSent.get(slot) ?? -Infinity) + this.perChatMs; }

  private remember(c: ChatSummary): void {
    if (c.quick) this.quick.add(c.id);
    const was = this.chats.get(c.id);
    // Keep the previous turn's receipt fixed: the current receipt arrives while still running, before idle.
    const nextReceipt = was?.lastResult && c.lastResult && c.lastResult.at !== was.lastResult.at && was.lastResult.at > was.turnResultAt;
    const turnResultAt = !was || nextReceipt || (IN_TURN.has(c.state) && !IN_TURN.has(was.state))
      ? (was?.lastResult?.at ?? c.lastResult?.at ?? 0) : was.turnResultAt;
    const report = c.run?.report;
    const reportedTurn = report?.via === 'agent_report' && report.at > turnResultAt
      && (!report.canonical || report.canonical.runId === c.run?.runId);
    // A delayed report supersedes only this turn's generic completion, never errors, requests or user decisions.
    const queued = this.buffer.get(c.id);
    if (reportedTurn && queued?.kind === 'done' && !queued.report && queued.at >= report.at) this.buffer.delete(c.id);
    this.chats.set(c.id, { state: c.state, title: c.title, harness: c.harness, isOrchestrator: c.isOrchestrator, closedAt: c.closedAt, handoffBusy: c.handoffBusy, lastText: c.lastText, lastError: c.lastError, lastResult: c.lastResult, pending: c.pending, parentId: c.parentId, agent: c.agent, turnResultAt, reportedTurn });
  }

  /** the Orchestrator, which every work chat's news go to; without the list, the one seen */
  private orchestratorId(): string | null {
    const r = this.d.list ? this.d.list().find(c => c.isOrchestrator && !c.closedAt) : undefined;
    if (r) { if (!this.chats.has(r.id)) this.remember(r); return r.id; }
    for (const [id, c] of this.chats) if (c.isOrchestrator) return id;
    return null;
  }

  private orchestrator(): Seen | undefined {
    const id = this.orchestratorId();
    return id ? this.chats.get(id) : undefined;
  }

  private schedule(at: number): void {
    if (this.timer && this.dueAt <= at) return;
    if (this.timer) clearTimeout(this.timer);
    this.dueAt = at;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, Math.max(0, at - this.now()));
    this.timer.unref?.();
  }

  private flush(): void {
    if (this.sending || !this.buffer.size) return;
    const id = this.orchestratorId();
    if (!this.d.enabled() || !id) { this.buffer.clear(); this.changed(); return; }
    for (const [k, e] of this.buffer) if (!this.chats.get(e.chatId) || this.chats.get(e.chatId)?.closedAt) this.buffer.delete(k);
    const gate = gateOf(this.orchestrator()!);
    const now = this.now();
    // due: something that may go through the gate now; then everything ready that the gate lets through goes with it
    // (quiet news rides along), chats told too recently wait for their turn
    if (this.nextDue(gate) > now) { this.reschedule(); return; }
    const ready = [...this.buffer.values()].filter(e => passes(gate, classOf(e)) && this.readyAt(slotOf(e)) <= now);
    ready.sort((a, b) => a.at - b.at);
    for (const e of ready) this.lastSent.set(slotOf(e), now);
    this.changed();
    this.sending = true;
    log.info('chats', 'news sent to the Orchestrator', { chat: id, data: { chats: ready.length, kinds: ready.map(e => e.kind), gate } });
    let settled = false;
    const receipt: WakeSubmissionReceipt = {
      submitted: () => {
        if (settled) return; settled = true;
        for (const e of ready) if (this.buffer.get(slotOf(e)) === e) this.buffer.delete(slotOf(e));
        this.changed(); this.sending = false; this.reschedule();
      },
      failed: error => {
        if (settled) return; settled = true;
        log.warn('chats', 'news not sent to the Orchestrator', { chat: id, cause: errText(error), hint: 'the durable outbox retries after the cooldown' });
        this.sending = false; this.reschedule();
      },
    };
    void this.d.send(id, wakeMessage(ready), receipt)
      .then(() => { if (!this.d.receiptAcknowledgement) receipt.submitted(); })
      .catch(receipt.failed);

  }
}
