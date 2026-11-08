// Resolve an authenticated interview's linked host receipts in order, without quotas or agent-supplied answers.
// ManagerRequests binds and rechecks this snapshot; new user requests and consumed handoffs invalidate its key.
import { askingPlan, normalizeInterviewQuestion, type IntakeSource, type PlanIntake } from '../../shared/strategy';
import { withClarified } from './plan-interview';

export interface IntakeRecord {
  s: { isOrchestrator: boolean; closedAt?: number };
  intakeKey?: string;
  continuationDecisions?: string;
}

export function resolvePlanIntake(r: IntakeRecord, { chatId, question, key }: IntakeSource): PlanIntake {
  const selected = Array.isArray(question) ? question : [question];
  if (!selected.length || selected.some(q => typeof q !== 'string' || !q.trim())
    || new Set(selected.map(normalizeInterviewQuestion)).size !== selected.length) throw new Error('intakeQuestions requires distinct exact questions, without a question-count limit.');
  const invalid = () => new Error('Use the exact questions from your current answered intake panels, or omit intakeQuestions.');
  if (!key || !r.s.isOrchestrator || r.s.closedAt || key !== r.intakeKey || !r.continuationDecisions) throw invalid();
  let cursor: string | undefined = key;
  const found: { question: string; answer: string | string[]; requestId: string; pcOnly: boolean }[] = [];
  const seen = new Set<string>();
  for (const record of r.continuationDecisions.split('\n').reverse()) {
    if (!cursor) break;
    const decision = JSON.parse(record), qs = decision.questions;
    if (decision.intakeKey !== cursor) continue;
    cursor = decision.previousIntakeKey;
    if (decision.nativeQuestion !== true || decision.by === 'relay' || decision.answer?.kind !== 'question' || !Array.isArray(qs) || qs.length !== 1) throw invalid();
    const q = qs[0]?.question;
    if (typeof q !== 'string') throw invalid();
    const normalized = normalizeInterviewQuestion(q);
    if (seen.has(normalized)) throw new Error('Interview question already asked; start from the unresolved decisions.');
    seen.add(normalized);
    if (selected.includes(q)) found.push({ question: q, answer: decision.answer.answers?.[q], requestId: decision.requestId, pcOnly: decision.pcOnly !== false });
  }
  if (found.length !== selected.length) throw invalid();
  let result = askingPlan(0);
  for (const entry of found.reverse()) {
    if (typeof entry.requestId !== 'string' || !entry.requestId) throw invalid();
    const next = withClarified(result, [{ question: entry.question }], { [entry.question]: entry.answer }, entry.pcOnly, { chatId, requestId: entry.requestId });
    if (next === result) throw invalid();
    result = next;
  }
  return { clarified: result.clarified, ...(result.enough ? { enough: true } : {}), ...(result.pcOnly ? { pcOnly: true } : {}), intakeReceipts: result.intakeReceipts ?? [] };
}
