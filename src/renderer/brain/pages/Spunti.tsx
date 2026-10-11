// Spunti dell'IA e riflessioni: what the AI proposes to improve the brain, the way you work and itself, each with its
// reasoning (Ho notato / Penso / Quanto ne sono sicura / Non so / Cosa fare), plus the AI's reflections on itself.
// Tabs by audience; "Discutiamone" sends a ready message to the Regia (confirmed). Data: /api/tables (ideas whose
// source is the AI, ai-reflections.md).
import type { ReactNode } from 'react';
import { normTables, type Idea, type Reflection } from '../types';
import { useBrain } from '../api';
import { fmt } from '../lib/format';
import { Async, Empty, PageHead } from '../components/States';
import { Pill, Tabs, type Tone } from '../components/ui';
import { DiscussButton, regiaOf, useAppChats } from '../components/Composer';

type Per = 'second-brain' | 'te' | 'ia';
const PER: { id: Per; title: string; hint: string }[] = [
  { id: 'second-brain', title: 'Per il cervello', hint: 'regole, tool, agenti' },
  { id: 'te', title: 'Per te', hint: 'il tuo modo di lavorare, abitudini, tempo' },
  { id: 'ia', title: "Per l'IA", hint: 'come lavorano Regia, chat e agenti' },
];
/** The audience of an AI idea: the brain (default), the AI itself, or the owner (any other value: the owner's name). */
export const perOf = (i: Pick<Idea, 'per'>): Per => { const p = i.per.trim().toLowerCase(); return !p || p === 'second-brain' ? 'second-brain' : p === 'ia' ? 'ia' : 'te'; };
const sure = (s: string): ReactNode => {
  const v = s.toLowerCase().match(/alta|media|bassa/)?.[0];
  return v ? <Pill tone={(v === 'alta' ? 'good' : v === 'media' ? 'warn' : 'bad') as Tone} title={s}>sicurezza {v}</Pill> : null;
};
const stateTone = (s: string): Tone => (s === 'aperta' ? 'warn' : s === 'fatta' ? 'good' : s === 'scartata' ? 'outline' : 'blue');

function Reasoning({ x }: { x: Partial<Idea & Reflection> }) {
  const rows: [string, string | undefined][] = [['Ho notato', x.notato], ['Penso', x.penso], ['Sicurezza', x.sicurezza], ['Non so', x.nonso], ['Cosa fare', x.come]];
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return <dl className="bx-reason">{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function Spunti({ arg, nav }: { arg?: string; nav: (t: string) => void }) {
  const t = useBrain('/api/tables', normTables);
  const regia = regiaOf(useAppChats());
  const ai = (t.data?.ideas ?? []).filter(i => i.chi === 'IA').sort((a, b) => Number(b.stato === 'aperta') - Number(a.stato === 'aperta') || b.data.localeCompare(a.data));
  const refl = [...(t.data?.reflections ?? [])].sort((a, b) => b.data.localeCompare(a.data));
  const tab = (['tutti', 'riflessioni', ...PER.map(p => p.id)] as string[]).includes(arg ?? '') ? (arg as Per | 'tutti' | 'riflessioni') : 'tutti';
  const open = ai.filter(i => i.stato === 'aperta');

  const card = (i: Idea) => (
    <article key={`${i.data}|${i.titolo}`} className="bx-card bx-spunto" data-testid="bx-spunto">
      <div className="bx-row"><Pill tone={stateTone(i.stato)}>{i.stato}</Pill>{sure(i.sicurezza)}<span className="sp" /><span className="small muted">{fmt.day(i.data)}</span></div>
      <h3>{i.titolo}</h3>
      {i.idea && <p className="idea">{i.idea}</p>}
      <Reasoning x={{ ...i, sicurezza: i.sicurezza.replace(/^(alta|media|bassa)\s*:?\s*/i, '') }} />
      {i.fonte && <p className="small muted">Nato in: {i.fonte.replace(/^IA\s*·\s*/, '')}</p>}
      {i.stato === 'aperta' && <DiscussButton regia={regia} title={i.titolo}
        text={`Discutiamo lo spunto dell'IA «${i.titolo}» (ideas.md, ${i.data}). Voglio parlarne: portalo nella prossima scaletta con pro, contro e cosa servirebbe per farlo.`} />}
    </article>
  );
  const thought = (r: Reflection) => (
    <article key={`${r.data}|${r.chat}|${r.titolo}`} className="bx-card bx-spunto accent-violet" data-testid="bx-riflessione">
      <div className="bx-row">{sure(r.sicurezza)}<span className="sp" /><span className="small muted">{fmt.day(r.data)} · {r.chat}</span></div>
      <h3>{r.titolo}</h3>
      <Reasoning x={{ ...r, sicurezza: r.sicurezza.replace(/^(alta|media|bassa)\s*:?\s*/i, '') }} />
      <DiscussButton regia={regia} title={r.titolo} text={`Discutiamo la riflessione dell'IA «${r.titolo}» (ai-reflections.md, ${r.data}, chat ${r.chat}). Voglio parlarne.`} />
    </article>
  );
  const group = (p: (typeof PER)[number]) => {
    const rows = ai.filter(i => perOf(i) === p.id);
    return (
      <section key={p.id} className="bx-section">
        <div className="bx-section-head"><h2>{p.title}<span className="count"> · {rows.length}</span></h2><p>{p.hint}</p></div>
        {rows.length ? <div className="bx-cards">{rows.map(i => card(i))}</div> : <Empty title="Ancora nessuno spunto qui">Compaiono quando un'IA ne propone uno.</Empty>}
      </section>
    );
  };
  const counts = Object.fromEntries(PER.map(p => [p.id, ai.filter(i => perOf(i) === p.id).length]));

  return (
    <>
      <PageHead title="Spunti dell'IA" at={t.at} onRefresh={() => t.reload()}
        lead={t.data ? (ai.length || refl.length ? <><b>{open.length} {open.length === 1 ? 'spunto aperto' : 'spunti aperti'}</b> e <b>{refl.length} {refl.length === 1 ? 'riflessione' : 'riflessioni'}</b>. Ogni voce mostra il ragionamento: cosa ho notato, cosa penso, quanto ne sono sicura, cosa non so.</> : <b>Ancora nessuno spunto.</b>) : undefined}
        what="Qui l'IA scrive come migliorare il cervello, il tuo modo di lavorare e se stessa, con i suoi dubbi. «Discutiamone» lo manda alla Regia." />
      <Async loading={t.loading && !t.data} error={t.data ? null : t.error} onRetry={() => t.reload()} lines={5} block>
        {() => (
          <>
            <Tabs label="Spunti per chi" value={tab} onChange={id => nav(id === 'tutti' ? 'spunti' : `spunti/${id}`)}
              items={[{ id: 'tutti', label: 'Tutti', n: ai.length }, ...PER.map(p => ({ id: p.id, label: p.title, n: counts[p.id] })), { id: 'riflessioni', label: 'Riflessioni', n: refl.length }]} />
            {tab === 'riflessioni' ? (refl.length ? <div className="bx-cards">{refl.map(r => thought(r))}</div> : <Empty title="Ancora nessuna riflessione">Le chat la scrivono a fine lavoro, quando hanno qualcosa di vero da dire su di sé.</Empty>)
              : tab === 'tutti' ? (
                <>
                  {PER.filter(p => counts[p.id]).map(group)}
                  {PER.some(p => !counts[p.id]) && <p className="muted small">{PER.filter(p => !counts[p.id]).map(p => p.title).join(' e ')}: ancora niente.</p>}
                  {refl.length > 0 && (
                    <section className="bx-section">
                      <div className="bx-section-head"><h2>Riflessioni dell'IA<span className="count"> · {refl.length}</span></h2><p>cosa pensa di come sta lavorando</p></div>
                      <div className="bx-cards">{refl.slice(0, 3).map(r => thought(r))}</div>
                    </section>
                  )}
                </>
              ) : group(PER.find(p => p.id === tab)!)}
          </>
        )}
      </Async>
    </>
  );
}
