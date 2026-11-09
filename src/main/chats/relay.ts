// Single entry (ADR 0239): a work chat's Sì/No question reaches the user through the Orchestrator's own conversation,
// so it works where only the Orchestrator is seen (Remote Control on claude.ai, a phone conversation, the PC). The
// Orchestrator calls app_relay_question for a chat; the app records which question it relays and hands back its exact
// text, which the Orchestrator writes to the user. The user's NEXT own message in the Orchestrator chat that is just
// «sì» or «no» (any channel: the PC, the paired phone, Remote Control) answers that question, from the user's words
// and by the app, never from the Orchestrator's: an agent's mail or the app's news never count. Anything else leaves
// the relay open. Only simple yes/no questions of the engines' own question tools, never one touching production,
// deploys, pushes, secrets or messages to people (phone-port.ts phoneQuestionReserved: those stay for the PC), never
// a permission or a command (the user's click). One relay per Orchestrator, for RELAY_MS; a question answered
// elsewhere first drops it. Used by wiring.ts (the tool and the emitter tap); pinned by test/unit/chats/relay.test.ts.
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
  now?(): number;
}

interface Relay { orchestratorId: string; chatId: string; requestId: string; question: string; at: number }

export class QuestionRelay {
  private relays = new Map<string, Relay>();
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
    if (phoneQuestionReserved(p, () => this.d.items(chatId))) throw new Error('This question touches something reserved to the user (production, a deploy, a push, a secret, a message to people) or is not the engine\'s own question: it stays in its panel on the PC. Tell the user it waits there.');
    this.relays.set(orchestratorId, { orchestratorId, chatId, requestId: p.id, question: q.question, at: this.now() });
    log.info('chats', 'question relayed through the Orchestrator', { chat: chatId, data: { request: p.id } });
    return { question: q.question, chat: c.title,
      write: `Write to the user, exactly: «${c.title} chiede: ${q.question} Rispondi sì o no.» Their next message that is only «sì» or «no» answers it; the app delivers it, you do nothing more. Never answer it yourself.` };
  }

  /** A user's own message in the Orchestrator chat (wiring.ts taps chat:item). True = it answered a relayed question. */
  async userSaid(orchestratorId: string, text: string, via?: 'phone'): Promise<boolean> {
    const r = this.relays.get(orchestratorId);
    if (!r) return false;
    const open = this.d.pending().some(p => p.chatId === r.chatId && p.id === r.requestId);
    if (!open || this.now() - r.at > RELAY_MS) { this.relays.delete(orchestratorId); return false; }
    const said = yesNoOf(text);
    if (!said) return false;
    const p = this.d.pending().find(x => x.chatId === r.chatId && x.id === r.requestId);
    const option = p?.questions?.[0]?.options.find(o => yesNoOf(o.label) === said);
    if (!p || !option) return false;
    this.relays.delete(orchestratorId);
    try {
      await this.d.answer(r.chatId, r.requestId, { kind: 'question', answers: { [r.question]: option.label } }, via === 'phone' ? 'phone' : 'pc');
      log.info('chats', 'relayed question answered by the user', { chat: r.chatId, data: { request: r.requestId, answer: said } });
      return true;
    } catch (e) {
      log.warn('chats', 'relayed answer not delivered', { chat: r.chatId, cause: errText(e), hint: 'the question stays in its panel on the PC' });
      return false;
    }
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
