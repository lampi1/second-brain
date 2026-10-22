// A Strategist's plan to approve, as a card of the questions window (ADR 0121; the owner, 2026-10-22: «almeno quella di
// approvazione del piano tramite il popup se sono attivati i popup, rimostrando gli step del piano nella domanda con una
// bella UI»). It reads like the window's other cards (RequestPanel size `window`): the kind on top, a muted lead, the
// question large; then the steps as a numbered list, each with the role that does it and its short detail, what is
// already clear and when it counts as finished; «Approva e parti» (also Enter on the card) and «Cambia qualcosa», which
// opens a box for what to change (Enter sends, Esc goes back). Both go through chat:plan with the plan's `at` (a newer
// proposal is refused, never approved unseen); the plan's phase moves and the card leaves by itself, here and on the
// strip. Esc on the card is the window's «Rispondi dopo». Used by QuestionsWindow.tsx; the ask is lib/plan-ask.ts.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ROLE_DEFAULTS } from '@shared/roles';
import { t } from '../i18n';
import { planDecide, useApp } from '../store/store';
import { claimFocus } from '../actions';
import { planAskKey, type PlanAsk } from '../lib/plan-ask';
import { AgentAvatar } from './AgentAvatar';
import { IconBranch, IconCheck, IconEdit } from './Icons';
import { Kbd } from './ui';
import '../styles/plan-approval.css';

export function PlanApproval({ ask, chatTitle, onEscape, keysTo, testid }: {
  ask: PlanAsk; chatTitle: string; onEscape: () => void; keysTo?: HTMLElement | null; testid: string;
}) {
  const plan = useApp(s => s.chats[ask.chatId]?.plan);
  const key = planAskKey(ask.chatId, ask.at);
  const [changing, setChanging] = useState(false), [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null), changeBtn = useRef<HTMLButtonElement>(null), backTo = useRef(false);
  // Ctrl+J asked for this card before it was drawn: the keyboard comes here as it mounts (actions.ts claimFocus)
  useLayoutEffect(() => { if (claimFocus(key)) ref.current?.focus({ preventScroll: true }); }, [key]);
  // «Annulla» gives the keyboard back to «Cambia qualcosa»
  useEffect(() => { if (!changing && backTo.current) { backTo.current = false; changeBtn.current?.focus(); } }, [changing]);
  if (!plan || plan.phase !== 'proposed' || plan.at !== ask.at) return null;
  const n = plan.steps.length;

  const decide = (decision: 'approve' | 'change') => {
    if (busy || (decision === 'change' && !text.trim())) return;
    setBusy(true);
    // the plan moves on and this card leaves; a refusal (a newer proposal, an engine down) gives the buttons back
    void planDecide(ask.chatId, decision, ask.at, text).then(ok => { if (!ok) setBusy(false); });
  };
  const cancel = () => { backTo.current = true; setChanging(false); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // a focused button or the box handles its own keys
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey && !changing) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) decide('approve'); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape(); }
  };

  return (
    <div ref={ref} tabIndex={0} onKeyDown={onKey} className={`wq plan-ask ${busy ? 'sent' : ''}`} role="group" data-request-key={key} data-testid={testid} data-kind="plan"
      aria-busy={busy} aria-label={t('tree.plan.ask.label', { chat: chatTitle })}>
      {keysTo && !changing && createPortal(<><Kbd>{t('genui.request.enter')}</Kbd>{' '}{t('tree.plan.ask.keys')}</>, keysTo)}
      <div className="wq-kicker"><IconBranch size={13} /><span>{t('tree.plan.ask.kicker')}</span><span className="wq-step" data-testid={`${testid}-count`}>{t('tree.plan.steps', { n })}</span></div>
      <p className="wq-lead">{t('tree.plan.ask.lead', { n })}</p>
      <h2 className="wq-q">{t('tree.plan.ask.title')}</h2>

      <ol className="pa-steps" data-testid={`${testid}-steps`}>
        {plan.steps.map((s, i) => {
          const who = s.role ? ROLE_DEFAULTS[s.role].name : t('tree.plan.self');
          return (
            <li key={i} className="pa-step" data-testid={`${testid}-step-${i + 1}`} data-role={s.role ?? 'strategist'}>
              <span className="pa-n" aria-hidden="true">{i + 1}</span>
              <span className="pa-body">
                <span className="pa-title">{s.title}</span>
                {s.detail && <span className="pa-detail">{s.detail}</span>}
              </span>
              <span className="pa-who"><AgentAvatar avatar={{ kind: 'character', value: s.role ?? 'strategist' }} name={who} size={20} />{who}</span>
            </li>
          );
        })}
      </ol>

      {(plan.doneWhen || plan.clarified.length > 0) && (
        <div className="pa-facts">
          {plan.doneWhen && (
            <div className="pa-fact" data-testid={`${testid}-done-when`}><span className="pa-fact-k"><IconCheck size={12} />{t('tree.plan.ask.doneWhen')}</span><span>{plan.doneWhen}</span></div>
          )}
          {plan.clarified.length > 0 && (
            <div className="pa-fact" data-testid={`${testid}-known`}><span className="pa-fact-k">{t('tree.plan.ask.known')}</span>
              <span className="pa-known">{plan.clarified.map((c, i) => <span key={i} className="pa-chip"><b>{c.q}</b> {c.a}</span>)}</span>
            </div>
          )}
        </div>
      )}

      {changing ? (
        <div className="pa-change">
          <label className="wq-label" htmlFor={`${testid}-change-text`}>{t('tree.plan.changePlaceholder')}</label>
          <textarea id={`${testid}-change-text`} value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={2000} autoFocus disabled={busy} data-testid={`${testid}-change-text`}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); decide('change'); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
            }} />
          <div className="pa-change-foot">
            <span className="pa-hint">{t('tree.plan.ask.changeHint')}</span>
            <button type="button" className="btn btn-ghost btn-l" onClick={cancel} disabled={busy}>{t('tree.plan.cancel')}</button>
            <button type="button" className="btn btn-primary btn-l" onClick={() => decide('change')} disabled={busy || !text.trim()} data-testid={`${testid}-change-send`}>{t('tree.plan.send')} <Kbd>{t('genui.request.enter')}</Kbd></button>
          </div>
        </div>
      ) : (
        <div className="wq-perm pa-actions">
          <button type="button" className="btn btn-primary btn-l" onClick={() => decide('approve')} disabled={busy} data-testid={`${testid}-approve`}><IconCheck size={13} /> {t('tree.plan.approve')}</button>
          <button ref={changeBtn} type="button" className="btn btn-ghost btn-l" onClick={() => setChanging(true)} disabled={busy} data-testid={`${testid}-change`}><IconEdit size={13} /> {t('tree.plan.change')}</button>
        </div>
      )}
    </div>
  );
}
