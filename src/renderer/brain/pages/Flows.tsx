// The Routine page (ADR 0153, mockup B v2): «Adesso» first (only what needs the user, then the runs that work by
// themselves), «Routine» (each routine in plain words; open one for its steps, models, trigger and queue), «Storico».
// The app's runner does the work; starting on a work item or a pasted list happens here or through the Orchestrator;
// creating or changing a routine goes through the Orchestrator and the existing approval modal.
import { useState } from 'react';
import type { FlowDraft, FlowDryRun, FlowRun, FlowSnapshot, FlowVersion } from '@shared/flows';
import { flowRequest, type FlowRequestKind } from '../../lib/flow-request';
import { orchestratorIdOf } from '../../lib/orchestrator-route';
import { needsYou } from '../../lib/routine-view';
import { plain, reloadFlows, useFlows } from '../../store/flows';
import { app, send, useApp } from '../../store/store';
import { toast } from '../../store/ui';
import { focusChat } from '../../actions';
import { sb } from '../../sb';
import { FlowRecoveryDialog } from '../../components/FlowRunControls';
import { FlowImport } from '../../components/FlowImport';
import { FlowAutomationControls } from '../../components/FlowAutomation';
import { DryRunView, RoutineDetail, RoutineHistory, RoutineList, RoutineNow, RoutineStart, routineName } from '../../components/Routine';
import { IconBranch } from '../../components/Icons';
import { t } from '../../i18n';
import '../../styles/flows.css';
import '../../styles/routine.css';
function askOrchestrator(kind: FlowRequestKind, version?: FlowVersion, draft?: FlowDraft) {
  const id = orchestratorIdOf(app.get());
  if (!id) { toast(t('flows.noOrchestrator'), 'warn'); return; }
  const definition = draft?.definition ?? version?.definition;
  const result = send(id, flowRequest(kind, definition ? { id: definition.id, name: definition.title, version: version?.version } : undefined));
  if (result === 'empty') return;
  focusChat(id); toast(t(result === 'queued' ? 'flows.queued' : 'flows.sent'), 'info');
}
type Tab = 'now' | 'routines' | 'history';
export function Flows() {
  const { snapshot, error, loading } = useFlows();
  const ready = useApp(s => !!orchestratorIdOf(s));
  const [tab, setTab] = useState<Tab>('now'), [opened, setOpened] = useState<string | null>(null), [importing, setImporting] = useState(false);
  const [starting, setStarting] = useState<{ flowId?: string } | null>(null), [dry, setDry] = useState<{ result: FlowDryRun; title: string } | null>(null);
  const [recovery, setRecovery] = useState<{ snapshot: FlowSnapshot; run: FlowRun; mode: 'from-step' | 'cancel' } | null>(null);
  const count = snapshot ? new Set([...snapshot.versions.map(v => v.definition.id), ...snapshot.drafts.map(d => d.definition.id)]).size : 0;
  const yours = snapshot ? snapshot.runs.filter(run => needsYou(snapshot, run)).length : 0;
  const dryRun = async (flowId: string) => {
    if (!snapshot) return;
    try { setDry({ result: await sb.invoke('flows:dryRun', { contextKey: snapshot.contextKey, flowId }), title: routineName(snapshot, flowId) }); }
    catch (e) { toast(plain(e), 'err'); }
  };
  const hasActive = !!snapshot && Object.keys(snapshot.active).length > 0;
  return <section className="flows-page rt-page" data-testid="flows-page">
    <header className="rt-head"><div><h1>{t('rt.title')}</h1><p className="rt-intro">{t('rt.intro')}</p></div><span className="rt-sp" />
      {snapshot && <button type="button" className="btn btn-ghost btn-m" disabled={!!error} onClick={() => setImporting(true)} data-testid="flow-import-open">{t('flows.import')}</button>}
      <button type="button" className="btn btn-ghost btn-m" disabled={!ready} onClick={() => askOrchestrator('create')}>✦ {t('rt.new')}</button>
      {hasActive && <button type="button" className="btn btn-primary btn-m" onClick={() => setStarting({})} data-testid="rt-start-open">▶ {t('rt.startItem')}</button>}
    </header>
    {importing && snapshot && <FlowImport key={snapshot.contextKey} contextKey={snapshot.contextKey} onClose={() => setImporting(false)} />}
    {error && <div className="flow-block" role="alert"><strong>{t('flows.unavailable')}</strong><p>{error}</p><button type="button" className="btn btn-ghost btn-s" onClick={() => void reloadFlows()}>{t('flows.retry')}</button></div>}
    {loading && !snapshot && <p role="status" className="flows-muted">{t('flows.loading')}</p>}
    {snapshot?.automation?.storageError && <p className="flow-block" role="alert">{snapshot.automation.storageError}</p>}
    {!loading && !error && snapshot && count === 0 && <div className="flows-empty" data-testid="flows-empty"><IconBranch size={28} /><h2>{t('flows.empty')}</h2><p>{t('flows.emptyHint')}</p><button type="button" className="btn btn-primary btn-m" disabled={!ready} onClick={() => askOrchestrator('create')}>{t('flows.ask')}</button>{!ready && <span className="flows-muted">{t('flows.noOrchestrator')}</span>}</div>}
    {snapshot && count > 0 && <>
      <nav className="rt-tabs" role="tablist" aria-label={t('rt.title')}>
        {(['now', 'routines', 'history'] as const).map(id => <button key={id} type="button" role="tab" aria-selected={opened ? id === 'routines' : tab === id} className="rt-tab" onClick={() => { setTab(id); setOpened(null); }} data-testid={`rt-tab-${id}`}>
          {t(id === 'now' ? 'rt.tabNow' : id === 'routines' ? 'rt.tabRoutines' : 'rt.tabHistory')}{id === 'now' && yours > 0 && <span className="rt-count" data-tone="red">{yours}</span>}{id === 'routines' && <span className="rt-count">{count}</span>}</button>)}
      </nav>
      {opened ? <RoutineDetail snapshot={snapshot} flowId={opened} onBack={() => setOpened(null)} onStart={flowId => setStarting({ flowId })} onDryRun={flowId => void dryRun(flowId)}
          onAsk={version => askOrchestrator('refine', version, snapshot.drafts.find(d => d.definition.id === opened && d.status === 'proposed'))} />
        : tab === 'now' ? <RoutineNow snapshot={snapshot} onRecovery={(run, mode) => setRecovery({ snapshot, run, mode })} />
        : tab === 'routines' ? <><RoutineList snapshot={snapshot} onOpen={setOpened} /><FlowAutomationControls snapshot={snapshot} /></>
        : <RoutineHistory snapshot={snapshot} />}
    </>}
    {starting && snapshot && <RoutineStart snapshot={snapshot} flowId={starting.flowId} onClose={() => setStarting(null)} onDryRun={(result, title) => setDry({ result, title })} />}
    {dry && <DryRunView result={dry.result} title={dry.title} onClose={() => setDry(null)} />}
    {recovery && <FlowRecoveryDialog {...recovery} onClose={() => setRecovery(null)} onDone={() => setRecovery(null)} />}
  </section>;
}
