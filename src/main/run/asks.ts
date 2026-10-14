// "Comando da eseguire": a shell block a chat left for the user becomes an open request, like a question or a
// permission, so it shows in the chat's tile, in the request layer and in the questions window (never in the Regia), and
// notifies. Why: a block with Esegui stood unnoticed in a chat and the work stood still (the user, 2026-10-12: "non mi
// appare come notifica quando devo premere Esegui").
// How: it watches the events main sends to the page (chat:item, chat:updated, chat:removed), so it works the same for
// Claude, Cursor and the demo without touching the engines. When a chat's turn ends (its state goes back to idle),
// the turn's last assistant message is read with the rule in shared/command-ask.ts; each block it picks, not run yet,
// becomes a PendingRequest of type 'command' (pending:added + the onAsk notification). It leaves (pending:resolved)
// when the block runs (ran(), from run:start: Esegui in the chat or on the card), when the user says "Non serve"
// (dismiss), or when the chat goes on (a new message, a new turn, archived or removed; the app's own news to the Regia,
// chats/regia-wake.ts, and a run's result, run/results.ts, are not the chat going on). It never blocks the chat:
// ChatSummary.pending does not count it, so messages are never queued behind it. Nothing is persisted: after a
// restart the chats are closed and their blocks keep their Esegui in the chat.
// Used by wiring.ts (attachCommandAsks, for the real app and the demo) and index.ts (chat:pending, run:*).
import type { ChatItem, ChatState, ChatSummary, EventMap, PendingRequest } from '../../shared/contract';
import { askedBlocks } from '../../shared/command-ask';
import { prodRisk } from '../../shared/runnable';
import { log } from '../log';
import { APP_EVENT_LABEL } from '../chats/regia-wake';
import { RUN_RESULT_LABEL } from './results';
import { isNotesOnly } from '../../shared/notes';

export interface CommandAsksDeps {
  emit<K extends 'pending:added' | 'pending:resolved'>(channel: K, payload: EventMap[K]): void;
  /** has this block of that message already been run (the runner's list)? */
  ran(chatId: string, itemId: string, code: string): boolean;
  /** a new request (→ the feed "Domanda per te": the notification) */
  onAsk?(req: PendingRequest, chatTitle: string): void;
  /** how long after the turn's end the last message is read (late streaming updates land first) */
  settleMs?: number;
  now?(): number;
}

interface Turn { last: { id: string; text: string } | null; ids: Set<string> }

/** a turn ran: 'starting' alone is an engine booting (a reopen, a queued chat), its idle has no new message to read */
const IN_TURN: ReadonlySet<ChatState> = new Set(['running', 'waiting']);

export class CommandAsks {
  private asks = new Map<string, Map<string, PendingRequest>>();
  private turns = new Map<string, Turn>();
  private chats = new Map<string, Pick<ChatSummary, 'state' | 'title' | 'closedAt' | 'handoffBusy'>>();
  private timers = new Map<string, NodeJS.Timeout>();
  /** chats whose current turn the app started with its news ("Eventi alla Regia"): the user did not move on */
  private appTurn = new Set<string>();
  /** chats in a hand-off turn (manager askHandoff): its items are the note, not a message for the user */
  private handoff = new Set<string>();

  constructor(private readonly d: CommandAsksDeps) {}

  /** Every event main sends to the page passes here (wiring.ts taps the emitter). */
  observe(channel: string, payload: unknown): void {
    if (channel === 'chat:item') { const p = payload as EventMap['chat:item']; this.item(p.chatId, p.item); }
    else if (channel === 'chat:updated') this.updated(payload as ChatSummary);
    else if (channel === 'chat:removed') { const { chatId } = payload as EventMap['chat:removed']; this.forget(chatId); }
  }

  pending(): PendingRequest[] {
    return [...this.asks.values()].flatMap(m => [...m.values()]).sort((a, b) => a.at - b.at);
  }

  has(chatId: string, requestId: string): boolean { return !!this.asks.get(chatId)?.has(requestId); }

  /** "Non serve": off the list, the block stays in the chat with its Esegui. */
  dismiss(chatId: string, requestId: string): void {
    if (!this.has(chatId, requestId)) throw new Error('Questa richiesta non è più aperta.');
    log.info('run', 'command request dismissed', { chat: chatId, data: { id: requestId } });
    this.drop(chatId, requestId);
  }

  /** A run started (Esegui on the card or under the block): its request is answered. */
  ran(chatId: string, itemId: string, code: string): void {
    const m = this.asks.get(chatId);
    if (!m) return;
    for (const r of [...m.values()]) if (r.command?.itemId === itemId && r.command.code === code) this.drop(chatId, r.id);
  }

  stop(): void { for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); }

  private item(chatId: string, item: ChatItem): void {
    if (item.kind === 'user') {
      // the app's own messages (news to the Regia, a run's result) and the notes of the user's clicks (Mandato, Non
      // serve: ADR 0038) are no answer to the other commands it left: they stay
      if (item.text.startsWith(APP_EVENT_LABEL) || item.text.startsWith(RUN_RESULT_LABEL) || isNotesOnly(item.text)) this.appTurn.add(chatId);
      else { this.appTurn.delete(chatId); this.clear(chatId, 'new message'); }
      this.turns.set(chatId, { last: null, ids: new Set([item.id]) });
      return;
    }
    if (this.handoff.has(chatId)) return; // the hand-off note: never the turn's last message
    const t = this.turns.get(chatId) ?? { last: null, ids: new Set<string>() };
    this.turns.set(chatId, t);
    const seen = t.ids.has(item.id);
    t.ids.add(item.id);
    if (item.kind === 'assistant') {
      // a new message, or the streaming update of the last one (an older message's update never takes its place)
      if (!seen || t.last?.id === item.id) t.last = { id: item.id, text: item.text };
      // a late update of the turn's last message after the turn ended: read it again
      if (t.last?.id === item.id && this.chats.get(chatId)?.state === 'idle' && this.timers.has(chatId)) this.schedule(chatId);
    } else if (!seen && (item.kind === 'tool' || item.kind === 'thinking')) t.last = null; // the agent went on after it
  }

  private updated(c: ChatSummary): void {
    const was = this.chats.get(c.id)?.state;
    this.chats.set(c.id, { state: c.state, title: c.title, closedAt: c.closedAt, handoffBusy: c.handoffBusy });
    if (c.closedAt) { this.clear(c.id, 'archived'); return; }
    if (c.handoffBusy && !this.handoff.has(c.id)) {
      // a hand-off starts right after a turn: that turn's last message is read now, before the note's items arrive
      this.handoff.add(c.id);
      const t = this.timers.get(c.id);
      if (t) { clearTimeout(t); this.timers.delete(c.id); this.read(c.id, true); }
    }
    if (this.handoff.has(c.id)) {
      // the hand-off turn is over (handoffBusy goes before idle): nothing to read, the requests stay
      if (c.state === 'idle' && !c.handoffBusy) this.handoff.delete(c.id);
      return;
    }
    if (c.state === 'running' && was !== 'running' && !this.appTurn.has(c.id)) this.clear(c.id, 'new turn');
    // the turn is over: read its last message once the last streaming updates have landed
    if (c.state === 'idle' && was && IN_TURN.has(was) && !c.handoffBusy) this.schedule(c.id);
  }

  private schedule(chatId: string): void {
    const old = this.timers.get(chatId);
    if (old) clearTimeout(old);
    const t = setTimeout(() => { this.timers.delete(chatId); this.read(chatId); }, this.d.settleMs ?? 250);
    t.unref?.();
    this.timers.set(chatId, t);
  }

  /** force: the turn ended and a hand-off starts at once (state and handoffBusy already moved on) */
  private read(chatId: string, force = false): void {
    const c = this.chats.get(chatId);
    const last = this.turns.get(chatId)?.last;
    this.appTurn.delete(chatId);
    if (!c || c.closedAt || !last || (!force && (c.state !== 'idle' || c.handoffBusy))) return;
    const m = this.asks.get(chatId) ?? new Map<string, PendingRequest>();
    for (const b of askedBlocks(last.text)) {
      const id = `cmd-${last.id}-${b.index}`;
      if (m.has(id) || this.d.ran(chatId, last.id, b.code)) continue;
      const prod = prodRisk(b.code);
      const req: PendingRequest = {
        id, chatId, type: 'command', tool: 'Esegui', title: 'Comando da eseguire', detail: b.code,
        input: { itemId: last.id, code: b.code, lang: b.lang }, at: this.d.now?.() ?? Date.now(),
        command: { itemId: last.id, code: b.code, lang: b.lang, ...(prod ? { prod } : {}), ...(b.lead ? { lead: b.lead } : {}) },
      };
      m.set(id, req);
      this.asks.set(chatId, m);
      log.info('run', 'command request', { chat: chatId, data: { id, chars: b.code.length, prod: prod ?? null } });
      this.d.emit('pending:added', req);
      this.d.onAsk?.(req, c.title);
    }
  }

  private drop(chatId: string, requestId: string): void {
    const m = this.asks.get(chatId);
    if (!m?.delete(requestId)) return;
    if (!m.size) this.asks.delete(chatId);
    this.d.emit('pending:resolved', { chatId, requestId });
  }

  private clear(chatId: string, why: string): void {
    const t = this.timers.get(chatId);
    if (t) { clearTimeout(t); this.timers.delete(chatId); }
    const m = this.asks.get(chatId);
    if (!m) return;
    log.debug('run', 'command requests cleared', { chat: chatId, data: { why, n: m.size } });
    for (const id of [...m.keys()]) this.drop(chatId, id);
  }

  private forget(chatId: string): void {
    this.clear(chatId, 'removed');
    this.turns.delete(chatId);
    this.chats.delete(chatId);
    this.handoff.delete(chatId);
  }
}
