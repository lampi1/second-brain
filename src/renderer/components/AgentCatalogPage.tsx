// Dedicated agent overview. "Crea agente" opens the questionnaire (AgentCreateDialog) that sends the user's request to
// the Orchestrator; a card flips to its details and skills (#81) and "Apri profilo" opens the agent on its own page
// (AgentStudio), with its lifecycle panel, pulse and the start composer. Rendered by App.tsx for page 'agenti'.
import { useEffect, useState } from 'react';
import { inProbation, type AgentMetrics } from '@shared/agents';
import type { AgentLifecycleClient } from '@shared/agent-lifecycle';
import { AgentLifecyclePanel } from './AgentLifecyclePanel';
import { AgentApprovals } from './AgentApprovals';
import { lifecycleClient } from '../lib/agent-lifecycle';
import { go } from '../actions';
import { t } from '../i18n';
import { selectCatalog, type CatalogSort } from '../lib/agent-catalog';
import { requestPack } from '../lib/agent-pack-ui';
import { sb } from '../sb';
import { refreshAgents, useAgents } from '../store/agents';
import { useApp } from '../store/store';
import { ui } from '../store/ui';
import { AgentCatalogCard } from './AgentCatalogCard';
import { AgentCreateDialog } from './AgentCreateDialog';
import { AgentStudio } from './AgentStudio';
import { Select } from './Select';
import { ContextPulse } from './ContextPulse';
import { useBrainModel } from '../store/brain-model';
import '../styles/agent-catalog.css';

export function AgentCatalogPage({ lifecycleApi = lifecycleClient }: { lifecycleApi?: AgentLifecycleClient } = {}) {
  const { catalog, error } = useAgents();
  const arg = ui.use(s => s.pageArg);
  const chats = useApp(s => s.chats);
  const { state: model } = useBrainModel();
  const [role, setRole] = useState(''), [engine, setEngine] = useState(''), [sort, setSort] = useState<CatalogSort>('name');
  const [metrics, setMetrics] = useState<AgentMetrics[] | null>(null), [metricsError, setMetricsError] = useState(false);
  const [refresh, setRefresh] = useState(0), [creating, setCreating] = useState(false);
  useEffect(() => {
    let alive = true, pending = false;
    setMetrics(null); setMetricsError(false);
    const read = async () => {
      if (pending) return;
      pending = true;
      try { const value = await sb.invoke('agents:metrics', undefined); if (alive) { setMetrics(value); setMetricsError(false); } }
      catch { if (alive) { setMetrics(null); setMetricsError(true); } }
      finally { pending = false; }
    };
    void read();
    const timer = setInterval(() => void read(), 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [catalog, refresh]);
  const profile = catalog?.profiles.find(p => p.id === arg);
  if (arg === 'studio' || profile) return <AgentStudio key={arg} initialProfile={profile}>
    {lifecycleApi && profile && <AgentLifecyclePanel api={lifecycleApi} agentId={profile.id} onReview={() => go({ page: 'agenti', arg: profile.id })} />}
    {profile && <ContextPulse key={profile.id} place={`agent:${profile.id}`} />}
  </AgentStudio>;
  const profiles = catalog?.profiles ?? [];
  return <section className="agent-overview" aria-label={t('catalog.title')} data-testid="agent-overview">
    <header className="catalog-head"><div><h2>{t('catalog.title')}</h2><p>{t('catalog.subtitle')}</p></div>
      <button type="button" className="btn btn-ghost" onClick={() => requestPack({ kind: 'import' })} data-testid="agent-import">{t('pack.import')}</button>
      <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} disabled={!catalog || !!catalog.problem} data-testid="agent-create-open">{t('catalog.create')}</button></header>
    <AgentApprovals />
    {!profiles.some(p => p.origin.kind !== 'preset') && <p className="catalog-intro">{t('catalog.intro')}</p>}
    {(error || catalog?.problem) && <p role="alert">{error || catalog?.problem}<button type="button" className="link-btn" onClick={() => void refreshAgents()}>{t('studio.retry')}</button></p>}
    {!catalog && !error && <p role="status">{t('studio.loading')}</p>}
    {creating && <AgentCreateDialog onClose={() => setCreating(false)} />}
    <div className="catalog-filters">
      <label className="field"><span>{t('catalog.role')}</span><Select value={role} onChange={e => setRole(e.target.value)}><option value="">{t('catalog.all')}</option>{[...new Set(profiles.map(p => p.role).filter(Boolean))].sort().map(r => <option key={r} value={r}>{r}</option>)}</Select></label>
      <label className="field"><span>{t('catalog.engine')}</span><Select value={engine} onChange={e => setEngine(e.target.value)}><option value="">{t('catalog.all')}</option>{[...new Set(profiles.map(p => p.engine))].sort().map(id => <option key={id} value={id}>{catalog?.models.find(m => m.engine === id)?.label ?? id}</option>)}</Select></label>
      <label className="field"><span>{t('catalog.sort')}</span><Select value={sort} onChange={e => setSort(e.target.value as CatalogSort)}><option value="name">{t('catalog.name')}</option><option value="role">{t('catalog.role')}</option><option value="engine">{t('catalog.engine')}</option></Select></label>
      <button type="button" className="btn btn-ghost" onClick={() => { setRefresh(n => n + 1); void refreshAgents(); }}>{t('studio.retry')}</button>
    </div>
    {metricsError && <p role="alert">{t('catalog.metricsError')}</p>}
    {(() => {
      const shown = selectCatalog(profiles, role, engine, sort);
      const working = shown.filter(p => !inProbation(p) && (metrics?.find(m => m.agentId === p.id)?.open ?? 0) > 0).length;
      const trial = shown.filter(p => inProbation(p)).length;
      return <div className="catalog-summary" data-testid="catalog-summary">
        <p className="catalog-count"><strong>{t('agentsGrid.count', { n: shown.length })}</strong>
          {working > 0 && <span data-state="working"><i aria-hidden="true" />{t('agentsGrid.workingCount', { n: working })}</span>}
          {trial > 0 && <span data-state="probation"><i aria-hidden="true" />{t('agentsGrid.probationCount', { n: trial })}</span>}</p>
        <p className="catalog-note">{t('catalog.note')}</p>
      </div>;
    })()}
    <div className="catalog-grid">{selectCatalog(profiles, role, engine, sort).map((p, index) => {
      const starts = Object.values(chats).filter(c => c.run?.agentId === p.id).map(c => c.run!.startedAt);
      return <AgentCatalogCard key={p.id} profile={p} updateAvailable={catalog?.presetUpdates?.some(update => update.agentId === p.id)} index={index} engine={catalog?.models.find(m => m.engine === p.engine)?.label ?? p.engine}
        metrics={metrics?.find(m => m.agentId === p.id)} loaded={metrics !== null} lastStart={starts.length ? Math.max(...starts) : null} onOpen={() => go({ page: 'agenti', arg: p.id })}
        skills={model?.agents.find(a => a.id === p.id)?.skills ?? []} memory={model?.memory.find(m => m.kind === 'agent' && m.agentId === p.id) ?? null} onSkill={name => go({ page: 'skill', arg: name })} />;
    })}</div>
    {catalog && !selectCatalog(profiles, role, engine, sort).length && <p role="status">{t('catalog.empty')}</p>}
  </section>;
}
