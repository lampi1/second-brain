// A Yes is not a run (#372, the owner 2026-11-10: three times in one week an agent asked «Hai eseguito il comando
// sopra?», got Sì, and went on although nothing had run). The question gates send such a question back
// (shared/yes-no.ts ranCommandQuestion); when one still reaches the user (after the retries) and the answer is Yes with
// no run of that chat's commands with Esegui since shortly before the question, the chat reads NOT_RAN_NOTE instead of a
// bare Sì: the user's word stays, the app says what it did not see. Pure; used by manager-requests.ts answer();
// pinned by test/unit/chats/ran-check.test.ts.
import type { Answer, PendingRequest, RunInfo } from '../../shared/contract';
import { isNativeQuestion, isYesNo, NOT_RAN_NOTE, ranCommandQuestion, yesNoOf } from '../../shared/yes-no';

/** a run this long before the question still backs its Yes (the block came first, the question right after) */
export const RAN_LOOKBACK_MS = 15 * 60_000;

/** The answer as the chat should read it: unchanged, or the Yes with the app's note when no run backs it. */
export function backedAnswer(req: Pick<PendingRequest, 'type' | 'tool' | 'questions' | 'at'>, answer: Answer, runs: readonly Pick<RunInfo, 'startedAt'>[]): Answer {
  const q = req.questions?.length === 1 ? req.questions[0] : undefined;
  if (!q || answer.kind !== 'question' || !isNativeQuestion(req) || !isYesNo(q) || !ranCommandQuestion(q.question ?? '')) return answer;
  const raw = answer.answers[q.question], value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || yesNoOf(value) !== 'yes') return answer;
  if (runs.some(r => r.startedAt >= req.at - RAN_LOOKBACK_MS)) return answer;
  return { ...answer, answers: { ...answer.answers, [q.question]: NOT_RAN_NOTE } };
}
