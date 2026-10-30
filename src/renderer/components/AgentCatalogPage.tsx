// The Agenti page: the six roles (the Orchestrator first, then the five work roles) and Flash, each a card that flips
// to its instructions and skills (#81) and opens the role's own page (AgentStudio: the editor, its versions).
// The decisions that change a role's reach or cost (a trial to keep, a tier suggestion: ADR 0083) are cards of Memoria →
// Proposte (ADR 0123): a line on top points there. No role is created here: the catalog is fixed, a missing know-how
// becomes a skill. The work roles' cards say when the nightly review last updated their levels (ADR 0203). Rendered by
// App.tsx for page 'agenti'.
import { useEffect, useState } from 'react';
import type { AgentMetrics } from '@shared/agents';
import { isWorkRole } from '@shared/roles';
import { ProposalsPointer } from './brain-model/ProposalsPointer';
import { go } from '../actions';
import { t } from '../i18n';
import { sb } from '../sb';
import { refreshAgents, useAgents } from '../store/agents';
import { useApp } from '../store/store';
import { isBusy } from '../store/state';
import { ui } from '../store/ui';
import { AgentCatalogCard } from './AgentCatalogCard';
import { JudgingSwitch, useJudgingEstimate } from './JudgingSwitch';
import { HelpTip } from './HelpTip';
import { AgentStudio, EDIT_ELEMENT } from './AgentStudio';
import { useBrainModel } from '../store/brain-model';
import '../styles/agent-catalog.css';

export function AgentCatalogPage() {
  const { catalog, error } = useAgents();
  const arg = ui.use(s => s.pageArg);
  const chats = useApp(s => s.chats);
  const { state: model } = useBrainModel();
  const [metrics, setMetrics] = useState<AgentMetrics[] | null>(null), [metricsError, setMetricsError] = useState(false);
  const estimate = useJudgingEstimate(), judging = useApp(s => s.settings?.judging === true);
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
  if (profile) return <AgentStudio key={profile.id} profile={profile} />;
  const profiles = catalog?.profiles ?? [];
  // from the chats read above (a hook here, after the role page's early return, would change the hook order)
  const working = profiles.filter(p => !p.trial && Object.values(chats).some(c => c.agent?.id === p.id && !c.closedAt && isBusy(c))).length;
  const trial = profiles.filter(p => p.trial).length;
  return <section className="agent-overview" aria-label={t('catalog.title')} data-testid="agent-overview">
    <header className="catalog-head"><div><h2>{t('catalog.title')}</h2><p>{t('catalog.subtitle')}</p></div></header>
    <JudgingSwitch estimate={estimate} />
    <ProposalsPointer />
    <p className="catalog-intro">{t('catalog.intro')}</p>
    {(error || catalog?.problem) && <p role="alert">{error || catalog?.problem}<button type="button" className="link-btn" onClick={() => void refreshAgents()}>{t('studio.retry')}</button></p>}
    {!catalog && !error && <p role="status">{t('studio.loading')}</p>}
    {metricsError && <p role="alert">{t('catalog.metricsError')}</p>}
    <div className="catalog-summary" data-testid="catalog-summary">
      <p className="catalog-count"><strong>{t('agentsGrid.count', { n: profiles.filter(p => p.scope === 'role').length })}</strong>
        {working > 0 && <span data-state="working"><i aria-hidden="true" />{t('agentsGrid.workingCount', { n: working })}</span>}
        {trial > 0 && <span data-state="trial"><i aria-hidden="true" />{t('agentsGrid.trialCount', { n: trial })}</span>}
        <HelpTip title={t('explain.team.title')} guide="agents" testid="catalog-summary-help"><p>{t('explain.team.p1')}</p><p>{t('explain.team.p2')}</p></HelpTip></p>
      <p className="catalog-note">{t('catalog.note')}</p>
    </div>
    <div className="catalog-grid">{profiles.map((p, index) => {
      const starts = Object.values(chats).filter(c => c.run?.agentId === p.id).map(c => c.run!.startedAt);
      return <AgentCatalogCard key={p.id} profile={p} index={index} engine={catalog?.models.find(m => m.engine === p.engine)?.label ?? p.engine}
        metrics={metrics?.find(m => m.agentId === p.id)} loaded={metrics !== null} lastStart={starts.length ? Math.max(...starts) : null} onOpen={() => go({ page: 'agenti', arg: p.id, element: EDIT_ELEMENT })}
        memory={model?.memory.find(m => m.kind === 'agent' && m.agentId === p.id) ?? null}
        reviewedAt={judging && isWorkRole(p.id) ? estimate?.lastBatch?.at ?? null : null} onSkill={name => go({ page: 'skill', arg: name })} />;
    })}</div>
  </section>;
}
