// Idee: every idea of the brain (yours and the AI's) in one table with filters by state, area and who, the
// "riprendere" date (red when it has come), the whole text in the side panel. The AI's ideas with their reasoning
// are told in "Spunti dell'IA". Data: /api/tables (ideas.md).
import { normTables, type Idea } from '../types';
import { useBrain } from '../api';
import { fmt } from '../lib/format';
import { Async, Empty, PageHead } from '../components/States';
import { DataTable, type Col } from '../components/DataTable';
import { Markdown } from '../components/Markdown';
import { Pill, type Navigate, type Tone } from '../components/ui';

const stateTone = (s: string): Tone => (s === 'aperta' ? 'warn' : s === 'fatta' ? 'good' : s === 'in corso' ? 'blue' : s === 'scartata' ? 'outline' : '');
const dates = (s: string) => s.replace(/\d{4}-\d{2}-\d{2}/g, d => fmt.day(d));
export const who = (i: Pick<Idea, 'chi'>): string => (i.chi === 'IA' ? 'IA' : 'Tu');

export function Idee({ nav }: { nav: Navigate }) {
  const t = useBrain('/api/tables', normTables);
  const today = t.data?.today ?? '';
  const ideas = t.data ? [...t.data.ideas].sort((a, b) => b.data.localeCompare(a.data)) : [];
  const by = (s: string) => ideas.filter(i => i.stato === s).length;
  const mine = ideas.filter(i => i.chi !== 'IA');
  const oldOpen = [...mine].filter(i => i.stato === 'aperta').sort((a, b) => a.data.localeCompare(b.data))[0];
  const due = ideas.filter(i => i.scaduta && i.scaduta <= today && !/fatta|scartata/.test(i.stato));
  const cols: Col<Idea>[] = [
    { key: 'data', label: 'Data', type: 'date', nowrap: true, width: '96px', render: r => fmt.day(r.data) },
    { key: 'titolo', label: 'Idea', render: r => <b>{r.titolo}</b>, width: '34%' },
    { key: 'chi', label: 'Chi', width: '64px', value: who, render: r => <Pill tone={r.chi === 'IA' ? 'violet' : ''}>{who(r)}</Pill> },
    { key: 'area', label: 'Area', width: '96px' },
    { key: 'stato', label: 'Stato', width: '92px', render: r => <Pill tone={stateTone(r.stato)}>{r.stato}</Pill> },
    { key: 'riprendere', label: 'Riprendere', clip: true, help: 'Quando o a quale condizione ripensarci', render: r => r.scaduta && r.scaduta <= today && !/fatta|scartata/.test(r.stato) ? <span><Pill tone="bad">da riprendere</Pill> {dates(r.riprendere)}</span> : dates(r.riprendere) },
    { key: 'idea', label: 'In breve', clip: true, hidden: true },
  ];
  return (
    <>
      <PageHead title="Idee" at={t.at} onRefresh={() => t.reload()}
        lead={t.data ? <><b>{by('aperta')} aperte</b>, {by('in corso')} in corso, {by('fatta')} fatte{due.length ? <> · <b>{due.length} da riprendere adesso</b></> : ''}.{oldOpen ? <> La più vecchia aperta: <b>{oldOpen.titolo}</b>.</> : null}</> : undefined}
        what="Le idee tue e dell'IA, da ideas.md. Filtra per stato, area e chi l'ha avuta; clic su una riga per leggerla tutta." />
      <Async loading={t.loading && !t.data} error={t.data ? null : t.error} onRetry={() => t.reload()} lines={6}>
        {() => ideas.length ? (
          <DataTable name="idee" label="Idee" rows={ideas} cols={cols} filters={['stato', 'area', 'chi']} detailTitle={r => r.titolo}
            detail={r => (
              <>
                <div className="bx-row"><Pill tone={stateTone(r.stato)}>{r.stato}</Pill><Pill tone={r.chi === 'IA' ? 'violet' : ''}>{who(r)}</Pill><Pill tone="outline">{r.area}</Pill><span className="small muted">{fmt.dayLong(r.data)}</span></div>
                {r.testo ? <Markdown text={r.testo} name={`idea-${r.data}`} /> : <p>{r.idea}</p>}
                {r.chi === 'IA' && <button type="button" className="bx-go" onClick={() => nav('spunti')}>Il ragionamento dell'IA è in Spunti →</button>}
              </>
            )} />
        ) : <Empty title="Ancora nessuna idea">Dì «segnatelo» a una chat: l'idea arriva qui con la data per riprenderla.</Empty>}
      </Async>
    </>
  );
}
