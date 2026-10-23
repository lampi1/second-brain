// The line of a working chat (owner, 2026-10-22: "frasi belle divertenti a tema … a tema del task", then «battute
// esilaranti e cringe»): a short dev joke picked by the task's kind of work, read from its title or request with the routing lexicon
// (shared/work-concepts.ts conceptsOf: fix, build, qa, research…), "any" when none matches. Zero tokens. The phrase
// changes every LINE_MS on the shared UI clock (frozen in the demo, so screenshots stay stable), each chat starting from
// its own place so two chats rarely say the same thing. The phrases of the day (main/daily-phrases.ts: the lightest
// model rewrites them once a day, owner 2026-10-23) replace a kind's fixed ones when they are there
// (store/daily-phrases.ts reads them). Pure; used by components/ChatItems.tsx Typing and StripActivity.tsx.
import type { ChatItem, DailyPhrases } from '@shared/contract';
import { conceptsOf, type Concept } from '@shared/work-concepts';
import type { typingIt } from '../i18n/areas/typing.it';
import { t } from '../i18n';

export type TypingKey = keyof typeof typingIt;

export const LINE_MS = 5000; // a joke takes longer to read than a word
/** How many phrases each kind has (the keys typing.<kind>.0 … n-1 in i18n/areas/typing.*.ts). */
export const LINES: Readonly<Record<Concept | 'any', number>> = { any: 16, fix: 6, build: 6, review: 6, qa: 6, cause: 6, ops: 6, runbook: 6, research: 6, write: 6, inbox: 6, plan: 6 };

const seed = (s: string): number => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

/** The i18n key of the phrase for `topic` (the task's title or request) at `now`. */
export function typingKey(topic: string, now: number): TypingKey {
  const kind: Concept | 'any' = conceptsOf(topic)[0] ?? 'any';
  return `typing.${kind}.${(Math.floor(now / LINE_MS) + seed(topic)) % LINES[kind]}` as TypingKey;
}

/** The line for `topic` at `now`: the day's phrase of its kind when there is one, else the fixed one (typingKey). */
export function typingText(topic: string, now: number, daily: DailyPhrases | null): string {
  const kind: Concept | 'any' = conceptsOf(topic)[0] ?? 'any';
  const lines = daily?.lines[kind];
  return lines?.length ? lines[(Math.floor(now / LINE_MS) + seed(topic)) % lines.length]! : t(typingKey(topic, now));
}

/** The topic of a chat with no task title (the Orchestrator, Flash): the user's last request. */
export function lastAsk(items: readonly ChatItem[] | undefined): string {
  for (let i = (items?.length ?? 0) - 1; i >= 0; i--) { const it = items![i]!; if (it.kind === 'user') return it.text.slice(0, 400); }
  return '';
}
