// "Memoria" (G Y, ADR 0077): what the brain knows and what happened, plus one memory per agent, and what it all says
// (owner, 2026-10-19: contents formatted well, files you can really open, curious facts, statistics and charts,
// maintenance as a visible button). Top: the "Manutenzione" button (every job now, what each did, "Annulla"), then the
// statistics (MemoryInsights.tsx: key numbers, "Lo sapevi?", growth, lines per agent, recurring errors, skills used or
// never used, most recalled lines, stale files), then three sections of cards whose latest lines are rendered Markdown
// and open the real file in the file viewer: knowledge (customers, environments, people, references), what happened
// (open threads, journal, errors, with the error log) and the agents' memories with the shared one. A clean install
// shows what will appear instead of empty charts. "Unisci i doppioni" (bottom panel) runs the merge-memory job alone.
// Memory never travels with an exported agent. Rendered by App.tsx PageFrame for 'memoria'.
import { useContext, useState, type CSSProperties, type ReactNode } from 'react';
import type { AgentMemoryStat, ErrorEntry, MemoryFile, MemoryStats } from '@shared/brain-model';
import { openFileViewer } from '../../actions';
import { locale, t } from '../../i18n';
import { useBrainModel } from '../../store/brain-model';
import { PageHead } from '../../brain/components/States';
import { memorySections } from '../../lib/brain-model-view';
import { brainFile, lineParts, memoryEmpty, shortDay } from '../../lib/memory-view';
import { HelpTip } from '../HelpTip';
import { IconFile } from '../Icons';
import { MaintenancePanel, when } from './MaintenancePanel';
import { MaintenanceButton } from './MaintenanceButton';
import { InlineMd, MemoryInsights, OpenFile } from './MemoryInsights';
import '../../styles/agent-catalog.css';
import '../../styles/brain-model.css';
import '../../styles/memory.css';

const GROUPS = ['Clienti', 'Ambienti', 'Persone', 'Riferimenti'] as const;
const groupLabel = (g: string) => ((GROUPS as readonly string[]).includes(g) ? t(`bm.mem.group.${g as (typeof GROUPS)[number]}`) : g);
const kindLabel = (m: MemoryFile) => (m.kind === 'knowledge' ? groupLabel(m.group) : m.kind === 'agent' ? m.group : t(`bm.mem.kind.${m.kind}`));

function MemoryCard({ m, index, agent }: { m: MemoryFile; index: number; agent?: AgentMemoryStat }) {
  const open = useContext(OpenFile);
  const lines = m.previewMd ?? m.preview;
  return <article className="catalog-card mm-card" data-kind={m.kind === 'agent' ? 'agent' : 'memory'} data-mkind={m.kind} data-testid={`bm-mem-${m.file}`} style={{ '--row-index': Math.min(index, 8) } as CSSProperties}>
    <header className="bm-card-head">
      <div><h3><button type="button" className="mm-card-title" onClick={() => open(m.file)}>{m.title}</button></h3><p className="bm-card-sub" title={m.file}>{m.file}</p></div>
      <span className="bm-badges"><span className="bm-badge" data-tone={m.kind === 'agent' ? 'violet' : m.kind === 'shared' ? 'green' : 'blue'}>{kindLabel(m)}</span></span>
    </header>
    {lines.length > 0 && <ul className="mm-lines">{lines.map((p, i) => {
      const { date, text } = lineParts(p);
      return <li key={i}>{date && <time dateTime={date}>{shortDay(date, locale())}</time>}<InlineMd text={text} /></li>;
    })}</ul>}
    <footer className="bm-card-foot">
      <span>{t('bm.mem.entries', { n: m.entries })}{m.changedAt ? ` · ${t('bm.changed', { at: when(m.changedAt) })}` : ''}</span>
      {agent && <span className="mm-recall-chip" data-testid="mm-card-recalls">{t('mm.loadedIn', { n: agent.recalls })} <HelpTip label={t('mm.loadedHelpLabel')}>{t('mm.loadedHelp')}</HelpTip></span>}
      <span className="sp" />
      <button type="button" className="btn btn-ghost btn-s mm-open" onClick={() => open(m.file)} data-testid="mm-open"><IconFile /> {t('mm.openFile')}</button>
    </footer>
  </article>;
}

function Section({ id, title, lead, files, empty, stats, children }: { id: 'knowledge' | 'happened' | 'agents'; title: string; lead: string; files: MemoryFile[]; empty: string; stats?: MemoryStats; children?: ReactNode }) {
  return <section className="bm-section" aria-labelledby={`bm-mem-${id}`} data-testid={`bm-mem-section-${id}`}>
    <header><div><h3 id={`bm-mem-${id}`}>{title}</h3><p>{lead}</p></div></header>
    {files.length ? <div className="catalog-grid">{files.map((m, i) => <MemoryCard key={m.file} m={m} index={i} agent={m.kind === 'agent' ? stats?.perAgent.find(a => a.agentId === m.agentId) : undefined} />)}</div> : <p className="bm-empty">{empty}</p>}
    {children}
  </section>;
}

/** The logged errors (ai-errors.md), newest first, rendered, each with its recurring group and the rule it produced. */
function ErrorLog({ items, groups }: { items: ErrorEntry[]; groups: MemoryStats['errors']['groups'] }) {
  const open = useContext(OpenFile);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(12);
  const count = new Map(groups.map(g => [g.key, g.count]));
  const rows = items.filter(e => `${e.type ?? ''} ${e.area ?? ''} ${e.agent} ${e.text} ${e.rule ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="bm-panel" data-testid="bm-mem-errors">
    <header className="bm-panel-head"><div><h3>{t('bm.mem.errors')}</h3><p>{t('bm.mem.errorsLead')}</p></div>
      <div className="bm-panel-actions">
        <input type="search" className="sk-input" value={query} onChange={e => setQuery(e.target.value)} aria-label={t('bm.mem.errorsFilterLabel')} placeholder={t('bm.mem.errorsFilter')} />
        {items.length > 0 && <button type="button" className="btn btn-ghost btn-s mm-open" onClick={() => open('ai-errors.md')}><IconFile /> {t('mm.openFile')}</button>}
      </div></header>
    {rows.length ? <ul className="bm-changes">{rows.slice(0, limit).map((e, i) => {
      const n = count.get(e.group) ?? 1;
      return <li className="bm-change" key={`${e.date}-${e.time}-${i}`}>
        <div className="bm-change-main">
          <span className="bm-change-meta">{(e.type ?? e.area) && <span className="bm-tag">{e.type ?? e.area}</span>}{e.date ? shortDay(e.date, locale()) : ''}{e.time ? ` ${e.time}` : ''} · {e.agent}{n >= 2 && <span className="mm-again" title={t('mm.timesTitle', { n })}>{t('mm.again', { n })}</span>}</span>
          <p className="bm-change-what"><InlineMd text={e.text} /></p>
          {e.rule && <p className="bm-change-why"><b>{t('mm.rule')}</b> <InlineMd text={e.rule} /></p>}
        </div>
      </li>;
    })}</ul> : <p className="bm-empty">{query ? t('bm.mem.errorsNone') : t('bm.mem.errorsEmpty')}</p>}
    {rows.length > limit && <button type="button" className="link-btn bm-more" onClick={() => setLimit(n => n + 20)}>{t('bm.maint.more', { n: Math.min(20, rows.length - limit) })}</button>}
  </div>;
}

/** A brain with nothing written yet: what the page will show, so it never looks broken. */
function CleanStart() {
  return <section className="mm-clean" data-testid="mm-clean">
    <h2>{t('mm.clean.title')}</h2>
    <p>{t('mm.clean.lead')}</p>
    <ul>{(['lines', 'errors', 'skills', 'facts'] as const).map(k => <li key={k}><b>{t(`mm.clean.${k}`)}</b><span>{t(`mm.clean.${k}Text`)}</span></li>)}</ul>
  </section>;
}

export function MemoryPage() {
  const { state, error } = useBrainModel();
  const s = memorySections(state?.memory ?? []);
  const stats = state?.memoryStats;
  const knowledge = [...s.knowledge].sort((a, b) => GROUPS.indexOf(a.group as never) - GROUPS.indexOf(b.group as never) || a.title.localeCompare(b.title));
  const root = state?.root ?? null;
  return <OpenFile.Provider value={rel => openFileViewer(brainFile(root, rel))}><div className="bm-page agent-overview mm-page" data-testid="bm-memory-page">
    <PageHead title={t('bm.mem.title')} lead={t('bm.mem.lead')} actions={<MaintenanceButton />} />
    {error && <p role="alert">{error}</p>}
    {state && !state.root ? <p className="bm-empty">{t('bm.noBrain')}</p> : <>
      {stats && (memoryEmpty(stats) ? <CleanStart /> : <MemoryInsights s={stats} />)}
      <Section id="knowledge" title={t('bm.mem.knowledge')} lead={t('bm.mem.knowledgeLead')} files={knowledge} empty={t('bm.mem.empty.knowledge')} />
      <Section id="happened" title={t('bm.mem.happened')} lead={t('bm.mem.happenedLead')} files={s.happened} empty={t('bm.mem.empty.happened')}><ErrorLog items={stats?.errors.items ?? []} groups={stats?.errors.groups ?? []} /></Section>
      <Section id="agents" title={t('bm.mem.agents')} lead={t('bm.mem.agentsLead')} files={s.agents} empty={t('bm.mem.empty.agents')} stats={stats} />
    </>}
    <MaintenancePanel kinds={['memory']} job="merge-memory" runLabel={t('bm.mem.mergeDup')} testId="bm-maint-memory" />
  </div></OpenFile.Provider>;
}
