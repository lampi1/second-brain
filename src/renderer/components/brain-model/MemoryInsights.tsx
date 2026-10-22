// The statistics of Memoria (its «Statistiche» tab, ADR 0122; owner, 2026-10-19: "estremamente interessante e ricca di
// statistiche e grafici, tipo errore ricorrente, skill utile inutile", "cose curiose"): "Lo sapevi?" (curious facts
// picked from the data), how the memory grew week by week, lines per agent, the skills the runs used or never used
// (uses, success, last use) and the files gone stale. Gone as duplicates (ADR 0122): the key-number row (lines: the
// hub's live counter; errors: Qualità; unused skills: the table) and the recurring errors block (Qualità's patterns and
// the File tab's error log). Every number carries a "?" that says how it is computed. Data: BrainModelState.memoryStats
// (main, brainmodel/memory-stats.ts). Each file opens in the app's file viewer. Charts: brain/components/Charts.tsx
// (validated palette, tooltips, "Dati" table, CSV). Used by MemoryPage.tsx. Styles: styles/memory.css (mm-*).
import { createContext, useContext, type ReactNode } from 'react';
import type { MemoryStats, SkillUse } from '@shared/brain-model';
import { locale, t } from '../../i18n';
import { HBarChart, StackedBars } from '../../brain/components/Charts';
import { renderMarkdown } from '../../brain/components/Markdown';
import { memoryFacts, shortDay, total, verdictTone, type Fact } from '../../lib/memory-view';
import { HelpTip } from '../HelpTip';
import { when } from './MaintenancePanel';

/** Opens a brain-relative file in the file viewer (MemoryPage provides it with the brain root). */
export const OpenFile = createContext<(rel: string) => void>(() => {});
const num = (n: number) => n.toLocaleString(locale());
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const day = (d: string | null) => (d ? shortDay(d, locale()) : '—');

/** One line of Markdown, rendered inline (sanitized by the brain viewer's DOMPurify). */
export function InlineMd({ text, className = '' }: { text: string; className?: string }) {
  // no DOM (server rendering in the unit tests): the text as is, escaped by React
  if (typeof window === 'undefined') return <span className={`mm-md ${className}`}>{text}</span>;
  const html = renderMarkdown(text).trim().replace(/^<p>/, '').replace(/<\/p>$/, '');
  return <span className={`mm-md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Head({ id, title, lead, help, testId }: { id?: string; title: string; lead?: string; help: ReactNode; testId?: string }) {
  return <header className="mm-head">
    <h3 id={id}>{title} <HelpTip label={title} wide>{help}</HelpTip></h3>
    {lead && <p data-testid={testId}>{lead}</p>}
  </header>;
}

const FACT_KIND: Record<Fact['id'], 'error' | 'memory' | 'skill' | 'agent'> = {
  repeat: 'error', topWord: 'error', weekday: 'error', errorsTrend: 'error',
  oldest: 'memory', busiestDay: 'memory', duplicates: 'memory',
  longest: 'agent', silent: 'agent', unusedSkills: 'skill', bestSkill: 'skill',
};
function FactCard({ f, i }: { f: Fact; i: number }) {
  const open = useContext(OpenFile);
  const p = f.params as Record<string, string | number>;
  return <article className="mm-fact" data-kind={FACT_KIND[f.id]} data-testid={`mm-fact-${f.id}`} style={{ ['--row-index' as string]: i }}>
    <span className="mm-fact-k">{t(`mm.fact.${f.id}.k`)}</span>
    <p className="mm-fact-text"><InlineMd text={t(`mm.fact.${f.id}`, { ...p, day: typeof p.day === 'number' ? t(`mm.weekday.${p.day as 0}`) : '', date: typeof p.date === 'string' ? day(p.date) : '' })} /></p>
    <footer>
      <HelpTip label={t(`mm.fact.${f.id}.k`)} text={t('mm.fact.how')}>{t(`mm.fact.${f.id}.help`)}</HelpTip>
      {f.file && <button type="button" className="link-btn" onClick={() => open(f.file!)}>{t('mm.openFile')}</button>}
    </footer>
  </article>;
}

function Facts({ s }: { s: MemoryStats }) {
  const facts = memoryFacts(s);
  if (!facts.length) return null;
  return <section className="mm-block" aria-labelledby="mm-facts-h" data-testid="mm-facts">
    <Head id="mm-facts-h" title={t('mm.facts')} lead={t('mm.factsLead')} help={t('mm.factsHelp')} />
    <div className="mm-facts">{facts.map((f, i) => <FactCard key={f.id} f={f} i={i} />)}</div>
  </section>;
}

function Growth({ s }: { s: MemoryStats }) {
  const labels = s.weeks.map(w => shortDay(w, locale()));
  const series = s.growth.map(g => ({ label: t(`mm.kind.${g.kind}`), values: g.values }));
  const added = total(s.growth.flatMap(g => g.values));
  return <StackedBars title={t('mm.growth')} name="memoria-crescita" testId="mm-growth" labels={labels} series={series}
    note={<HelpTip label={t('mm.growth')} wide>{t('mm.growthHelp')}</HelpTip>}
    explain={{ find: added ? t('mm.growthFind', { n: added, weeks: s.weeks.length }) : t('mm.growthNone') }} />;
}

function PerAgent({ s }: { s: MemoryStats }) {
  const rows = s.perAgent.filter(a => a.exists);
  if (!rows.length) return <div className="bx-card mm-emptycard" data-testid="mm-per-agent"><h3>{t('mm.perAgent')}</h3><p className="bm-empty">{t('mm.perAgentEmpty')}</p></div>;
  return <HBarChart title={t('mm.perAgent')} name="memoria-agenti" testId="mm-per-agent" labels={rows.map(a => a.name)} series={[{ label: t('mm.lines'), values: rows.map(a => a.entries) }]}
    note={<HelpTip label={t('mm.perAgent')}>{t('mm.perAgentHelp')}</HelpTip>}
    explain={{ find: t('mm.perAgentFind', { name: rows[0]!.name, n: rows[0]!.entries, silent: s.perAgent.length - rows.length }) }} />;
}


function SkillRow({ k }: { k: SkillUse }) {
  const open = useContext(OpenFile);
  return <tr data-testid={`mm-skill-${k.name}`} data-verdict={k.verdict}>
    <th scope="row">{k.rel ? <button type="button" className="link-btn mm-skill-name" onClick={() => open(k.rel!)}>{k.name}</button> : <span className="mm-skill-name">{k.name}</span>}</th>
    <td><span className="mm-verdict" data-tone={verdictTone(k.verdict)}><i aria-hidden="true" />{t(`mm.verdict.${k.verdict}`)}</span></td>
    <td className="num">{num(k.uses)}</td>
    <td className="num">{k.known ? <span title={t('mm.successTitle', { ok: k.ok, n: k.known })}>{pct(k.success)}<small> · {k.ok}/{k.known}</small></span> : <span className="bm-nodata">{t('bm.noData')}</span>}</td>
    <td className="num">{k.lastUse ? when(k.lastUse) : '—'}</td>
    <td className="num">{num(k.usedBy)}</td>
  </tr>;
}
function Skills({ s }: { s: MemoryStats }) {
  const count = (v: SkillUse['verdict']) => s.skills.filter(k => k.verdict === v).length;
  const col = (label: string, help: string, num = true) => <th scope="col" className={num ? 'num' : ''}>{label} <HelpTip label={label}>{help}</HelpTip></th>;
  return <section className="mm-block" aria-labelledby="mm-skills-h" data-testid="mm-skills">
    <Head id="mm-skills-h" title={t('mm.skills')} lead={s.skills.length ? t('mm.skillsLead', { useful: count('useful'), weak: count('weak'), unused: count('unused'), total: s.skills.length }) : t('mm.skillsEmpty')} help={t('mm.skillsHelp')} />
    {s.skills.length > 0 && <div className="bx-card flush"><div className="bm-table-wrap"><table className="bm-table mm-skill-table">
      <thead><tr>{col(t('mm.col.skill'), t('mm.col.skillHelp'), false)}{col(t('mm.col.verdict'), t('mm.col.verdictHelp'), false)}{col(t('mm.col.uses'), t('mm.col.usesHelp'))}{col(t('mm.col.success'), t('mm.col.successHelp'))}{col(t('mm.col.last'), t('mm.col.lastHelp'))}{col(t('mm.col.agents'), t('mm.col.agentsHelp'))}</tr></thead>
      <tbody>{s.skills.map(k => <SkillRow key={k.name} k={k} />)}</tbody>
    </table></div></div>}
  </section>;
}

function Stale({ s }: { s: MemoryStats }) {
  const open = useContext(OpenFile);
  return <section className="bx-card mm-list-card" data-testid="mm-stale">
    <Head title={t('mm.stale')} lead={t('mm.staleLead', { days: s.staleDays })} help={t('mm.staleHelp', { days: s.staleDays })} />
    {s.stale.length ? <ul className="mm-stale">{s.stale.map(f => <li key={f.file}>
      <span className="mm-stale-main"><b>{f.title}</b><small title={f.file}>{f.file}</small></span>
      <span className="mm-stale-days" data-old={f.days >= s.staleDays * 2}>{t('mm.daysAgo', { n: f.days })}</span>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => open(f.file)} aria-label={t('mm.openNamed', { name: f.title })}>{t('bm.open')}</button>
    </li>)}</ul> : <p className="bm-empty">{t('mm.staleEmpty', { days: s.staleDays })}</p>}
  </section>;
}

/** The statistics block (Memoria → Statistiche); `s` from BrainModelState.memoryStats. No key-number row: the lines are
 *  the hub's live counter, the errors live on Qualità and in File's error log, the unused skills in the table below
 *  (ADR 0122). */
export function MemoryInsights({ s }: { s: MemoryStats }) {
  return <div className="mm-insights" data-testid="mm-insights">
    <Facts s={s} />
    <div className="mm-grid-2"><Growth s={s} /><PerAgent s={s} /></div>
    <Skills s={s} />
    {/* no "richiami": a line counted once per run started after it, even past the ~4000 characters a run really gets;
        loaded is not used (ADR 0101, E-apprendimento §5) */}
    <Stale s={s} />
  </div>;
}
