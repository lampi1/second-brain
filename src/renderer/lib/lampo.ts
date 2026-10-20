// «Lampo», the quick lane (ADR 0105), pure: the last question and answer that «Fanne un lavoro» drafts into the
// Orchestrator's input. Kept out of LampoTile.tsx so it runs without a DOM. Used by LampoTile.tsx; pinned by
// test/unit/chats/lampo.test.ts.
import type { ChatItem } from '@shared/contract';

const oneLine = (s: string, max: number): string => { const x = s.replace(/\s+/g, ' ').trim(); return x.length > max ? `${x.slice(0, max - 1)}…` : x; };

/** The last question the user asked Lampo and the answer it gave, for «Fanne un lavoro». */
export function lastExchange(items: readonly ChatItem[] | undefined): { question: string; answer: string } | null {
  const list = items ?? [];
  let q = -1;
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.kind === 'user') { q = i; break; }
  if (q < 0) return null;
  const user = list[q] as Extract<ChatItem, { kind: 'user' }>;
  const answer = list.slice(q + 1).filter((x): x is Extract<ChatItem, { kind: 'assistant' }> => x.kind === 'assistant').map(x => x.text).join('\n');
  return { question: oneLine(user.text, 600), answer: oneLine(answer, 900) };
}
