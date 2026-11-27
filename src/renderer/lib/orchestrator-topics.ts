// The Orchestrator's topics as the renderer sees them (ADR 0369): the list main keeps ('orchestrator:topics', reloaded on
// 'orchestrator:topicsChanged'), the labels the existing topic pills show (the same string[] API OrchestratorTile.tsx
// had from the [Topic] prefixes), the search over the Orchestrator's messages by text and topic, and the user's move of a
// message to another topic. Data and hooks only: the pills and the message chip keep their own look.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ChatItem, OrchestratorTopic } from '@shared/contract';
import { searchMessages, topicLabels } from '@shared/orchestrator-topics';

const NONE: readonly OrchestratorTopic[] = [];
let topics: { chatId: string | null; list: readonly OrchestratorTopic[] } = { chatId: null, list: [] };
const subs = new Set<() => void>();
let started = false, rev = 0;
const set = (chatId: string | null, list: readonly OrchestratorTopic[]) => { topics = { chatId, list }; for (const fn of subs) fn(); };
const hasBridge = () => typeof window !== 'undefined' && !!window.sb;

async function load(chatId: string): Promise<void> {
  const mine = ++rev;
  try { const r = await window.sb.invoke('orchestrator:topics', { chatId }); if (mine === rev) set(r.chatId, r.topics); } catch { /* none yet: the pills fall back to the [Topic] prefixes */ }
}

function start(chatId: string): void {
  if (!hasBridge()) return;
  if (!started) {
    started = true;
    window.sb.on('orchestrator:topicsChanged', r => { rev++; set(r.chatId, r.topics); });
  }
  if (topics.chatId !== chatId) void load(chatId);
}

const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };
const snapshot = () => topics;

/** The stored topics of the Orchestrator `chatId` (most recent first). */
export function useStoredTopics(chatId: string | null): readonly OrchestratorTopic[] {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { if (chatId) start(chatId); }, [chatId]);
  return s.chatId === chatId || !chatId ? s.list : NONE;
}

/** The Orchestrator's topics for its tile: `labels` for the pills (the same string[] as before), `search` over its
 *  messages, `move` of a message to another topic (a new label makes a new one). */
export function useOrchestratorTopics(chatId: string | null, items: readonly ChatItem[] | undefined): {
  labels: string[];
  topics: readonly OrchestratorTopic[];
  search: (q: string, topic?: string) => ChatItem[];
  move: (itemId: string, topic: string) => Promise<void>;
} {
  const stored = useStoredTopics(chatId);
  const labels = useMemo(() => topicLabels(stored, items ?? []), [stored, items]);
  return useMemo(() => ({
    labels, topics: stored,
    search: (q: string, topic = '') => searchMessages(items ?? [], q, topic),
    move: (itemId: string, topic: string) => moveToTopic(chatId, itemId, topic),
  }), [labels, stored, items, chatId]);
}

/** The user moves one of the Orchestrator's messages to `topic`. */
export async function moveToTopic(chatId: string | null, itemId: string, topic: string): Promise<void> {
  if (!chatId || !hasBridge() || !topic.trim()) return;
  const r = await window.sb.invoke('orchestrator:setTopic', { chatId, itemId, topic });
  rev++;
  set(r.chatId, r.topics);
}
