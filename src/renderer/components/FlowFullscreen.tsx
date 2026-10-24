// Full-window flow inspection uses the shared accessible modal and the same immutable definition/run as the catalog.
import type { FlowDefinition as Definition, FlowRun } from '@shared/flows';
import { FlowDefinition } from './FlowDefinition';
import { FlowDiagram } from './FlowDiagram';
import { Modal } from './ui';
import { t } from '../i18n';

export function FlowFullscreenContent({ definition, run, onNavigate }: { definition: Definition; run?: FlowRun; onNavigate?: () => void }) {
  return <div className="flow-fullscreen-content">
    {run && <div className="flow-run-focus" data-testid="flow-fullscreen-run"><div className="flow-card-head"><strong>{run.subjectKey}</strong><span className="flow-version">v{run.flowVersion}</span><span className="flow-badge" data-status={run.status}>{t(`flows.${run.status}`)}</span></div><p className="flows-muted">{[run.scope.project, run.scope.areaPath].filter(Boolean).join(' · ')}</p></div>}
    <section className="flow-fullscreen-steps" aria-label={t('flows.steps')} data-testid="flow-fullscreen-steps">
      <h2>{t('flows.steps')} · {definition.steps.length}</h2>
      <FlowDefinition definition={definition} run={run} onNavigate={onNavigate} />
    </section>
    <details className="flow-fullscreen-diagram"><summary>{t('flows.diagram')}</summary><FlowDiagram definition={definition} run={run} onNavigate={onNavigate} /></details>
  </div>;
}
export function FlowFullscreen({ definition, version, run, onClose }: { definition: Definition; version?: number; run?: FlowRun; onClose: () => void }) {
  return <Modal isolateWorkspace onClose={onClose} label={t('flows.fullscreen')} className="flow-fullscreen" testid="flow-fullscreen" title={definition.title} subtitle={`${version ? `v${version} · ` : ''}${definition.description}`} closeButton backdropCloses={false}
    aside={<button type="button" className="btn btn-ghost btn-s" data-autofocus onClick={onClose} data-testid="flow-fullscreen-exit">{t('flows.exitFullscreen')} · Esc</button>}>
    <FlowFullscreenContent definition={definition} run={run} onNavigate={onClose} />
  </Modal>;
}
