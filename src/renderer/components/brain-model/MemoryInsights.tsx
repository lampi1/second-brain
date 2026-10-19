// The statistics of the Memoria page (owner, 2026-10-19: "estremamente interessante e ricca di statistiche e grafici,
// tipo errore ricorrente, skill utile inutile", "cose curiose"): the key numbers, "Lo sapevi?" (curious facts picked
// from the data), how the memory grew week by week, lines per agent, the lines recalled most, the recurring errors
// (count, trend, agents, the rule each produced), the skills the runs used or never used (uses, success, last use) and
// the files gone stale. Every number carries a "?" that says how it is computed. Data: BrainModelState.memoryStats
// (main, brainmodel/memory-stats.ts). Each file opens in the app's file viewer. Charts: brain/components/Charts.tsx
// (validated palette, tooltips, "Dati" table, CSV). Used by MemoryPage.tsx. Styles: styles/memory.css (mm-*).
import { createContext, useContext, type ReactNode } from 'react';
import type { MemoryStats, SkillUse } from '@shared/brain-model';
import { locale, t } from '../../i18n';
import { HBarChart, Sparkline, StackedBars } from '../../brain/components/Charts';
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

function Kpi({ k, v, s, help, tone, testId }: { k: string; v: ReactNode; s?: ReactNode; help: ReactNode; tone?: 'warn' | 'good'; testId: string }) {
  return <div className={`bx-kpi mm-kpi ${tone ?? ''}`} data-testid={testId}>
    <span className="k">{k} <HelpTip label={k}>{help}</HelpTip></span>
    <span className="v">{v}</span>
    {s && <span className="s">{s}</span>}
  </div>;
}

function Head({ id, title, lead, help, testId }: { id?: string; title: string; lead?: string; help: ReactNode; testId?: string }) {
  return <header className="mm-head">
    <h3 id={id}>{title} <HelpTip label={title} wide>{help}</HelpTip></h3>
    {lead && <p data-testid={testId}>{lead}</p>}
  </header>;
}

const FACT_KIND: Record<Fact['id'], 'error' | 'memory' | 'skill' | 'agent'> = {
  repeat: 'error', topWord: 'error', weekday: 'error', errorsTrend: 'error',
  mostRecalled: 'memory', oldest: 'memory', busiestDay: 'memory', duplicates: 'memory',
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

function Recalled({ s }: { s: MemoryStats }) {
  const open = useContext(OpenFile);
  return <section className="bx-card mm-list-card" data-testid="mm-recalled">
    <Head title={t('mm.recalled')} lead={t('mm.recalledLead')} help={t('mm.recalledHelp')} />
    {s.topRecalled.length ? <ol className="mm-rank">{s.topRecalled.map((l, i) => {
      const max = s.topRecalled[0]!.recalls || 1;
      return <li key={`${l.file}-${i}`}>
        <span className="mm-rank-n" aria-hidden="true">{i + 1}</span>
        <span className="mm-rank-main">
          <InlineMd text={l.text} />
          <small>{l.owner}{l.date ? ` · ${day(l.date)}` : ''}</small>
          <span className="mm-meter" aria-hidden="true"><i style={{ width: `${(l.recalls / max) * 100}%` }} /></span>
        </span>
        <span className="mm-rank-v" title={t('mm.recallsTitle', { n: l.recalls })}><b>{num(l.recalls)}</b><small>{t('mm.runs')}</small></span>
        <button type="button" className="btn btn-ghost btn-s" onClick={() => open(l.file)} aria-label={t('mm.openNamed', { name: l.owner })}>{t('bm.open')}</button>
      </li>;
    })}</ol> : <p className="bm-empty">{t('mm.recalledEmpty')}</p>}
  </section>;
}

function Errors({ s }: { s: MemoryStats }) {
  const e = s.errors;
  const labels = s.weeks.map(w => shortDay(w, locale()));
  const recurring = e.groups.filter(g => g.count >= 2);
  return <section className="mm-block" aria-labelledby="mm-errors-h" data-testid="mm-errors">
    <Head id="mm-errors-h" title={t('mm.errors')} lead={e.total ? t('mm.errorsLead', { n: e.total, groups: recurring.length }) : t('mm.errorsEmpty')} help={t('mm.errorsHelp')} />
    {e.total > 0 && <div className="mm-errors">
      <div className="mm-groups" data-testid="mm-error-groups">
        {e.groups.slice(0, 6).map((g, i) => <article key={g.key} className="mm-group" data-recurring={g.count >= 2} data-testid="mm-error-group" style={{ ['--row-index' as string]: i }}>
          <header>
            <span className="mm-group-count" title={t('mm.timesTitle', { n: g.count })}><b>{g.count}</b><small>{g.count === 1 ? t('mm.time') : t('mm.times')}</small></span>
            <span className="mm-group-main">
              <b className="mm-group-label">{g.label}</b>
              <small>{g.agents.join(', ')} · {g.first === g.last ? day(g.last) : t('mm.fromTo', { from: day(g.first), to: day(g.last) })}</small>
            </span>
            <span className="mm-group-trend"><Sparkline values={g.trend} labels={labels} label={t('mm.trendLabel', { label: g.label })} highlightLast={false} /></span>
          </header>
          {g.count >= 2 && <p className="mm-group-sample"><span className="mm-say">{t('mm.lastTime')}</span> <InlineMd text={g.sample} /></p>}
          {g.rule && <p className="mm-group-rule"><span className="mm-say">{t('mm.rule')}</span> <InlineMd text={g.rule} /></p>}
        </article>)}
      </div>
      <div className="mm-errors-side">
        <div className="bx-kpis mm-kpis-2">
          <Kpi k={t('mm.k.last30')} v={num(e.last30)} s={t('mm.k.prev30', { n: e.prev30 })} tone={e.last30 > e.prev30 ? 'warn' : e.last30 < e.prev30 ? 'good' : undefined} help={t('mm.k.last30Help')} testId="mm-k-last30" />
          <Kpi k={t('mm.k.recurring')} v={num(recurring.reduce((a, g) => a + g.count, 0))} s={t('mm.k.recurringS', { n: recurring.length })} help={t('mm.k.recurringHelp')} testId="mm-k-recurring" />
        </div>
        {e.byAgent.length > 0 && <HBarChart title={t('mm.byAgent')} name="errori-agenti" testId="mm-errors-by-agent" labels={e.byAgent.map(a => a.agent)} series={[{ label: t('mm.errorsN'), values: e.byAgent.map(a => a.count) }]}
          note={<HelpTip label={t('mm.byAgent')}>{t('mm.byAgentHelp')}</HelpTip>} />}
      </div>
    </div>}
  </section>;
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

/** The statistics block; `s` from BrainModelState.memoryStats. */
export function MemoryInsights({ s }: { s: MemoryStats }) {
  const recalls = s.perAgent.reduce((a, x) => a + x.recalls, 0);
  const unused = s.skills.filter(k => k.verdict === 'unused').length;
  return <div className="mm-insights" data-testid="mm-insights">
    <div className="bx-kpis mm-kpis" data-testid="mm-kpis">
      <Kpi k={t('mm.k.lines')} v={num(s.totals.entries)} s={t('mm.k.linesS', { n: s.totals.files })} help={t('mm.k.linesHelp')} testId="mm-k-lines" />
      <Kpi k={t('mm.k.agents')} v={`${s.totals.agentsWithMemory}/${s.totals.agents}`} s={t('mm.k.agentsS', { n: s.totals.agents - s.totals.agentsWithMemory })} help={t('mm.k.agentsHelp')} testId="mm-k-agents" />
      <Kpi k={t('mm.k.recalls')} v={num(recalls)} s={t('mm.k.recallsS', { n: s.totals.runs })} help={t('mm.k.recallsHelp')} testId="mm-k-recalls" />
      <Kpi k={t('mm.k.errors')} v={num(s.errors.total)} s={t('mm.k.errorsS', { n: s.errors.last30 })} tone={s.errors.last30 > s.errors.prev30 ? 'warn' : undefined} help={t('mm.k.errorsHelp')} testId="mm-k-errors" />
      <Kpi k={t('mm.k.unused')} v={`${unused}/${s.skills.length}`} s={t('mm.k.unusedS')} tone={unused ? 'warn' : undefined} help={t('mm.k.unusedHelp')} testId="mm-k-unused" />
    </div>
    <Facts s={s} />
    <div className="mm-grid-2"><Growth s={s} /><PerAgent s={s} /></div>
    <Errors s={s} />
    <Skills s={s} />
    <div className="mm-grid-2"><Recalled s={s} /><Stale s={s} /></div>
  </div>;
}
