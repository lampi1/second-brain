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

const stateTone = (s: string): Tone => (s === 'aperta' ? 'warn' : s === 'fatta' ? 'good' : s === 'in corso' ? 'blue' : s === 'scartata' ? 'outline' : '');
const dates = (s: string) => s.replace(/\d{4}-\d{2}-\d{2}/g, d => fmt.day(d));
export const who = (i: Pick<Idea, 'chi'>): string => (i.chi === 'IA' ? 'IA' : 'Tu');

export type IdeeFilter = 'tutte' | 'mie' | 'ia';
/** The page arg → the filter ("riflessioni", from old Spunti links, is the AI's). */
export const filterOf = (arg?: string): IdeeFilter => (arg === 'mie' ? 'mie' : arg === 'ia' || arg === 'riflessioni' ? 'ia' : 'tutte');

/** Whom an AI idea is for: the brain (default), the AI itself, or the owner (any other value: the owner's name). */
export const perOf = (i: Pick<Idea, 'per'>): string => { const p = i.per.trim().toLowerCase(); return !p || p === 'second-brain' ? 'il cervello' : p === 'ia' ? "l'IA" : 'te'; };
const sure = (s: string): ReactNode => {
  const v = s.toLowerCase().match(/alta|media|bassa/)?.[0];
  return v ? <Pill tone={(v === 'alta' ? 'good' : v === 'media' ? 'warn' : 'bad') as Tone} title={s}>sicurezza {v}</Pill> : null;
};
const bareSure = (s: string) => s.replace(/^(alta|media|bassa)\s*:?\s*/i, '');

function Reasoning({ x }: { x: Partial<Idea & Reflection> }) {
  const rows: [string, string | undefined][] = [['Ho notato', x.notato], ['Penso', x.penso], ['Sicurezza', x.sicurezza], ['Non so', x.nonso], ['Cosa fare', x.come]];
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
    { key: 'data', label: 'Data', type: 'date', nowrap: true, width: '96px', render: r => fmt.day(r.data) },
    { key: 'titolo', label: 'Idea', render: r => <><b>{r.titolo}</b>{discussed[topicKey({ kind: 'idea', idea: r })] && <span className="bx-discuss-tag" title="Ne hai già discusso" data-testid="bx-idea-discussed">✓ discussa</span>}</>, width: '34%' },
    { key: 'chi', label: 'Chi', width: '64px', value: who, render: r => <Pill tone={r.chi === 'IA' ? 'violet' : ''}>{who(r)}</Pill> },
    { key: 'per', label: 'Per', width: '96px', help: "Per chi è lo spunto dell'IA", value: r => (r.chi === 'IA' ? perOf(r) : '') },
    { key: 'area', label: 'Area', width: '96px' },
    { key: 'stato', label: 'Stato', width: '92px', render: r => <Pill tone={stateTone(r.stato)}>{r.stato}</Pill> },
    { key: 'riprendere', label: 'Riprendere', clip: true, help: 'Quando o a quale condizione ripensarci', render: r => r.scaduta && r.scaduta <= today && !/fatta|scartata/.test(r.stato) ? <span><Pill tone="bad">da riprendere</Pill> {dates(r.riprendere)}</span> : dates(r.riprendere) },
    { key: 'idea', label: 'In breve', clip: true, hidden: true },
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
  const lead = !t.data ? undefined : !ideas.length ? (filter === 'ia' && refl.length ? <><b>Nessuno spunto dell'IA</b>, {refl.length} {refl.length === 1 ? 'riflessione' : 'riflessioni'}.</> : undefined) : (
    <><b>{by('aperta')} aperte</b>, {by('in corso')} in corso, {by('fatta')} fatte{due.length ? <> · <b>{due.length} da riprendere adesso</b></> : ''}.
      {oldOpen ? <> La più vecchia aperta: <b>{oldOpen.titolo}</b>.</> : null}
      {filter === 'ia' && refl.length ? <> E {refl.length} {refl.length === 1 ? 'riflessione' : 'riflessioni'} dell'IA su di sé.</> : null}</>
  );
  const what = filter === 'ia'
    ? "Gli spunti dell'IA per migliorare il cervello, il tuo modo di lavorare e se stessa, ognuno con il suo ragionamento. Clic su una riga per leggerlo e discuterne con la Regia."
    : "Le idee tue e dell'IA, da ideas.md. Filtra per stato, area e chi l'ha avuta; clic su una riga per leggerla tutta e discuterne con la Regia.";

  return (
    <>
      <PageHead title="Idee" at={t.at} onRefresh={() => t.reload()} lead={lead} what={what} />
      <Async loading={t.loading && !t.data} error={t.data ? null : t.error} onRetry={() => t.reload()} lines={6}>
        {() => (
          <>
            <Tabs<IdeeFilter> label="Di chi sono le idee" value={filter} onChange={id => nav(id === 'tutte' ? 'idee' : `idee/${id}`)}
              items={[{ id: 'tutte', label: 'Tutte', n: all.length }, { id: 'mie', label: 'Mie', n: mine.length }, { id: 'ia', label: "Dall'IA", n: ai.length }]} />
            {ideas.length ? (
              <DataTable key={filter} name={filter === 'tutte' ? 'idee' : `idee-${filter}`} testId="bx-table-idee" label="Idee" rows={ideas} cols={cols} filters={filters} detailTitle={r => r.titolo}
                detail={(r, close) => (
                  <>
                    <div className="bx-row">
                      <Pill tone={stateTone(r.stato)}>{r.stato}</Pill><Pill tone={r.chi === 'IA' ? 'violet' : ''}>{who(r)}</Pill>
                      {r.chi === 'IA' && <Pill tone="outline">per {perOf(r)}</Pill>}<Pill tone="outline">{r.area}</Pill>{r.chi === 'IA' && sure(r.sicurezza)}
                      <span className="small muted">{fmt.dayLong(r.data)}</span>
                    </div>
                    {r.chi === 'IA'
                      ? <>{r.idea && <p>{r.idea}</p>}<Reasoning x={{ ...r, sicurezza: bareSure(r.sicurezza) }} />{r.fonte && <p className="small muted">Nato in: {r.fonte.replace(/^IA\s*·\s*/, '')}</p>}</>
                      : r.testo ? <Markdown text={r.testo} name={`idea-${r.data}`} /> : <p>{r.idea}</p>}
                    <DiscussBar key={topicKey({ kind: 'idea', idea: r })} topic={{ kind: 'idea', idea: r }} onRegia={close} />
                  </>
                )} />
            ) : filter === 'ia'
              ? <Empty title="Ancora nessuno spunto dell'IA">Compaiono quando un'IA ne propone uno.</Empty>
              : <Empty title="Ancora nessuna idea">Dì «segnatelo» a una chat: l'idea arriva qui con la data per riprenderla.</Empty>}
            {filter === 'ia' && (
              <section className="bx-section" data-testid="bx-riflessioni">
                <div className="bx-section-head"><h2>Riflessioni dell'IA<span className="count"> · {refl.length}</span></h2><p>cosa pensa di come sta lavorando</p></div>
                {refl.length ? <div className="bx-cards">{refl.map(thought)}</div> : <Empty title="Ancora nessuna riflessione">Le chat la scrivono a fine lavoro, quando hanno qualcosa di vero da dire su di sé.</Empty>}
              </section>
            )}
          </>
        )}
      </Async>
    </>
  );
}
