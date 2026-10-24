// A Strategist's plan in QuestionsWindow as the decision card (DecisionCard.tsx, ADR 0149): the steps, who does each,
// when it is done and what is already known are its evidence, always open; Sì starts it, No or «Non voglio rispondere»
// asks for another plan, «Scrivi una risposta…» sends what to change. Every decision carries the exact proposal timestamp;
// No asks for a different plan through the existing change path and never starts the proposed steps.
import { useLayoutEffect, useRef, useState } from 'react';
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
import { IconBranch, IconCheck, IconFile, IconGlobe } from './Icons';
import { DecisionCard } from './DecisionCard';
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
  const ref = useRef<HTMLDivElement>(null), submitting = useRef(false);
  // Ctrl+J asked for this card before it was drawn: the keyboard comes here as it mounts (actions.ts claimFocus)
  useLayoutEffect(() => { if (claimFocus(key)) ref.current?.focus({ preventScroll: true }); }, [key]);
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
  return (
    <DecisionCard ref={ref} testBase={testid} className="wq plan-ask" busy={busy} laterButton={false} onLater={onEscape}
      rootProps={{ 'data-request-key': key, 'data-kind': 'plan', 'aria-label': t('tree.plan.ask.label', { chat: chatTitle }) }}
      head={<><IconBranch size={13} /><span>{t('tree.plan.ask.kicker')}</span><span className="dc-chip" data-testid={`${testid}-count`}>{t('tree.plan.steps', { n })}</span></>}
      question={t('tree.plan.ask.title')}
      ifYes={t('genui.decision.planYes')} ifNo={t('genui.decision.planNo')}
      yes={{ onChoose: () => decide('approve'), recommended: true, testid: `${testid}-approve` }}
      no={{ onChoose: () => decide('change', t('tree.plan.ask.rejection')), testid: `${testid}-reject` }}
      write={{ onSend: answer => decide('change', answer), initial: changing ? text : undefined, onDraft: v => edit(true, v), hint: t('tree.plan.ask.changeHint'),
        testids: { open: `${testid}-change`, input: `${testid}-change-text`, send: `${testid}-change-send` } }}
      skip={{ onChoose: () => decide('change', t('tree.plan.ask.rejection')), hint: t('genui.decision.skipDiscard') }}
      footer={keysTo ? createPortal(<span>{t('genui.decision.keys')}</span>, keysTo) : null}>
      <p className="pa-summary" data-testid={`${testid}-summary`}>{t('tree.plan.ask.lead', { n })} {brief}{n > 3 && <span> {t('tree.plan.ask.more', { n: n - 3 })}</span>}</p>
      <ol className="pa-steps" data-testid={`${testid}-steps`}>
        {plan.steps.map((s, i) => {
          const who = s.role ? ROLE_DEFAULTS[s.role].name : t('tree.plan.self');
          return (
            <li key={i} className="pa-step" data-testid={`${testid}-step-${i + 1}`} data-role={s.role ?? 'strategist'}>
              <span className="pa-n" aria-hidden="true">{i + 1}</span>
              <span className="pa-body">
                <span className="pa-title">{withoutImages(s.title)}</span>
                {s.detail && <span className="pa-detail">{withoutImages(s.detail)}</span>}
              </span>
              <span className="pa-who"><AgentAvatar avatar={{ kind: 'character', value: s.role ?? 'strategist' }} name={who} size={20} />{who}</span>
            </li>
          );
        })}
      </ol>
      {images.length > 0 && <AskImages images={images} testBase={testid} />}
      {(plan.doneWhen || plan.clarified.length > 0) && (
        <div className="pa-facts" data-testid={`${testid}-details`}>
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
      {links.length > 0 && <div className="ctx-links" data-testid={`${testid}-links`}>
        {links.map((link, i) => link.kind === 'web'
          ? <a key={link.href} className="ctx-link" href={link.href} target="_blank" rel="noopener noreferrer" title={link.href} data-testid={`${testid}-link-${i}`}><IconGlobe size={12} /><span>{link.label}</span></a>
          : <button key={link.href} type="button" className="ctx-link file" onClick={() => void openFile(link.href, ask.chatId)} title={link.href} data-testid={`${testid}-link-${i}`}><IconFile size={12} /><span>{link.label}</span></button>)}
      </div>}
    </DecisionCard>
  );
}
