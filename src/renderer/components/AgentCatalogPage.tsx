// Dedicated agent overview and guided Orchestrator entry; profile editing stays in the existing Studio.
import { useEffect, useRef, useState } from 'react';
import type { AgentMetrics } from '@shared/agents';
import { go, focusChat } from '../actions';
import { t } from '../i18n';
import { agentCreationBrief, selectCatalog, type CatalogSort } from '../lib/agent-catalog';
import { sb } from '../sb';
import { refreshAgents, useAgents } from '../store/agents';
import { createRoutedChat, useApp } from '../store/store';
import { ui } from '../store/ui';
import { AgentCatalogCard } from './AgentCatalogCard';
import { AgentStudio } from './AgentStudio';
import { Select } from './Select';
import '../styles/agent-catalog.css';

export function AgentCatalogPage() {
  const { catalog, error } = useAgents();
  const arg = ui.use(s => s.pageArg);
  const chats = useApp(s => s.chats);
  const root = useApp(s => s.info?.brainRoot);
  const [role, setRole] = useState(''), [engine, setEngine] = useState(''), [sort, setSort] = useState<CatalogSort>('name');
  const [metrics, setMetrics] = useState<AgentMetrics[] | null>(null), [metricsError, setMetricsError] = useState(false);
  const [refresh, setRefresh] = useState(0), [creating, setCreating] = useState(false);
  const [task, setTask] = useState(''), [area, setArea] = useState(''), [guideEngine, setGuideEngine] = useState('');
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState(false);
  const working = useRef(false);
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
  if (arg === 'studio' || profile) return <><button type="button" className="btn btn-ghost catalog-back" onClick={() => go({ page: 'agenti' })}>{t('catalog.back')}</button><AgentStudio key={arg} initialProfile={profile} /></>;
  const profiles = catalog?.profiles ?? [];
  const choices = catalog?.models.filter(m => m.enabled && m.trusted && (m.defaultModel || m.modelSelectable && m.models.length > 0)) ?? [];
  const chosen = choices.find(m => m.engine === guideEngine) ?? choices[0];
  const create = async () => {
    if (working.current || !root || !chosen || !task.trim() || !area.trim()) return;
    working.current = true; setBusy(true); setProblem(false);
    try {
      const model = chosen.defaultModel ? undefined : chosen.models[0]?.id;
      const chat = await createRoutedChat({ title: t('catalog.create'), regia: true, regiaName: t('catalog.title'), cwd: root,
        prompt: agentCreationBrief(task, area, chosen.engine), defaults: { harness: chosen.engine, ...(model ? { model } : {}) },
        ask: { harness: chosen.engine, ...(model ? { model } : {}), reason: 'User chose the agent creation guide engine' } });
      if (chat) { setCreating(false); focusChat(chat.id); } else setProblem(true);
    } finally { working.current = false; setBusy(false); }
  };
  return <section className="agent-overview" aria-label={t('catalog.title')} data-testid="agent-overview">
    <header className="catalog-head"><div><h2>{t('catalog.title')}</h2><p>{t('catalog.subtitle')}</p></div>
      <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} disabled={!catalog || !!catalog.problem}>{t('catalog.create')}</button>
      <button type="button" className="btn btn-ghost" onClick={() => go({ page: 'agenti', arg: 'studio' })}>{t('catalog.studio')}</button></header>
    {!profiles.some(p => p.origin.kind !== 'preset') && <p className="catalog-intro">{t('catalog.intro')}</p>}
    {(error || catalog?.problem) && <p role="alert">{error || catalog?.problem}<button type="button" className="link-btn" onClick={() => void refreshAgents()}>{t('studio.retry')}</button></p>}
    {!catalog && !error && <p role="status">{t('studio.loading')}</p>}
    {creating && <form className="catalog-create" onSubmit={e => { e.preventDefault(); void create(); }}>
      <h3>{t('catalog.create')}</h3><p>{t('catalog.guideNote')}</p>
      <label className="field"><span>{t('catalog.task')}</span><textarea required maxLength={2000} value={task} onChange={e => setTask(e.target.value)} disabled={busy} /></label>
      <label className="field"><span>{t('catalog.area')}</span><input required maxLength={500} value={area} onChange={e => setArea(e.target.value)} disabled={busy} /></label>
      <label className="field"><span>{t('catalog.engine')}</span><Select value={chosen?.engine ?? ''} onChange={e => setGuideEngine(e.target.value)} disabled={busy}>{choices.map(m => <option key={m.engine} value={m.engine}>{m.label}</option>)}</Select></label>
      {!root && <p role="status">{t('catalog.noRoot')}</p>}
      {problem && <p role="alert">{t('catalog.createError')}</p>}
      <div><button type="submit" className="btn btn-primary" disabled={busy || !root || !chosen || !task.trim() || !area.trim()}>{t('catalog.guide')}</button> <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setCreating(false)}>{t('catalog.cancel')}</button></div>
    </form>}
    <div className="catalog-filters">
      <label className="field"><span>{t('catalog.role')}</span><Select value={role} onChange={e => setRole(e.target.value)}><option value="">{t('catalog.all')}</option>{[...new Set(profiles.map(p => p.role).filter(Boolean))].sort().map(r => <option key={r} value={r}>{r}</option>)}</Select></label>
      <label className="field"><span>{t('catalog.engine')}</span><Select value={engine} onChange={e => setEngine(e.target.value)}><option value="">{t('catalog.all')}</option>{[...new Set(profiles.map(p => p.engine))].sort().map(id => <option key={id} value={id}>{catalog?.models.find(m => m.engine === id)?.label ?? id}</option>)}</Select></label>
      <label className="field"><span>{t('catalog.sort')}</span><Select value={sort} onChange={e => setSort(e.target.value as CatalogSort)}><option value="name">{t('catalog.name')}</option><option value="role">{t('catalog.role')}</option><option value="engine">{t('catalog.engine')}</option></Select></label>
      <button type="button" className="btn btn-ghost" onClick={() => { setRefresh(n => n + 1); void refreshAgents(); }}>{t('studio.retry')}</button>
    </div>
    {metricsError && <p role="alert">{t('catalog.metricsError')}</p>}
    <p className="catalog-note">{t('catalog.note')}</p>
    <div className="catalog-grid">{selectCatalog(profiles, role, engine, sort).map(p => {
      const starts = Object.values(chats).filter(c => c.run?.agentId === p.id).map(c => c.run!.startedAt);
      return <AgentCatalogCard key={p.id} profile={p} engine={catalog?.models.find(m => m.engine === p.engine)?.label ?? p.engine}
        updateAvailable={catalog?.presetUpdates?.some(update => update.agentId === p.id)}
        metrics={metrics?.find(m => m.agentId === p.id)} loaded={metrics !== null} lastStart={starts.length ? Math.max(...starts) : null} onOpen={() => go({ page: 'agenti', arg: p.id })} />;
    })}</div>
    {catalog && !selectCatalog(profiles, role, engine, sort).length && <p role="status">{t('catalog.empty')}</p>}
  </section>;
}
