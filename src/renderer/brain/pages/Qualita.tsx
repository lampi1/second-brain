// Qualità: how well the AI works, from the brain's own logs. Tabs: errors (by type, by day, every one), whether the
// rules born from errors stopped them (recurrence), praise, the specialists' notebooks, improvement proposals and their
// outcome, measures (forced interventions per day, stacked by kind), confirmed bugs by pattern. Each block opens with
// the discovery from the data and the next step. Data: /api/tables.
import { normTables, type BugRow, type ErrorRow, type Measure, type Playbook, type Proposal, type RuleRow, type Tables, type WinRow } from '../types';
import { useBrain } from '../api';
import { daysBetween, fmt } from '../lib/format';
import { countBy, short, sum } from '../lib/text';
import { Async, Empty, PageHead } from '../components/States';
import { HBarChart, LineChart, StackedBars } from '../components/Charts';
import { DataTable, type Col } from '../components/DataTable';
import { Pill, Tabs, type Navigate, type Tone } from '../components/ui';

type Tab = 'errori' | 'regole' | 'lodi' | 'taccuini' | 'proposte' | 'misure' | 'bug';
const TABS: Tab[] = ['errori', 'regole', 'lodi', 'taccuini', 'proposte', 'misure', 'bug'];
const propTone = (s: string): Tone => (/confermata|applicata/.test(s) ? 'good' : /rifiutata|peggiorata|inutile/.test(s) ? 'bad' : /accettata/.test(s) ? 'blue' : '');

function Errori({ t }: { t: Tables }) {
  const types = countBy(t.errors, r => r.tipo).slice(0, 12);
  const dates = countBy(t.errors, r => r.data).sort(([a], [b]) => a.localeCompare(b)).slice(-30);
  const worst = [...dates].sort((a, b) => b[1] - a[1])[0];
  const week = t.errors.filter(r => daysBetween(r.data, t.today) < 7).length;
  const cols: Col<ErrorRow>[] = [
    { key: 'data', label: 'Data', type: 'date', nowrap: true, width: '92px', render: r => fmt.day(r.data) },
    { key: 'chi', label: 'Chi', clip: true, width: '13%', help: "La chat o l'agente che ha sbagliato" },
    { key: 'area', label: 'Area', clip: true, width: '12%' },
    { key: 'tipo', label: 'Tipo', width: '160px', render: r => <Pill>{r.tipo || '—'}</Pill> },
    { key: 'detto', label: 'Ha detto', clip: true, help: "Cosa ha affermato o fatto l'IA" },
    { key: 'vero', label: 'Era vero', clip: true, help: 'Come stavano davvero le cose' },
    { key: 'regola', label: 'Regola nata', clip: true, hidden: true, help: "La regola scritta per non ripetere l'errore" },
    { key: 'visto', label: 'Visto da', clip: true, hidden: true },
  ];
  return (
    <>
      <div className="bx-grid-2">
        <HBarChart title="Errori per tipo" name="errori-per-tipo" labels={types.map(([k]) => k)} series={[{ label: 'errori', values: types.map(([, v]) => v) }]}
          explain={{ find: types[0] ? <><b>{types[0][0]}</b> è l'errore più comune: <b>{types[0][1]} volte, il {fmt.pct(types[0][1], t.errors.length)}%</b>.</> : undefined, next: types[0]?.[0] === 'fatto-non-verificato' ? 'l\'IA dice cose senza controllarle: chiedi sempre «da dove lo sai?»' : 'guarda in «Regole servite?» se la regola su questo tipo funziona', says: "che tipo di errori fa l'IA.", why: 'un tipo che si ripete chiede una regola.' }} />
        <LineChart title="Errori per giorno" name="errori-per-giorno" labels={dates.map(([d]) => fmt.day(d))} series={[{ label: 'errori', values: dates.map(([, v]) => v) }]}
          explain={{ find: worst ? <>Il giorno peggiore: <b>{fmt.day(worst[0])}, {worst[1]} errori</b>.</> : undefined, says: 'quanti errori sono stati registrati ogni giorno.', why: 'più chat in parallelo, più errori: è un segnale di carico.' }} />
      </div>
      <DataTable name="errori-ia" label="Errori dell'IA" rows={[...t.errors].reverse()} cols={cols} filters={['tipo', 'area']} detailTitle={r => r.detto || r.tipo}
        explain={{ find: <><b>{week} errori negli ultimi 7 giorni</b> su {t.errors.length} in tutto.</>, says: "ogni errore: cosa ha detto l'IA e cosa era vero.", why: 'è lo storico da cui nascono le regole; clic su una riga per leggerla tutta.' }} />
    </>
  );
}

function Regole({ t }: { t: Tables }) {
  const rules = t.recurrence.rules;
  const back = rules.filter(r => r.again > 0);
  const worst = [...back].sort((a, b) => b.again - a.again)[0];
  const cols: Col<RuleRow>[] = [
    { key: 'date', label: 'Data', type: 'date', width: '92px', render: r => fmt.day(r.date) },
    { key: 'type', label: 'Tipo', width: '170px' },
    { key: 'area', label: 'Area', clip: true, width: '16%' },
    { key: 'rule', label: 'Regola', clip: true },
    { key: 'again', label: 'Errore tornato', type: 'num', width: '130px', help: "Quante volte lo stesso tipo di errore, in un'area simile, è tornato dopo la regola", render: r => <Pill tone={r.again ? 'bad' : 'good'}>{r.again ? `${r.again} ${r.again === 1 ? 'volta' : 'volte'}` : 'no'}</Pill> },
  ];
  return (
    <>
      {t.recurrence.totals.length > 0 && <HBarChart title="Ricorrenza per tipo" name="ricorrenza" note="tutti gli errori registrati" labels={t.recurrence.totals.slice(0, 10).map(([k]) => k)} series={[{ label: 'errori', values: t.recurrence.totals.slice(0, 10).map(([, v]) => v) }]} />}
      {rules.length ? <DataTable name="regole-servite" label="Regole servite" rows={rules} cols={cols} filters={['type']} sort={{ key: 'again', dir: -1 }}
        explain={{ find: <><b>{rules.length - back.length} regole su {rules.length} hanno funzionato</b>: il loro errore non è più tornato.{worst ? <> La meno efficace: <b>{short(worst.rule, 60)}</b>, errore tornato {worst.again} volte.</> : null}</>, next: worst ? "quella regola va riscritta: chiedilo alla Regia con le parole dell'errore" : undefined, says: 'per ogni regola nata da un errore, se l\'errore è tornato dopo.', why: "una regola che non ferma l'errore è solo testo in più." }} />
        : <Empty title="Nessuna regola nata da un errore, ancora" />}
    </>
  );
}

function Lodi({ t }: { t: Tables }) {
  const byChat = countBy(t.wins, r => r.chat);
  const cols: Col<WinRow>[] = [
    { key: 'data', label: 'Data', type: 'date', width: '92px', render: r => fmt.day(r.data) },
    { key: 'ora', label: 'Ora', width: '60px' },
    { key: 'chat', label: 'Chat', clip: true, width: '16%' },
    { key: 'harness', label: 'Motore', width: '80px' },
    { key: 'esito', label: 'Esito', width: '90px', help: 'pieno = lode senza riserve; parziale = «perfetto, però…»', render: r => <Pill tone={r.esito === 'pieno' ? 'good' : 'warn'}>{r.esito}</Pill> },
    { key: 'parole', label: 'Le tue parole', clip: true },
    { key: 'consegnato', label: 'Cosa era stato consegnato', clip: true },
  ];
  return t.wins.length ? <DataTable name="lodi" label="Lodi" rows={[...t.wins].reverse()} cols={cols} filters={['harness', 'esito']}
    explain={{ find: <><b>{t.wins.length} lodi</b>; la chat che ne ha di più: <b>{byChat[0]?.[0]} ({byChat[0]?.[1]})</b>.</>, says: 'ogni volta che hai scritto «perfetto», «ora funziona»… e cosa era stato consegnato.', why: 'dice cosa funziona, da ripetere.' }} />
    : <Empty title="Ancora nessuna lode registrata">Quando scrivi «perfetto» o «ora funziona» a una chat, la lode e cosa era stato consegnato arrivano qui.</Empty>;
}

function Taccuini({ t, nav }: { t: Tables; nav: Navigate }) {
  const pb = t.playbooks;
  const pts = sum(pb.map(p => p.punti)), proposed = sum(pb.map(p => p.proposti.length));
  const cols: Col<Playbook>[] = [
    { key: 'agent', label: 'Specialista', render: r => <button type="button" className="bx-go" onClick={() => nav(`esplora/playbooks/${r.agent}.md`)}>{r.agent}</button> },
    { key: 'punti', label: 'Punti', type: 'num', help: 'Punti approvati, che lo specialista legge all\'avvio' },
    { key: 'proposti', label: 'In attesa', type: 'num', value: r => r.proposti.length, help: 'Punti proposti dalle chat, non ancora approvati' },
    { key: 'size', label: 'Caratteri (max 2500)', type: 'num', help: 'Il taccuino ha un tetto: quando è pieno si accorpa', render: r => (r.size > 2000 ? <Pill tone="warn">{fmt.int(r.size)}</Pill> : fmt.int(r.size)) },
    { key: 'review', label: 'Da rivedere', value: r => r.review.join(', '), help: 'Punti con più voti «dannoso» che «utile»' },
  ];
  return pb.length ? <DataTable name="taccuini" label="Taccuini degli specialisti" rows={pb} cols={cols} search={false}
    explain={{ find: <><b>{pts} punti</b> imparati in tutto, <b>{proposed} in attesa</b> del tuo sì.</>, next: proposed ? 'la Regia ti porta i punti proposti: un sì e lo specialista li usa' : undefined, says: 'il taccuino di ogni specialista: cosa ha imparato dai suoi errori e dalle tue lodi.', why: 'ogni punto rende lo specialista più bravo senza appesantire le altre chat.' }} />
    : <Empty title="Nessun taccuino" />;
}

function Proposte({ t }: { t: Tables }) {
  const st = countBy(t.proposals, r => r.stato), tp = countBy(t.proposals, r => r.tipo).slice(0, 10);
  const applied = t.proposals.filter(p => p.stato === 'applicata').length, measured = t.proposals.filter(p => /confermata|inutile|peggiorata/.test(p.stato)).length;
  const cols: Col<Proposal>[] = [
    { key: 'id', label: 'Id', width: '72px', nowrap: true },
    { key: 'data', label: 'Data', type: 'date', width: '92px', render: r => fmt.day(r.data) },
    { key: 'proposta', label: 'Proposta', clip: true },
    { key: 'tipo', label: 'Tipo', width: '100px' },
    { key: 'stato', label: 'Stato', width: '110px', help: 'proposta → accettata → applicata → confermata (misurata e utile), oppure rifiutata / inutile / peggiorata', render: r => <Pill tone={propTone(r.stato)}>{r.stato || '—'}</Pill> },
    { key: 'dettaglio', label: 'Dettaglio', clip: true, hidden: true },
  ];
  return (
    <>
      <div className="bx-grid-2">
        <HBarChart title="Proposte per stato" name="proposte-stato" labels={st.map(([k]) => k)} series={[{ label: 'proposte', values: st.map(([, v]) => v) }]}
          explain={{ find: <><b>{applied} applicate ma solo {measured} misurate</b> (confermate, inutili o peggiorate).</>, next: 'chiedi una misura per le applicate: senza, non sai se hanno aiutato', says: 'a che punto è ogni proposta di miglioramento.', why: 'tenere solo ciò che migliora davvero.' }} />
        <HBarChart title="Proposte per tipo" name="proposte-tipo" labels={tp.map(([k]) => k)} series={[{ label: 'proposte', values: tp.map(([, v]) => v) }]}
          explain={{ find: tp[0] ? <>Quasi sempre <b>{tp[0][0]}</b> ({tp[0][1]} su {t.proposals.length}).</> : undefined, says: 'di che tipo sono le proposte.', why: 'troppe regole e pochi script = più testo da rileggere.' }} />
      </div>
      <DataTable name="proposte" label="Proposte" rows={[...t.proposals].reverse()} cols={cols} filters={['stato', 'tipo']} detailTitle={r => `${r.id} · ${r.proposta}`}
        explain={{ says: 'ogni proposta (regola, script, hook, agente) e il suo esito.', why: 'serve a non riproporre ciò che hai già scartato.' }} />
    </>
  );
}

function Misure({ t }: { t: Tables }) {
  const m = t.measures.filter(x => x.metric === 'interventi_forzati').sort((a, b) => a.date.localeCompare(b.date));
  const keys = [...new Set(m.flatMap(x => Object.keys(x.breakdown ?? {})))];
  const first = m[0], last = m[m.length - 1];
  const rows = [...t.measures].sort((a, b) => b.date.localeCompare(a.date));
  const cols: Col<Measure>[] = [
    { key: 'date', label: 'Data', type: 'date', width: '92px', render: r => fmt.day(r.date) },
    { key: 'metric', label: 'Metrica' },
    { key: 'value', label: 'Valore', type: 'num', width: '80px' },
    { key: 'human', label: 'Tuoi messaggi', type: 'num', width: '120px', help: 'Quanti messaggi hai scritto quel giorno: per confrontare giorni pieni e vuoti' },
    { key: 'model', label: 'Modello', width: '150px' },
    { key: 'brain', label: 'Versione cervello', width: '130px', help: 'Il commit del cervello di quel giorno: lega una misura a un cambio di regole' },
    ...keys.map(k => ({ key: `b:${k}`, label: k.replace(/_/g, ' '), type: 'num' as const, hidden: true, value: (r: Measure) => r.breakdown?.[k] ?? '' })),
  ];
  return (
    <>
      {m.length ? <StackedBars title="Interventi forzati per giorno" name="interventi-forzati" height={240} labels={m.map(x => fmt.day(x.date))} series={keys.map(k => ({ label: k.replace(/_/g, ' '), values: m.map(x => x.breakdown?.[k] ?? 0) }))}
        explain={{ find: first && last && first !== last ? <>Dal {fmt.day(first.date)} al {fmt.day(last.date)}: <b>da {first.value} a {last.value}</b> interventi al giorno.</> : undefined, next: 'se sale, guarda il colore più alto: è il tipo di intervento da eliminare', says: "quante volte al giorno hai dovuto correggere, rispiegare o sollecitare l'IA.", why: 'è la misura di quanto il cervello ti fa perdere tempo: più basso è meglio.' }} />
        : <Empty title="Nessuna misura registrata" />}
      <DataTable name="misure" label="Misure" rows={rows} cols={cols} filters={['metric']} sort={{ key: 'date', dir: -1 }} />
    </>
  );
}

function Bug({ t }: { t: Tables }) {
  const areas = countBy(t.bugs, r => r.area), pats = countBy(t.bugs, r => r.pattern);
  const cols: Col<BugRow>[] = [
    { key: 'data', label: 'Data', type: 'date', width: '92px', render: r => fmt.day(r.data) },
    { key: 'area', label: 'Area', width: '16%' },
    { key: 'bug', label: 'Bug', clip: true },
    { key: 'pattern', label: 'Schema', width: '90px', help: 'Il tipo di errore ricorrente (catalogo del reviewer)' },
    { key: 'fonte', label: 'Trovato da', width: '120px', clip: true },
    { key: 'rif', label: 'Rif.', width: '120px', clip: true },
  ];
  return (
    <>
      {pats.length > 1 && <HBarChart title="Bug per schema" name="bug-schema" labels={pats.slice(0, 10).map(([k]) => k)} series={[{ label: 'bug', values: pats.slice(0, 10).map(([, v]) => v) }]} />}
      <DataTable name="bug-log" label="Bug confermati" rows={[...t.bugs].reverse()} cols={cols} filters={['area', 'pattern']}
        explain={{ find: areas[0] ? <>L'area con più bug: <b>{areas[0][0]} ({areas[0][1]})</b>.</> : undefined, next: areas[0] ? "prima di una review in quell'area, guarda questi bug: gli schemi si ripetono" : undefined, says: 'ogni bug confermato, con il suo schema.', why: 'gli schemi che tornano diventano controlli del reviewer.' }} />
    </>
  );
}

export function Qualita({ arg, nav }: { arg?: string; nav: Navigate }) {
  const t = useBrain('/api/tables', normTables);
  const tab: Tab = TABS.includes(arg as Tab) ? (arg as Tab) : 'errori';
  const d = t.data;
  const week = d ? d.errors.filter(r => daysBetween(r.data, d.today) < 7).length : 0;
  const rules = d?.recurrence.rules ?? [];
  const held = rules.filter(r => !r.again).length;
  return (
    <>
      <PageHead title="Qualità" at={t.at} onRefresh={() => t.reload()}
        lead={d ? <><b>{d.errors.length} errori</b> dell'IA registrati ({week} negli ultimi 7 giorni), <b>{d.wins.length} lodi</b>{rules.length ? <>; <b>{held} regole su {rules.length}</b> hanno fermato il loro errore</> : null}.</> : undefined}
        what="Come lavora l'IA, dai registri del cervello: errori, regole, lodi, taccuini, proposte, misure e bug." />
      <Async loading={t.loading && !d} error={d ? null : t.error} onRetry={() => t.reload()} lines={6} block>
        {() => d && (
          <>
            <Tabs label="Sezioni della qualità" value={tab} onChange={id => nav(id === 'errori' ? 'qualita' : `qualita/${id}`)} items={[
              { id: 'errori', label: 'Errori', n: d.errors.length }, { id: 'regole', label: 'Regole servite?', n: rules.length }, { id: 'lodi', label: 'Lodi', n: d.wins.length },
              { id: 'taccuini', label: 'Taccuini', n: d.playbooks.length }, { id: 'proposte', label: 'Proposte', n: d.proposals.length }, { id: 'misure', label: 'Misure', n: d.measures.length }, { id: 'bug', label: 'Bug', n: d.bugs.length },
            ]} />
            <div className="bx-section" data-testid={`bx-quality-${tab}`}>
              {tab === 'errori' ? <Errori t={d} /> : tab === 'regole' ? <Regole t={d} /> : tab === 'lodi' ? <Lodi t={d} /> : tab === 'taccuini' ? <Taccuini t={d} nav={nav} /> : tab === 'proposte' ? <Proposte t={d} /> : tab === 'misure' ? <Misure t={d} /> : <Bug t={d} />}
            </div>
          </>
        )}
      </Async>
    </>
  );
}
