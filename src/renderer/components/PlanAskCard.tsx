// A Strategist's plan that waits for the user's ok, opened among the questions (ADR 0343): which job, one line and «Apri la mappa».
// The plan is read, approved, kept for later and changed only on its map; an ok typed in the Orchestrator's field while
// this card is open still counts (lib/field-answer.ts). Used by QuestionsWindow.tsx.
import { useLayoutEffect, useRef } from 'react';
import { claimFocus, openPlanOf } from '../actions';
import { t } from '../i18n';
import { planAskKey, type PlanAsk } from '../lib/plan-ask';
import { useApp } from '../store/store';
import { IconMap } from './Icons';

export function PlanAskCard({ ask, onEscape, testid }: { ask: PlanAsk; onEscape: () => void; testid: string }) {
  const steps = useApp(s => { const p = s.chats[ask.chatId]?.plan; return p?.phase === 'proposed' && p.at === ask.at ? p.steps.length : null; });
  const chatTitle = useApp(s => s.chats[ask.chatId]?.title ?? '');
  const key = planAskKey(ask.chatId, ask.at), ref = useRef<HTMLDivElement>(null);
  // Ctrl+J asked for this card before it was drawn: the keyboard comes here as it mounts (actions.ts claimFocus)
  useLayoutEffect(() => { if (claimFocus(key)) ref.current?.focus({ preventScroll: true }); }, [key]);
  if (steps === null) return null;
  return <div ref={ref} tabIndex={-1} className="plan-ask" data-request-key={key} data-kind="plan" aria-label={t('tree.plan.ask.label', { chat: chatTitle })} data-testid={testid}
    onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onEscape(); } }}>
    <b data-testid={`${testid}-title`}>{chatTitle}</b>
    <span data-testid={`${testid}-count`}>{t('tree.plan.steps', { n: steps })} · {t('tree.plan.ask.onMap')}</span>
    <button type="button" className="btn btn-primary btn-s" onClick={() => void openPlanOf(ask.chatId)} data-testid={`${testid}-map`}><IconMap size={13} />{t('plans.open')}</button>
  </div>;
}
