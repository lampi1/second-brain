// Single entry (ADR 0239): a work chat's Sì/No question reaches the user through the Orchestrator's own conversation,
// so it works where only the Orchestrator is seen (Remote Control on claude.ai, a phone conversation, the PC). The
// Orchestrator calls app_relay_question for a chat; the app records which question it relays and hands back its exact
// text, which the Orchestrator writes to the user. The user's NEXT own message in the Orchestrator chat answers it
// when it is just «sì» or «no» (any channel: the PC, the paired phone, Remote Control), from the user's words and by
// the app, never from the Orchestrator's: an agent's mail or the app's news never count. Any other message ends the
// relay (a later bare «no» may answer something else). Only simple yes/no questions of the engines' own question
// tools (any other the Orchestrator answers itself with app_resolve_question, ADR 0275), never a permission. A command
// a chat left is relayed as «Eseguo sul PC?» (ADR 0259 §4) with its whole text: «sì» runs it on the PC, production,
// databases and Azure included (his «sì» to what he read is the second click, ADR 0275), «no» puts it aside. The text carries the same parts
// as the PC's card (ask-text.ts questionLines). Telegram's filter hides commands, paths and addresses, so a command it
// cannot show whole is refused up front while he writes from Telegram (#390: never a question whose «sì» is then thrown
// away); Remote Control shows the Orchestrator's reply whole, so his «sì» there runs it as on the PC. One relay per Orchestrator at a time, for RELAY_MS; a question answered elsewhere first drops
// it. A «sì»/«no» that cannot be delivered (the relay expired, the question changed, the delivery failed) is told to
// the Orchestrator, never lost in silence. Used by wiring.ts (the tool and the emitter tap); pinned by
// test/unit/chats/relay.test.ts.
import type { Answer, ChatItem, ChatSummary, PendingRequest } from '../../shared/contract';
import { isNativeQuestion, isYesNo, yesNoOf } from '../../shared/yes-no';
import type { PhoneCommands } from './phone-port';
import { briefFor, commandLines, commandShownWhole, questionLines } from './ask-text';
import { errText, log } from '../log';
import { callerOf } from '../mcp/caller';
import type { McpTool } from '../mcp/server';

export const RELAY_MS = 30 * 60_000;
/** where a user's message was typed away from the PC: Telegram ('phone') or Remote Control ('remote') */
type Channel = 'phone' | 'remote';
/** relay_question's refusal of a command Telegram cannot show (#390): what the Orchestrator tells him instead */
const TELEGRAM_HIDES = (title: string): string => `Not relayed: the user is writing from Telegram, which hides commands, paths and addresses, and his «sì» never runs a command he did not read whole. Do not ask him yes or no. Tell him in one line that a command of «${title}» waits for him: he approves it with Esegui on the PC, or from Remote Control, where he reads it whole.`;

/** what the Orchestrator writes to the user, word for word: the card's parts, one per line, then «Rispondi sì o no» */
const writeText = (title: string, lines: readonly string[]): string =>
  `Write to the user, exactly${lines.length > 1 ? ', keeping the line breaks' : ''}: «${title} chiede: ${lines.join('\n')}${lines.length > 1 ? '\n' : ' '}Rispondi sì o no.» and ask nothing else in that message. Their next message, if it is only «sì» or «no», answers it: the app delivers it, you do nothing more; any other reply ends the relay (relay again if needed). If it cannot be delivered the app tells you. Never answer it yourself.`;

export interface RelayDeps {
  chats(): ChatSummary[];
  pending(): PendingRequest[];
  items(chatId: string): ChatItem[];
  /** ChatManager.answer: by = where the user wrote (a phone or Remote Control message is 'phone': a question only) */
  answer(chatId: string, requestId: string, answer: Answer, by: 'pc' | 'phone'): Promise<void>;
  /** an app line to the Orchestrator (its news path): a relayed answer that did not land */
  notify?(orchestratorId: string, text: string): void;
  /** the commands the chats left (run/asks.ts); absent = a command is never relayed */
  commands?: PhoneCommands;
  now?(): number;
}

interface Relay { orchestratorId: string; chatId: string; requestId: string; question: string; at: number; command?: boolean }

export class QuestionRelay {
  private relays = new Map<string, Relay>();
  /** a relay another message ended (the user may not have seen the question yet): a bare «sì»/«no» after it is told */
  private ended = new Map<string, Relay>();
  constructor(private readonly d: RelayDeps) {}
  private now(): number { return this.d.now?.() ?? Date.now(); }

  /** The Orchestrator relays a work chat's open Sì/No question: what it must write to the user, word for word. */
  relay(orchestratorId: string, chatId: string): { question: string; chat: string; write: string } {
    const chats = this.d.chats(), o = chats.find(c => c.id === orchestratorId), c = chats.find(x => x.id === chatId);
    if (!o?.isOrchestrator) throw new Error('Only the Orchestrator relays questions.');
    if (!c || c.isOrchestrator || c.closedAt) throw new Error('chatId: an open work chat (app_pending).');
    const cmds = (this.d.commands?.pending() ?? []).filter(p => p.chatId === chatId);
    const asks = [...cmds, ...this.d.pending().filter(p => p.chatId === chatId)].sort((a, b) => a.at - b.at);
    if (!asks.length) throw new Error('That chat waits for no answer now (app_pending).');
    // its command first: the PC's window shows it before the chat's question too (ADR 0259)
    // production, databases and Azure too (ADR 0275): he reads the whole command and his «sì» runs it
    const cmd = cmds[0];
    if (cmd) return this.relayCommand(orchestratorId, c.title, cmd);
    const p = asks.find(x => x.type === 'question');
    if (!p) throw new Error('Only a question or a command is relayed. A permission you answer yourself with app_resolve_question (allow); one that runs on production, a database or Azure: show the user what it runs, and after his yes answer it with confirmed true.');
    const q = p.questions?.[0];
    if (p.questions?.length !== 1 || !q || !isYesNo(q)) throw new Error('Only a single Sì/No question is relayed. Write this one to the user yourself, then answer it for him with app_resolve_question with what he says.');
    const armed = this.relays.get(orchestratorId);
    if (armed && armed.requestId !== p.id && this.now() - armed.at <= RELAY_MS && this.d.pending().some(x => x.chatId === armed.chatId && x.id === armed.requestId)) {
      const other = chats.find(x => x.id === armed.chatId)?.title ?? armed.chatId;
      throw new Error(`The user has not answered the question of «${other}» yet: one relayed question at a time. Relay this one after that answer.`);
    }
    if (!isNativeQuestion(p)) throw new Error('This is not the engine\'s own question: write it to the user yourself, then answer it for him with app_resolve_question with what he says.');
    this.armed(orchestratorId);
    this.relays.set(orchestratorId, { orchestratorId, chatId, requestId: p.id, question: q.question, at: this.now() });
    this.ended.delete(orchestratorId);
    log.info('chats', 'question relayed through the Orchestrator', { chat: chatId, data: { request: p.id } });
    let brief;
    try { brief = briefFor(p, this.d.items(chatId)); } catch { brief = undefined; }
    return { question: q.question, chat: c.title, write: writeText(c.title, questionLines(q.question, brief)) };
  }

  private armed(orchestratorId: string): void {
    const armed = this.relays.get(orchestratorId);
    if (armed && armed.command && this.now() - armed.at <= RELAY_MS && this.d.commands?.pending().some(x => x.chatId === armed.chatId && x.id === armed.requestId)) {
      const other = this.d.chats().find(x => x.id === armed.chatId)?.title ?? armed.chatId;
      throw new Error(`The user has not answered the command of «${other}» yet: one relayed question at a time. Relay this one after that answer.`);
    }
  }

  /** where the user's last own message in the Orchestrator's chat came from: his next one most likely comes from there too */
  private lastChannel(orchestratorId: string): Channel | 'pc' | null {
    let items: ChatItem[];
    try { items = this.d.items(orchestratorId); } catch { return null; }
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (it.kind === 'user' && !it.from) return it.via === 'phone' ? it.remote ? 'remote' : 'phone' : 'pc';
    }
    return null;
  }

  private relayCommand(orchestratorId: string, title: string, p: PendingRequest): { question: string; chat: string; write: string } {
    // he is on Telegram, which would show «[comando: eseguilo dal PC]» in place of this command: no question is asked
    // whose «sì» could not run it (#390)
    if (this.lastChannel(orchestratorId) === 'phone' && !commandShownWhole(p)) throw new Error(TELEGRAM_HIDES(title));
    const armed = this.relays.get(orchestratorId);
    if (armed && armed.requestId !== p.id && this.now() - armed.at <= RELAY_MS
      && [...this.d.pending(), ...(this.d.commands?.pending() ?? [])].some(x => x.chatId === armed.chatId && x.id === armed.requestId)) {
      const other = this.d.chats().find(x => x.id === armed.chatId)?.title ?? armed.chatId;
      throw new Error(`The user has not answered the question of «${other}» yet: one relayed question at a time. Relay this one after that answer.`);
    }
    const question = 'Eseguo questo comando sul tuo PC?';
    this.relays.set(orchestratorId, { orchestratorId, chatId: p.chatId, requestId: p.id, question, at: this.now(), command: true });
    this.ended.delete(orchestratorId);
    log.info('chats', 'command relayed through the Orchestrator', { chat: p.chatId, data: { request: p.id } });
    return { question, chat: title, write: writeText(title, commandLines(p, title)) };
  }

  /** the Orchestrator wrote the whole command to the user after relaying it (spaces folded: Markdown may rewrap it) */
  private shownWhole(orchestratorId: string, r: Relay, code: string): boolean {
    const fold = (t: string) => t.replace(/\s+/g, ' ').trim(), want = fold(code);
    if (!want) return false;
    try { return this.d.items(orchestratorId).some(i => i.kind === 'assistant' && i.at >= r.at && fold(i.text).includes(want)); } catch { return false; }
  }

  /** «sì» / «no» on a relayed command: run it on the PC or put it aside (checked again on the command as it is now) */
  private commandSaid(r: Relay, said: 'yes' | 'no' | null, orchestratorId: string, via?: Channel): boolean {
    const cmds = this.d.commands, p = cmds?.pending().find(x => x.chatId === r.chatId && x.id === r.requestId);
    if (!cmds || !p) return false;                       // run or put aside elsewhere first
    if (!said) { this.ended.set(orchestratorId, r); return false; }
    const why = this.now() - r.at > RELAY_MS ? 'l\'inoltro era scaduto (30 min)'
      // Telegram shows a command as «[comando: eseguilo dal PC]» (phone/filter.ts): a «sì» from there never runs what it
      // did not show. Reached only when the relay started while he wrote from the PC or Remote Control (relayCommand
      // refuses it up front on Telegram); Remote Control shows the reply whole and falls to the check below, as the PC
      : via === 'phone' && said === 'yes' && !commandShownWhole(p) ? 'su Telegram il comando non si vede intero, quindi il suo «sì» da lì non lo lancia: digli in una riga che lo approva dal PC (Esegui) o da Controllo remoto, senza richiedergli sì o no'
      // his «sì» runs only what he read: the Orchestrator's reply since the relay must hold the whole command (ADR 0275)
      : said === 'yes' && !this.shownWhole(orchestratorId, r, p.command?.code ?? '') ? 'non gli hai mostrato il comando intero: riscrivigli il testo di relay_question parola per parola' : '';
    if (why) { this.lost(r, said, why); return false; }
    try {
      // he read the whole command in the relayed text: his «sì» is the second click production needs (ADR 0275)
      if (said === 'yes') cmds.run(r.chatId, r.requestId, true); else cmds.dismiss(r.chatId, r.requestId);
      log.info('chats', 'relayed command decided by the user', { chat: r.chatId, data: { request: r.requestId, answer: said } });
      return true;
    } catch (e) {
      log.warn('chats', 'relayed command not run', { chat: r.chatId, cause: errText(e), hint: 'the command stays on the PC with its Esegui' });
      this.lost(r, said, `non è partito (${errText(e)})`);
      return false;
    }
  }

  /** A user's own message in the Orchestrator chat (wiring.ts taps chat:item). True = it answered a relayed question. */
  async userSaid(orchestratorId: string, text: string, via?: Channel): Promise<boolean> {
    const said = yesNoOf(text);
    const r = this.relays.get(orchestratorId);
    if (!r) {
      // a «sì»/«no» after a relay another message ended (it may have crossed the question): never lost in silence
      const e = this.ended.get(orchestratorId);
      this.ended.delete(orchestratorId);
      if (e && said && this.now() - e.at <= RELAY_MS && [...this.d.pending(), ...(this.d.commands?.pending() ?? [])].some(x => x.chatId === e.chatId && x.id === e.requestId)) {
        this.lost(e, said, 'era arrivato prima un altro messaggio, che ha chiuso l\'inoltro');
      }
      return false;
    }
    this.relays.delete(orchestratorId);                  // the next own message: an answer or the end of the relay
    if (r.command) return this.commandSaid(r, said, orchestratorId, via);
    const p = this.d.pending().find(x => x.chatId === r.chatId && x.id === r.requestId);
    if (!p) return false;                                // answered elsewhere first: nothing waits for this word
    if (!said) { this.ended.set(orchestratorId, r); return false; }   // something else: the Orchestrator reads it
    const option = p.questions?.[0]?.options.find(o => yesNoOf(o.label) === said);
    const why = this.now() - r.at > RELAY_MS ? 'l\'inoltro era scaduto (30 min)'
      : !option || p.questions?.[0]?.question !== r.question ? 'la domanda è cambiata' : '';
    if (!why) {
      try {
        await this.d.answer(r.chatId, r.requestId, { kind: 'question', answers: { [r.question]: option!.label } }, via ? 'phone' : 'pc');
        log.info('chats', 'relayed question answered by the user', { chat: r.chatId, data: { request: r.requestId, answer: said } });
        return true;
      } catch (e) {
        log.warn('chats', 'relayed answer not delivered', { chat: r.chatId, cause: errText(e), hint: 'the question stays in its panel on the PC' });
        this.lost(r, said, 'la consegna alla chat non è riuscita');
        return false;
      }
    }
    this.lost(r, said, why);
    return false;
  }

  private lost(r: Relay, said: 'yes' | 'no', why: string): void {
    const title = this.d.chats().find(c => c.id === r.chatId)?.title ?? r.chatId;
    log.info('chats', 'relayed answer not delivered', { chat: r.chatId, data: { why } });
    this.d.notify?.(r.orchestratorId, `[evento app] La risposta «${said === 'yes' ? 'sì' : 'no'}» dell'utente NON è arrivata a «${title}»: ${why}. La domanda è ancora aperta: inoltrala di nuovo con relay_question o di' all'utente che aspetta sul PC.`);
  }

  /** relay_question on the Orchestrator's own endpoint (tool-visibility.ts: shown to it only; the caller is the token's chat) */
  tool(): McpTool {
    return {
      name: 'relay_question',
      description: 'Bring a work chat\'s open Sì/No question to the user through THIS conversation (Remote Control, phone, PC): the app returns its exact text; write it to the user as told. Their next message that is only «sì» or «no» answers it (the app delivers it). A command the chat left is relayed first, as «Eseguo sul PC?», whole: his «sì» runs it on the PC (production, databases and Azure too: he read it). While he writes from Telegram a command it cannot show whole is refused: say what the refusal tells you. A permission is never relayed: answer it with app_resolve_question.',
      inputSchema: { type: 'object', required: ['chatId'], additionalProperties: false, properties: { chatId: { type: 'string', description: 'the work chat that waits (app_pending)' } } },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (a, ctx) => JSON.stringify(this.relay(callerOf(ctx.params), String(a.chatId ?? ''))),
    };
  }

  /** what is relayed now (tests, diagnostics) */
  current(orchestratorId: string): Relay | undefined { return this.relays.get(orchestratorId); }
}
