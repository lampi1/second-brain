// Idee: every idea of the brain in one place, yours and the AI's, with three filters at the top (Tutte / Mie /
// Dall'IA; the page arg "mie" / "ia", old "spunti" links land on "ia"). One table with filters by state, area, who
// and, for the AI, for whom; the "riprendere" date (red when it has come); clic on a row → the side panel with the whole
// text, the AI's reasoning (Ho notato / Penso / Sicurezza / Non so / Cosa fare), "Discutine" (the Regia with a ready
// draft) and "Apri una chat" (components/Discuss); a discussed idea is marked in the table. "Dall'IA" also lists the
// AI's reflections on itself (ai-reflections.md) as cards with the same buttons. Data: /api/tables.
import type { ReactNode } from 'react';
import { normTables, type Idea, type Reflection } from '../types';
import { useBrain } from '../api';
import { fmt } from '../lib/format';
import { Async, Empty, PageHead } from '../components/States';
import { DataTable, type Col } from '../components/DataTable';
import { Markdown } from '../components/Markdown';
import { Pill, Tabs, type Navigate, type Tone } from '../components/ui';
import { DiscussBar, useDiscussed } from '../components/Discuss';
import { topicKey } from '../lib/discuss';
import { t as tr } from '../../i18n';

const stateTone = (s: string): Tone => (s === 'aperta' ? 'warn' : s === 'fatta' ? 'good' : s === 'in corso' ? 'blue' : s === 'scartata' ? 'outline' : '');
const dates = (s: string) => s.replace(/\d{4}-\d{2}-\d{2}/g, d => fmt.day(d));
export const who = (i: Pick<Idea, 'chi'>): string => (i.chi === 'IA' ? tr('brainPages.idee.whoAI') : tr('brainPages.idee.who'));

export type IdeeFilter = 'tutte' | 'mie' | 'ia';
/** The page arg → the filter ("riflessioni", from old Spunti links, is the AI's). */
export const filterOf = (arg?: string): IdeeFilter => (arg === 'mie' ? 'mie' : arg === 'ia' || arg === 'riflessioni' ? 'ia' : 'tutte');

/** Whom an AI idea is for: the brain (default), the AI itself, or the owner (any other value: the owner's name). */
export const perOf = (i: Pick<Idea, 'per'>): string => { const p = i.per.trim().toLowerCase(); return !p || p === 'second-brain' ? tr('brainPages.idee.perBrain') : p === 'ia' ? tr('brainPages.idee.perAI') : tr('brainPages.idee.perYou'); };
const sure = (s: string): ReactNode => {
  const v = s.toLowerCase().match(/alta|media|bassa/)?.[0];
  return v ? <Pill tone={(v === 'alta' ? 'good' : v === 'media' ? 'warn' : 'bad') as Tone} title={s}>{tr('brainPages.idee.sureLabel', { v })}</Pill> : null;
};
const bareSure = (s: string) => s.replace(/^(alta|media|bassa)\s*:?\s*/i, '');

function Reasoning({ x }: { x: Partial<Idea & Reflection> }) {
  const rows: [string, string | undefined][] = [[tr('brainPages.idee.reasonNoted'), x.notato], [tr('brainPages.idee.reasonThink'), x.penso], [tr('brainPages.idee.reasonSure'), x.sicurezza], [tr('brainPages.idee.reasonUnknown'), x.nonso], [tr('brainPages.idee.reasonWhat'), x.come]];
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return <dl className="bx-reason" data-testid="bx-reason">{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function Idee({ arg, nav }: { arg?: string; nav: Navigate }) {
  const t = useBrain('/api/tables', normTables);
  const discussed = useDiscussed();
  const filter = filterOf(arg);
  const today = t.data?.today ?? '';
  const all = t.data ? [...t.data.ideas].sort((a, b) => b.data.localeCompare(a.data)) : [];
  const mine = all.filter(i => i.chi !== 'IA');
  const ai = all.filter(i => i.chi === 'IA');
  const refl = [...(t.data?.reflections ?? [])].sort((a, b) => b.data.localeCompare(a.data));
  const ideas = filter === 'mie' ? mine : filter === 'ia' ? ai : all;
  const by = (s: string) => ideas.filter(i => i.stato === s).length;
  const oldOpen = [...ideas].filter(i => i.stato === 'aperta').sort((a, b) => a.data.localeCompare(b.data))[0];
  const due = ideas.filter(i => i.scaduta && i.scaduta <= today && !/fatta|scartata/.test(i.stato));
  const cols: Col<Idea>[] = ([
    { key: 'data', label: tr('brainPages.idee.colData'), type: 'date', nowrap: true, width: '96px', render: r => fmt.day(r.data) },
    { key: 'titolo', label: tr('brainPages.idee.colIdea'), render: r => <><b>{r.titolo}</b>{discussed[topicKey({ kind: 'idea', idea: r })] && <span className="bx-discuss-tag" title={tr('brainPages.idee.discussedTitle')} data-testid="bx-idea-discussed">{tr('brainPages.idee.discussedMark')}</span>}</>, width: '34%' },
    { key: 'chi', label: tr('brainPages.idee.colChi'), width: '64px', value: who, render: r => <Pill tone={r.chi === 'IA' ? 'violet' : ''}>{who(r)}</Pill> },
    { key: 'per', label: tr('brainPages.idee.colPer'), width: '96px', help: tr('brainPages.idee.colHelpPer'), value: r => (r.chi === 'IA' ? perOf(r) : '') },
    { key: 'area', label: tr('brainPages.idee.colArea'), width: '96px' },
    { key: 'stato', label: tr('brainPages.idee.colStato'), width: '92px', render: r => <Pill tone={stateTone(r.stato)}>{r.stato}</Pill> },
    { key: 'riprendere', label: tr('brainPages.idee.colRiprendere'), clip: true, help: tr('brainPages.idee.colRiprendereHelp'), render: r => r.scaduta && r.scaduta <= today && !/fatta|scartata/.test(r.stato) ? <span><Pill tone="bad">{tr('brainPages.idee.resumeNow')}</Pill> {dates(r.riprendere)}</span> : dates(r.riprendere) },
    { key: 'idea', label: tr('brainPages.idee.colBreve'), clip: true, hidden: true },
  ] satisfies Col<Idea>[]).filter(c => c.key !== 'per' || filter === 'ia'); // only the AI's ideas have an audience (and the saved column choices of "idee" never knew it)
  const filters = filter === 'ia' ? ['stato', 'per', 'area'] : filter === 'mie' ? ['stato', 'area'] : ['stato', 'area', 'chi'];

  const thought = (r: Reflection) => (
    <article key={`${r.data}|${r.chat}|${r.titolo}`} className="bx-card bx-spunto accent-violet" data-testid="bx-riflessione">
      <div className="bx-row">{sure(r.sicurezza)}<span className="sp" /><span className="small muted">{fmt.day(r.data)} · {r.chat}</span></div>
      <h3>{r.titolo}</h3>
      <Reasoning x={{ ...r, sicurezza: bareSure(r.sicurezza) }} />
      <DiscussBar topic={{ kind: 'reflection', reflection: r }} />
    </article>
  );
  const lead = !t.data ? undefined : !ideas.length ? (filter === 'ia' && refl.length ? <><b>{tr('brainPages.idee.noIdeaNoneAI')}</b>{tr('brainPages.idee.reflectionCountSuffix', { n: refl.length })}</> : undefined) : (
    <><b>{tr('brainPages.idee.aperteCount', { n: by('aperta') })}</b>{tr('brainPages.idee.statsLine', { inCorso: by('in corso'), fatte: by('fatta') })}{due.length ? <> · <b>{tr('brainPages.idee.dueNow', { n: due.length })}</b></> : ''}.
      {oldOpen ? <>{tr('brainPages.idee.oldestOpenPrefix')}<b>{oldOpen.titolo}</b>.</> : null}
      {filter === 'ia' && refl.length ? <>{tr('brainPages.idee.aiReflectionsNote', { n: refl.length })}</> : null}</>
  );
  const what = filter === 'ia' ? tr('brainPages.idee.whatAI') : tr('brainPages.idee.whatDefault');

  return (
    <>
      <PageHead title={tr('brainPages.idee.pageTitle')} at={t.at} onRefresh={() => t.reload()} lead={lead} what={what} />
      <Async loading={t.loading && !t.data} error={t.data ? null : t.error} onRetry={() => t.reload()} lines={6}>
        {() => (
          <>
            <Tabs<IdeeFilter> label={tr('brainPages.idee.tabsLabel')} value={filter} onChange={id => nav(id === 'tutte' ? 'idee' : `idee/${id}`)}
              items={[{ id: 'tutte', label: tr('brainPages.idee.tabAll'), n: all.length }, { id: 'mie', label: tr('brainPages.idee.tabMine'), n: mine.length }, { id: 'ia', label: tr('brainPages.idee.tabAI'), n: ai.length }]} />
            {ideas.length ? (
              <DataTable key={filter} name={filter === 'tutte' ? 'idee' : `idee-${filter}`} testId="bx-table-idee" label={tr('brainPages.idee.tableLabel')} rows={ideas} cols={cols} filters={filters} detailTitle={r => r.titolo}
                detail={(r, close) => (
                  <>
                    <div className="bx-row">
                      <Pill tone={stateTone(r.stato)}>{r.stato}</Pill><Pill tone={r.chi === 'IA' ? 'violet' : ''}>{who(r)}</Pill>
                      {r.chi === 'IA' && <Pill tone="outline">{tr('brainPages.idee.perPrefix', { per: perOf(r) })}</Pill>}<Pill tone="outline">{r.area}</Pill>{r.chi === 'IA' && sure(r.sicurezza)}
                      <span className="small muted">{fmt.dayLong(r.data)}</span>
                    </div>
                    {r.chi === 'IA'
                      ? <>{r.idea && <p>{r.idea}</p>}<Reasoning x={{ ...r, sicurezza: bareSure(r.sicurezza) }} />{r.fonte && <p className="small muted">{tr('brainPages.idee.bornIn', { source: r.fonte.replace(/^IA\s*·\s*/, '') })}</p>}</>
                      : r.testo ? <Markdown text={r.testo} name={`idea-${r.data}`} /> : <p>{r.idea}</p>}
                    <DiscussBar key={topicKey({ kind: 'idea', idea: r })} topic={{ kind: 'idea', idea: r }} onRegia={close} />
                  </>
                )} />
            ) : filter === 'ia'
              ? <Empty title={tr('brainPages.idee.noAIIdeas')}>{tr('brainPages.idee.noAIIdeasDesc')}</Empty>
              : <Empty title={tr('brainPages.idee.noIdeas')}>{tr('brainPages.idee.noIdeasDesc')}</Empty>}
            {filter === 'ia' && (
              <section className="bx-section" data-testid="bx-riflessioni">
                <div className="bx-section-head"><h2>{tr('brainPages.idee.reflectionsTitle')}<span className="count"> · {refl.length}</span></h2><p>{tr('brainPages.idee.reflectionsDesc')}</p></div>
                {refl.length ? <div className="bx-cards">{refl.map(thought)}</div> : <Empty title={tr('brainPages.idee.noReflections')}>{tr('brainPages.idee.noReflectionsDesc')}</Empty>}
              </section>
            )}
          </>
        )}
      </Async>
    </>
  );
}
