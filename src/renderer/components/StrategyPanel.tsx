// A Strategist's plan on its strip (ADR 0108, 0343): while it asks, the answers already clear, «Basta domande» and a
// pointer to its open question (QuestionsWindow.tsx); with a plan, one line: a round dot per step (ADR 0311), the count
// and «apri mappa». The plan itself is seen, approved and followed only on its map (work-map/PlanFull.tsx). Used by
// ChatTile.tsx and OrchestratorTile.tsx; the plan is ChatSummary.plan (shared/strategy.ts).
import type { ChatSummary, PendingRequest } from '@shared/contract';
import { ENOUGH_QUESTIONS, planCount, type StrategyPlan } from '@shared/strategy';
import { t } from '../i18n';
import { answer } from '../store/store';
import { openPlanOf, reqKey } from '../actions';
import { openQueue } from '../lib/later';
import '../styles/strategy.css';

function Known({ plan }: { plan: StrategyPlan }) {
  if (!plan.clarified.length) return null;
  return <div className="sp-known" data-testid="plan-known"><span>{t('tree.plan.known')}</span>
    {plan.clarified.map((c, i) => <span key={i} className="sp-known-item"><span className="sp-check" aria-hidden="true">✓</span><b>{c.q}</b> {c.a}</span>)}
  </div>;
}

/** question = the Strategist's open question: it opens in the questions window, the card points to it. */
export function StrategyPanel({ chat, question, compact }: { chat: ChatSummary; question?: PendingRequest; compact?: boolean }) {
  const plan = chat.plan;
  if (!plan) return null;
  const id = chat.id;
  // «Basta domande»: the open question gets that answer, the Strategist proposes the plan with what it knows
  const enough = (req: PendingRequest) => void answer(req, { kind: 'question', answers: Object.fromEntries((req.questions ?? []).map(q => [q.question, ENOUGH_QUESTIONS])) });

  if (plan.phase === 'asking' || plan.phase === 'revising') {
    return <div tabIndex={-1} className="sp-card" data-testid={`plan-${id}`} data-phase={plan.phase}>
      <div className="sp-top"><span className="sp-kicker">{t(plan.phase === 'revising' ? 'tree.plan.revisingKicker' : 'tree.plan.asking')}</span>
        {question && <span className="sp-right" data-testid={`plan-question-n-${id}`}>{t('tree.plan.question', { n: plan.clarified.length + 1 })}</span>}</div>
      {question
        ? <p className="sp-note sp-in-window" data-testid={`plan-in-window-${id}`}>{t('tree.plan.inWindow')} <button type="button" className="sp-link" onClick={() => openQueue(reqKey(question))} data-testid={`plan-open-window-${id}`}>{t('tree.plan.openWindow')}</button></p>
        : <p className="sp-note">{t(plan.phase === 'revising' ? 'tree.plan.revising' : 'tree.plan.thinking')}</p>}
      <Known plan={plan} />
      {question && plan.phase === 'asking' && <div className="sp-foot"><button type="button" className="sp-link" onClick={() => enough(question)} data-testid={`plan-enough-${id}`}>{t('tree.plan.enough')}</button></div>}
    </div>;
  }

  const { done, total, percent } = planCount(plan);
  const note = plan.phase === 'proposed' ? 'tree.plan.ready'
    : plan.steps.some(s => s.state === 'blocked') ? 'tree.plan.blocked'
        : plan.steps.some(s => s.state === 'partial') ? 'tree.plan.partial' : null;
  return <div tabIndex={-1} className={`sp-card sp-progress${compact ? ' is-compact' : ''}`} data-testid={`plan-${id}`} data-phase={plan.phase}>
    <div className="sp-summary">
      <span className="sp-kicker">{t('tree.plan.title')}</span>
      {/* one round dot per step: done filled, the one under way half, a blocked one amber, the next ones empty (ADR 0311) */}
      <span className="sp-dots" aria-hidden="true">
        {plan.steps.map((s, i) => <i key={i} className={`is-${s.state}`} />)}
      </span>
      <span className="sp-count" data-testid={`plan-percent-${id}`}>{percent}% · {done}/{total}</span>
      {note && <span className={plan.phase === 'proposed' ? 'sp-wait' : 'sp-blocked'}>{t(note)}</span>}
      <button type="button" className="sp-link sp-right" onClick={() => void openPlanOf(id)} data-testid={`plan-map-${id}`}>{t('plans.do.open')}</button>
    </div>
    <span className="sr-only" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={t('tree.plan.progress', { done, total })} />
  </div>;
}
