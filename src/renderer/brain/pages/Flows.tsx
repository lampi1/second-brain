// Flussi is a read-only catalog and run viewer. Creation, revision and execution always begin in the existing Orchestrator.
import { useMemo, useState } from 'react';
import type { FlowDraft, FlowRun, FlowSnapshot, FlowVersion } from '@shared/flows';
import { flowAsks } from '../../lib/flow-ask';
import { flowRequest, type FlowRequestKind } from '../../lib/flow-request';
import { orchestratorIdOf } from '../../lib/orchestrator-route';
import { openQueue } from '../../lib/later';
import { reloadFlows, useFlows } from '../../store/flows';
import { app, send, useApp } from '../../store/store';
import { toast } from '../../store/ui';
import { focusChat, openChatRef } from '../../actions';
import { FlowDefinition } from '../../components/FlowDefinition';
import { IconBranch } from '../../components/Icons';
import { t } from '../../i18n';
import '../../styles/flows.css';

function askOrchestrator(kind: FlowRequestKind, version?: FlowVersion, draft?: FlowDraft) {
  const id = orchestratorIdOf(app.get());
  if (!id) { toast(t('flows.noOrchestrator'), 'warn'); return; }
  const definition = draft?.definition ?? version?.definition;
  const result = send(id, flowRequest(kind, definition ? { id: definition.id, name: definition.title, version: version?.version } : undefined));
  if (result === 'empty') return;
  focusChat(id);
  toast(t(result === 'queued' ? 'flows.queued' : 'flows.sent'), 'info');
}
function DefinitionCard({ version, draft, snapshot, ready }: { version?: FlowVersion; draft?: FlowDraft; snapshot: FlowSnapshot; ready: boolean }) {
  const definition = draft?.definition ?? version!.definition;
  const proposed = draft?.status === 'proposed';
  const status = proposed ? 'review' : draft && draft.status !== 'active' ? 'draft' : snapshot.active[definition.id] === version?.version ? 'active' : 'disabled';
  const ask = proposed ? flowAsks(snapshot).find(a => a.type === 'flow-definition' && a.draft === draft) : undefined;
  return <article className="flow-card" data-testid="flow-definition" data-state={status}>
    <div className="flow-card-head"><h3>{definition.title}</h3><span className="flow-version">{draft && draft.status !== 'active' ? `r${draft.revision}` : `v${version?.version ?? '—'}`}</span><span className="flow-badge" data-status={status}>{t(`flows.${status}`)}</span></div>
    {definition.description && <p>{definition.description}</p>}
    <details><summary>{t('flows.details')} · {definition.steps.length}</summary><FlowDefinition definition={definition} /></details>
    {draft && draft.status !== 'active' && version && <details><summary>{t('flows.approvedVersion')} · v{version.version}{snapshot.active[definition.id] === version.version ? ` · ${t('flows.active')}` : ''}</summary><p>{version.definition.description}</p><FlowDefinition definition={version.definition} /></details>}
    <div className="flow-actions">
    {ask && <button type="button" className="btn btn-amber btn-s" onClick={() => openQueue(`${ask.chatId}/${ask.id}`)}>{t('flows.reviewOpen')}</button>}
      <button type="button" className="btn btn-ghost btn-s" disabled={!ready} onClick={() => askOrchestrator('refine', version, draft)}>{t('flows.refine')}</button>
      {version && snapshot.active[definition.id] === version.version && <button type="button" className="btn btn-ghost btn-s" disabled={!ready} onClick={() => askOrchestrator('start', version)}>{t('flows.start')}</button>}
    </div>
  </article>;
}
function RunCard({ run, snapshot }: { run: FlowRun; snapshot: FlowSnapshot }) {
  const version = snapshot.versions.find(v => v.definition.id === run.flowId && v.version === run.flowVersion && v.digest === run.definitionDigest);
  const current = run.steps[run.currentStep];
  const boundChat = useApp(s => current?.chatId && s.chats[current.chatId] ? current.chatId : null);
  const ask = flowAsks(snapshot).find(a => a.type === 'flow-run' && a.run.id === run.id);
  return <article className="flow-card" data-testid="flow-run">
    <div className="flow-card-head"><h3>{version?.definition.title ?? run.flowId}</h3><span className="flow-version">v{run.flowVersion}</span><span className="flow-badge" data-status={run.status}>{t(`flows.${run.status}`)}</span></div>
    <p className="flows-muted">{run.subjectKey} · {[run.scope.project, run.scope.areaPath].filter(Boolean).join(' · ')}</p>
    {current && <p className="flow-current">{t('flows.current')}: <strong>{version?.definition.steps[run.currentStep]?.title ?? current.stepId}</strong></p>}
    {current?.reason && <p className="flow-block" role="status">{current.reason}</p>}
    {boundChat && <button type="button" className="btn btn-ghost btn-s" onClick={() => openChatRef(boundChat)} data-testid="flow-open-agent">{t('flows.openAgent')}</button>}
    {ask && <button type="button" className="btn btn-amber btn-s" onClick={() => openQueue(`${ask.chatId}/${ask.id}`)}>{t('flows.reviewOpen')}</button>}
    {version && <details><summary>{t('flows.history')}</summary><FlowDefinition definition={version.definition} run={run} /></details>}
  </article>;
}
export function Flows() {
  const { snapshot, error, loading } = useFlows();
  const ready = useApp(s => !!orchestratorIdOf(s));
  const [category, setCategory] = useState<string | null>(null);
  const rows = useMemo(() => {
    if (!snapshot) return [];
    const ids = [...new Set([...snapshot.drafts.map(d => d.definition.id), ...snapshot.versions.map(v => v.definition.id)])];
    return ids.map(id => {
      const versions = snapshot.versions.filter(v => v.definition.id === id);
      const version = versions.find(v => v.version === snapshot.active[id]) ?? versions.sort((a, b) => b.version - a.version)[0];
      const draft = snapshot.drafts.find(d => d.definition.id === id);
      return { id, version, draft, definition: draft?.definition ?? version!.definition };
    });
  }, [snapshot]);
  const categories = [...new Set(rows.map(row => row.definition.category).filter((value): value is string => !!value))];
  const selected = category && categories.includes(category) ? category : null;
  return <section className="flows-page" data-testid="flows-page">
    <header className="flows-head"><div><h1>{t('flows.title')}</h1><p>{t('flows.intro')}</p></div>{rows.length > 0 && <button type="button" className="btn btn-primary btn-m" disabled={!ready} onClick={() => askOrchestrator('create')}>{t('flows.ask')}</button>}</header>
    {error && <div className="flow-block" role="alert"><strong>{t('flows.unavailable')}</strong><p>{error}</p><button type="button" className="btn btn-ghost btn-s" onClick={() => void reloadFlows()}>{t('flows.retry')}</button></div>}
    {loading && !snapshot && <p role="status" className="flows-muted">{t('flows.loading')}</p>}
    {!loading && !error && rows.length === 0 && <div className="flows-empty" data-testid="flows-empty"><IconBranch size={28} /><h2>{t('flows.empty')}</h2><p>{t('flows.emptyHint')}</p><button type="button" className="btn btn-primary btn-m" disabled={!ready} onClick={() => askOrchestrator('create')}>{t('flows.ask')}</button><span className="flows-muted">{t(ready ? 'flows.readOnly' : 'flows.noOrchestrator')}</span></div>}
    {snapshot && rows.length > 0 && <><div className="flows-section-head"><h2>{t('flows.definitions')}</h2><span className="flows-count">{rows.length}</span></div>
      {categories.length > 0 && <div className="flows-tabs" aria-label={t('flows.definitions')}><button type="button" className="btn btn-ghost btn-s" aria-pressed={!selected} onClick={() => setCategory(null)}>{t('flows.all')}</button>{categories.map(value => <button key={value} type="button" className="btn btn-ghost btn-s" aria-pressed={selected === value} onClick={() => setCategory(value)}>{value}</button>)}</div>}
      <div className="flows-list">{rows.filter(row => !selected || row.definition.category === selected).map(row => <DefinitionCard key={row.id} version={row.version} draft={row.draft} snapshot={snapshot} ready={ready} />)}</div></>}
    {snapshot && (rows.length > 0 || snapshot.runs.length > 0) && <><div className="flows-section-head"><h2>{t('flows.runs')}</h2><span className="flows-count">{snapshot.runs.length}</span></div><div className="flows-list">{snapshot.runs.length ? [...snapshot.runs].sort((a, b) => b.updatedAt - a.updatedAt).map(run => <RunCard key={run.id} run={run} snapshot={snapshot} />) : <p className="flows-muted">{t('flows.noRuns')}</p>}</div></>}
  </section>;
}
