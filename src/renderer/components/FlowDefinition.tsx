// Complete flow definitions and host-recorded receipts shared by the catalog and QuestionsWindow; read only, except the
// catalog's step tier menu (`edit`), which only proposes a new revision.
import type { FlowDefinition as Definition, FlowRun } from '@shared/flows';
import { openChatRef } from '../actions';
import { t, locale } from '../i18n';
import { linksIn } from '../lib/askContext';
import { openFile } from './GenUi';
import { FlowStepAgent, type FlowStepTierControl } from './FlowStepAgent';
export function FlowLinks({ sources, chatId, onNavigate }: { sources: string[]; chatId?: string; onNavigate?: () => void }) {
  const links = linksIn(sources);
  return links.length ? <div className="ctx-links">{links.map(link => link.kind === 'file'
    ? <button key={link.href} type="button" className="ctx-link file" onClick={() => { onNavigate?.(); void openFile(link.href, chatId); }}>{link.label}</button>
    : <a key={link.href} className="ctx-link" href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>)}</div> : null;
}
export function FlowTestDbEvidence({ run, stepId }: { run?: FlowRun; stepId: string }) {
  const entries = run?.testDbEvidence?.filter(entry => entry.stepId === stepId) ?? [];
  return entries.length ? <details className="flow-report" data-testid="flow-test-db-evidence"><summary>{t('flows.testDbEvidence')} · {entries.length}</summary>
    {entries.map(entry => <details key={entry.id}><summary>{entry.targetId} · {entry.database} · {t(`flows.testDbStatus.${entry.status}`)} · {new Date(entry.at).toLocaleString(locale())}</summary>
      <p>{t('flows.testDbHash')}: <code>{entry.queryHash}</code></p>
      <p>{t('flows.testDbRun')}: <code>{entry.runId}</code></p>
      {entry.rowCount !== undefined && <p>{t('flows.testDbRows')}: {entry.rowCount}{entry.truncated ? ` · ${t('flows.testDbTruncated')}` : ''}</p>}
      <p className="flows-muted">{entry.id}</p>
    </details>)}
  </details> : null;
}
export function FlowDefinition({ definition, run, edit, onNavigate }: { definition: Definition; run?: FlowRun; edit?: FlowStepTierControl; onNavigate?: () => void }) {
  return <div className="flow-definition">
    {run?.dossierPath && <button type="button" className="ctx-link file" data-testid="flow-dossier" onClick={() => { onNavigate?.(); void openFile(run.dossierPath!); }}>{t('flows.dossier')}</button>}
    {run?.settlementError && <p className="flow-block" role="status">{run.settlementError}</p>}
    {run?.disposition && <p className="flow-block">{t(run.disposition.kind === 'skipped' ? 'flows.skipped' : run.disposition.lesson === false ? 'flows.needsHuman' : 'flows.packageDowngrade')}: {run.disposition.reason}<br />{run.disposition.cleanup} · {run.disposition.error ?? ''}</p>}
    {!!run?.trace?.length && <details className="flow-report"><summary>{t('flows.timeline')} · {run.trace.length}</summary>{run.trace.map(e => <p key={e.id}>{new Date(e.at).toLocaleString(locale())} · {e.stepId ?? e.kind} · {e.message}</p>)}</details>}
    {!!run?.history?.some(h => h.status === 'pending') && <p className="flow-block">{t('flows.historyPending')}: {run.history.find(h => h.status === 'pending')?.reason ?? '…'}</p>}
    <dl className="flow-facts">
      <dt>{t('flows.scope')}</dt><dd>{[definition.scope.project, definition.scope.areaPath].filter(Boolean).join(' · ') || '—'}</dd>
      {definition.aliases.length > 0 && <><dt>{t('flows.triggers')}</dt><dd>{definition.aliases.join(' · ')}</dd></>}
    </dl>
    {definition.package ? <details className="flow-report" data-testid="flow-package"><summary>{t('flows.package')} · {definition.package.assets.length} {t('flows.assets')}</summary>
      <p>{t('flows.packageScope')}</p><p>{t('flows.requiredOps')}: {definition.package.requiredOps.join(' · ') || '—'}</p>
      {!!definition.package.production?.length && <details data-testid="flow-production-intents"><summary>{t('flows.productionPrepared')}</summary><p>{t('flows.productionDisabled')}</p>{definition.package.production.map(intent => <p key={intent.id}><strong>{intent.id}</strong> · {intent.operation} · {intent.targetId}<br />{intent.recipeAssetId} · {intent.timeoutMs} ms<br />{intent.maxRows !== undefined && <>{t('flows.maxReadRows')}: {intent.maxRows}<br /></>}{intent.maxAffectedRows !== undefined && <>{t('flows.maxAffectedRows')}: {intent.maxAffectedRows}<br /></>}{t('flows.rollbackAsset')}: {intent.rollbackAssetId ?? '—'}<br /><code>{intent.recipeSha256}</code></p>)}</details>}
      {definition.package.history && <p>{t('flows.packageHistory')}</p>}
      {definition.package.downgrade && <p>{t('flows.packageDowngrade')}: <code>{JSON.stringify(definition.package.downgrade)}</code></p>}
      {definition.package.outputs.map(output => <p key={output.id}><strong>{output.id}</strong> · {output.kind}: {output.description}<br />{output.brainPath ?? t('flows.runArtifact')}</p>)}
      {definition.package.assets.map(asset => <details key={asset.id}><summary>{asset.id} · {asset.kind}</summary><p><code>{asset.sha256}</code></p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{asset.content}</pre></details>)}
    </details> : <p className="flows-muted" data-testid="flow-package-legacy">{t('flows.packageLegacy')}</p>}
    <ol className="flow-steps" aria-label={t('flows.steps')}>
      {definition.steps.map((step, index) => {
        const state = run?.steps.find(s => s.stepId === step.id);
        return <li key={step.id} className="flow-step" data-current={run?.currentStep === index}>
          <span className="flow-step-n">{index + 1}</span><div>
            <div className="flow-step-title"><strong>{step.title}</strong><span className="flow-badge">{t(`flows.${step.kind === 'approval' ? 'gate' : step.kind}`)}</span>{state && <span className="flow-badge" data-status={state.status}>{t(`flows.${state.status}`)}</span>}</div>
            {state?.chatId && <button type="button" className="btn btn-ghost btn-s" data-testid="flow-step-open-agent" onClick={() => { onNavigate?.(); openChatRef(state.chatId!); }}>{t('flows.openAgent')}</button>}
            <FlowStepAgent step={step} chatId={state?.chatId} edit={edit} />
            <p style={{ whiteSpace: 'pre-wrap' }}>{step.instructions}</p>
            {step.agentPrompt && <details className="flow-report"><summary>{t('flows.frozenPrompt')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{step.agentPrompt}</pre></details>}
            {!!step.assets?.length && <p>{t('flows.assets')}: {step.assets.join(' · ')}</p>}
            {step.testEnvironment && <p>{t('flows.testEnvironment')}: <strong>{step.testEnvironment}</strong></p>}
            {step.testDbRead && <p>{t('flows.testDbRead')}</p>}
            {step.adapter && <p><code>{step.adapter}</code></p>}
            {step.action && <p><code>{step.action.kind}: {step.action.ref}</code></p>}
            <details><summary>{t('flows.constraints')}</summary><dl className="flow-facts"><dt>{t('flows.inputs')}</dt><dd>{step.inputs.join(' · ') || '—'}</dd>{step.workspaceInput && <><dt>{t('flows.workspaceInput')}</dt><dd>{step.workspaceInput}</dd></>}<dt>{t('flows.effect')}</dt><dd>{step.effect}</dd><dt>{t('flows.timeout')}</dt><dd>{step.timeoutMs} ms</dd><dt>{t('flows.attempts')}</dt><dd>{state ? `${state.attempts} / ` : ''}{step.maxAttempts}</dd>{step.reviewOf && <><dt>{t('flows.reviewOf')}</dt><dd>{step.reviewOf}</dd></>}</dl></details>
            {state?.reason && <p className="flow-block" role="status">{state.reason}</p>}
            {step.evidence.length > 0 && <><p><strong>{t('flows.evidence')}</strong></p><ul>{step.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></>}
            <FlowLinks onNavigate={onNavigate} sources={[step.instructions, ...step.evidence]} />
            <FlowTestDbEvidence run={run} stepId={step.id} />
            {state?.receipt && <details className="flow-report"><summary>{t('flows.history')} · {new Date(state.receipt.at).toLocaleString(locale())}</summary><p>{state.receipt.summary}</p><FlowLinks onNavigate={onNavigate} sources={[state.receipt.summary, ...state.receipt.evidence]} chatId={state.receipt.chatId} />{state.receipt.evidence.map((e, i) => <p key={i}>{e}</p>)}</details>}
          </div>
        </li>;
      })}
    </ol>
  </div>;
}
