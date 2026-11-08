// Unbounded ordered interviews: host-only receipt resolution, normalized loop prevention and stop/approval separation.
import { describe, expect, it } from 'vitest';
import { resolvePlanIntake } from '../../../src/main/chats/plan-intake';
import { interviewQuestionHash, repeatedInterviewQuestion, withClarified } from '../../../src/main/chats/plan-interview';
import { askingPlan, delegationGate, ENOUGH_QUESTIONS, readPlan } from '../../../src/shared/strategy';

function interview(questions: string[], stop = false) {
  const records = questions.map((question, i) => ({ requestId: `request-${i}`, nativeQuestion: true,
    intakeKey: `key-${i}`, previousIntakeKey: i ? `key-${i - 1}` : undefined, pcOnly: false,
    questions: [{ question }], answer: { kind: 'question', answers: { [question]: stop && i === questions.length - 1 ? ENOUGH_QUESTIONS : `Answer ${i}` } } }));
  const source = { chatId: 'orchestrator', question: [...questions], key: `key-${questions.length - 1}` };
  const record = { s: { isOrchestrator: true }, intakeKey: source.key, continuationDecisions: records.map(r => JSON.stringify(r)).join('\n') };
  return { source, record };
}

describe('host interview intake', () => {
  it('keeps more than eight answers and one receipt per answer in host order, even if selection order differs', () => {
    const questions = Array.from({ length: 30 }, (_, i) => `Decision ${i}?`), f = interview(questions);
    const plan = askingPlan(1, resolvePlanIntake(f.record, { ...f.source, question: [...questions].reverse() }));
    expect(plan.clarified).toEqual(questions.map((q, i) => ({ q, a: `Answer ${i}` })));
    expect(plan.intakeReceipts).toEqual(questions.map((_, i) => ({ chatId: 'orchestrator', requestId: `request-${i}` })));
    expect(readPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    expect(delegationGate(plan, 'agent_delegate')).toContain('not approved');
  });

  it('rejects duplicates after Unicode, whitespace and case normalization without guessing semantic equivalence', () => {
    const f = interview(['Desktop only?', '  ＤＥＳＫＴＯＰ   only? ']);
    expect(() => resolvePlanIntake(f.record, f.source)).toThrow(/distinct/);
    expect(() => resolvePlanIntake(f.record, { ...f.source, question: ['Desktop only?'] })).toThrow(/already asked/);
    const first = withClarified(askingPlan(1), [{ question: 'Desktop only?' }], { 'Desktop only?': 'Sì' });
    expect(repeatedInterviewQuestion(first, '  ＤＥＳＫＴＯＰ   only? ')).toBe(true);
    expect(repeatedInterviewQuestion(first, 'Mobile too?')).toBe(false);
    expect(repeatedInterviewQuestion({ ...askingPlan(1), questionHistory: [interviewQuestionHash('Unanswered?')] }, 'UNANSWERED?')).toBe(true);
    expect(() => withClarified(first, [{ question: 'DESKTOP only?' }], { 'DESKTOP only?': 'No' })).toThrow(/already asked/);
  });

  it('keeps earlier answers and every receipt when the user stops, without treating the stop as approval', () => {
    const f = interview(['Scope?', 'More?'], true), plan = askingPlan(1, resolvePlanIntake(f.record, f.source));
    expect(plan).toMatchObject({ enough: true, clarified: [{ q: 'Scope?', a: 'Answer 0' }] });
    expect(plan.intakeReceipts).toHaveLength(2);
    expect(delegationGate(plan, 'agent_assign_task')).toContain('not approved');
  });

  it('refuses stale keys, foreign chats, consumed receipts and answers outside the linked interview', () => {
    const f = interview(['One?', 'Two?']);
    for (const record of [{ ...f.record, intakeKey: undefined }, { ...f.record, intakeKey: 'new' }, { ...f.record, s: { isOrchestrator: false } },
      { ...f.record, continuationDecisions: f.record.continuationDecisions.replace('"previousIntakeKey":"key-0"', '"previousIntakeKey":"different-task"') }]) {
      expect(() => resolvePlanIntake(record, f.source)).toThrow(/exact questions/);
    }
  });
});
