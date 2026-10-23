// Compact plan decision for QuestionsWindow: a short scope preview with the complete plan in a disclosure,
// explicit yes/no and an optional free-text alternative. Every decision carries the exact proposal timestamp;
// No asks for a different plan through the existing change path and never starts the proposed steps.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ROLE_DEFAULTS } from '@shared/roles';
import { t } from '../i18n';
import { planDecide, useApp } from '../store/store';
import { claimFocus } from '../actions';
import { linksIn } from '../lib/askContext';
import { imagesIn, withoutImages } from '../lib/askImages';
import { AskImages } from './AskImages';
import { openFile } from './GenUi';
import { planAskKey, type PlanAsk } from '../lib/plan-ask';
import { AgentAvatar } from './AgentAvatar';
import { IconBranch, IconCheck, IconEdit, IconFile, IconGlobe } from './Icons';
import { Kbd } from './ui';
import '../styles/plan-approval.css';

// Queue navigation and opening evidence can remount a card; keep its unsent alternative for the same proposal.
// A bounded session cache avoids retaining abandoned proposals indefinitely.
const drafts = new Map<string, { changing: boolean; text: string }>();

export function PlanApproval({ ask, chatTitle, onEscape, keysTo, testid }: {
  ask: PlanAsk; chatTitle: string; onEscape: () => void; keysTo?: HTMLElement | null; testid: string;
}) {
  const plan = useApp(s => s.chats[ask.chatId]?.plan);
  const key = planAskKey(ask.chatId, ask.at);
  const [changing, setChanging] = useState(drafts.get(key)?.changing ?? false), [text, setText] = useState(drafts.get(key)?.text ?? ''), [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null), changeBtn = useRef<HTMLButtonElement>(null), backTo = useRef(false), submitting = useRef(false);
  // Ctrl+J asked for this card before it was drawn: the keyboard comes here as it mounts (actions.ts claimFocus)
  useLayoutEffect(() => { if (claimFocus(key)) ref.current?.focus({ preventScroll: true }); }, [key]);
  // Cancelling the alternative gives the keyboard back to its button.
  useEffect(() => { if (!changing && backTo.current) { backTo.current = false; changeBtn.current?.focus(); } }, [changing]);
  if (!plan || plan.phase !== 'proposed' || plan.at !== ask.at) return null;
  const n = plan.steps.length;

  const texts = [...plan.steps.flatMap(s => [s.title, s.detail ?? '']), plan.doneWhen ?? '', ...plan.clarified.flatMap(c => [c.q, c.a])];
  const links = linksIn(texts);
  const images = imagesIn(texts.map(text => ({ text })));
  const preview = plan.steps.slice(0, 3).map(s => withoutImages(s.title)).join(' · ');
  const brief = preview.length > 220 ? `${preview.slice(0, 219).trimEnd()}…` : preview;
  const edit = (changing: boolean, text: string) => {
    drafts.set(key, { changing, text });
    if (drafts.size > 32) drafts.delete(drafts.keys().next().value!);
    setChanging(changing); setText(text);
  };
  const decide = (decision: 'approve' | 'change', answer = text) => {
    if (submitting.current || (decision === 'change' && !answer.trim())) return;
    submitting.current = true;
    setBusy(true);
    // the plan moves on and this card leaves; a refusal (a newer proposal, an engine down) gives the buttons back
    void planDecide(ask.chatId, decision, ask.at, answer).then(ok => {
      if (!ok) { submitting.current = false; setBusy(false); }
      else drafts.delete(key);
    });
  };
  const cancel = () => { backTo.current = true; edit(false, text); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.nativeEvent.isComposing) return; // a focused button or the box handles its own keys
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !changing) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) decide('approve'); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape(); }
  };

  return (
    <div ref={ref} tabIndex={0} onKeyDown={onKey} className={`wq plan-ask ${busy ? 'sent' : ''}`} role="group" data-request-key={key} data-testid={testid} data-kind="plan"
      aria-busy={busy} aria-label={t('tree.plan.ask.label', { chat: chatTitle })}>
      {keysTo && !changing && createPortal(<><Kbd>{t('genui.request.enter')}</Kbd>{' '}{t('tree.plan.ask.keys')}</>, keysTo)}
      <div className="wq-kicker"><IconBranch size={13} /><span>{t('tree.plan.ask.kicker')}</span><span className="wq-step" data-testid={`${testid}-count`}>{t('tree.plan.steps', { n })}</span></div>
      <p className="wq-lead">{t('tree.plan.ask.lead', { n })}</p>
      <h2 className="wq-q">{t('tree.plan.ask.title')}</h2>

      <p className="pa-summary" data-testid={`${testid}-summary`}>{brief}{n > 3 && <span> {t('tree.plan.ask.more', { n: n - 3 })}</span>}</p>
      {links.length > 0 && <div className="ctx-links" data-testid={`${testid}-links`}>
        {links.map((link, i) => link.kind === 'web'
          ? <a key={link.href} className="ctx-link" href={link.href} target="_blank" rel="noopener noreferrer" title={link.href} data-testid={`${testid}-link-${i}`}><IconGlobe size={12} /><span>{link.label}</span></a>
          : <button key={link.href} type="button" className="ctx-link file" onClick={() => void openFile(link.href, ask.chatId)} title={link.href} data-testid={`${testid}-link-${i}`}><IconFile size={12} /><span>{link.label}</span></button>)}
      </div>}
      {images.length > 0 && <AskImages images={images} testBase={testid} />}
      <details className="pa-details" data-testid={`${testid}-details`}>
        <summary>{t('tree.plan.ask.details')}</summary>
        <div className="pa-details-body">
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
        </div>
      </details>

      {changing ? (
        <div className="pa-change">
          <label className="wq-label" htmlFor={`${testid}-change-text`}>{t('tree.plan.changePlaceholder')}</label>
          <textarea id={`${testid}-change-text`} value={text} onChange={e => edit(true, e.target.value)} rows={3} maxLength={2000} autoFocus disabled={busy} data-testid={`${testid}-change-text`}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) decide('change'); }
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
          <button type="button" className="btn btn-primary btn-l" onClick={() => decide('approve')} disabled={busy} data-testid={`${testid}-approve`}><IconCheck size={13} /> {t('tree.plan.ask.yes')}</button>
          <button type="button" className="btn btn-ghost btn-l" onClick={() => decide('change', t('tree.plan.ask.rejection'))} disabled={busy} data-testid={`${testid}-reject`}>{t('tree.plan.ask.no')}</button>
          <button ref={changeBtn} type="button" className="btn btn-ghost btn-l" onClick={() => edit(true, text)} disabled={busy} data-testid={`${testid}-change`}><IconEdit size={13} /> {t('tree.plan.ask.other')}</button>
        </div>
      )}
    </div>
  );
}
