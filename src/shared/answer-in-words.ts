// The user's own words answer an open question (ADR 0274; the owner, 2026-11-12: «se rispondo direttamente
// all'orchestrator o all'agente il pannello deve sparire, però allo stesso tempo deve sparire se la risposta che do
// all'orchestrator è della domanda non di altre robe»). In the chat that asks, what he writes is the answer
// (ChatInput.tsx); in the Orchestrator, the Orchestrator decides whether his message answers one of the open questions
// and passes his words with app_resolve_question `words` (appctl/tools.ts), checked against what he wrote (sameWords).
import type { PendingRequest } from './contract';
import { isMcpFormRequest } from './mcp-form';
import { isNativeQuestion } from './yes-no';

/** An engine's own question (never a permission, a command, an MCP form or the app's own step question). */
export const answerableInWords = (req: Pick<PendingRequest, 'type' | 'tool' | 'questions'>): boolean =>
  isNativeQuestion(req) && !isMcpFormRequest(req) && !!req.questions?.length;

/** The answer his words give: every question of the request reads them (a multi-select takes them as its one pick). */
export function wordsAnswer(req: Pick<PendingRequest, 'questions'>, words: string): { kind: 'question'; answers: Record<string, string | string[]> } {
  const w = words.trim();
  return { kind: 'question', answers: Object.fromEntries((req.questions ?? []).map(q => [q.question, q.multiSelect ? [w] : w])) };
}

const norm = (s: string): string => s.toLowerCase().replace(/[«»"“”'’`]/g, '').replace(/\s+/g, ' ').trim();

/** The words are his: they occur in what he wrote (case, quotes and spacing aside), and say something. */
export function sameWords(said: string, words: string): boolean {
  const w = norm(words);
  return w.length > 0 && norm(said).includes(w);
}
