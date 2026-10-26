// A dependency-free view of the real sequential step graph and explicit review relations, with an accessible inspector.
import { useId, useState } from 'react';
import type { FlowDefinition, FlowRun } from '@shared/flows';
import { t, locale } from '../i18n';
import { useApp } from '../store/store';
import { openChatRef } from '../actions';
import { FlowBrowserDetails, FlowLinks, FlowTestDbEvidence } from './FlowDefinition';
import { FlowStepAgent } from './FlowStepAgent';
export function FlowDiagram({ definition, run, onNavigate }: { definition: FlowDefinition; run?: FlowRun; onNavigate?: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const prefix = useId();
  const current = definition.steps[run?.currentStep ?? 0];
  const selected = definition.steps.find(step => step.id === picked) ?? current ?? definition.steps[0];
  const state = run?.steps.find(step => step.stepId === selected?.id);
  const chat = useApp(s => state?.chatId && s.chats[state.chatId] ? state.chatId : null);
  const height = Math.max(140, definition.steps.length * 112 + 24);
  return <section className="flow-diagram" aria-label={t('flows.diagram')} data-testid="flow-diagram">
    <div className="flow-canvas">
      <div className="flow-canvas-head"><span>{t('flows.diagram')}</span><span>{definition.steps.length} {t('flows.steps').toLocaleLowerCase(locale())}</span></div>
      <p className="flow-canvas-hint">{t('flows.diagramHint')}</p>
      <div className="flow-graph-scroll"><div className="flow-graph-track" style={{ height }}>
        <svg className="flow-edges" viewBox={`0 0 440 ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs><marker id={`${prefix}-arrow`} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 1 1 L 6 4 L 1 7" fill="none" stroke="currentColor" /></marker></defs>
          {definition.steps.slice(1).map((step, i) => <path key={step.id} data-edge="sequence" d={`M 220 ${i * 112 + 100} L 220 ${i * 112 + 132}`} markerEnd={`url(#${prefix}-arrow)`} />)}
          {definition.steps.map((step, i) => {
            const target = definition.steps.findIndex(other => other.id === step.reviewOf);
            return target < 0 ? null : <path key={`review-${step.id}`} data-edge="review" className="flow-review-edge" d={`M 380 ${i * 112 + 62} C 428 ${i * 112 + 62}, 428 ${target * 112 + 62}, 380 ${target * 112 + 62}`} markerEnd={`url(#${prefix}-arrow)`} />;
          })}
        </svg>
        <ol className="flow-graph-nodes" aria-label={t('flows.steps')}>
          {definition.steps.map((step, index) => {
            const recorded = run?.steps.find(s => s.stepId === step.id);
            const status = recorded?.status ?? 'pending';
            return <li key={step.id} style={{ top: index * 112 + 24 }}><button type="button" className="flow-node" data-testid="flow-node" data-status={status} data-current={!!run && run.currentStep === index && run.status !== 'completed' && run.status !== 'cancelled'} aria-pressed={selected?.id === step.id} aria-controls={`${prefix}-inspector`} onClick={() => setPicked(step.id)}>
              <span className="flow-node-index">{status === 'completed' ? '✓' : String(index + 1).padStart(2, '0')}</span>
              <span className="flow-node-content"><strong>{step.title}</strong><span>{t(`flows.${step.kind === 'approval' ? 'gate' : step.kind}`)}{recorded ? ` · ${t(`flows.${status}`)}` : ''}</span></span>
              <FlowStepAgent step={step} chatId={recorded?.chatId} compact />
              {status === 'running' && <span className="flow-node-live" aria-hidden="true" />}
            </button></li>;
          })}
        </ol>
      </div></div>
    </div>
    <aside className="flow-inspector" id={`${prefix}-inspector`} aria-label={t('flows.inspect')} data-testid="flow-inspector">
      {selected ? <><span className="flow-eyebrow">{t('flows.inspect')}</span><h3>{selected.title}</h3>
        <span className="flow-badge" data-status={state?.status}>{t(`flows.${state?.status ?? (selected.kind === 'approval' ? 'gate' : selected.kind)}`)}</span>
        <FlowStepAgent step={selected} chatId={state?.chatId} />
        <p>{selected.instructions}</p>
        {selected.testEnvironment && <p>{t('flows.testEnvironment')}: <strong>{selected.testEnvironment}</strong></p>}
        {selected.testDbRead && <p>{t('flows.testDbRead')}</p>}
        <FlowBrowserDetails step={selected} run={run} onNavigate={onNavigate} />
        {selected.adapter && <p><code>{selected.adapter}</code></p>}
        {selected.reviewOf && <p className="flow-review-relation">{t('flows.reviewOf')}: <strong>{definition.steps.find(step => step.id === selected.reviewOf)?.title ?? selected.reviewOf}</strong></p>}
        {state?.reason && <p className="flow-block" role="status">{state.reason}</p>}
        {chat && <button type="button" className="btn btn-ghost btn-s" onClick={() => { onNavigate?.(); openChatRef(chat); }} data-testid="flow-open-agent">{t('flows.openAgent')}</button>}
        <details><summary>{t('flows.evidence')}</summary>{selected.evidence.length ? <ul>{selected.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul> : <p className="flows-muted">{t('flows.noEvidence')}</p>}<FlowLinks onNavigate={onNavigate} sources={[selected.instructions, ...selected.evidence]} /></details>
        <FlowTestDbEvidence run={run} stepId={selected.id} />
        {state?.receipt && <details className="flow-report"><summary>{t('flows.history')}</summary><time>{new Date(state.receipt.at).toLocaleString(locale())}</time><p>{state.receipt.summary}</p>{state.receipt.evidence.map((e, i) => <p key={i}>{e}</p>)}<FlowLinks onNavigate={onNavigate} sources={[state.receipt.summary, ...state.receipt.evidence]} chatId={state.receipt.chatId} /></details>}
      </> : <p>{t('flows.noInspector')}</p>}
    </aside>
  </section>;
}
