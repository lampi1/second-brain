// User recovery controls preserve original history, display exact prerequisites and ask before repeating effects.
import { useId, useRef, useState, type ReactNode } from 'react';
import type { FlowRun, FlowSnapshot } from '@shared/flows';
import type { FlowCancelAsk, FlowRestartAsk } from '../lib/flow-ask';
import { flowRecoveryPreview, flowRecoveryQuestion, flowRunCanCancel, flowRunVersion, type FlowRecoveryMode } from '../lib/flow-recovery';
import { controlFlowRun, decideFlow, useFlows } from '../store/flows';
import { app, send, useApp } from '../store/store';
import { t } from '../i18n';
import { decisionDraft, saveDecisionDraft } from '../lib/decision-drafts';
import { FlowDefinition } from './FlowDefinition';
import { FlowAutomationSummary } from './FlowAutomationSummary';
import { Modal } from './ui';

export function FlowRunControls({ run, onRequest }: { run: FlowRun; onRequest: (mode: FlowRecoveryMode) => void }) {
  const owner = useApp(s => s.chats[run.ownerOrchestratorId]);
  const current = run.steps[run.currentStep];
  return <section className="flow-run-controls" data-testid="flow-run-controls">
    <p className="flows-muted">{t('flows.runOwner')}: {owner?.title || run.ownerOrchestratorId}</p>
    {run.restartOf && <p className="flows-muted">{t('flows.runFrom')}: {run.restartOf.runId}{run.restartOf.stepId ? ` · ${run.restartOf.stepId}` : ''}</p>}
    {run.status === 'cancelled' ? <p role="status">{t(run.cancellation?.interruption === 'pending' ? 'flows.interruptionPending' : 'flows.runStopped')}{run.cancellation?.reason ? ` ${run.cancellation.reason}` : ''}</p> : current?.reason ? <p className="flow-block" role="status">{current.reason}</p> : (run.status === 'blocked' || run.status === 'approval') && <p className="flow-block" role="status">{t('flows.queueDecision')}</p>}
    {run.cancellation?.interruption === 'pending' && <p className="flow-block" role="status">{t('flows.interruptionHint')}{current?.reason && current.reason !== run.cancellation.reason ? ` ${current.reason}` : ''}</p>}
    {run.recoveryFeedback && <p className="flows-muted">{run.recoveryFeedback.message}</p>}
    {run.status === 'active' && (current?.status === 'ready' || current?.status === 'pending') && <p role="status">{t('flows.queueWaiting')}</p>}
    <div className="flow-actions">
      {flowRunCanCancel(run) && <button type="button" className="btn btn-ghost btn-s" onClick={() => onRequest('cancel')} data-testid="flow-cancel">{t('flows.cancelRun')}</button>}
      <button type="button" className="btn btn-ghost btn-s" onClick={() => onRequest('from-step')} data-testid="flow-resume-step">{t('flows.resumeStep')}</button>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => onRequest('from-start')} data-testid="flow-restart">{t('flows.restartRun')}</button>
    </div>
  </section>;
}

/** A shared body for local confirmations and Orchestrator proposals. The opening snapshot freezes the target. */
export function FlowRecoveryContent({ snapshot, run, mode, proposal, onClose, onDone }: {
  snapshot: FlowSnapshot; run: FlowRun; mode: FlowRecoveryMode; proposal?: FlowRestartAsk | FlowCancelAsk; onClose: () => void; onDone?: (id: string) => void;
}) {
  const currentSnapshot = useFlows().snapshot;
  const inputId = useId(), stepInputId = useId();
  const [stepId, setStepId] = useState(proposal?.run.pendingRecovery?.stepId ?? run.steps[run.currentStep]?.stepId ?? run.steps[0]?.stepId);
  const draftKey = proposal ? `${proposal.chatId}/${proposal.id}` : `flow/${encodeURIComponent(snapshot.contextKey)}/recovery/${run.id}@${run.revision}/${mode}`;
  const [feedback, setFeedback] = useState(() => decisionDraft(draftKey)), [changing, setChanging] = useState(() => !!decisionDraft(draftKey)), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const owner = useApp(s => s.chats[run.ownerOrchestratorId]);
  const preview = mode === 'cancel' ? undefined : flowRecoveryPreview(snapshot, run, mode, stepId);
  const version = preview?.version ?? flowRunVersion(snapshot, run);
  const definition = version?.definition;
  const liveRun = currentSnapshot?.runs.find(row => row.id === run.id);
  const livePreview = mode !== 'cancel' && currentSnapshot && liveRun ? flowRecoveryPreview(currentSnapshot, liveRun, mode, stepId) : undefined;
  const pending = mode === 'cancel' ? undefined : proposal?.run.pendingRecovery;
  const rule = preview?.automationRule && snapshot.automation?.rules.find(row => row.id === preview.automationRule!.id);
  const automationStale = livePreview?.automationRule?.id !== preview?.automationRule?.id || livePreview?.automationRule?.revision !== preview?.automationRule?.revision
    || !!pending && (pending.automationRule?.id !== preview?.automationRule?.id || pending.automationRule?.revision !== preview?.automationRule?.revision);
  const stale = currentSnapshot?.contextKey !== snapshot.contextKey || liveRun?.revision !== run.revision
    || (mode !== 'cancel' && (livePreview?.version?.version !== preview?.version?.version || livePreview?.version?.digest !== preview?.version?.digest))
    || !!pending && (preview?.version?.version !== pending.targetVersion || preview?.version?.digest !== pending.targetDigest);
  const reason = stale || mode !== 'cancel' && automationStale ? t('flows.recoveryStale') : preview?.reason === 'active' ? t('flows.recoveryActive') : preview?.reason === 'version' ? t('flows.recoveryVersion') : preview?.reason === 'step' ? t('flows.recoveryPick') : preview?.reason === 'prefix' ? `${t('flows.recoveryMissing')} ${preview.missing.map(step => step.title).join(' · ')}` : preview?.reason === 'automation' || livePreview?.reason === 'automation' ? t('flows.recoveryAutomation') : mode === 'cancel' && !flowRunCanCancel(run) ? t('flows.runStopped') : null;
  const answer = async (value: 'yes' | 'no' | 'other') => {
    if (locked.current || value === 'yes' && reason || value === 'other' && !feedback.trim()) return;
    if (value === 'no' && !proposal) { saveDecisionDraft(draftKey, ''); onClose(); return; }
    locked.current = true; setBusy(true); setError(null);
    try {
      if (proposal) {
        if (await decideFlow(proposal, value, value === 'other' ? feedback.trim() : undefined)) { saveDecisionDraft(draftKey, ''); onClose(); }
        else setError(t('flows.failedDecision'));
      } else if (value === 'other') {
        if (!app.get().chats[run.ownerOrchestratorId]) { setError(t('flows.recoveryOwnerMissing')); return; }
        const result = send(run.ownerOrchestratorId, flowRecoveryQuestion(run, definition, mode, stepId, feedback));
        if (result !== 'empty') { saveDecisionDraft(draftKey, ''); onClose(); }
      } else {
        const result = await controlFlowRun(snapshot.contextKey, mode === 'cancel' ? { runId: run.id, expectedRevision: run.revision } : {
          runId: run.id, expectedRevision: run.revision, mode, ...(mode === 'from-step' ? { stepId } : {}),
          acknowledgeEffects: true, targetVersion: preview!.version!.version, targetDigest: preview!.version!.digest, ...(preview?.automationRule ? { automationRule: preview.automationRule } : {}),
        });
        if (result.ok) { saveDecisionDraft(draftKey, ''); onDone?.(result.runId ?? run.id); onClose(); } else setError(result.error ?? t('flows.recoveryFailed'));
      }
    } finally { locked.current = false; setBusy(false); }
  };
  return <div className="flow-recovery" aria-busy={busy} data-testid="flow-recovery-content">
    <p className="wq-lead">{run.subjectKey} · v{version?.version ?? run.flowVersion} · {mode === 'cancel' ? t('flows.cancelHint') : t(mode === 'from-start' ? 'flows.restartActive' : 'flows.restartPinned')}</p>
    {mode === 'cancel' && proposal?.run.pendingCancellation?.reason && <p>{proposal.run.pendingCancellation.reason}</p>}
    {mode !== 'cancel' && <p>{t('flows.restartHint')}</p>}
    {mode === 'from-start' && definition?.steps[0] && <p><strong>{t('flows.recoveryStep')}: 1. {definition.steps[0].title}</strong></p>}
    {mode === 'from-step' && <div className="flow-recovery-picker"><label htmlFor={stepInputId}>{t('flows.recoveryStep')}</label><select id={stepInputId} value={stepId ?? ''} disabled={busy || !!proposal} onChange={event => setStepId(event.target.value)} data-testid="flow-recovery-step">{definition?.steps.map((step, index) => <option key={step.id} value={step.id}>{index + 1}. {step.title}</option>)}</select></div>}
    {reason && <p className="flow-block" role="status" data-testid="flow-recovery-blocker">{reason}</p>}
    {mode !== 'cancel' && preview && preview.prefix.length > 0 && <p>{t('flows.recoveryPrefix')}: {preview.prefix.map(step => step.title).join(' · ')}</p>}
    {rule && <details><summary>{t('flows.configuration')} · {rule.id} · r{rule.revision}</summary><FlowAutomationSummary config={rule.config} /></details>}
    {mode !== 'cancel' && preview && <details className="flow-recovery-effects" open={preview.effects.length > 0}><summary>{t('flows.recoveryEffects')} · {preview.effects.length}</summary>{preview.effects.length ? <ul>{preview.effects.map(step => <li key={step.id}>{step.title}</li>)}</ul> : <p>{t('flows.recoveryNoEffects')}</p>}</details>}
    {mode !== 'cancel' && definition && <details className="flow-recovery-definition"><summary>{t('flows.details')} · v{version!.version}</summary><FlowDefinition definition={definition} onNavigate={onClose} /></details>}
    <details className="flow-recovery-context"><summary>{t('flows.runContext')}</summary><dl className="flow-facts"><dt>{t('flows.scope')}</dt><dd>{[run.scope.project, run.scope.areaPath].filter(Boolean).join(' · ') || '—'}</dd><dt>{t('flows.inputs')}</dt><dd>{Object.keys(run.inputs).length ? <dl className="flow-facts">{Object.entries(run.inputs).map(([name, value]) => <div key={name} className="flow-input-pair"><dt>{name}</dt><dd>{value}</dd></div>)}</dl> : '—'}</dd></dl></details>
    {error && <p role="alert" className="flow-block">{error}</p>}
    <div className="wq-perm"><button type="button" className="btn btn-primary btn-l" disabled={busy || !!reason} onClick={() => void answer('yes')} data-testid="flow-recovery-yes">{t('flows.yes')}</button><button type="button" className="btn btn-ghost btn-l" disabled={busy} onClick={() => void answer('no')} data-testid="flow-recovery-no">{t('flows.no')}</button><button type="button" className="btn btn-ghost btn-l" disabled={busy} aria-expanded={changing} data-testid="flow-recovery-other" onClick={() => setChanging(value => !value)}>{t('flows.other')}</button></div>
    {changing && <div className="pa-change"><label className="wq-label" htmlFor={inputId}>{t('flows.answer')}</label><textarea id={inputId} rows={3} maxLength={2000} value={feedback} onChange={event => { setFeedback(event.target.value); saveDecisionDraft(draftKey, event.target.value); }} disabled={busy} autoFocus data-testid="flow-recovery-feedback" /><p className="flows-muted">{t('flows.recoveryOtherHint')}</p>{!owner && !proposal && <p className="flow-block">{t('flows.recoveryOwnerMissing')}</p>}<button type="button" className="btn btn-primary btn-m" disabled={busy || !feedback.trim() || !owner && !proposal} onClick={() => void answer('other')}>{t('flows.sendAnswer')}</button></div>}
  </div>;
}
export function FlowRecoveryDialog(props: { snapshot: FlowSnapshot; run: FlowRun; mode: FlowRecoveryMode; onClose: () => void; onDone: (id: string) => void }) {
  const title = t(props.mode === 'cancel' ? 'flows.cancelQuestion' : 'flows.restartQuestion');
  return <Modal isolateWorkspace onClose={props.onClose} label={title} title={title} className="flow-recovery-modal" closeButton backdropCloses={false} testid="flow-recovery-modal"><FlowRecoveryContent {...props} /></Modal>;
}
export function FlowRestartApproval({ ask, onEscape }: { ask: FlowRestartAsk | FlowCancelAsk; onEscape: () => void }) {
  const current = useFlows().snapshot;
  // Keep the proposal's original revision even when the live snapshot changes while this question is open.
  const [snapshot] = useState(() => current);
  if (!snapshot || !(ask.type === 'flow-cancel' ? ask.run.pendingCancellation : ask.run.pendingRecovery)) return <p role="status">{t('flows.recoveryStale')}</p>;
  return <FlowRecoveryQuestionFrame ask={ask} onEscape={onEscape}><div className="wq-kicker">{t('flows.title')} · v{ask.run.pendingRecovery?.targetVersion ?? ask.run.flowVersion}</div><h2 className="wq-q">{t(ask.type === 'flow-cancel' ? 'flows.cancelQuestion' : 'flows.restartQuestion')}</h2><FlowRecoveryContent snapshot={snapshot} run={ask.run} mode={ask.type === 'flow-cancel' ? 'cancel' : ask.run.pendingRecovery!.mode} proposal={ask} onClose={onEscape} /></FlowRecoveryQuestionFrame>;
}

/** The shared questions window focuses this frame; Escape postpones the exact request without deciding it. */
export function FlowRecoveryQuestionFrame({ ask, onEscape, children }: { ask: FlowRestartAsk | FlowCancelAsk; onEscape: () => void; children: ReactNode }) {
  return <div className="wq flow-review" tabIndex={0} role="group" aria-label={ask.title} data-testid={`qwin-${ask.type}`} data-request-key={`${ask.chatId}/${ask.id}`} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onEscape(); }
  }}>{children}</div>;
}
