// "Memoria" (G Y, ADR 0077): what the brain knows and what happened, plus one memory per agent. Three sections of
// cards: knowledge (customers, environments, people, references), what happened (open threads, journal, errors, with
// the logged errors and the rule each produced, moved here from the Dashboard: "Cosa abbiamo imparato") and the
// agents' memories with the shared one. "Unisci i doppioni" runs the merge-memory job now: a line found in several
// agents' memories goes once to memory/shared.md, logged with "Annulla". Memory never travels with an exported agent.
// Rendered by App.tsx PageFrame for 'memoria'.
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { MemoryFile } from '@shared/brain-model';
import { goTarget } from '../../actions';
import { t } from '../../i18n';
import { useBrainModel } from '../../store/brain-model';
import { useBrain } from '../../brain/api';
import { normTables } from '../../brain/types';
import { PageHead } from '../../brain/components/States';
import { memorySections } from '../../lib/brain-model-view';
import { MaintenancePanel, when } from './MaintenancePanel';
import '../../styles/agent-catalog.css';
import '../../styles/brain-model.css';

const GROUPS = ['Clienti', 'Ambienti', 'Persone', 'Riferimenti'] as const;
const groupLabel = (g: string) => ((GROUPS as readonly string[]).includes(g) ? t(`bm.mem.group.${g as (typeof GROUPS)[number]}`) : g);
const kindLabel = (m: MemoryFile) => (m.kind === 'knowledge' ? groupLabel(m.group) : m.kind === 'agent' ? m.group : t(`bm.mem.kind.${m.kind}`));

function MemoryCard({ m, index }: { m: MemoryFile; index: number }) {
  return <article className="catalog-card" data-kind={m.kind === 'agent' ? 'agent' : 'memory'} data-testid={`bm-mem-${m.file}`} style={{ '--row-index': Math.min(index, 8) } as CSSProperties}>
    <header className="bm-card-head">
      <div><h3>{m.title}</h3><p className="bm-card-sub" title={m.file}>{m.file}</p></div>
      <span className="bm-badges"><span className="bm-badge" data-tone={m.kind === 'agent' ? 'violet' : m.kind === 'shared' ? 'green' : 'blue'}>{kindLabel(m)}</span></span>
    </header>
    {m.preview.length > 0 && <ul className="bm-preview">{m.preview.map((p, i) => <li key={i} title={p}>{p}</li>)}</ul>}
    <footer className="bm-card-foot">
      <span>{t('bm.mem.entries', { n: m.entries })}{m.changedAt ? ` · ${t('bm.changed', { at: when(m.changedAt) })}` : ''}</span>
      <span className="sp" />
      <button type="button" className="btn btn-ghost btn-s" onClick={() => goTarget(`file/${m.file}`)}>{t('bm.open')}</button>
    </footer>
  </article>;
}

function Section({ id, title, lead, files, empty, children }: { id: 'knowledge' | 'happened' | 'agents'; title: string; lead: string; files: MemoryFile[]; empty: string; children?: ReactNode }) {
  return <section className="bm-section" aria-labelledby={`bm-mem-${id}`} data-testid={`bm-mem-section-${id}`}>
    <header><div><h3 id={`bm-mem-${id}`}>{title}</h3><p>{lead}</p></div></header>
    {files.length ? <div className="catalog-grid">{files.map((m, i) => <MemoryCard key={m.file} m={m} index={i} />)}</div> : <p className="bm-empty">{empty}</p>}
    {children}
  </section>;
}

/** The logged errors (ai-errors.md): each correction with the rule it produced, newest first, filterable. */
function ErrorLog() {
  const tables = useBrain('/api/tables', normTables, { pollMs: 30_000 });
  const [query, setQuery] = useState('');
  const rows = (tables.data?.errors ?? []).filter(e => `${e.tipo} ${e.area} ${e.chi} ${e.vero} ${e.regola}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="bm-panel" data-testid="bm-mem-errors">
    <header className="bm-panel-head"><div><h3>{t('bm.mem.errors')}</h3><p>{t('bm.mem.errorsLead')}</p></div>
      <input type="search" className="sk-input" value={query} onChange={e => setQuery(e.target.value)} aria-label={t('bm.mem.errorsFilterLabel')} placeholder={t('bm.mem.errorsFilter')} /></header>
    {rows.length ? <ul className="bm-changes">{rows.slice().reverse().slice(0, 40).map((e, i) => <li className="bm-change" key={`${e.data}-${e.ora}-${i}`}>
      <div className="bm-change-main">
        <span className="bm-change-meta"><span className="bm-tag">{e.tipo || e.area || 'AI'}</span>{e.data} {e.ora}{e.chi ? ` · ${e.chi}` : ''}</span>
        <p className="bm-change-what">{e.vero || e.detto}</p>
        {e.regola && <p className="bm-change-why">{e.regola}</p>}
      </div>
    </li>)}</ul> : <p className="bm-empty">{tables.data ? (query ? t('bm.mem.errorsNone') : t('bm.mem.errorsEmpty')) : t('bm.loading')}</p>}
  </div>;
}

export function MemoryPage() {
  const { state, error } = useBrainModel();
  const s = memorySections(state?.memory ?? []);
  const knowledge = [...s.knowledge].sort((a, b) => GROUPS.indexOf(a.group as never) - GROUPS.indexOf(b.group as never) || a.title.localeCompare(b.title));
  return <div className="bm-page agent-overview" data-testid="bm-memory-page">
    <PageHead title={t('bm.mem.title')} lead={t('bm.mem.lead')} />
    {error && <p role="alert">{error}</p>}
    {state && !state.root ? <p className="bm-empty">{t('bm.noBrain')}</p> : <>
      <Section id="knowledge" title={t('bm.mem.knowledge')} lead={t('bm.mem.knowledgeLead')} files={knowledge} empty={t('bm.mem.empty.knowledge')} />
      <Section id="happened" title={t('bm.mem.happened')} lead={t('bm.mem.happenedLead')} files={s.happened} empty={t('bm.mem.empty.happened')}><ErrorLog /></Section>
      <Section id="agents" title={t('bm.mem.agents')} lead={t('bm.mem.agentsLead')} files={s.agents} empty={t('bm.mem.empty.agents')} />
    </>}
    <MaintenancePanel kinds={['memory']} job="merge-memory" runLabel={t('bm.mem.mergeDup')} testId="bm-maint-memory" />
  </div>;
}
