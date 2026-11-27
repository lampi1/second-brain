// The Orchestrator's topics as both sides read them (ADR 0369): a label's clean form and identity, the topic of an item
// (the one the app stored on it, else an old `[Topic]` prefix the model wrote), and the search over the Orchestrator's
// messages by text and topic. Main's assignment (agents/orchestrator-topics.ts) and the renderer's hook
// (renderer/lib/orchestrator-topics.ts) use it, so a label matches the same way everywhere.
import type { ChatItem } from './contract';

/** The longest label a topic may have (the pills and the message chip show it whole). */
export const TOPIC_MAX = 36;

/** A label as stored: one line, no brackets or leading #, collapsed spaces, at most TOPIC_MAX characters; '' when
 *  nothing usable is left. */
export function cleanTopic(label: string): string {
  const s = String(label ?? '').replace(/[[\]\r\n\t]+/g, ' ').replace(/^\s*#+/, '').replace(/\s+/g, ' ').trim();
  return s.length < 2 ? '' : s.slice(0, TOPIC_MAX).trim();
}

/** Two labels name the same topic (case and accents aside). */
export const topicKey = (label: string): string => cleanTopic(label).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const sameTopic = (a: string | undefined, b: string | undefined): boolean => !!a && !!b && topicKey(a) === topicKey(b);

/** The app's own labels that are never a topic ([evento app …], [Messaggio …]). */
const APP_TAG = /^(evento|messaggio|system|nota|app|task|role|ruolo)\b/i;

/** A leading `[Topic]` prefix (a reply of the model before ADR 0369, or the user's own tag): the label and the rest. */
export function taggedTopic(text: string): { topic: string; body: string } | null {
  const m = /^\s*\[([^\][\n]{2,36})\](?![([:])[ \t]+([\s\S]+)$/.exec(text);
  if (!m) return null;
  const tag = cleanTopic(m[1]!), body = m[2]!;
  if (!tag || !body.trim() || APP_TAG.test(tag)) return null;
  return { topic: tag, body };
}

/** The topic an item belongs to: the app's (item.topic), else an old [Topic] prefix; null = none. */
export function itemTopic(item: ChatItem): string | null {
  if ((item.kind === 'user' || item.kind === 'assistant' || item.kind === 'system') && item.topic) return item.topic;
  if (item.kind === 'user' || item.kind === 'assistant') return taggedTopic(item.text)?.topic ?? null;
  return null;
}

/** The searchable text of an item. */
function itemText(item: ChatItem): string {
  if ('text' in item && typeof item.text === 'string') return item.text;
  if (item.kind === 'tool') return `${item.name} ${item.summary}`;
  return '';
}

/** Whether an item matches a search: `q` in its text (case-insensitive) and, with `topic`, that topic. */
export function matchesSearch(item: ChatItem, q: string, topic: string): boolean {
  if (topic && !sameTopic(itemTopic(item) ?? undefined, topic)) return false;
  const needle = q.trim().toLowerCase();
  return !needle || itemText(item).toLowerCase().includes(needle);
}

/** The Orchestrator's messages (his and its replies, the chats' news) that match, newest first, at most `limit`. */
export function searchMessages(items: readonly ChatItem[], q: string, topic = '', limit = 50): ChatItem[] {
  if (!q.trim() && !topic.trim()) return [];
  const out: ChatItem[] = [];
  for (let i = items.length - 1; i >= 0 && out.length < limit; i--) {
    const it = items[i]!;
    if ((it.kind === 'user' || it.kind === 'assistant' || it.kind === 'system') && matchesSearch(it, q, topic.trim())) out.push(it);
  }
  return out;
}

/** The labels to show as pills: the store's open topics (most recent first) and the old [Topic] prefixes of the loaded
 *  items, each once, at most `max`, in the order they first appear in the conversation. */
export function topicLabels(stored: readonly { label: string; open: boolean; lastAt: number }[], items: readonly ChatItem[], max = 8): string[] {
  const seen = new Map<string, string>();
  for (const it of items) {
    const t = itemTopic(it);
    if (t && !seen.has(topicKey(t))) seen.set(topicKey(t), t);
  }
  const open = [...stored].filter(t => t.open).sort((a, b) => a.lastAt - b.lastAt);
  for (const t of open) if (!seen.has(topicKey(t.label))) seen.set(topicKey(t.label), t.label);
  return [...seen.values()].slice(-max);
}
