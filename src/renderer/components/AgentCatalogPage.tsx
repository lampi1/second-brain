// The Agenti page: the nine roles (the Orchestrator first, then the eight work roles) and Pulse, each a card that flips
// to its instructions and skills (#81) and opens the role's own page (AgentStudio: the editor, its versions, its pulse).
// "Da approvare" on top holds the decisions that change a role's reach or cost (ADR 0083). No role is created here: the
// catalog is fixed, a missing know-how becomes a skill. Rendered by App.tsx for page 'agenti'.
import { useEffect, useState } from 'react';
import type { AgentMetrics } from '@shared/agents';
import { AgentApprovals } from './AgentApprovals';
import { go } from '../actions';
import { t } from '../i18n';
import { requestPack } from '../lib/agent-pack-ui';
import { sb } from '../sb';
import { refreshAgents, useAgents } from '../store/agents';
import { useApp } from '../store/store';
import { ui } from '../store/ui';
import { AgentCatalogCard } from './AgentCatalogCard';
import { AgentStudio } from './AgentStudio';
import { ContextPulse } from './ContextPulse';
import { useBrainModel } from '../store/brain-model';
import '../styles/agent-catalog.css';

export function AgentCatalogPage() {
  const { catalog, error } = useAgents();
  const arg = ui.use(s => s.pageArg);
  const chats = useApp(s => s.chats);
  const { state: model } = useBrainModel();
  const [metrics, setMetrics] = useState<AgentMetrics[] | null>(null), [metricsError, setMetricsError] = useState(false);
  useEffect(() => {
    let alive = true, pending = false;
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
  }, [catalog]);
  const profile = catalog?.profiles.find(p => p.id === arg);
  if (profile) return <AgentStudio key={profile.id} profile={profile}>
    <ContextPulse key={profile.id} place={`agent:${profile.id}`} />
  </AgentStudio>;
  const profiles = catalog?.profiles ?? [];
  const working = profiles.filter(p => !p.trial && (metrics?.find(m => m.agentId === p.id)?.open ?? 0) > 0).length;
  const trial = profiles.filter(p => p.trial).length;
  return <section className="agent-overview" aria-label={t('catalog.title')} data-testid="agent-overview">
    <header className="catalog-head"><div><h2>{t('catalog.title')}</h2><p>{t('catalog.subtitle')}</p></div>
      <button type="button" className="btn btn-ghost" onClick={() => requestPack({ kind: 'import' })} data-testid="agent-import">{t('pack.import')}</button></header>
    <AgentApprovals />
    <p className="catalog-intro">{t('catalog.intro')}</p>
    {(error || catalog?.problem) && <p role="alert">{error || catalog?.problem}<button type="button" className="link-btn" onClick={() => void refreshAgents()}>{t('studio.retry')}</button></p>}
    {!catalog && !error && <p role="status">{t('studio.loading')}</p>}
    {metricsError && <p role="alert">{t('catalog.metricsError')}</p>}
    <div className="catalog-summary" data-testid="catalog-summary">
      <p className="catalog-count"><strong>{t('agentsGrid.count', { n: profiles.filter(p => p.scope === 'role').length })}</strong>
        {working > 0 && <span data-state="working"><i aria-hidden="true" />{t('agentsGrid.workingCount', { n: working })}</span>}
        {trial > 0 && <span data-state="trial"><i aria-hidden="true" />{t('agentsGrid.trialCount', { n: trial })}</span>}</p>
      <p className="catalog-note">{t('catalog.note')}</p>
    </div>
    <div className="catalog-grid">{profiles.map((p, index) => {
      const starts = Object.values(chats).filter(c => c.run?.agentId === p.id).map(c => c.run!.startedAt);
      return <AgentCatalogCard key={p.id} profile={p} index={index} engine={catalog?.models.find(m => m.engine === p.engine)?.label ?? p.engine}
        metrics={metrics?.find(m => m.agentId === p.id)} loaded={metrics !== null} lastStart={starts.length ? Math.max(...starts) : null} onOpen={() => go({ page: 'agenti', arg: p.id })}
        memory={model?.memory.find(m => m.kind === 'agent' && m.agentId === p.id) ?? null} onSkill={name => go({ page: 'skill', arg: name })} />;
    })}</div>
  </section>;
}
