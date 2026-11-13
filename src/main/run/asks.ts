// "Comando da eseguire": a shell block a chat left for the user becomes an open request, like a question or a
// permission, so it shows in the chat's tile, in the request layer and in the questions window (never in the Orchestrator), and
// notifies. Why: a block with Esegui stood unnoticed in a chat and the work stood still (the user, 2026-10-12: "non mi
// appare come notifica quando devo premere Esegui").
// How: it watches the events main sends to the page (chat:item, chat:updated, chat:removed), so it works the same for
// Claude, Cursor and the demo without touching the engines. When a chat's turn ends (its state goes back to idle),
// the turn's last assistant message is read with the rule in shared/command-ask.ts; each block it picks, not run yet,
// becomes a PendingRequest of type 'command' (pending:added + the onAsk notification). It leaves (pending:resolved)
// when the block runs (ran(), from run:start: Esegui in the chat or on the card), when the user says "Non serve"
// (dismiss), or when the chat goes on (a new message, a new turn, archived or removed; the app's own news to the Orchestrator,
// chats/orchestrator-wake.ts, and a run's result, run/results.ts, are not the chat going on). It never blocks the chat:
// ChatSummary.pending does not count it, so messages are never queued behind it. Nothing is persisted: after a
// restart the chats are closed and their blocks keep their Esegui in the chat.
// Asked once (ADR 0239, single entry): a block with the same code, in the same folder, as one another chat already left
// open is not asked again: that chat follows the open one, and the one run answers both (followersOf, run/results.ts
// sends the result to each). A run started on any chat's block answers every open ask of the same code and folder. A
// block that already ran with success in the same folder within RECENT_OK_MS is not asked either, once per chat and
// code: that chat gets the earlier result instead (alreadyRan); proposed again after that, it is asked as usual.
// A block whose command is still running in the same folder (Esegui on a long deploy, #383) is not asked either: the
// chat hears once that it runs and gets its result when it ends.
// When an open ask leaves without a run ("Non serve", its chat went on), its first follower is asked in its place.
// A block followed by a question in the same turn (ADR 0259, the owner 2026-11-10: «mi chiede se ho eseguito un comando
// prima della modale esegui»): a question or a visual (AskUserQuestion, ask_user, show_ui) is not work, so the block stays
// the turn's last message, and it is asked as soon as the chat waits on that question, not only once the turn ends; a
// block put aside with «Non serve» is not asked again in the same turn.
// Checked first (#388): a block that cannot even start (a placeholder left in, a program path that does not exist, a
// shell waiting for the keyboard, a PowerShell 5.1 parse error: run/precheck.ts) is not shown; it goes back to its chat
// with the reasons (CHECK_LABEL), so the user only sees commands that can start. After MAX_BOUNCES such returns in a row
// the chat's next broken block is shown anyway, its problems written on the card (no endless loop of tokens).
// Used by wiring.ts (attachCommandAsks, for the real app and the demo) and index.ts (chat:pending, run:*).
import type { ChatItem, ChatState, ChatSummary, EventMap, PendingRequest, RunInfo } from '../../shared/contract';
import { askedBlocks, type AskedBlock } from '../../shared/command-ask';
import { prodRisk } from '../../shared/runnable';
import { log } from '../log';
import { APP_EVENT_LABEL } from '../chats/orchestrator-wake';
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
  /** the folder a chat's block runs in (CommandRunner.cwdOf): the same code in another folder is another command */
  cwdOf?(chatId: string): string | undefined;
  /** the runs so far (CommandRunner.list): a block that ran with success recently is not asked again */
  runs?(): RunInfo[];
  /** a block not asked because it ran with success recently: that run's result goes to the chat (RunResults.tell);
   *  false = it could not be told (results off): the block is asked as usual */
  alreadyRan?(chatId: string, run: RunInfo): boolean;
  /** #388: what makes the block fail before it starts, in that folder ([] = none; run/precheck.ts) */
  check?(code: string, cwd: string): Promise<string[]>;
  /** #388: a block not shown because of check goes back to its chat with this message (labelled CHECK_LABEL) */
  sendBack?(chatId: string, text: string): Promise<boolean>;
}

/** The first line of the message that sends a broken block back (renderer/lib/foreign.ts reads it as Esegui's). */
export const CHECK_LABEL = "[controllo di Esegui · messaggio automatico di second-brain: il comando che hai lasciato all'utente non gli è stato mostrato perché non può partire; non è un messaggio dell'utente]";
/** broken blocks sent back in a row by one chat before the next is shown anyway */
export const MAX_BOUNCES = 3;

/** The message that sends a broken block back to its chat (Italian: the chats speak Italian with the user). */
export function checkMessage(blocks: readonly { code: string; problems: readonly string[] }[], cwd: string): string {
  return [CHECK_LABEL, ...blocks.flatMap(b => [`Comando (PowerShell 5.1, cartella ${cwd}):`, '```powershell', b.code, '```',
    `Esito: non mostrato all'utente: ${b.problems[0] ?? ''}`, ...b.problems.map(p => `- ${p}`), '']),
    'Correggilo e riproponilo come ultimo blocco della risposta; se non puoi correggerlo, spiega all\'utente cosa manca.'].join('\n');
}

/** a block that ran with success within this time is not asked again (once per chat and code) */
export const RECENT_OK_MS = 60 * 60_000;
/** the code as Esegui runs it (runner.ts start): line ends and trailing space do not make another command */
export const sameCode = (code: string): string => code.replace(/\r\n/g, '\n').trimEnd();

interface Turn { last: { id: string; text: string } | null; ids: Set<string> }

/** Tools that ask or show something to the user without doing any work: the turn's last message stays the one before
 *  them, so a block followed by a question is still the command the user is asked to run (ADR 0259). */
const TRANSPARENT_TOOL = /(?:^|__)(?:AskUserQuestion|AskQuestion|ask_user|show_ui)$/;

/** a turn ran: 'starting' alone is an engine booting (a reopen, a queued chat), its idle has no new message to read */
const IN_TURN: ReadonlySet<ChatState> = new Set(['running', 'waiting']);

export class CommandAsks {
  private asks = new Map<string, Map<string, PendingRequest>>();
  private turns = new Map<string, Turn>();
  private chats = new Map<string, Pick<ChatSummary, 'state' | 'title' | 'closedAt' | 'handoffBusy' | 'pending'>>();
  private timers = new Map<string, NodeJS.Timeout>();
  /** chats whose current turn the app started with its news ("Eventi all'Orchestrator"): the user did not move on */
  private appTurn = new Set<string>();
  /** chats in a hand-off turn (manager askHandoff): its items are the note, not a message for the user */
  private handoff = new Set<string>();
  /** How many turn ends were read, with or without a command in them (tests, diagnostics) */
  reads = 0;
  /** open ask (chatId#requestId) → the same block left by other chats, not asked again (asked once, ADR 0239) */
  private followers = new Map<string, PendingRequest[]>();
  /** a run (chatId|itemId|code) → the other chats whose open ask of the same code it answered */
  private runFollowers = new Map<string, Set<string>>();
  /** chatId#requestId the user put aside with «Non serve» in this turn: a later read of the same message (the question
   *  that followed it answered, the turn over) never asks it again */
  private dismissed = new Set<string>();
  /** chat → the message read when the chat stopped on a question (askedAtQuestion) */
  private atQuestion = new Map<string, string>();
  /** chatId|code already told about a recent success: proposed again, it is asked */
  private toldRecent = new Set<string>();
  /** chatId|runId already told that run is still going (#383): proposed again meanwhile, still not asked */
  private toldRunning = new Set<string>();
  /** chat → broken blocks sent back in a row (#388) */
  private bounces = new Map<string, number>();
  /** chat → the send-back waiting for the chat to be free (#388) */
  private held = new Map<string, { itemId: string; text: string; blocks: { b: AskedBlock; key: string; problems: string[] }[] }>();
  /** chatId#requestId being checked, or already sent back: a second read of the same message never checks it again */
  private checked = new Set<string>();

  /** the run results (RunResults.tell), linked once both exist (wiring-shared.ts attachRunResults) */
  private teller?: (chatId: string, run: RunInfo) => boolean;

  constructor(private readonly d: CommandAsksDeps) {}

  /** RunResults is built after this: from then on a block that ran with success recently is told, not asked. */
  useResults(tell: (chatId: string, run: RunInfo) => boolean): void { this.teller = tell; }

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

  /** Whether this message belongs to the chat's current turn (a run's result may answer that turn's question). */
  /** The message whose blocks were asked when the chat stopped on its question (ADR 0259), until the turn goes on: a run
   *  of one of them may answer that question; a block from earlier in the turn, or a later question, never. */
  askedAtQuestion(chatId: string, itemId: string): boolean { return this.atQuestion.get(chatId) === itemId; }

  /** "Non serve": off the list, the block stays in the chat with its Esegui. */
  dismiss(chatId: string, requestId: string): void {
    if (!this.has(chatId, requestId)) throw new Error('Questa richiesta non è più aperta.');
    log.info('run', 'command request dismissed', { chat: chatId, data: { id: requestId } });
    this.dismissed.add(`${chatId}#${requestId}`);
    this.drop(chatId, requestId);
  }

  /** A run started (Esegui on the card or under the block): its request is answered, and so is every open ask of the
   *  same code in the same folder in other chats (asked once): those chats get the run's result too (followersOf).
   *  ended = the run was already over when start returned (it could not start): only its own request leaves, and a
   *  chat that followed it is asked in its place. */
  ran(chatId: string, itemId: string, code: string, ended = false): void {
    const key = runKey(chatId, itemId, code), cwd = this.d.cwdOf?.(chatId), want = sameCode(code);
    for (const [cid, m] of [...this.asks]) for (const r of [...m.values()]) {
      if (!r.command) continue;
      const own = cid === chatId && r.command.itemId === itemId && r.command.code === code;
      const twin = cid !== chatId && sameCode(r.command.code) === want && this.d.cwdOf?.(cid) === cwd;
      // a run that ended as it started (the shell could not start): it answered its own block, and no other chat
      if (ended) { if (own) this.drop(cid, r.id); continue; }
      if (!own && !twin) continue;
      const told = this.runFollowers.get(key) ?? new Set<string>();
      if (twin) told.add(cid);
      for (const f of this.followers.get(reqKey(r)) ?? []) if (f.chatId !== chatId) told.add(f.chatId);
      if (told.size) this.runFollowers.set(key, told);
      this.followers.delete(reqKey(r));
      this.drop(cid, r.id, true);
    }
  }

  /** The chats besides the run's own whose ask this run answered (asked once): each gets its result. Read once. */
  followersOf(run: Pick<RunInfo, 'chatId' | 'itemId' | 'code'>): string[] {
    const key = runKey(run.chatId, run.itemId, run.code), told = this.runFollowers.get(key);
    this.runFollowers.delete(key);
    return told ? [...told] : [];
  }

  stop(): void { for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); }

  private item(chatId: string, item: ChatItem): void {
    if (item.kind === 'user') {
      // the app's own messages (news to the Orchestrator, a run's result) and the notes of the user's clicks (Mandato, Non
      // serve: ADR 0038) are no answer to the other commands it left: they stay
      if (item.text.startsWith(APP_EVENT_LABEL) || item.text.startsWith(RUN_RESULT_LABEL) || item.text.startsWith(CHECK_LABEL) || isNotesOnly(item.text)) this.appTurn.add(chatId);
      else { this.appTurn.delete(chatId); this.clear(chatId, 'new message'); this.bounces.delete(chatId); this.held.delete(chatId); }
      this.turns.set(chatId, { last: null, ids: new Set([item.id]) });
      for (const k of [...this.dismissed]) if (k.startsWith(`${chatId}#`)) this.dismissed.delete(k);
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
    } else if (!seen && item.kind === 'tool' && TRANSPARENT_TOOL.test(item.name)) { /* a question or a visual: not work */ }
    else if (!seen && (item.kind === 'tool' || item.kind === 'thinking')) t.last = null; // the agent went on after it
  }

  private updated(c: ChatSummary): void {
    const was = this.chats.get(c.id)?.state;
    this.chats.set(c.id, { state: c.state, title: c.title, closedAt: c.closedAt, handoffBusy: c.handoffBusy, pending: c.pending });
    if (c.closedAt) { this.clear(c.id, 'archived'); this.held.delete(c.id); return; }
    if (this.held.has(c.id)) this.flushHeld(c.id);
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
    if (c.state === 'running' && was !== 'running') this.atQuestion.delete(c.id);
    // waiting → running is the same turn going on after an answer: the commands asked at its question stay
    if (c.state === 'running' && was !== 'running' && was !== 'waiting' && !this.appTurn.has(c.id)) this.clear(c.id, 'new turn');
    // the turn is over: read its last message once the last streaming updates have landed
    if (c.state === 'idle' && was && IN_TURN.has(was) && !c.handoffBusy) this.schedule(c.id);
    // the turn stops on a question right after a block (ADR 0259): the command is asked now, next to the question, not
    // only after the user answered it
    else if (c.state === 'waiting' && was === 'running' && !c.handoffBusy) this.schedule(c.id);
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
    this.reads++;
    this.appTurn.delete(chatId);
    if (!c || c.closedAt || !last || (!force && ((c.state !== 'idle' && c.state !== 'waiting') || c.handoffBusy))) return;
    if (c.state === 'waiting') this.atQuestion.set(chatId, last.id);
    const m = this.asks.get(chatId) ?? new Map<string, PendingRequest>();
    const cwd = this.d.cwdOf?.(chatId), now = this.d.now?.() ?? Date.now();
    const toCheck: { b: AskedBlock; id: string; key: string }[] = [];
    for (const b of askedBlocks(last.text)) {
      const id = `cmd-${last.id}-${b.index}`;
      if (m.has(id) || this.dismissed.has(`${chatId}#${id}`) || this.d.ran(chatId, last.id, b.code)) continue;
      const code = sameCode(b.code), toldKey = `${chatId}|${code}`;
      // the same command still running in the same folder (#383: a deploy of several minutes was proposed again while it
      // ran): never asked; the chat hears once that it runs, and gets its result when it ends (it follows that run)
      const running = cwd === undefined ? undefined : this.d.runs?.().filter(r => r.state === 'running' && r.cwd === cwd && sameCode(r.code) === code).at(-1);
      if (running) {
        const once = `${chatId}|${running.id}`;
        if (this.toldRunning.has(once) || (this.d.alreadyRan ?? this.teller)?.(chatId, running)) {
          this.toldRunning.add(once);
          if (running.chatId !== chatId) {   // results on only: with them off the block is asked as usual
            const key = runKey(running.chatId, running.itemId, running.code);
            this.runFollowers.set(key, (this.runFollowers.get(key) ?? new Set<string>()).add(chatId));
          }
          log.info('run', 'command not asked: the same command is still running', { chat: chatId, data: { id, run: running.id } });
          continue;
        }
      }
      const recent = cwd === undefined || this.toldRecent.has(toldKey) ? undefined : this.d.runs?.().filter(r => r.state === 'ok' && r.cwd === cwd && sameCode(r.code) === code && (r.endedAt ?? 0) >= now - RECENT_OK_MS).at(-1);
      if (recent && (this.d.alreadyRan ?? this.teller)?.(chatId, recent)) {
        this.toldRecent.add(toldKey);
        log.info('run', 'command not asked again: it ran with success recently', { chat: chatId, data: { id, run: recent.id } });
        continue;
      }
      if (!this.d.check || cwd === undefined) { this.offer(chatId, last.id, b, []); continue; }
      const key = `${chatId}#${id}`;
      if (this.checked.has(key)) continue;
      this.checked.add(key);
      toCheck.push({ b, id, key });
    }
    if (toCheck.length && this.d.check && cwd !== undefined) void this.checkAll(chatId, last.id, cwd, toCheck);
  }

  /** #388: the message's blocks checked together; the good ones are offered first, then the broken ones go back in one
   *  message (one bounce), held while the chat waits on a question or works. */
  private async checkAll(chatId: string, itemId: string, cwd: string, list: { b: AskedBlock; id: string; key: string }[]): Promise<void> {
    const check = this.d.check!;
    const found = await Promise.all(list.map(x => check(x.b.code, cwd).catch(() => [] as string[])));
    const cur = this.chats.get(chatId);
    // the chat went on meanwhile: nothing to do
    if (!cur || cur.closedAt || this.turns.get(chatId)?.last?.id !== itemId) return;
    const live = list.map((x, i) => ({ ...x, problems: found[i] ?? [] }))
      .filter(x => !this.has(chatId, x.id) && !this.dismissed.has(x.key) && !this.d.ran(chatId, itemId, x.b.code));
    const broken = live.filter(x => x.problems.length);
    for (const x of live) if (!x.problems.length) { this.checked.delete(x.key); this.offer(chatId, itemId, x.b, []); }
    if (!broken.length) { if (live.length) this.bounces.delete(chatId); return; }
    const n = this.bounces.get(chatId) ?? 0;
    if (n >= MAX_BOUNCES || !this.d.sendBack) { this.showBroken(chatId, itemId, broken); return; }
    this.bounces.set(chatId, n + 1);
    log.info('run', 'command not shown: it cannot start, sent back to its chat', { chat: chatId, data: { ids: broken.map(x => x.id), problems: broken.flatMap(x => x.problems) } });
    this.held.set(chatId, { itemId, text: checkMessage(broken.map(x => ({ code: x.b.code, problems: x.problems })), cwd), blocks: broken });
    this.flushHeld(chatId);
  }

  /** shown anyway, the problems on the card (MAX_BOUNCES reached, or the chat could not be told) */
  private showBroken(chatId: string, itemId: string, broken: { b: AskedBlock; key: string; problems: string[] }[]): void {
    this.bounces.delete(chatId);
    for (const x of broken) { this.checked.delete(x.key); this.offer(chatId, itemId, x.b, x.problems); }
  }

  /** The held send-back goes once the chat is free (idle, nothing open, no hand-off), like a run's result. */
  private flushHeld(chatId: string): void {
    const h = this.held.get(chatId), c = this.chats.get(chatId);
    if (!h || !c) return;
    // the agent wrote a newer message meanwhile: the old blocks are past, that message is read on its own
    if (this.turns.get(chatId)?.last?.id !== h.itemId) {
      this.held.delete(chatId);
      this.bounces.set(chatId, Math.max(0, (this.bounces.get(chatId) ?? 1) - 1));
      return;
    }
    if (c.state !== 'idle' || c.handoffBusy || c.pending) return;
    this.held.delete(chatId);
    void this.d.sendBack!(chatId, h.text).then(ok => {
      if (ok) return;
      // the chat could not be told: the user sees the blocks, with their problems
      this.bounces.set(chatId, Math.max(0, (this.bounces.get(chatId) ?? 1) - 1));
      if (this.turns.get(chatId)?.last?.id === h.itemId) this.showBroken(chatId, h.itemId, h.blocks);
    });
  }

  /** The block becomes the user's request, or follows the same open one of another chat (asked once). problems = what
   *  the check found, shown on the card when it was sent back MAX_BOUNCES times already. */
  private offer(chatId: string, itemId: string, b: AskedBlock, problems: readonly string[]): void {
    const c = this.chats.get(chatId);
    if (!c) return;
    const id = `cmd-${itemId}-${b.index}`, cwd = this.d.cwdOf?.(chatId), code = sameCode(b.code);
    const prod = prodRisk(b.code);
    const lead = [problems.length ? `⚠ Potrebbe non partire: ${problems.join('; ')}.` : '', b.lead].filter(Boolean).join(' ');
    const req: PendingRequest = {
      id, chatId, type: 'command', tool: 'Esegui', title: 'Comando da eseguire', detail: b.code,
      input: { itemId, code: b.code, lang: b.lang }, at: this.d.now?.() ?? Date.now(),
      command: { itemId, code: b.code, lang: b.lang, ...(prod ? { prod } : {}), ...(lead ? { lead } : {}) },
    };
    const open = cwd === undefined ? undefined : this.pending().find(r => r.chatId !== chatId && r.command && sameCode(r.command.code) === code && this.d.cwdOf?.(r.chatId) === cwd);
    if (open) {
      // asked once: this chat follows the open ask, and gets the result of its run
      const list = this.followers.get(reqKey(open)) ?? [];
      if (!list.some(f => f.chatId === chatId)) list.push(req);
      this.followers.set(reqKey(open), list);
      log.info('run', 'command not asked twice: another chat asks the same', { chat: chatId, data: { id, follows: open.chatId } });
      return;
    }
    this.open(req, c.title);
  }

  private open(req: PendingRequest, title: string): void {
    const m = this.asks.get(req.chatId) ?? new Map<string, PendingRequest>();
    m.set(req.id, req);
    this.asks.set(req.chatId, m);
    log.info('run', 'command request', { chat: req.chatId, data: { id: req.id, chars: req.detail.length, prod: req.command?.prod ?? null } });
    this.d.emit('pending:added', req);
    this.d.onAsk?.(req, title);
  }

  /** ran = it left because it ran: its followers got their result; otherwise the first follower is asked instead */
  private drop(chatId: string, requestId: string, ran = false): void {
    const m = this.asks.get(chatId);
    const req = m?.get(requestId);
    if (!m || !req) return;
    m.delete(requestId);
    if (!m.size) this.asks.delete(chatId);
    this.d.emit('pending:resolved', { chatId, requestId });
    const waiting = this.followers.get(reqKey(req));
    this.followers.delete(reqKey(req));
    if (ran || !waiting?.length) return;
    const [next, ...rest] = waiting.filter(f => { const c = this.chats.get(f.chatId); return !!c && !c.closedAt; });
    if (!next) return;
    if (rest.length) this.followers.set(reqKey(next), rest);
    this.open({ ...next, at: this.d.now?.() ?? Date.now() }, this.chats.get(next.chatId)?.title ?? '');
  }

  private clear(chatId: string, why: string): void {
    const t = this.timers.get(chatId);
    if (t) { clearTimeout(t); this.timers.delete(chatId); }
    // this chat went on: it follows no other chat's ask any more
    for (const [k, list] of [...this.followers]) {
      const keep = list.filter(f => f.chatId !== chatId);
      if (keep.length === list.length) continue;
      if (keep.length) this.followers.set(k, keep); else this.followers.delete(k);
    }
    const m = this.asks.get(chatId);
    if (!m) return;
    log.debug('run', 'command requests cleared', { chat: chatId, data: { why, n: m.size } });
    for (const id of [...m.keys()]) this.drop(chatId, id);
  }

  private forget(chatId: string): void {
    this.clear(chatId, 'removed');
    this.atQuestion.delete(chatId);
    for (const k of [...this.dismissed]) if (k.startsWith(`${chatId}#`)) this.dismissed.delete(k);
    for (const k of [...this.toldRecent]) if (k.startsWith(`${chatId}|`)) this.toldRecent.delete(k);
    for (const k of [...this.toldRunning]) if (k.startsWith(`${chatId}|`)) this.toldRunning.delete(k);
    this.turns.delete(chatId);
    this.chats.delete(chatId);
    this.handoff.delete(chatId);
    this.bounces.delete(chatId);
    this.held.delete(chatId);
    for (const k of [...this.checked]) if (k.startsWith(`${chatId}#`)) this.checked.delete(k);
  }
}

const reqKey = (r: Pick<PendingRequest, 'chatId' | 'id'>): string => `${r.chatId}#${r.id}`;
const runKey = (chatId: string, itemId: string, code: string): string => `${chatId}|${itemId}|${sameCode(code)}`;
