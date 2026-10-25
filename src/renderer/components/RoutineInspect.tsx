// Reachable immutable routine/run inspector, including exact grants and a dossier-based Orchestrator handoff.
import { useState } from 'react';
import type { FlowDefinition, FlowRun, FlowSnapshot } from '@shared/flows';
import { FlowFullscreen, FlowFullscreenButton } from './FlowFullscreen';
import { FlowAutomationSummary } from './FlowAutomationSummary';
import { app, send } from '../store/store';
import { orchestratorIdOf } from '../lib/orchestrator-route';
import { focusChat } from '../actions';
import { toast } from '../store/ui';
import { t } from '../i18n';
export function RoutineInspect({ snapshot, definition, version, run }: { snapshot: FlowSnapshot; definition?: FlowDefinition; version?: number; run?: FlowRun }) {
  const [open, setOpen] = useState(false);
  if (!definition) return null;
  const config = run?.approval?.config ?? (!run ? snapshot.automation?.rules.find(r => r.config.flowId === definition.id && r.config.flowVersion === version)?.config : undefined);
  const discuss = () => {
    const state = app.get(), owner = run?.ownerOrchestratorId;
    const id = owner && state.chats[owner]?.isOrchestrator ? owner : orchestratorIdOf(state);
    if (!id || !run) { toast(t('flows.noOrchestrator'), 'warn'); return; }
    const result = send(id, `Read app_flow_dossier for run ${run.id}, section full. Explain its observed outcome, retries, evidence, grant usage and unresolved effects. Separate facts from hypotheses. Propose concrete improvements as a new routine version through native yes/no/free-text questions; never alter the approved version or grants silently.`);
    if (result !== 'empty') { setOpen(false); focusChat(id); toast(t(result === 'queued' ? 'flows.queued' : 'flows.sent'), 'info'); }
  };
  return <span className="rt-inspect" onClick={event => event.stopPropagation()}>
    <FlowFullscreenButton onClick={() => setOpen(true)} />
    {run && <button type="button" className="btn btn-ghost btn-s" data-testid="flow-discuss-run" onClick={discuss}>{t('flows.discussRun')}</button>}
    {open && <FlowFullscreen definition={definition} version={run?.flowVersion ?? version} run={run} onClose={() => setOpen(false)} controls={<>
      {run && <button type="button" className="btn btn-ghost btn-s" onClick={discuss}>{t('flows.discussRun')}</button>}
      {config && <details className="flow-report" data-testid="flow-inspect-grants"><summary>{t('flows.requiredOps')}</summary><FlowAutomationSummary config={config} /></details>}
    </>} />}
  </span>;
}
