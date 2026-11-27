// ChatManager layer (ADR 0200): the Orchestrator's topics and its per-topic context (ADR 0369). Each of the user's
// messages gets its topic from the app (agents/orchestrator-topic-service.ts), its replies and the chats' news take
// theirs, the chats it starts join the topic they were started on, and the user moves a message with one click
// ('orchestrator:setTopic'). When the Orchestrator's context starts again (a new session, or the rollover of an ACP
// engine past its budget or on a topic switch: orchestrator-rollover.ts) its first message carries the per-topic
// brief (agents/orchestrator-brief.ts) instead of the whole mixed history. Every hook here is a no-op without
// opts.topics. The rollover never touches the stop or queue logic: it runs only when the engine is idle, before the
// user's message is delivered (manager.ts deliverNow).
import crypto from 'node:crypto';
import { sameTopic } from '../../shared/orchestrator-topics';
import type { ChatItem, HandoffInfo, OrchestratorTopics, PendingRequest } from '../../shared/contract';
import { engineOf } from '../engines/registry';
import { errText, log } from '../log';
import { topicBrief, type BriefChat } from '../agents/orchestrator-brief';
import type { TopicAssignment, TopicChat, TopicQuestion } from '../agents/orchestrator-topics';
import { AFTER_CALLS } from './continuity';
import { ManagerContinuity } from './manager-continuity';
import { coldDivider } from './manager-helpers';
import type { Rec, RollTurns, RolloverStep } from './manager-types';
import { ROLLOVER_POLICY, rolloverDue } from './orchestrator-rollover';

/** A chat id a wake message names («chatId <id>»). */
const CHAT_ID_IN_TEXT = /\bchatId[\s:=]+["«]?([\w-]{4,64})/g;

export abstract class ManagerTopics extends ManagerContinuity {
  abstract pending(): PendingRequest[];

  /** The chats as the topic rules read them (never the Orchestrators). */
  private topicChats(): Omit<TopicChat, 'topic'>[] {
    return [...this.chats.values()].filter(c => !c.s.isOrchestrator).map(c => ({
      id: c.s.id, title: c.s.title, cwd: c.s.cwd, ...(c.s.parentId ? { parentId: c.s.parentId } : {}),
      ...(c.s.plan?.doneWhen ? { plan: String(c.s.plan.doneWhen) } : {}),
    }));
  }

  /** The questions and plans that wait for the user's answer in the other chats (never a permission: a «sì» is not
   *  an answer to a tool's request, the user grants those on their panel). */
  private topicQuestions(): TopicQuestion[] {
    const asks = this.pending().filter(p => p.type === 'question' && !this.chats.get(p.chatId)?.s.isOrchestrator).map(p => ({ chatId: p.chatId, at: p.at }));
    const plans = [...this.chats.values()].filter(c => c.s.plan?.phase === 'proposed' && !c.s.closedAt).map(c => ({ chatId: c.s.id, at: c.s.plan?.at ?? 0 }));
    return [...asks, ...plans];
  }

  /** The topic of a chat (its own, else its parent's), when the Orchestrator's topics are on. */
  protected chatTopic(chatId: string): string | undefined {
    return this.opts.topics?.topicOfChat(chatId, this.topicChats());
  }

  /** The user's own message to the Orchestrator: its topic now (the rules), a later move by the lightest model. */
  protected assignTopic(r: Rec, itemId: string, text: string): TopicAssignment | null {
    const topics = this.opts.topics;
    if (!topics || !r.s.isOrchestrator) return null;
    try {
      if (r.topicMove && r.topicMove.itemId !== itemId) r.topicMove = undefined;
      return topics.assign(r.s.id, text, Date.now(), { items: r.items, chats: this.topicChats(), questions: this.topicQuestions() }, topic => this.moveTurn(r, itemId, topic, 'model'), itemId);
    } catch (e) {
      log.warn('chats', 'topic not assigned', { chat: r.s.id, cause: errText(e), hint: 'the message goes without a topic; the next one tries again' });
      return null;
    }
  }

  /** The topic of a message the Orchestrator gets from a chat or from the app's news: the sender's, else the one chat
   *  the news names; undefined when it names none or several topics. */
  protected newsTopic(text: string, from?: string): string | undefined {
    if (!this.opts.topics) return undefined;
    if (from) {
      const sender = [...this.chats.values()].find(c => !c.s.isOrchestrator && c.s.title === from);
      return sender ? this.chatTopic(sender.s.id) : undefined;
    }
    const found = new Set<string>();
    let topic: string | undefined;
    for (const m of text.matchAll(CHAT_ID_IN_TEXT)) {
      const t = this.chatTopic(m[1]!);
      if (t && ![...found].some(x => sameTopic(x, t))) { found.add(t); topic = t; }
    }
    return found.size === 1 ? topic : undefined;
  }

  /** An item of the Orchestrator without a topic gets the one it belongs to (ManagerCore.addItem). */
  protected override tagItem(r: Rec, item: ChatItem): ChatItem {
    if (!r.s.isOrchestrator) return item;
    // the lightest model answered while the message waited for its engine: the item appears with the model's topic
    const move = r.topicMove;
    if (move && move.itemId === item.id && item.kind === 'user' && item.topicBy !== 'user') {
      r.topicMove = undefined;
      r.turnTopic = move.topic;
      return { ...item, topic: move.topic, topicBy: 'model' };
    }
    return this.tagWith(item, r.turnTopic);
  }

  private tagWith(item: ChatItem, turnTopic: string | undefined): ChatItem {
    const topics = this.opts.topics;
    if (!topics) return item;
    const got = topics.itemTopic(item, turnTopic, it => {
      if (it.kind === 'user' && it.from) return this.newsTopic('', it.from);
      if (it.kind === 'system') { const id = it.params?.chatId; return typeof id === 'string' ? this.chatTopic(id) : undefined; }
      return undefined;
    });
    if (!got) return item;
    return item.kind === 'user' ? { ...item, topic: got.topic, ...(got.by ? { topicBy: got.by } : {}) } : { ...item, topic: got.topic } as ChatItem;
  }

  /** A transcript read back (ManagerPersistence.ensureHistory): each message of the user finds its topic again by its
   *  mark, each reply takes the one of the message before it. */
  protected override tagHistory(r: Rec): void {
    const topics = this.opts.topics;
    if (!topics || !r.s.isOrchestrator) return;
    let turn: string | undefined;
    r.items = r.items.map(it => {
      const tagged = this.tagWith(it, turn);
      if (tagged.kind === 'user' && !tagged.from && tagged.topic) turn = tagged.topic;
      return tagged;
    });
    if (turn) r.turnTopic = turn;
  }

  /** The Orchestrator's topics ('orchestrator:topics'). */
  topicsOf(chatId: string): OrchestratorTopics {
    const r = this.need(chatId);
    return (r.s.isOrchestrator ? this.opts.topics?.list(r.s.id) : null) ?? { chatId: r.s.id, topics: [] };
  }

  /** The user moves one of the Orchestrator's messages to another topic ('orchestrator:setTopic'). */
  setItemTopic(chatId: string, itemId: string, topic: string): OrchestratorTopics {
    const r = this.need(chatId), topics = this.opts.topics;
    if (!r.s.isOrchestrator || !topics) throw new Error('Gli argomenti esistono solo nell’Orchestrator.');
    const item = r.items.find(i => i.id === itemId);
    if (!item || (item.kind !== 'user' && item.kind !== 'assistant' && item.kind !== 'system')) throw new Error('Messaggio non trovato.');
    // a reply moves with the message it answers (the user's, or a chat's mail before it) and that message's other
    // replies; a chat's result moves alone
    const idx = r.items.indexOf(item);
    const head = item.kind === 'user' ? item : item.kind === 'assistant' ? [...r.items.slice(0, idx)].reverse().find((i): i is Extract<ChatItem, { kind: 'user' }> => i.kind === 'user') : undefined;
    if (head) {
      const label = topics.move(r.s.id, head.text, head.at, topic, head.id);
      this.moveTurn(r, head.id, label, 'user');
    } else {
      const label = topics.move(r.s.id, 'text' in item ? item.text : '', item.at, topic, item.id);
      this.retag(r, item, label);
    }
    return topics.list(r.s.id);
  }

  private retag(r: Rec, item: ChatItem, topic: string, by?: 'user' | 'model'): void {
    const next = item.kind === 'user' ? { ...item, topic, ...(by ? { topicBy: by } : {}) } : { ...item, topic } as ChatItem;
    const i = r.items.indexOf(item);
    if (i >= 0) r.items[i] = next;
    this.opts.emitter.emit('chat:item', { chatId: r.s.id, item: next, replace: true });
  }

  /** A message and the replies to it (up to the next message, the user's or a chat's mail) take `topic`; a model's
   *  move never undoes the user's own (the store refuses it first: OrchestratorTopicService.refine). A model's move of
   *  a message not added yet waits for it (tagItem). */
  private moveTurn(r: Rec, itemId: string, topic: string, by: 'user' | 'model'): void {
    if (this.chats.get(r.s.id) !== r) return;
    const start = r.items.findIndex(i => i.id === itemId);
    if (start < 0) { if (by === 'model') r.topicMove = { itemId, topic }; return; }
    const first = r.items[start]!;
    if (first.kind === 'user' && first.topicBy === 'user' && by === 'model') return;
    const next = r.items.findIndex((i, n) => n > start && i.kind === 'user');
    for (const it of r.items.slice(start, next < 0 ? undefined : next)) {
      if (it === first || it.kind === 'assistant') this.retag(r, it, topic, it === first ? by : undefined);
    }
    // the user's latest own message: its turn goes on under the new topic
    const own = (i: ChatItem): boolean => i.kind === 'user' && !i.from && !i.text.startsWith('[');
    if (own(first) && !r.items.some((i, n) => n > start && own(i))) r.turnTopic = topic;
  }

  /** A chat the Orchestrator starts or assigns in a turn joins that turn's topic. */
  protected linkToTurn(chat: Rec): void {
    const o = this.openOrchestrator(), topics = this.opts.topics;
    if (!o || !topics || chat.s.isOrchestrator || !o.turnTopic) return;
    try { topics.linkChat(o.s.id, chat.s.id, o.turnTopic); } catch (e) { log.debug('chats', 'chat not linked to its topic', { chat: chat.s.id, data: errText(e) }); }
  }

  /** The per-topic brief of an Orchestrator's fresh context (agents/orchestrator-brief.ts). */
  /** `exclude` = the message being sent (it follows the brief itself). */
  protected topicBriefFor(r: Rec, topic: string, exclude?: string): string {
    const topics = this.opts.topics;
    if (!topics) return '';
    const chats: BriefChat[] = [...this.chats.values()].filter(c => !c.s.isOrchestrator && !c.s.closedAt && !c.s.parentId).map(c => {
      const t = this.chatTopic(c.s.id);
      return { id: c.s.id, title: c.s.title, state: c.s.state, ...(t ? { topic: t } : {}), ...(c.pending.size > 0 || c.s.plan?.phase === 'proposed' ? { waiting: true } : {}) };
    });
    let essentials = '';
    try { essentials = this.opts.orchestratorEssentials?.() ?? ''; } catch { essentials = ''; }
    return topicBrief({ topic, items: exclude ? r.items.filter(i => i.id !== exclude) : r.items, topics: topics.list(r.s.id).topics, chats, essentials });
  }

  /** Before the user's message (manager.ts deliverNow): an idle ACP Orchestrator grown past its budget since its
   *  session started, or surely switching topic past the smaller growth, ends its session; the next one starts fresh
   *  and its first message carries the role text and the brief. A guess of the rules (not sure, or the answer to
   *  another chat's question) never counts as a switch. After a restart (no engine yet, nothing known of the session
   *  but its reported size) the budget alone decides. null = it goes on in the same session. */
  protected async orchestratorRollover(r: Rec, a: TopicAssignment): Promise<RolloverStep | null> {
    const engine = engineOf(r.s.harness);
    if (!this.opts.topics || !r.s.isOrchestrator || !engine || r.switching || (!r.session && !r.s.sessionId)) return null;
    const policy = this.opts.rolloverPolicy ? this.opts.rolloverPolicy(engine.kind) : ROLLOVER_POLICY[engine.kind] ?? null;
    if (!policy) return null;
    const topic = a.topic;
    // the session as the rule reads it: the messages since a rollover started it, its first turn's size
    let st = r.rollTurns;
    if (st && st.session !== undefined && st.session !== r.s.sessionId) st = undefined; // another session since (a cold switch, a new chat)
    if (st && st.session === undefined && st.turns > 0) st = { ...st, session: r.s.sessionId };
    if (st && st.fresh && st.base === undefined && st.turns > 0 && (r.s.contextTokens ?? 0) > 0) st = { ...st, base: r.s.contextTokens };
    const sureSwitch = a.sure && a.by !== 'question' && !!r.turnTopic && !sameTopic(r.turnTopic, topic);
    const idle = !this.midTurn(r) && !r.pending.size && !r.commandsOpen?.size && !r.handoffTurn && !r.archiving && !r.releasing && !r.opening && !(r.s.background ?? 0) && !r.s.queued;
    const reason = rolloverDue({
      kind: engine.kind, contextTokens: r.s.contextTokens ?? 0, topicChanged: sureSwitch, idle, remote: !!r.s.remoteControl?.on,
      ...(st?.fresh ? { turns: st.turns, ...(st.base ? { baseTokens: st.base } : {}) } : {}),
    }, policy);
    const counted: RollTurns = st ? { ...st, turns: st.turns + 1 } : { session: r.s.sessionId, turns: 1, fresh: false };
    if (!reason) { r.rollTurns = counted; return null; }
    const run = (async (): Promise<RolloverStep | null> => {
      const old = r.s.sessionId, at = Date.now(), contextTokens = r.s.contextTokens ?? 0;
      const prev = { sessionId: old, contextTokens: r.s.contextTokens, contextMaxTokens: r.s.contextMaxTokens, costTotalUsd: r.costTotalUsd, ctxSince: r.ctxSince, after: r.after, rolePrimed: r.rolePrimed, rollTurns: counted };
      // the brief is kept as the divider's note, like a cold continuation's hand-off: written first, so a disk that
      // refuses it leaves the session as it is; the note it replaces comes back if the fresh session does not start
      let notePath: string, prevNote: HandoffInfo | null;
      try {
        prevNote = this.handoffs.read(r.s.id);
        const note = this.handoffs.write(r.s.id, { title: r.s.title, text: this.topicBriefFor(r, topic), at, source: 'auto', ...(contextTokens ? { contextTokens } : {}) });
        notePath = old && /^[\w-]{1,64}$/.test(old) ? this.handoffs.archive(r.s.id, old) : note.path;
      } catch (e) {
        log.warn('chats', 'Orchestrator rollover note not written', { chat: r.s.id, cause: errText(e), hint: 'it goes on in the same session; the next message tries again' });
        r.rollTurns = counted;
        return null;
      }
      const sess = r.session;
      if (sess) {
        r.autoEnding = true;
        try { await this.closeKeeping(r, sess); } finally { r.autoEnding = false; }
      }
      if (r.pending.size || this.midTurn(r)) { r.rollTurns = counted; return null; }
      r.s.sessionId = engine.caps.transcript ? crypto.randomUUID() : null;
      delete r.s.contextTokens; delete r.s.contextMaxTokens;
      r.costTotalUsd = 0; r.ctxSince = undefined; r.rolePrimed = undefined;
      r.after = { kind: 'continuation', left: AFTER_CALLS };
      // this message is the fresh session's first; its id is known once the engine started (the next message reads it)
      r.rollTurns = { session: engine.caps.transcript ? r.s.sessionId : undefined, turns: 1, fresh: true };
      this.persist(true);
      log.info('chats', 'Orchestrator: fresh session for the topic context', { chat: r.s.id, data: { reason, contextTokens, base: st?.base ?? null, harness: r.s.harness, from: old } });
      return { reason, old, at, contextTokens, notePath, prev, prevNote };
    })();
    r.switching = run.then((): null => null);
    try { return await run; } finally { r.switching = undefined; }
  }

  /** The fresh session started: the divider folds the old one. */
  protected rolloverDone(r: Rec, step: RolloverStep): void {
    this.addItem(r, coldDivider(step.old ?? `roll-${step.at}`, step.at, step.notePath), false);
    this.updated(r);
  }

  /** The fresh session did not start: back to the old one (resumed by the next message). */
  protected rolloverUndo(r: Rec, step: RolloverStep): void {
    if (r.session) return;
    const p = step.prev;
    r.s.sessionId = p.sessionId;
    if (p.contextTokens !== undefined) r.s.contextTokens = p.contextTokens;
    if (p.contextMaxTokens !== undefined) r.s.contextMaxTokens = p.contextMaxTokens;
    r.costTotalUsd = p.costTotalUsd; r.ctxSince = p.ctxSince; r.after = p.after; r.rolePrimed = p.rolePrimed; r.rollTurns = p.rollTurns;
    // the chat's own note as it was before the brief took its place
    try {
      if (step.prevNote) { const { path: _p, chatId: _c, ...note } = step.prevNote; this.handoffs.write(r.s.id, note); }
      else this.handoffs.remove(r.s.id);
    } catch (e) { log.warn('chats', 'hand-off note not put back', { chat: r.s.id, cause: errText(e), hint: 'the brief stays as the chat\'s note; the next hand-off replaces it' }); }
    this.persist();
    this.updated(r);
    log.warn('chats', 'Orchestrator fresh session not started', { chat: r.s.id, cause: r.s.lastError ?? 'engine did not start', hint: 'it goes on in its old session; the next message tries the fresh one again' });
  }
}
