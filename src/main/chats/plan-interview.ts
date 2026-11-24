// Record each complete, human interview answer before truncating display text for the Plan panel and handoff.
import { createHash } from 'node:crypto';
import { reservedText } from '../../shared/away';
import { CLARIFIED_MAX, CLARIFIED_TEXT_MAX, interviewNeedsPC, stopsQuestions, type Clarified, type StrategyPlan } from '../../shared/strategy';
import { closeAnswered } from '../../shared/plan-doubts';
import { yesNoOf } from '../../shared/yes-no';

export function withClarified(plan: StrategyPlan, qs: { question: string; header?: string }[], answers: Record<string, string | string[]>, panelPcOnly = false): StrategyPlan {
  const question = qs[0]?.question.replace(/\s+/g, ' ').trim();
  if (!question || qs.length !== 1) return plan;
  const raw = answers[qs[0]!.question], value = Array.isArray(raw) ? raw.join(', ') : raw;
  if (typeof value !== 'string' || !value.trim()) return plan;
  const text = value.replace(/\s+/g, ' ').trim();
  const reserved = panelPcOnly || reservedText(question) || reservedText(text);
  const restriction = reserved || interviewNeedsPC(plan) ? { pcOnly: true as const } : {};
  if (stopsQuestions(text)) return { ...plan, ...restriction, enough: true };
  const clip = (s: string) => s.length > CLARIFIED_TEXT_MAX ? s.slice(0, CLARIFIED_TEXT_MAX - 1) + '…' : s;
  const answer = yesNoOf(text) ? text.replace(/\s*\((consigliat[oa]|recommended|empfohlen)\)\s*/i, '').trim() : text;
  const q = clip(question), a = clip(answer);
  const line: Clarified = { q, a, ...(q !== question ? { questionHash: createHash('sha256').update(question).digest('hex') } : {}),
    ...(reserved || q.endsWith('…') || a.endsWith('…') ? { pcOnly: reserved } : {}) };
  const same = plan.clarified.findIndex(entry => entry.q === q && entry.questionHash === line.questionHash);
  // a doubt asked with its own words is closed by this answer (ADR 0344)
  const closed = plan.doubts ? { doubts: closeAnswered(plan.doubts, question, answer) } : {};
  if (same >= 0) return { ...plan, ...restriction, ...closed, clarified: plan.clarified.map((c, i) => i === same ? line : c) };
  return { ...plan, ...restriction, ...closed, asked: (plan.asked ?? plan.clarified.length) + 1, clarified: [...plan.clarified, line].slice(-CLARIFIED_MAX) };
}
