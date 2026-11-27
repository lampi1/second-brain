// The Orchestrator's topics on disk (ADR 0369): <userData>/orchestrator-topics.json keeps the topics (label, when made
// and last touched, the chats they hold, the user's last line on each), the topic of each message and the topic of each
// chat. The app keeps no messages (they stay in each engine's transcript, chats/store.ts), and an item read back from a
// transcript has another id than the live one, so a message's topic is found again by a fingerprint of its text and
// its time (recall). Never message text beyond a 120-character gist per topic; never secrets. Writes are atomic and
// deferred (agents/local-store.ts). Used by the chat manager (chats/manager.ts, manager-core.ts addItem) through
// OrchestratorTopicService (orchestrator-topic-service.ts); unit tests in test/unit/agents/orchestrator-topic-store.test.ts.
import crypto from 'node:crypto';
import type { OrchestratorTopic, TopicSource } from '../../shared/contract';
import { cleanTopic, sameTopic } from '../../shared/orchestrator-topics';
import { readLocal, writeLocal, writeLocalTextAsync } from './local-store';
import { errText, log } from '../log';

/** A topic stays open this long after its last message. */
export const TOPIC_OPEN_MS = 3 * 24 * 60 * 60_000;
const MAX_TOPICS = 200, MAX_MARKS = 4000, MAX_CHATS = 2000, GIST = 120;
/** A transcript's time of a message may differ a little from the live one. */
const RECALL_MS = 5 * 60_000;

interface StoredTopic { label: string; createdAt: number; lastAt: number; chatIds: string[]; gist?: string }
/** One message's topic: the fingerprint of its text, its time, the topic, how it was chosen. */
interface Mark { key: string; at: number; topic: string; by: TopicSource }
interface Stored { version: 1; topics: StoredTopic[]; marks: Mark[]; chats: Record<string, string> }

/** The fingerprint of a message: its first 160 characters, spaces collapsed, the app's hints after them never count. */
export function textKey(text: string): string {
  return crypto.createHash('sha256').update(text.replace(/\s+/g, ' ').trim().slice(0, 160)).digest('hex').slice(0, 20);
}

function readStored(value: unknown): Stored {
  const empty: Stored = { version: 1, topics: [], marks: [], chats: {} };
  if (!value || typeof value !== 'object') return empty;
  const o = value as Record<string, unknown>;
  const num = (x: unknown): number | null => typeof x === 'number' && Number.isFinite(x) ? x : null;
  const topics = Array.isArray(o.topics) ? o.topics.flatMap((t): StoredTopic[] => {
    const r = t as Record<string, unknown>, label = cleanTopic(String(r?.label ?? '')), createdAt = num(r?.createdAt), lastAt = num(r?.lastAt);
    if (!label || createdAt === null || lastAt === null) return [];
    const chatIds = Array.isArray(r.chatIds) ? r.chatIds.filter((c): c is string => typeof c === 'string' && c.length <= 100).slice(-50) : [];
    return [{ label, createdAt, lastAt, chatIds, ...(typeof r.gist === 'string' ? { gist: r.gist.slice(0, GIST) } : {}) }];
  }).slice(-MAX_TOPICS) : [];
  const marks = Array.isArray(o.marks) ? o.marks.flatMap((m): Mark[] => {
    const r = m as Record<string, unknown>, at = num(r?.at), topic = cleanTopic(String(r?.topic ?? ''));
    return typeof r?.key === 'string' && /^[a-f0-9]{20}$/.test(r.key) && at !== null && topic && typeof r.by === 'string' ? [{ key: r.key, at, topic, by: r.by as TopicSource }] : [];
  }).slice(-MAX_MARKS) : [];
  const chats: Record<string, string> = {};
  if (o.chats && typeof o.chats === 'object') for (const [id, t] of Object.entries(o.chats as Record<string, unknown>).slice(-MAX_CHATS)) {
    const label = typeof t === 'string' ? cleanTopic(t) : '';
    if (label && id.length <= 100) chats[id] = label;
  }
  return { version: 1, topics, marks, chats };
}

export class OrchestratorTopicStore {
  private data: Stored;
  private timer: NodeJS.Timeout | null = null;
  private gen = 0;
  /** the file could not be read: it is never overwritten (local-store.ts), the topics live in memory only */
  private readonly keepFile: boolean = false;

  constructor(private readonly file: string | null, private readonly now: () => number = Date.now, private readonly saveMs = 1500) {
    let raw: unknown = null;
    if (file) try { raw = readLocal(file); } catch (e) {
      this.keepFile = true;
      log.warn('chats', 'orchestrator topics not readable', { cause: errText(e), hint: 'topics start empty in memory and the file is left untouched; remove or fix orchestrator-topics.json to keep them again' });
    }
    this.data = readStored(raw);
  }

  /** The topics, most recent first; open = touched within TOPIC_OPEN_MS. */
  list(): OrchestratorTopic[] {
    const now = this.now();
    return [...this.data.topics].sort((a, b) => b.lastAt - a.lastAt).map(t => ({ label: t.label, createdAt: t.createdAt, lastAt: t.lastAt, chatIds: [...t.chatIds], open: now - t.lastAt <= TOPIC_OPEN_MS, ...(t.gist ? { gist: t.gist } : {}) }));
  }

  /** The open labels, most recent last (what the rules read). */
  openLabels(): string[] {
    return this.list().filter(t => t.open).reverse().map(t => t.label);
  }

  private find(label: string): StoredTopic | undefined { return this.data.topics.find(t => sameTopic(t.label, label)); }

  /** The topic with this label, made when missing and touched now (gist = the user's line on it). Returns its label as
   *  stored (a known topic keeps its own spelling). */
  touch(label: string, at = this.now(), gist?: string): string {
    const clean = cleanTopic(label);
    if (!clean) throw new Error('Argomento non valido.');
    let t = this.find(clean);
    if (!t) {
      t = { label: clean, createdAt: at, lastAt: at, chatIds: [] };
      this.data.topics.push(t);
      if (this.data.topics.length > MAX_TOPICS) this.data.topics.sort((a, b) => a.lastAt - b.lastAt).splice(0, this.data.topics.length - MAX_TOPICS);
    }
    t.lastAt = Math.max(t.lastAt, at);
    if (gist) t.gist = gist.replace(/\s+/g, ' ').trim().slice(0, GIST);
    this.save();
    return t.label;
  }

  /** Remembers a message's topic, found again by recall(text, at) after a restart. */
  mark(text: string, at: number, topic: string, by: TopicSource): void {
    const key = textKey(text), label = this.touch(topic, at);
    const i = this.data.marks.findIndex(m => m.key === key && Math.abs(m.at - at) <= RECALL_MS);
    if (i >= 0) this.data.marks[i] = { key, at, topic: label, by };
    else this.data.marks.push({ key, at, topic: label, by });
    if (this.data.marks.length > MAX_MARKS) this.data.marks.splice(0, this.data.marks.length - MAX_MARKS);
    this.save();
  }

  /** A message's topic, by its text and time (the nearest mark of the same text), null = never marked. */
  recall(text: string, at: number): { topic: string; by: TopicSource } | null {
    const key = textKey(text);
    let best: Mark | null = null;
    for (const m of this.data.marks) if (m.key === key && (!best || Math.abs(m.at - at) < Math.abs(best.at - at))) best = m;
    return best ? { topic: best.topic, by: best.by } : null;
  }

  /** A chat (and its plan) belongs to this topic from now on. */
  linkChat(chatId: string, topic: string): void {
    const label = this.touch(topic);
    const was = this.data.chats[chatId];
    if (was && !sameTopic(was, label)) { const old = this.find(was); if (old) old.chatIds = old.chatIds.filter(c => c !== chatId); }
    this.data.chats[chatId] = label;
    const t = this.find(label)!;
    if (!t.chatIds.includes(chatId)) t.chatIds = [...t.chatIds, chatId].slice(-50);
    const ids = Object.keys(this.data.chats);
    if (ids.length > MAX_CHATS) for (const id of ids.slice(0, ids.length - MAX_CHATS)) delete this.data.chats[id];
    this.save();
  }

  chatTopic(chatId: string): string | undefined { return this.data.chats[chatId]; }

  /** Whether a label is a known topic. */
  has(label: string): boolean { return !!this.find(label); }

  /** A topic key → label map of the chats (for the rules' TopicChat.topic). */
  chatTopics(): ReadonlyMap<string, string> { return new Map(Object.entries(this.data.chats)); }

  private save(): void {
    if (!this.file || this.keepFile || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const gen = ++this.gen, body = JSON.stringify(this.data);
      // a newer write started meanwhile carries everything: this one is dropped
      void writeLocalTextAsync(this.file!, body, () => gen === this.gen).catch(e => log.warn('chats', 'orchestrator topics not saved', { cause: errText(e), hint: 'the next change writes them again' }));
    }, this.saveMs);
    this.timer.unref?.();
  }

  /** Writes now (the app quits, tests). */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.file && !this.keepFile) { this.gen++; writeLocal(this.file, this.data); }
  }
}

