// Da fare: what waits for you first (decisions in the open threads), then everything open by topic from the live brief
// (your PRs named after their bug, work items, now.md threads, AI-found bugs to validate), the ideas whose "riprendere"
// date has come, and every now.md thread as a table (how long it has been still). "Rileggi da DevOps" asks the brain
// to read DevOps again now. Data: /api/day?kind=brief, /api/tables.
import { normBrief, normTables, type NowRow } from '../types';
import { useBrain } from '../api';
import { dayAge, fmt } from '../lib/format';
import { devopsIndex, firstPerson, isAgentsSection, isDecision, linkify, nextText, ownerOf, short } from '../lib/text';
import { Async, Empty, PageHead } from '../components/States';
import { DataTable, type Col } from '../components/DataTable';
import { Markdown } from '../components/Markdown';
import { IconRefresh, Linked, Pill, Section, type Navigate } from '../components/ui';
import { TodoView } from './day';

export function DaFare({ nav }: { nav: Navigate }) {
  const t = useBrain('/api/tables', normTables);
  const br = useBrain('/api/day?kind=brief', normBrief);
  const owner = t.data ? ownerOf(t.data.ideas) : '';
  const today = t.data?.today ?? '';
  const idx = devopsIndex(br.data);
  const decide = br.data ? br.data.threads.filter(x => isDecision(x, owner)) : (t.data?.now ?? []).filter(r => isDecision({ next: r.prossimo, done: /^FATT/i.test(r.prossimo), section: r.sezione }, owner)).map(r => ({ label: r.filo, next: r.prossimo, date: r.aggiornato }));
  const due = (t.data?.ideas ?? []).filter(i => i.scaduta && i.scaduta <= today && !/fatta|scartata/.test(i.stato));
  const open = (t.data?.now ?? []).filter(r => !isAgentsSection(r.sezione));
  const prs = br.data?.prs.length ?? 0;
  const cols: Col<NowRow>[] = [
    { key: 'filo', label: 'Filo', width: '22%', render: r => <b>{r.filo}</b> },
    { key: 'sezione', label: 'Sezione', width: '13%' },
    { key: 'prossimo', label: 'Prossimo passo', clip: true, help: 'Cosa deve succedere perché il filo vada avanti' },
    { key: 'dove', label: 'Dove', clip: true, width: '18%', help: 'La chat, il branch o il file dove sta il lavoro' },
    { key: 'aggiornato', label: 'Fermo da', type: 'date', width: '110px', help: 'Da quanto la riga non cambia: verde fino a 3 giorni, giallo fino a 7, rosso oltre', render: r => { const a = dayAge(r.aggiornato, today); return a ? <Pill tone={a.tone}>{a.label}</Pill> : ''; } },
  ];

  return (
    <>
      <PageHead title="Da fare" at={br.at} refreshing={br.refreshing}
        lead={br.data || t.data ? <><b>{decide.length ? `${decide.length} ${decide.length === 1 ? 'decisione aspetta' : 'decisioni aspettano'} te` : 'Nessuna decisione ti aspetta'}</b>{` · ${prs} tue PR aperte · ${open.length} fili aperti`}{due.length ? ` · ${due.length} ${due.length === 1 ? "idea" : "idee"} da riprendere` : ''}.</> : undefined}
        what="Le tue PR, i bug e i lavori aperti, per argomento. I link aprono DevOps fuori dall'app."
        actions={<button type="button" className="bx-btn s" title="Rilegge PR e work item da DevOps adesso (zero token)" onClick={() => br.reload(true)} data-testid="bx-reread"><IconRefresh /> Rileggi da DevOps</button>} />

      {decide.length > 0 && (
        <Section title="Decisioni che aspettano te" count={decide.length} testId="bx-decisions">
          <div className="bx-card accent-amber tight">
            <ul className="bx-list">
              {decide.map((d, i) => <li key={i}><Pill tone="warn">decidi</Pill><span className="t"><b>{d.label}</b> · <Linked parts={linkify(short(firstPerson(nextText(d.next), owner), 160), idx)} /></span></li>)}
            </ul>
          </div>
        </Section>
      )}

      <Section title="Aperto, per argomento" testId="bx-todo">
        <Async loading={br.loading && !br.data} error={br.data ? null : br.error} onRetry={() => br.reload()} label="Leggo DevOps e i fili aperti (fino a 15 s la prima volta)…" lines={4} block>
          {() => br.data && <TodoView br={br.data} owner={owner} />}
        </Async>
      </Section>

      {due.length > 0 && (
        <Section title="Idee da riprendere" count={due.length} note="la data per ripensarci è arrivata" actions={<button type="button" className="bx-go" onClick={() => nav('idee')}>Tutte le idee →</button>}>
          <div className="bx-card tight">
            <ul className="bx-list">{due.map((i, k) => <li key={k}><Pill tone={i.chi === 'IA' ? 'violet' : ''}>{i.area}</Pill><span className="t"><b>{i.titolo}</b>{i.idea && <span className="muted"> · {short(i.idea, 160)}</span>}</span><span className="meta">dal {fmt.day(i.scaduta)}</span></li>)}</ul>
          </div>
        </Section>
      )}

      <details className="bx-details" data-testid="bx-threads">
        <summary>Tutti i fili aperti · {open.length}</summary>
        <div className="body">
          <Async loading={t.loading && !t.data} error={t.data ? null : t.error} onRetry={() => t.reload()}>
            {() => open.length ? <DataTable name="fili-aperti" label="Fili aperti" rows={open} cols={cols} filters={['sezione']} sort={{ key: 'aggiornato', dir: -1 }}
              explain={{ find: (() => { const st = open.filter(r => (dayAge(r.aggiornato, today)?.tone ?? '') === 'bad'); return st.length ? <><b>{st.length} fili fermi da più di una settimana</b>: {st.slice(0, 3).map(r => r.filo).join(', ')}.</> : <><b>Nessun filo fermo da più di una settimana.</b></>; })(), next: 'un filo fermo si chiude o si riprende: chiedilo alla Regia', says: 'ogni lavoro aperto con il suo prossimo passo.', why: 'un filo che non si muove è un pensiero aperto in più.' }} />
              : <Empty title="Nessun filo aperto" />}
          </Async>
        </div>
      </details>
      {br.data?.text && (
        <details className="bx-details">
          <summary>Dettaglio tecnico (brief completo)</summary>
          <div className="body"><Markdown text={br.data.text} name="brief" /></div>
        </details>
      )}
    </>
  );
}
