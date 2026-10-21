// A Strategist's plan with the user on its strip (ADR 0108), collapsed or expanded: while it asks, its open question
// with the answers already clear and «Basta domande» (with "Popup" on the question opens in the questions window
// instead: QuestionsWindow.tsx, and the strip keeps only what is already clear); then its short plan with «Approva e
// parti» and «Cambia qualcosa» (chat:plan); once approved, the steps as a checklist, Claude Code style (✓ done, a
// turning ring for the step under way, a dashed ring for the next ones), each with the role that does it. Used by
// ChatTile.tsx; the plan itself is ChatSummary.plan (shared/strategy.ts).
import { useState } from 'react';
import type { ChatSummary, PendingRequest } from '@shared/contract';
import { ENOUGH_QUESTIONS, planCount, type PlanStep, type StrategyPlan } from '@shared/strategy';
import { ROLE_DEFAULTS } from '@shared/roles';
import { t } from '../i18n';
import { answer, planDecide } from '../store/store';
import { useNow } from '../lib/clock';
import { answerLater } from '../lib/later';
import { AgentAvatar } from './AgentAvatar';
import { RequestPanel } from './RequestPanel';
import '../styles/strategy.css';

const MIN = 60_000;

/** The open question a Strategist's strip shows itself: it is asking, and the questions window is off. */
export function planQuestion(chat: Pick<ChatSummary, 'plan'>, reqs: readonly PendingRequest[], inWindow: boolean, queued: boolean): PendingRequest | undefined {
  const p = chat.plan?.phase;
  return (p === 'asking' || p === 'revising') && !inWindow && !queued ? reqs.find(r => r.type === 'question' && r.questions?.length) : undefined;
}

function StepIcon({ state }: { state: PlanStep['state'] }) {
  if (state === 'done') return <svg className="sp-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" className="sp-done-fill" /><path d="M4.8 8.2l2.1 2.1 4.3-4.4" fill="none" className="sp-done-mark" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (state === 'now') return <svg className="sp-icon sp-spin" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" className="sp-ring" strokeWidth="1.6" /><path d="M8 1.7a6.3 6.3 0 0 1 6.3 6.3" fill="none" className="sp-arc" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  if (state === 'blocked') return <svg className="sp-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" className="sp-blocked-fill" /><path d="M8 4.4v4.4M8 11.2v.1" className="sp-done-mark" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  return <svg className="sp-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" className="sp-todo" strokeWidth="1.4" strokeDasharray="2.2 2.2" /></svg>;
}

function Who({ step, now, timed }: { step: PlanStep; now: number; timed: boolean }) {
  const name = step.role ? ROLE_DEFAULTS[step.role].name : t('tree.plan.self');
  const mins = (ms: number) => Math.max(1, Math.round(ms / MIN));
  const when = !timed || !step.startedAt ? '' : step.endedAt ? t('tree.plan.minutes', { n: mins(step.endedAt - step.startedAt) }) : step.state === 'now' ? t('tree.plan.since', { n: mins(now - step.startedAt) }) : '';
  return <span className="sp-who">
    <AgentAvatar avatar={{ kind: 'character', value: step.role ?? 'strategist' }} name={name} size={18} />
    {name}{when && <> · {when}</>}{step.state === 'blocked' && <> · <b className="sp-blocked">{t('tree.plan.blocked')}</b></>}
  </span>;
}

function Steps({ plan, timed, testid }: { plan: StrategyPlan; timed: boolean; testid: string }) {
  const now = useNow(15_000);
  return <ul className="sp-list" data-testid={testid}>
    {plan.steps.map((s, i) => <li key={i} className={`sp-step is-${s.state}`} data-state={s.state} data-testid={`${testid}-${i + 1}`}>
      <StepIcon state={s.state} /><span className="sp-title">{s.title}</span><Who step={s} now={now} timed={timed} />
    </li>)}
  </ul>;
}

function Known({ plan }: { plan: StrategyPlan }) {
  if (!plan.clarified.length) return null;
  return <div className="sp-known" data-testid="plan-known"><span>{t('tree.plan.known')}</span>
    {plan.clarified.map((c, i) => <span key={i} className="sp-known-item"><span className="sp-check" aria-hidden="true">✓</span><b>{c.q}</b> {c.a}</span>)}
  </div>;
}

export function StrategyPanel({ chat, question }: { chat: ChatSummary; question?: PendingRequest }) {
  const plan = chat.plan;
  const [changing, setChanging] = useState(false), [text, setText] = useState(''), [busy, setBusy] = useState(false);
  if (!plan) return null;
  const id = chat.id;
  const decide = (decision: 'approve' | 'change') => {
    if (busy) return;
    setBusy(true);
    void planDecide(id, decision, text).then(ok => { if (ok) { setChanging(false); setText(''); } setBusy(false); });
  };
  // «Basta domande»: the open question gets that answer, the Strategist proposes the plan with what it knows
  const enough = (req: PendingRequest) => void answer(req, { kind: 'question', answers: Object.fromEntries((req.questions ?? []).map(q => [q.question, ENOUGH_QUESTIONS])) });

  if (plan.phase === 'asking' || plan.phase === 'revising') {
    return <div className="sp-card" data-testid={`plan-${id}`} data-phase={plan.phase}>
      <div className="sp-top"><span className="sp-kicker">{t(plan.phase === 'revising' ? 'tree.plan.revisingKicker' : 'tree.plan.asking')}</span>
        {question && <span className="sp-right" data-testid={`plan-question-n-${id}`}>{t('tree.plan.question', { n: plan.clarified.length + 1 })}</span>}</div>
      {question
        ? <div className="sp-ask"><RequestPanel req={question} variant="tile" chatTitle={chat.title} harness={chat.harness} onLater={answerLater} testid={`plan-ask-${id}`} /></div>
        : <p className="sp-note">{t(plan.phase === 'revising' ? 'tree.plan.revising' : 'tree.plan.thinking')}</p>}
      <Known plan={plan} />
      {question && plan.phase === 'asking' && <div className="sp-foot"><button type="button" className="sp-link" onClick={() => enough(question)} data-testid={`plan-enough-${id}`}>{t('tree.plan.enough')}</button></div>}
    </div>;
  }

  if (plan.phase === 'proposed') {
    return <div className="sp-card" data-testid={`plan-${id}`} data-phase="proposed">
      <div className="sp-top"><span className="sp-kicker">{t('tree.plan.title')}</span><span className="sp-right">{t('tree.plan.steps', { n: plan.steps.length })}</span></div>
      <Steps plan={plan} timed={false} testid={`plan-steps-${id}`} />
      {plan.doneWhen && <div className="sp-done-when">{t('tree.plan.doneWhen', { text: plan.doneWhen })}</div>}
      {changing
        ? <div className="sp-change">
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder={t('tree.plan.changePlaceholder')} rows={2} maxLength={2000} autoFocus aria-label={t('tree.plan.changePlaceholder')} data-testid={`plan-change-text-${id}`}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && text.trim()) { e.preventDefault(); decide('change'); } else if (e.key === 'Escape') { e.stopPropagation(); setChanging(false); } }} />
          <div className="sp-foot">
            <button type="button" className="sp-btn primary" disabled={busy || !text.trim()} onClick={() => decide('change')} data-testid={`plan-change-send-${id}`}>{t('tree.plan.send')}</button>
            <button type="button" className="sp-btn" onClick={() => setChanging(false)}>{t('tree.plan.cancel')}</button>
          </div>
        </div>
        : <div className="sp-foot">
          <button type="button" className="sp-btn primary" disabled={busy} onClick={() => decide('approve')} data-testid={`plan-approve-${id}`}>{t('tree.plan.approve')}</button>
          <button type="button" className="sp-btn" disabled={busy} onClick={() => setChanging(true)} data-testid={`plan-change-${id}`}>{t('tree.plan.change')}</button>
        </div>}
    </div>;
  }

  const { done, total } = planCount(plan);
  return <div className="sp-card sp-progress" data-testid={`plan-${id}`} data-phase={plan.phase}>
    <div className="sp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={t('tree.plan.progress', { done, total })} data-tip={t('tree.plan.progress', { done, total })}>
      <b style={{ width: `${total ? Math.round(done / total * 100) : 0}%` }} />
    </div>
    <Steps plan={plan} timed testid={`plan-steps-${id}`} />
  </div>;
}
