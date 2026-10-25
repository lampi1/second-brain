// Full-window flow inspection uses the shared accessible modal and the same immutable definition/run as the catalog.
import type { FlowDefinition as Definition, FlowRun } from '@shared/flows';
import type { ReactNode } from 'react';
import { FlowDefinition } from './FlowDefinition';
import { FlowDiagram } from './FlowDiagram';
import { Modal } from './ui';
import { t } from '../i18n';

/** Familiar four-corner control, with the same accessible name on entry and exit. */
export function FlowFullscreenButton({ expanded = false, onClick }: { expanded?: boolean; onClick: () => void }) {
  const label = t(expanded ? 'flows.exitFullscreen' : 'flows.fullscreen');
  return <button type="button" className="icon-btn flow-fullscreen-toggle" aria-label={label} title={label} data-tip={`${label}${expanded ? '|Esc' : ''}`} onClick={onClick} data-autofocus={expanded || undefined} data-testid={expanded ? 'flow-fullscreen-exit' : 'flow-fullscreen-open'}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={expanded ? 'M3 9h6V3M15 3v6h6M21 15h-6v6M9 21v-6H3' : 'M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6'} /></svg>
  </button>;
}
export function FlowFullscreenContent({ definition, run, onNavigate, controls }: { definition: Definition; run?: FlowRun; onNavigate?: () => void; controls?: ReactNode }) {
  return <div className="flow-fullscreen-content">
    <p className="flow-fullscreen-description">{definition.description}</p>
    {run && <div className="flow-run-focus" data-testid="flow-fullscreen-run"><div className="flow-card-head"><strong>{run.subjectKey}</strong><span className="flow-version">v{run.flowVersion}</span><span className="flow-badge" data-status={run.status}>{t(run.disposition?.kind === 'skipped' ? 'flows.skipped' : run.disposition?.kind === 'needs-human' ? 'flows.needsHuman' : run.cancellation?.interruption === 'pending' ? 'flows.interruptionPending' : `flows.${run.status}`)}</span></div><p className="flows-muted">{[run.scope.project, run.scope.areaPath].filter(Boolean).join(' · ')}</p></div>}
    {controls}
    <section className="flow-fullscreen-steps" aria-label={t('flows.steps')} data-testid="flow-fullscreen-steps">
      <h2>{t('flows.steps')} · {definition.steps.length}</h2>
      <FlowDefinition definition={definition} run={run} onNavigate={onNavigate} />
    </section>
    <details className="flow-fullscreen-diagram"><summary>{t('flows.diagram')}</summary><FlowDiagram definition={definition} run={run} onNavigate={onNavigate} /></details>
  </div>;
}
export function FlowFullscreen({ definition, version, run, onClose, controls }: { definition: Definition; version?: number; run?: FlowRun; onClose: () => void; controls?: ReactNode }) {
  return <Modal isolateWorkspace onClose={onClose} label={t('flows.fullscreen')} className="flow-fullscreen" testid="flow-fullscreen" title={definition.title} subtitle={`${version ? `v${version} · ` : ''}${definition.steps.length} ${t('flows.steps').toLocaleLowerCase()}`} closeButton={false} backdropCloses={false}
    aside={<FlowFullscreenButton expanded onClick={onClose} />}>
    <FlowFullscreenContent definition={definition} run={run} onNavigate={onClose} controls={controls} />
  </Modal>;
}
