// Visible capability plan and exact connector recipes, shared by routine activation and the step inspectors.
import type { FlowDefinition, FlowRun, FlowStep } from '@shared/flows';
import { executionChecks } from '@shared/flow-execution';
import { t } from '../i18n';
export function FlowExecutionSummary({ definition }: { definition: FlowDefinition }) {
  const checks = executionChecks(definition), unsupported = checks.filter(c => c.state === 'unsupported');
  return <div data-testid="flow-execution-plan">
    <p className={unsupported.length ? 'flow-block' : 'flows-muted'}>{t(unsupported.length ? 'flows.executionBlocked' : 'flows.executionPlan')}</p>
    {definition.steps.filter(s => s.mentionReason === 'analysis').map(s => <p className="flow-target" key={s.id}><strong>{s.title}</strong> · {t('flows.analysisMention')}</p>)}
    <details><summary>{t('flows.executionDetails')} · {checks.length}</summary>
      {checks.map(c => <p key={c.stepId}><strong>{definition.steps.find(s => s.id === c.stepId)?.title}</strong> · {t(`flows.execution.${c.capability}`)}<br />{t(`flows.executionState.${c.state}`)}</p>)}
    </details>
  </div>;
}
export function FlowConnectorDetails({ step, run }: { step: FlowStep; run?: FlowRun }) {
  const c = step.connector;
  if (!c) return null;
  return <div className="flow-target" data-testid="flow-connector-target">
    <p><strong>{c.serverId} / {c.tool}</strong> · {t(step.effect === 'read-only' ? 'flows.connectorRead' : 'flows.connectorWrite')}</p>
    <p className="flows-muted">{t('flows.connectorScope')} · {c.role}</p>
    <details><summary>{t('flows.connectorExact')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(c.arguments, null, 2)}</pre><p>Server: <code>{c.serverHash}</code><br />Tool: <code>{c.toolHash}</code></p></details>
    {run?.connectorReceipts?.filter(r => r.stepId === step.id).map(r => <div key={r.id} data-testid="flow-connector-result"><strong>{t(`flows.connectorOutcome.${r.outcome}`)}</strong><p>{r.summary}</p>{r.outcome === 'unknown' && <p className="flow-block">{t('flows.browserRetryWarning')}</p>}</div>)}
  </div>;
}
