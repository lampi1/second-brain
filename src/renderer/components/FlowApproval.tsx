// Exact-version flow decisions as the decision card (DecisionCard.tsx, ADR 0149), with the shared modal's focus,
// postponement and bounded session drafts.
import { useId, useRef, useState } from 'react';
import type { FlowAsk } from '../lib/flow-ask';
import { flowDecisionMode, flowDecisionSubmission, flowGateEvidence } from '../lib/flow-decision';
import { openChatRef } from '../actions';
import { useApp } from '../store/store';
import { decideFlow } from '../store/flows';
import { decisionDraft, saveDecisionDraft } from '../lib/decision-drafts';
import { t } from '../i18n';
import { FlowAutomationSummary } from './FlowAutomationSummary';
import { FlowDefinition } from './FlowDefinition';
import { FlowRestartApproval } from './FlowRunControls';
import { DecisionCard } from './DecisionCard';
import '../styles/flows.css';
export function FlowApproval({ ask, onEscape }: { ask: FlowAsk; onEscape: () => void }) {
  if (ask.type === 'flow-restart' || ask.type === 'flow-cancel') return <FlowRestartApproval ask={ask} onEscape={onEscape} />;
  return <FlowStandardApproval ask={ask} onEscape={onEscape} />;
}
function FlowStandardApproval({ ask, onEscape }: { ask: Exclude<FlowAsk, { type: 'flow-restart' | 'flow-cancel' }>; onEscape: () => void }) {
  const key = `${ask.chatId}/${ask.id}`, evidenceId = useId();
  const evidenceKey = `${key}/evidence`;
  const [evidence, setEvidence] = useState(() => decisionDraft(evidenceKey));
  const [feedback, setFeedback] = useState(() => decisionDraft(key));
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const definition = ask.type === 'flow-definition' ? ask.draft.definition : ask.version?.definition;
  const run = ask.type === 'flow-run' ? ask.run : undefined;
  const current = run?.steps[run.currentStep];
  const boundChat = useApp(s => current?.chatId && s.chats[current.chatId] ? current.chatId : null);
  const mode = flowDecisionMode(ask);
  const gate = flowGateEvidence(ask);
  const canApprove = flowDecisionSubmission(ask, 'yes', feedback, evidence) !== null;
  const decide = async (answer: 'yes' | 'no' | 'other', text = feedback) => {
    const submission = flowDecisionSubmission(ask, answer, text, evidence);
    if (submitting.current || !submission) return;
    submitting.current = true; setBusy(true);
    const ok = await decideFlow(ask, submission.answer, submission.feedback);
    if (ok) { saveDecisionDraft(key, ''); saveDecisionDraft(evidenceKey, ''); }
    submitting.current = false; setBusy(false);
  };
  return <DecisionCard testBase={`qwin-${ask.type}`} className="wq flow-review" busy={busy} laterButton={false} onLater={onEscape}
    rootProps={{ 'data-request-key': key, 'aria-label': ask.title }}
    head={<><span className="dc-chip">{t('flows.title')} · {ask.type === 'flow-definition' ? `r${ask.draft.revision}` : ask.type === 'flow-automation' ? `v${ask.rule.config.flowVersion} · r${ask.rule.revision}` : `v${ask.run.flowVersion} · r${ask.run.revision}`}</span><b className="dc-who">{ask.title}</b></>}
    question={t(ask.type === 'flow-definition' ? 'flows.proposalQuestion' : ask.type === 'flow-automation' ? 'flows.autoQuestion' : 'flows.stepQuestion')}
    yes={{ onChoose: () => void decide('yes'), label: t(mode === 'retry' ? 'flows.yesRetry' : 'flows.yes'), disabled: !canApprove, testid: 'flow-approve' }}
    no={{ onChoose: () => void decide('no'), label: t('flows.no'), testid: 'flow-reject' }}
    write={{ onSend: text => void decide('other', text), initial: decisionDraft(key) || undefined, onDraft: v => { setFeedback(v); saveDecisionDraft(key, v); }, hint: t('flows.otherHint'),
      testids: { open: 'flow-other', input: 'flow-feedback', send: 'flow-feedback-send' } }}
    skip={{ onChoose: () => void decide('no'), hint: t('genui.decision.skipDiscard') }}>
    {ask.type === 'flow-definition' && <p className="wq-lead">{t('flows.activationHint')}</p>}
    {ask.type === 'flow-automation' && <><p className="wq-lead">{t('flows.autoHint')}</p><FlowAutomationSummary config={ask.rule.config} /></>}
    {definition?.description && <p>{definition.description}</p>}
    {run && <><p className="flow-target" data-testid="flow-target"><strong>{t('flows.target')}:</strong> {run.subjectKey}<span className="flows-muted"> · {[run.scope.project, run.scope.areaPath].filter(Boolean).join(' · ') || '—'}</span></p><details data-testid="flow-run-context"><summary>{t('flows.runContext')}</summary><dl className="flow-facts"><dt>{t('flows.target')}</dt><dd>{run.subjectKey}</dd><dt>{t('flows.scope')}</dt><dd>{[run.scope.project, run.scope.areaPath].filter(Boolean).join(' · ') || '—'}</dd><dt>{t('flows.inputs')}</dt><dd>{Object.keys(run.inputs).length ? <dl className="flow-facts">{Object.entries(run.inputs).map(([name, value]) => <div key={name} className="flow-input-pair"><dt>{name}</dt><dd>{value}</dd></div>)}</dl> : '—'}</dd></dl></details></>}
    {current && <p>{t('flows.current')}: <strong>{definition?.steps[run!.currentStep]?.title ?? current.stepId}</strong></p>}
    {current?.reason && <p className="flow-block" role="status">{current.reason}</p>}
    {boundChat && <button type="button" className="btn btn-ghost btn-s" onClick={() => { onEscape(); openChatRef(boundChat); }} data-testid="flow-open-agent">{t('flows.openAgent')}</button>}
    {mode === 'retry' && <p className="wq-lead">{t('flows.retryHint')}</p>}
    {definition && <details><summary>{t('flows.details')} · {definition.steps.length}</summary><FlowDefinition definition={definition} run={run} /></details>}
    {gate.required && <div className="pa-change flow-evidence">
      <label className="wq-label" htmlFor={evidenceId}>{t('flows.evidence')}</label>
      <p className="wq-lead">{t(gate.labels.length ? 'flows.evidenceFormat' : 'flows.manualEvidence')}</p>
      {gate.labels.length > 0 && <ul className="flow-evidence-labels">{gate.labels.map(label => <li key={label}><code>{label}: …</code></li>)}</ul>}
      <textarea id={evidenceId} value={evidence} onChange={e => { setEvidence(e.target.value); saveDecisionDraft(evidenceKey, e.target.value); }} rows={3} maxLength={16000} disabled={busy} required data-testid="flow-evidence" />
    </div>}
  </DecisionCard>;
}
