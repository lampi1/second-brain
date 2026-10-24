// Automatic mode is part of each flow version; only explicit user actions pause/resume exact approved revisions.
import { useRef, useState } from 'react';
import type { FlowSnapshot, FlowVersion } from '@shared/flows';
import type { FlowAutomationControl, FlowAutomationPause } from '@shared/flow-automation';
import { flowAsks } from '../lib/flow-ask';
import { openQueue } from '../lib/later';
import { controlFlowAutomation } from '../store/flows';
import { useApp } from '../store/store';
import { t, locale } from '../i18n';
import { FlowAutomationSummary } from './FlowAutomationSummary';
function useControl(contextKey: string) {
  const [busy, setBusy] = useState(false), locked = useRef(false);
  return { busy, apply: async (control: FlowAutomationControl | FlowAutomationPause) => {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try { await controlFlowAutomation(contextKey, control); } finally { locked.current = false; setBusy(false); }
  } };
}
export function FlowAutomationControls({ snapshot }: { snapshot: FlowSnapshot }) {
  const { busy, apply } = useControl(snapshot.contextKey), auto = snapshot.automation;
  if (!auto) return null;
  return <details className="flow-auto-controls" data-testid="flow-auto-controls"><summary>{t('flows.autoSettings')}{auto.paused ? ` · ${t('flows.paused')}` : ''}</summary>
    {auto.storageError && <p className="flow-block" role="alert">{auto.storageError}</p>}
    {auto.paused && <p className="flows-muted">{t('flows.globalPaused')}</p>}
    <button type="button" className="btn btn-ghost btn-s" disabled={busy || !!auto.storageError} onClick={() => void apply({ expectedRevision: auto.revision, paused: !auto.paused })}>{t(auto.paused ? 'flows.resumeAll' : 'flows.pauseAll')}</button>
    <label className="flow-background"><input type="checkbox" checked={auto.background} disabled={busy || !!auto.storageError} onChange={e => void apply({ expectedRevision: auto.revision, background: e.target.checked })} />{t('flows.background')}</label>
    <p className="flows-muted">{t('flows.backgroundHint')}</p>
  </details>;
}
export function FlowAutomation({ version, snapshot }: { version: FlowVersion; snapshot: FlowSnapshot }) {
  const { busy, apply } = useControl(snapshot.contextKey);
  const chats = useApp(state => state.chats);
  const auto = snapshot.automation;
  const rules = auto?.rules.filter(rule => rule.config.flowId === version.definition.id && rule.config.flowVersion === version.version) ?? [];
  if (!rules.length) return <p className="flows-muted flow-mode-label">{t('flows.versionMode')}: <strong>{t('flows.manual')}</strong> · v{version.version}</p>;
  return <section className="flow-automation" data-testid="flow-automation" aria-label={t('flows.automatic')}>
    {rules.map(rule => {
      const ask = flowAsks(snapshot).find(a => a.type === 'flow-automation' && a.rule.id === rule.id && a.rule.revision === rule.revision);
      const events = auto!.events.filter(event => event.ruleId === rule.id).sort((a, b) => b.updatedAt - a.updatedAt);
      const resumable = rule.status === 'paused' && rule.approvedRevision === rule.revision;
      return <div key={rule.id} className="flow-auto-rule" data-testid="flow-auto-rule">
        <div className="flow-card-head"><strong>{t('flows.automatic')}</strong><span className="flow-version">v{rule.config.flowVersion} · r{rule.revision}</span><span className="flow-badge" data-status={rule.status}>{t(`flows.${rule.status}`)}</span>
          {ask && <button type="button" className="btn btn-amber btn-s" onClick={() => openQueue(`${ask.chatId}/${ask.id}`)}>{t('flows.reviewOpen')}</button>}
          {(rule.status === 'enabled' || resumable) && <button type="button" className="btn btn-ghost btn-s" disabled={busy || !!auto?.storageError} onClick={() => void apply({ id: rule.id, expectedRevision: rule.revision, paused: rule.status === 'enabled' })}>{t(resumable ? 'flows.resume' : 'flows.pause')}</button>}
        </div>
        <p className="flows-muted">{t('flows.runOwner')}: {chats[rule.ownerOrchestratorId]?.title || rule.ownerOrchestratorId}</p>
        <dl className="flow-auto-timing"><div><dt>{t('flows.nextCheck')}</dt><dd>{rule.status === 'enabled' && !auto!.paused && rule.nextCheckAt ? new Date(rule.nextCheckAt).toLocaleString(locale()) : t('flows.notScheduled')}</dd></div><div><dt>{t('flows.lastCheck')}</dt><dd>{rule.lastCheckAt ? new Date(rule.lastCheckAt).toLocaleString(locale()) : t('flows.noChecks')}</dd></div></dl>
        {rule.lastResult && <p className="flows-muted">{t('flows.lastResult')}: {rule.lastResult}</p>}
        {rule.error && <p className="flow-block" role="alert">{rule.error}</p>}
        {rule.feedback && <p className="flows-muted">{rule.feedback}</p>}
        <details><summary>{t(rule.status === 'enabled' || resumable ? 'flows.configuration' : 'flows.details')}</summary><FlowAutomationSummary config={rule.config} /></details>
        <details className="flow-event-queue"><summary>{t('flows.events')} · {events.length}{events.some(event => event.status === 'pending' || event.status === 'notified') ? ` · ${events.filter(event => event.status === 'pending' || event.status === 'notified').length} ${t('flows.pending')}` : ''}{events.some(event => event.status === 'blocked') ? ` · ${events.filter(event => event.status === 'blocked').length} ${t('flows.blocked')}` : ''}</summary>
          {events.length ? <ul>{events.map(event => <li key={event.id}><div><strong>{event.title}</strong><span className="flow-version">r{event.ruleRevision}</span><span className="flow-badge" data-status={event.status}>{t(event.status === 'pending' ? 'flows.queuedState' : `flows.${event.status}`)}</span></div>{event.reason ? <p>{event.reason}</p> : (event.status === 'pending' || event.status === 'notified' || event.status === 'blocked') && <p>{t(event.status === 'pending' ? 'flows.queueWaiting' : 'flows.queueDecision')}</p>}</li>)}</ul> : <p className="flows-muted">{t('flows.noEvents')}</p>}
        </details>
      </div>;
    })}
  </section>;
}
