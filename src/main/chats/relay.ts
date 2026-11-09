// Single entry (ADR 0239): a work chat's Sì/No question reaches the user through the Orchestrator's own conversation,
// so it works where only the Orchestrator is seen (Remote Control on claude.ai, a phone conversation, the PC). The
// Orchestrator calls app_relay_question for a chat; the app records which question it relays and hands back its exact
// text, which the Orchestrator writes to the user. The user's NEXT own message in the Orchestrator chat answers it
// when it is just «sì» or «no» (any channel: the PC, the paired phone, Remote Control), from the user's words and by
// the app, never from the Orchestrator's: an agent's mail or the app's news never count. Any other message ends the
// relay (a later bare «no» may answer something else). Only simple yes/no questions of the engines' own question
// tools, never one touching production, deploys, pushes, secrets or messages to people (phone-port.ts
// phoneQuestionReserved, checked again when the answer comes: those stay for the PC), never a permission or a command
// (the user's click). One relay per Orchestrator at a time, for RELAY_MS; a question answered elsewhere first drops
// it. A «sì»/«no» that cannot be delivered (the relay expired, the question changed, the delivery failed) is told to
// the Orchestrator, never lost in silence. Used by wiring.ts (the tool and the emitter tap); pinned by
// test/unit/chats/relay.test.ts.
import type { Answer, ChatItem, ChatSummary, PendingRequest } from '../../shared/contract';
import { isYesNo, yesNoOf } from '../../shared/yes-no';
import { phoneQuestionReserved } from './phone-port';
import { errText, log } from '../log';
import { callerOf } from '../mcp/caller';
import type { McpTool } from '../mcp/server';

export const RELAY_MS = 30 * 60_000;

export interface RelayDeps {
  chats(): ChatSummary[];
  pending(): PendingRequest[];
  items(chatId: string): ChatItem[];
  /** ChatManager.answer: by = where the user wrote (a phone or Remote Control message is 'phone': a question only) */
  answer(chatId: string, requestId: string, answer: Answer, by: 'pc' | 'phone'): Promise<void>;
  /** an app line to the Orchestrator (its news path): a relayed answer that did not land */
  notify?(orchestratorId: string, text: string): void;
  now?(): number;
}

interface Relay { orchestratorId: string; chatId: string; requestId: string; question: string; at: number }

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
    const asks = this.d.pending().filter(p => p.chatId === chatId).sort((a, b) => a.at - b.at);
    if (!asks.length) throw new Error('That chat waits for no answer now (app_pending).');
    const p = asks.find(x => x.type === 'question');
    if (!p) throw new Error('Only a question is relayed: a permission or a command is the user\'s click on the PC (or Esegui). Tell the user it waits there.');
    const q = p.questions?.[0];
    if (p.questions?.length !== 1 || !q || !isYesNo(q)) throw new Error('Only a single Sì/No question is relayed; this one stays in its panel on the PC.');
    const armed = this.relays.get(orchestratorId);
    if (armed && armed.requestId !== p.id && this.now() - armed.at <= RELAY_MS && this.d.pending().some(x => x.chatId === armed.chatId && x.id === armed.requestId)) {
      const other = chats.find(x => x.id === armed.chatId)?.title ?? armed.chatId;
      throw new Error(`The user has not answered the question of «${other}» yet: one relayed question at a time. Relay this one after that answer.`);
    }
    if (phoneQuestionReserved(p, () => this.d.items(chatId))) throw new Error('This question touches something reserved to the user (production, a deploy, a push, a secret, a message to people) or is not the engine\'s own question: it stays in its panel on the PC. Tell the user it waits there.');
    this.relays.set(orchestratorId, { orchestratorId, chatId, requestId: p.id, question: q.question, at: this.now() });
    this.ended.delete(orchestratorId);
    log.info('chats', 'question relayed through the Orchestrator', { chat: chatId, data: { request: p.id } });
    return { question: q.question, chat: c.title,
      write: `Write to the user, exactly: «${c.title} chiede: ${q.question} Rispondi sì o no.» and ask nothing else in that message. Their next message, if it is only «sì» or «no», answers it: the app delivers it, you do nothing more; any other reply ends the relay (relay again if needed). If it cannot be delivered the app tells you. Never answer it yourself.` };
  }

  /** A user's own message in the Orchestrator chat (wiring.ts taps chat:item). True = it answered a relayed question. */
  async userSaid(orchestratorId: string, text: string, via?: 'phone'): Promise<boolean> {
    const said = yesNoOf(text);
    const r = this.relays.get(orchestratorId);
    if (!r) {
      // a «sì»/«no» after a relay another message ended (it may have crossed the question): never lost in silence
      const e = this.ended.get(orchestratorId);
      this.ended.delete(orchestratorId);
      if (e && said && this.now() - e.at <= RELAY_MS && this.d.pending().some(x => x.chatId === e.chatId && x.id === e.requestId)) {
        this.lost(e, said, 'era arrivato prima un altro messaggio, che ha chiuso l\'inoltro');
      }
      return false;
    }
    this.relays.delete(orchestratorId);                  // the next own message: an answer or the end of the relay
    const p = this.d.pending().find(x => x.chatId === r.chatId && x.id === r.requestId);
    if (!p) return false;                                // answered elsewhere first: nothing waits for this word
    if (!said) { this.ended.set(orchestratorId, r); return false; }   // something else: the Orchestrator reads it
    const option = p.questions?.[0]?.options.find(o => yesNoOf(o.label) === said);
    const why = this.now() - r.at > RELAY_MS ? 'l\'inoltro era scaduto (30 min)'
      : !option || p.questions?.[0]?.question !== r.question ? 'la domanda è cambiata'
      : phoneQuestionReserved(p, () => this.d.items(r.chatId)) ? 'la domanda ora tocca qualcosa riservato all\'utente' : '';
    if (!why) {
      try {
        await this.d.answer(r.chatId, r.requestId, { kind: 'question', answers: { [r.question]: option!.label } }, via === 'phone' ? 'phone' : 'pc');
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
      description: 'Bring a work chat\'s open Sì/No question to the user through THIS conversation (Remote Control, phone, PC): the app returns its exact text; write it to the user as told. Their next message that is only «sì» or «no» answers it (the app delivers it). Permissions, commands and questions about production, deploys, pushes, secrets or messages to people are refused: they stay for the user\'s click on the PC.',
      inputSchema: { type: 'object', required: ['chatId'], additionalProperties: false, properties: { chatId: { type: 'string', description: 'the work chat that waits (app_pending)' } } },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      run: (a, ctx) => JSON.stringify(this.relay(callerOf(ctx.params), String(a.chatId ?? ''))),
    };
  }

  /** what is relayed now (tests, diagnostics) */
  current(orchestratorId: string): Relay | undefined { return this.relays.get(orchestratorId); }
}
