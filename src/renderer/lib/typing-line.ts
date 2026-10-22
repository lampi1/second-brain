// The line of a working chat (owner, 2026-10-22: "frasi belle divertenti a tema … a tema del task"): a short workshop
// phrase picked by the task's kind of work, read from its title or request with the routing lexicon
// (shared/work-concepts.ts conceptsOf: fix, build, qa, research…), "any" when none matches. Zero tokens. The phrase
// changes every LINE_MS on the shared UI clock (frozen in the demo, so screenshots stay stable), each chat starting from
// its own place so two chats rarely say the same thing. Pure; used by components/ChatItems.tsx Typing.
import type { ChatItem } from '@shared/contract';
import { conceptsOf, type Concept } from '@shared/work-concepts';
import type { typingIt } from '../i18n/areas/typing.it';

export type TypingKey = keyof typeof typingIt;

export const LINE_MS = 4000;
/** How many phrases each kind has (the keys typing.<kind>.0 … n-1 in i18n/areas/typing.*.ts). */
export const LINES: Readonly<Record<Concept | 'any', number>> = { any: 6, fix: 4, build: 4, review: 4, qa: 4, cause: 4, ops: 4, runbook: 4, research: 4, write: 4, inbox: 4, plan: 4 };

const seed = (s: string): number => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

/** The i18n key of the phrase for `topic` (the task's title or request) at `now`. */
export function typingKey(topic: string, now: number): TypingKey {
  const kind: Concept | 'any' = conceptsOf(topic)[0] ?? 'any';
  return `typing.${kind}.${(Math.floor(now / LINE_MS) + seed(topic)) % LINES[kind]}` as TypingKey;
}

/** The topic of a chat with no task title (the Orchestrator, Flash): the user's last request. */
export function lastAsk(items: readonly ChatItem[] | undefined): string {
  for (let i = (items?.length ?? 0) - 1; i >= 0; i--) { const it = items![i]!; if (it.kind === 'user') return it.text.slice(0, 400); }
  return '';
}
