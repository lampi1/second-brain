// One focused catalog for manual and automatic flows. All creation/configuration/start requests go through the Orchestrator.
import { useMemo, useState } from 'react';
import type { FlowDraft, FlowSnapshot, FlowVersion } from '@shared/flows';
import type { ModelTier } from '@shared/roles';
import { flowAsks } from '../../lib/flow-ask';
import { flowRequest, type FlowRequestKind } from '../../lib/flow-request';
import { orchestratorIdOf } from '../../lib/orchestrator-route';
import { openQueue } from '../../lib/later';
import { editFlowStepTier, exportFlowDefinition, reloadFlows, useFlows } from '../../store/flows';
import { app, send, useApp } from '../../store/store';
import { toast } from '../../store/ui';
import { focusChat } from '../../actions';
import { FlowDefinition } from '../../components/FlowDefinition';
import { FlowDiagram } from '../../components/FlowDiagram';
import { FlowFullscreen } from '../../components/FlowFullscreen';
import { FlowImport } from '../../components/FlowImport';
import { FlowAutomation, FlowAutomationControls } from '../../components/FlowAutomation';
import { IconBranch } from '../../components/Icons';
import { t, locale } from '../../i18n';
import '../../styles/flows.css';
function askOrchestrator(kind: FlowRequestKind, version?: FlowVersion, draft?: FlowDraft) {
  const id = orchestratorIdOf(app.get());
  if (!id) { toast(t('flows.noOrchestrator'), 'warn'); return; }
  const definition = draft?.definition ?? version?.definition;
  const result = send(id, flowRequest(kind, definition ? { id: definition.id, name: definition.title, version: version?.version } : undefined));
  if (result === 'empty') return;
  focusChat(id); toast(t(result === 'queued' ? 'flows.queued' : 'flows.sent'), 'info');
}
function FlowDetail({ version: preferredVersion, draft, snapshot, ready }: { version?: FlowVersion; draft?: FlowDraft; snapshot: FlowSnapshot; ready: boolean }) {
  const [pickedVersion, setPickedVersion] = useState<number | null>(null), [fullscreen, setFullscreen] = useState(false);
  const flowId = preferredVersion?.definition.id ?? draft!.definition.id;
  const versions = snapshot.versions.filter(row => row.definition.id === flowId).sort((a, b) => b.version - a.version);
  const version = versions.find(row => row.version === pickedVersion) ?? preferredVersion;
  // An older proposal cannot replace the approved definition or its automatic configuration.
  const definition = version?.definition ?? draft!.definition;
  const [pickedRun, setPickedRun] = useState<string | null>(null);
  const runs = snapshot.runs.filter(run => run.flowId === definition.id).sort((a, b) => b.updatedAt - a.updatedAt);
  const run = pickedRun === 'definition' ? undefined : runs.find(row => row.id === pickedRun) ?? runs.find(row => row.status !== 'completed') ?? runs[0];
  const runVersion = run && snapshot.versions.find(row => row.definition.id === run.flowId && row.version === run.flowVersion && row.digest === run.definitionDigest);
  const shownDefinition = runVersion?.definition ?? definition;
  const shownVersion = runVersion ?? version;
  const draftAsk = flowAsks(snapshot).find(ask => ask.type === 'flow-definition' && ask.draft.definition.id === definition.id);
  const runAsk = run && flowAsks(snapshot).find(ask => ask.type === 'flow-run' && ask.run.id === run.id);
  // Tier menu on the definition view only: the exact shown definition is the base; a pending proposal behind an active
  // version locks it (decide that one first), a pick only proposes the next revision for the existing modal.
  const pending = draft?.status === 'proposed' ? draft : undefined;
  const tierEdit = run ? undefined : {
    locked: version ? !!pending || snapshot.active[definition.id] !== version.version : !pending,
    pick: (stepId: string, tier: ModelTier | null) => void editFlowStepTier(snapshot.contextKey, { flowId: definition.id, base: version ? { version: version.version } : { draftRevision: draft!.revision }, stepId, tier }),
  };
  return <article className="flow-detail" data-testid="flow-definition">
    <header className="flow-detail-head"><div className="flow-card-head"><h2>{definition.title}</h2><span className="flow-version">{version ? `v${version.version}` : `r${draft!.revision}`}</span><span className="flow-badge" data-status={version && snapshot.active[definition.id] === version.version ? 'active' : 'draft'}>{t(version ? snapshot.active[definition.id] === version.version ? 'flows.active' : 'flows.approvedVersion' : 'flows.draft')}</span></div>
      <p>{definition.description}</p><div className="flow-actions">
        {version && snapshot.active[definition.id] === version.version && <><button type="button" className="btn btn-primary btn-s" disabled={!ready} onClick={() => askOrchestrator('start', version)}>{t('flows.runNow')}</button><button type="button" className="btn btn-ghost btn-s" disabled={!ready} onClick={() => askOrchestrator('automate', version)}>{t('flows.automate')}</button></>}
        <button type="button" className="btn btn-ghost btn-s" disabled={!ready} onClick={() => askOrchestrator('refine', version, !version || draft?.status === 'proposed' ? draft : undefined)}>{t('flows.refine')}</button>
      </div>
    </header>
    {draftAsk && <div className="flow-draft-notice"><p>{t(version ? 'flows.draftNotice' : 'flows.review')}</p><button type="button" className="btn btn-amber btn-s" onClick={() => openQueue(`${draftAsk.chatId}/${draftAsk.id}`)}>{t('flows.reviewOpen')}</button></div>}
    {version && <FlowAutomation version={version} snapshot={snapshot} />}
    {snapshot.versions.filter(other => other.definition.id === definition.id && other.version !== version?.version && snapshot.automation?.rules.some(rule => rule.config.flowId === definition.id && rule.config.flowVersion === other.version)).map(other => <FlowAutomation key={other.version} version={other} snapshot={snapshot} />)}
    {versions.length > 1 && <div className="flow-view-picker"><label htmlFor="flow-version-picker">{t('flows.versionPicker')}</label><select id="flow-version-picker" value={version?.version} onChange={event => { setPickedVersion(Number(event.target.value)); setPickedRun('definition'); }}>{versions.map(row => <option key={row.version} value={row.version}>v{row.version}{snapshot.active[definition.id] === row.version ? ` · ${t('flows.active')}` : ''}</option>)}</select></div>}
    <div className="flow-view-picker"><label htmlFor="flow-run-picker">{t('flows.runs')}</label><select id="flow-run-picker" value={run?.id ?? 'definition'} onChange={e => setPickedRun(e.target.value)}><option value="definition">{t('flows.definitionView')}{version ? ` · v${version.version}` : ''}</option>{runs.map(row => <option key={row.id} value={row.id}>{row.subjectKey} · v{row.flowVersion} · {t(`flows.${row.status}`)} · {new Date(row.createdAt).toLocaleString(locale())}</option>)}</select></div>
    {run && <div className="flow-run-focus" data-testid="flow-run"><div className="flow-card-head"><strong>{run.subjectKey}</strong><span className="flow-version">v{run.flowVersion}</span><span className="flow-badge" data-status={run.status}>{t(`flows.${run.status}`)}</span>{runAsk && <button type="button" className="btn btn-amber btn-s" onClick={() => openQueue(`${runAsk.chatId}/${runAsk.id}`)}>{t('flows.reviewOpen')}</button>}</div><p className="flows-muted">{[run.scope.project, run.scope.areaPath].filter(Boolean).join(' · ')}</p></div>}
    <div className="flow-portable-actions">
      {(!run || runVersion) && <button type="button" className="btn btn-ghost btn-s" data-testid="flow-fullscreen-open" onClick={() => setFullscreen(true)}>{t('flows.fullscreen')}</button>}
      {shownVersion && (!run || runVersion) && <div className="flow-export-group" aria-label={t('flows.export')}><span className="flows-muted">{t('flows.export')} · v{shownVersion.version}</span><button type="button" className="btn btn-ghost btn-s" onClick={() => void exportFlowDefinition(snapshot.contextKey, definition.id, shownVersion.version, 'json')} data-testid="flow-export-json">JSON</button><button type="button" className="btn btn-ghost btn-s" onClick={() => void exportFlowDefinition(snapshot.contextKey, definition.id, shownVersion.version, 'markdown')} data-testid="flow-export-markdown">Markdown</button></div>}
    </div>
    {shownVersion && <p className="flow-export-hint">{t('flows.exportHint')}</p>}
    {fullscreen && (!run || runVersion) && <FlowFullscreen definition={shownDefinition} version={shownVersion?.version} run={run} onClose={() => setFullscreen(false)} />}
    {(!run || runVersion) && <FlowDiagram key={`${shownDefinition.id}/${shownVersion?.version ?? draft?.revision}/${run?.id ?? 'definition'}`} definition={shownDefinition} run={run} />}
    {(!run || runVersion) && <details className="flow-full-definition"><summary>{t('flows.details')}{shownVersion ? ` · v${shownVersion.version}` : ''}</summary><FlowDefinition definition={shownDefinition} run={runVersion ? run : undefined} edit={tierEdit} /></details>}
    {run && !runVersion && <p className="flow-block" role="status">{t('flows.versionUnavailable')}</p>}
    {runs.length === 0 && <p className="flows-muted">{t('flows.noRuns')}</p>}
  </article>;
}
export function Flows() {
  const { snapshot, error, loading } = useFlows();
  const ready = useApp(s => !!orchestratorIdOf(s));
  const [importing, setImporting] = useState(false);
  const [category, setCategory] = useState<string | null>(null), [picked, setPicked] = useState<string | null>(null);
  const rows = useMemo(() => {
    if (!snapshot) return [];
    const ids = [...new Set([...snapshot.versions.map(v => v.definition.id), ...snapshot.drafts.map(d => d.definition.id)])];
    return ids.map(id => {
      const versions = snapshot.versions.filter(v => v.definition.id === id);
      const version = versions.find(v => v.version === snapshot.active[id]) ?? versions.sort((a, b) => b.version - a.version)[0];
      const draft = snapshot.drafts.filter(d => d.definition.id === id).sort((a, b) => b.revision - a.revision)[0];
      return { id, version, draft, definition: version?.definition ?? draft!.definition };
    });
  }, [snapshot]);
  const categories = [...new Set(rows.map(row => row.definition.category).filter((value): value is string => !!value))];
  const selectedCategory = category && categories.includes(category) ? category : null;
  const visible = rows.filter(row => !selectedCategory || row.definition.category === selectedCategory);
  const selected = visible.find(row => row.id === picked) ?? visible[0];
  return <section className="flows-page" data-testid="flows-page">
    <header className="flows-head"><div><span className="flow-eyebrow">{t('flows.automaticHint')}</span><h1>{t('flows.title')}</h1><p>{t('flows.intro')}</p></div><div className="flows-head-actions">{snapshot && <button type="button" className="btn btn-ghost btn-m" disabled={!!error} onClick={() => setImporting(true)} data-testid="flow-import-open">{t('flows.import')}</button>}{rows.length > 0 && <button type="button" className="btn btn-primary btn-m" disabled={!ready} onClick={() => askOrchestrator('create')}>{t('flows.ask')}</button>}</div></header>
    {importing && snapshot && <FlowImport key={snapshot.contextKey} contextKey={snapshot.contextKey} onClose={() => setImporting(false)} />}
    {error && <div className="flow-block" role="alert"><strong>{t('flows.unavailable')}</strong><p>{error}</p><button type="button" className="btn btn-ghost btn-s" onClick={() => void reloadFlows()}>{t('flows.retry')}</button></div>}
    {loading && !snapshot && <p role="status" className="flows-muted">{t('flows.loading')}</p>}
    {!loading && !error && rows.length === 0 && <div className="flows-empty" data-testid="flows-empty"><IconBranch size={28} /><h2>{t('flows.empty')}</h2><p>{t('flows.emptyHint')}</p><button type="button" className="btn btn-primary btn-m" disabled={!ready} onClick={() => askOrchestrator('create')}>{t('flows.ask')}</button><span className="flows-muted">{t(ready ? 'flows.readOnly' : 'flows.noOrchestrator')}</span></div>}
    {snapshot?.automation?.storageError && <p className="flow-block" role="alert">{snapshot.automation.storageError}</p>}
    {snapshot && <FlowAutomationControls snapshot={snapshot} />}
    {snapshot && rows.length > 0 && <div className="flows-workspace"><nav className="flows-master" aria-label={t('flows.flowList')}><div className="flows-section-head"><h2>{t('flows.flowList')}</h2><span className="flows-count">{rows.length}</span></div>
      {categories.length > 0 && <div className="flows-tabs" aria-label={t('flows.definitions')}><button type="button" className="btn btn-ghost btn-s" aria-pressed={!selectedCategory} onClick={() => setCategory(null)}>{t('flows.all')}</button>{categories.map(value => <button key={value} type="button" className="btn btn-ghost btn-s" aria-pressed={selectedCategory === value} onClick={() => setCategory(value)}>{value}</button>)}</div>}
      <div className="flows-catalog">{visible.map(row => {
        const automatic = snapshot.automation?.rules.some(rule => rule.config.flowId === row.id && rule.config.flowVersion === row.version?.version && (rule.status === 'enabled' || rule.status === 'paused'));
        const pending = flowAsks(snapshot).filter(ask => ask.type === 'flow-definition' ? ask.draft.definition.id === row.id : ask.type === 'flow-run' ? ask.run.flowId === row.id : ask.rule.config.flowId === row.id).length;
        return <button type="button" key={row.id} className="flow-catalog-item" aria-pressed={selected?.id === row.id} onClick={() => setPicked(row.id)}><span className="flow-catalog-icon"><IconBranch size={18} /></span><span><strong>{row.definition.title}</strong><small>{t(automatic ? 'flows.automatic' : 'flows.manual')} · {row.version ? `v${row.version.version}` : t('flows.draft')}</small>{pending > 0 && <small className="flow-needs-decision">{t('flows.review')} · {pending}</small>}</span></button>;
      })}</div></nav>{selected && <FlowDetail key={`${snapshot.contextKey}/${selected.id}`} version={selected.version} draft={selected.draft} snapshot={snapshot} ready={ready} />}</div>}
  </section>;
}
