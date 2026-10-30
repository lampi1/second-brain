// «Flash» (code name lampo), the quick lane (ADR 0105, 0107), pure: what «Fanne un lavoro» drafts into the Orchestrator's
// input. Since ADR 0209 Flash itself writes a real brief from its whole conversation (owner, 2026-10-30: «mi aspetto
// che lo crei bene il prompt per l'Orchestrator», he also uses Flash to plan, research and ask advice): BRIEF_ASK is the
// turn the tile sends to Flash, briefOf reads the brief out of its answer, briefStep says when it is ready; the last question and answer (lastExchange)
// stay the fallback when Flash cannot answer. Kept out of LampoTile.tsx so it runs without a DOM. Used by
// LampoTile.tsx and lib/flash-brief.ts; pinned by test/unit/chats/lampo.test.ts.
import type { ChatItem } from '@shared/contract';
import { FLASH_BRIEF_TAG } from '@shared/roles';

const oneLine = (s: string, max: number): string => { const x = s.replace(/\s+/g, ' ').trim(); return x.length > max ? `${x.slice(0, max - 1)}…` : x; };

/** The last question the user asked Flash and the answer it gave, for «Fanne un lavoro». */
export function lastExchange(items: readonly ChatItem[] | undefined): { question: string; answer: string } | null {
  const list = items ?? [];
  let q = -1;
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.kind === 'user') { q = i; break; }
  if (q < 0) return null;
  const user = list[q] as Extract<ChatItem, { kind: 'user' }>;
  const answer = list.slice(q + 1).filter((x): x is Extract<ChatItem, { kind: 'assistant' }> => x.kind === 'assistant').map(x => x.text).join('\n');
  return { question: oneLine(user.text, 600), answer: oneLine(answer, 900) };
}

export const BRIEF_START = '---BRIEF---', BRIEF_END = '---FINE---';
/** What «Fanne un lavoro» asks Flash: the Orchestrator's prompt, written from everything said in this chat. */
export const BRIEF_ASK = [
  `${FLASH_BRIEF_TAG} Scrivi ora il prompt che mando all’Orchestrator per trasformare in lavoro quello di cui abbiamo parlato qui (domande, ricerche, consigli o un piano).`,
  `Rispondi SOLO con il prompt, tra una riga ${BRIEF_START} e una riga ${BRIEF_END}, nella mia lingua, in prima persona come se lo scrivessi io, senza premesse.`,
  'Struttura, con titoletti brevi e solo le parti che servono:',
  '- Obiettivo: una frase su cosa voglio ottenere e perché.',
  '- Contesto: cosa abbiamo scoperto e deciso qui, con nomi esatti di file, link, PR, numeri e comandi (niente di inventato).',
  '- Cosa fare: le parti del lavoro; se serve un piano, chiedi che lo faccia lo Stratega con le sue domande.',
  '- Vincoli: cosa non toccare, tempi, costi, preferenze che ho espresso.',
  '- Fatto quando: criteri verificabili.',
  '- Domande aperte: solo quelle che restano davvero.',
].join('\n');

/** The brief inside Flash's answer to BRIEF_ASK (the text between the markers, else the whole answer), or null. */
export function briefOf(answer: string): string | null {
  const a = answer.indexOf(BRIEF_START), b = answer.lastIndexOf(BRIEF_END);
  const body = (a >= 0 && b > a ? answer.slice(a + BRIEF_START.length, b) : answer).trim();
  return body.length >= 20 ? body : null;
}

/** Where a «Fanne un lavoro» asked at `since` stands: not done while the ask is missing, Flash is busy or its answer
 *  streams; done (brief or null = draft the fallback) once the turn after the ask has ended. The ask is found by its tag
 *  and time, not by index, since the chat's item window slides. */
export type BriefStep = { done: false } | { done: true; brief: string | null };
export function briefStep(items: readonly ChatItem[] | undefined, busy: boolean, since: number): BriefStep {
  const list = items ?? [];
  let q = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const x = list[i]!;
    if (x.kind === 'user' && x.at >= since && x.text.startsWith(FLASH_BRIEF_TAG)) { q = i; break; }
  }
  if (q < 0 || busy) return { done: false };
  let end = list.length;
  for (let i = q + 1; i < list.length; i++) if (list[i]!.kind === 'user') { end = i; break; }
  const after = list.slice(q + 1, end);
  if (!after.length) return { done: false };
  const replies = after.filter((x): x is Extract<ChatItem, { kind: 'assistant' }> => x.kind === 'assistant');
  if (replies.some(x => x.streaming)) return { done: false };
  return { done: true, brief: replies.length ? briefOf(replies.map(x => x.text).join('\n')) : null };
}
