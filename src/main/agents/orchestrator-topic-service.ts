// The Orchestrator's topics at run time (ADR 0369): the rules (orchestrator-topics.ts) on each of the user's messages,
// the lightest model only when they are not sure (never in the way of the turn: the message goes at once with the
// rules' choice, and the model's later answer moves it), the topic of the chats' news and results, the user's own move
// of a message, and the list the renderer shows ('orchestrator:topics', 'orchestrator:topicsChanged'). Holds no chat
// state: the chat manager gives it what it reads (chats/manager.ts, manager-core.ts addItem). Unit tests:
// test/unit/agents/orchestrator-topic-service.test.ts.
import type { ChatItem, OrchestratorTopics, TopicSource } from '../../shared/contract';
import { cleanTopic, sameTopic } from '../../shared/orchestrator-topics';
import { errText, log } from '../log';
import { assignTopic, classifyPrompt, readClassified, replyQuote, topicOfChat, type TopicAssignment, type TopicChat, type TopicWorld } from './orchestrator-topics';
import type { OrchestratorTopicStore } from './orchestrator-topic-store';

/** The lightest model's one-line answer to a prompt (agents/oneshot.ts light run), null when none could answer. */
export type TopicClassifier = (system: string, prompt: string) => Promise<string | null>;

export interface TopicServiceDeps {
  store: OrchestratorTopicStore;
  /** the list changed (→ the renderer's 'orchestrator:topicsChanged') */
  emit?: (topics: OrchestratorTopics) => void;
  classify?: TopicClassifier;
  now?: () => number;
}

export class OrchestratorTopicService {
  private classify: TopicClassifier | undefined;
  private readonly now: () => number;
  constructor(private readonly d: TopicServiceDeps) { this.classify = d.classify; this.now = d.now ?? Date.now; }

  /** The lightest model, once the one-shot service exists (wiring.ts). */
  setClassifier(fn: TopicClassifier | undefined): void { this.classify = fn; }

  list(chatId: string | null): OrchestratorTopics { return { chatId, topics: this.d.store.list() }; }
  changed(chatId: string | null): void { try { this.d.emit?.(this.list(chatId)); } catch { /* the renderer reads them again on its next open */ } }

  /** The chats as the rules read them, with the topics the store gave them. */
  chatsWithTopics(chats: readonly Omit<TopicChat, 'topic'>[]): TopicChat[] {
    const map = this.d.store.chatTopics();
    return chats.map(c => { const t = map.get(c.id); return t ? { ...c, topic: t } : { ...c }; });
  }

  /** A chat's topic (its own, else its parent's). */
  topicOfChat(chatId: string, chats: readonly Omit<TopicChat, 'topic'>[]): string | undefined {
    return topicOfChat(chatId, this.chatsWithTopics(chats));
  }

  /** The user's own message to the Orchestrator: the rules choose now (stored), the lightest model later when they were
   *  not sure; `moved` gets the model's other choice (the manager re-tags the message and its turn). `id` = the item
   *  the message becomes (its mark is its own, whatever other message has the same words). */
  assign(chatId: string, text: string, at: number, world: Omit<TopicWorld, 'topics' | 'now'>, moved?: (topic: string) => void, id?: string): TopicAssignment {
    const w: TopicWorld = { ...world, chats: this.chatsWithTopics(world.chats), topics: this.d.store.openLabels(), now: at };
    const a = assignTopic(text, w);
    const words = replyQuote(text)?.body ?? text;
    // a new subject the rules named is the app's guess (dropped if its message moves away); his own tag is his
    const label = this.d.store.touch(a.topic, at, words, a.by === 'new' ? 'provisional' : a.by === 'tag' ? 'user' : undefined);
    this.d.store.mark(text, at, label, a.by, id, true);
    const out = { ...a, topic: label };
    this.changed(chatId);
    if (!a.sure && a.candidates.length && this.classify && moved) void this.refine(chatId, text, at, out, moved, id);
    return out;
  }

  private async refine(chatId: string, text: string, at: number, a: TopicAssignment, moved: (topic: string) => void, id?: string): Promise<void> {
    const topics = this.d.store.list();
    const rows = a.candidates.map(label => ({ label, ...(topics.find(t => sameTopic(t.label, label))?.gist ? { gist: topics.find(t => sameTopic(t.label, label))!.gist! } : {}) }));
    const { system, prompt } = classifyPrompt(replyQuote(text)?.body ?? text, rows);
    let answer: string | null = null;
    try { answer = await this.classify!(system, prompt); } catch (e) {
      log.warn('chats', 'topic model not answered', { cause: errText(e), hint: 'the message keeps the topic the rules gave it; the user can move it with one click' });
      return;
    }
    const pick = answer ? readClassified(answer, a.candidates) : null;
    log.info('chats', 'topic chosen by the light model', { data: { by: a.by, sure: false, picked: pick ? (pick.isNew ? 'new' : 'existing') : 'none', moved: !!pick && !sameTopic(pick.topic, a.topic) } });
    if (!pick || sameTopic(pick.topic, a.topic)) return;
    // the user moved it meanwhile: his choice stays
    if (this.d.store.recall(text, at, id)?.by === 'user') return;
    // a new label the model invented for a message the rules already put in a new topic: keep the rules' words
    if (pick.isNew && a.by === 'new') return;
    const label = this.d.store.touch(pick.topic, at, undefined, pick.isNew ? 'provisional' : undefined);
    this.d.store.mark(text, at, label, 'model', id);
    // the rules' provisional topic holds nothing else: never left as an empty open topic
    this.d.store.dropIfEmpty(a.topic);
    moved(label);
    this.changed(chatId);
  }

  /** The user moved a message to `topic` (a new label makes a new topic): stored as his own choice; the topic it left
   *  goes when nothing else is filed under it. */
  move(chatId: string, text: string, at: number, topic: string, id?: string): string {
    const clean = cleanTopic(topic);
    if (!clean) throw new Error('Argomento non valido.');
    const was = this.d.store.recall(text, at, id)?.topic;
    const label = this.d.store.touch(clean, at, undefined, 'user');
    this.d.store.mark(text, at, label, 'user', id);
    if (was && !sameTopic(was, label)) this.d.store.dropIfEmpty(was);
    this.changed(chatId);
    return label;
  }

  /** A chat the Orchestrator started (or the plan of one) belongs to the topic it was started on. */
  linkChat(orchestratorId: string, chatId: string, topic: string): void {
    if (sameTopic(this.d.store.chatTopic(chatId), topic)) return;
    this.d.store.linkChat(chatId, topic);
    this.changed(orchestratorId);
  }

  /** The topic an item of the Orchestrator gets when it has none: a message of the user read back from a transcript
   *  (its mark), its reply during a turn (the turn's topic), a chat's mail or result (that chat's topic). */
  /** `chatTopicOf` = the topic of the chat an item comes from (its mail's sender, a result's chat), when it has one. */
  itemTopic(item: ChatItem, turnTopic: string | undefined, chatTopicOf: (item: ChatItem) => string | undefined): { topic: string; by?: TopicSource } | null {
    if ((item.kind !== 'user' && item.kind !== 'assistant' && item.kind !== 'system') || item.topic) return null;
    if (item.kind === 'user' && !item.from) {
      const r = this.d.store.recall(item.text, item.at, item.id);
      return r ? { topic: r.topic, by: r.by } : null;
    }
    // a chat's mail or result the user moved himself (setItemTopic marks it): his choice over the chat's topic
    if (item.kind === 'user' || item.kind === 'system') {
      const moved = this.d.store.recall(item.text, item.at, item.id, true);
      if (moved?.by === 'user') return { topic: moved.topic, by: 'user' };
    }
    const fromChat = chatTopicOf(item);
    if (fromChat) return { topic: fromChat, by: 'chat' };
    if (item.kind === 'assistant' && turnTopic) return { topic: turnTopic };
    return null;
  }

  /** The time a topic was last touched (a chat's news counts too). */
  touch(topic: string): void { this.d.store.touch(topic, this.now()); }

  flush(): void { this.d.store.flush(); }
}
