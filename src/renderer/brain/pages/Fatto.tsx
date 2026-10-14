// Fatto e standup: what the work Regia and its chats did on a day (today by default; ← → or the date picker for
// another day), grouped by topic with DevOps links (PRs, work items), the stand-up sentences (today), the diary of the
// day as a table and the full technical report folded. The app's own work is left out (lib/appwork.ts: it has its
// place in "Migliora l'app"). Data: /api/day?kind=report&date=…, /api/tables.
import { normTables, type JournalRow } from '../types';
import { useBrain } from '../api';
import { dayName, fmt, isDay, shiftDay } from '../lib/format';
import { ownerOf } from '../lib/text';
import { normWorkReport, workJournal } from '../lib/appwork';
import { Async, PageHead } from '../components/States';
import { DataTable, type Col } from '../components/DataTable';
import { Markdown } from '../components/Markdown';
import { IconChevL, IconChevR, Pill, type Navigate, type Tone } from '../components/ui';
import { DoneView, DONE_TAGS, Standup } from './day';

const tagTone = (t: string): Tone => (/fatto|verificato/.test(t) ? 'good' : /decisione/.test(t) ? 'violet' : /attrito/.test(t) ? 'warn' : /lezione/.test(t) ? 'blue' : '');

export function Fatto({ arg, nav }: { arg?: string; nav: Navigate }) {
  const t = useBrain('/api/tables', normTables);
  const today = t.data?.today ?? '';
  const day = isDay(arg) ? arg : today;
  const rep = useBrain(day ? `/api/day?kind=report&date=${day}` : null, normWorkReport);
  const owner = t.data ? ownerOf(t.data.ideas) : '';
  const journal = workJournal((t.data?.journal ?? []).filter(r => r.data === day));
  const outcomes = rep.data ? rep.data.rows.filter(r => r.kind !== 'diario' || DONE_TAGS.test(r.tag ?? '')) : [];
  const prs = outcomes.filter(r => /^pr-/.test(r.kind)).length, items = outcomes.filter(r => r.kind === 'work-item').length;
  const isToday = day === today;
  const go = (d: string) => nav(d === today ? 'fatto' : `fatto/${d}`);
  const cols: Col<JournalRow>[] = [
    { key: 'ora', label: 'Ora', nowrap: true, width: '70px' },
    { key: 'tag', label: 'Tipo', width: '120px', help: 'fatto = un esito; decisione; lezione = cosa hai imparato; attrito = tempo perso', render: r => <Pill tone={tagTone(r.tag)}>{r.tag || '—'}</Pill> },
    { key: 'area', label: 'Area', width: '100px' },
    { key: 'testo', label: 'Cosa', clip: true },
  ];

  return (
    <>
      <PageHead title={isToday ? 'Fatto oggi' : `Fatto ${dayName(day, today).toLowerCase() === 'ieri' ? 'ieri' : `il ${fmt.dayLong(day)}`}`}
        at={rep.at} refreshing={rep.refreshing} onRefresh={() => rep.reload(true)}
        lead={rep.data ? <><b>{outcomes.length} {outcomes.length === 1 ? 'esito' : 'esiti'}</b>{prs ? `, ${prs} PR` : ''}{items ? `, ${items} work item` : ''} · {journal.length} righe di diario.</> : undefined}
        what="Gli esiti del giorno per argomento: PR, bug, chat e diario. I link aprono DevOps fuori dall'app."
        actions={day && (
          <div className="bx-row" role="group" aria-label="Giorno">
            <button type="button" className="bx-btn s" aria-label="Giorno prima" onClick={() => go(shiftDay(day, -1))}><IconChevL /></button>
            <input className="bx-input" style={{ height: 24, fontSize: 12 }} type="date" value={day} max={today} aria-label="Scegli il giorno" onChange={e => { if (isDay(e.target.value)) go(e.target.value); }} />
            <button type="button" className="bx-btn s" aria-label="Giorno dopo" disabled={isToday} onClick={() => go(shiftDay(day, 1))}><IconChevR /></button>
            {!isToday && <button type="button" className="bx-btn s" onClick={() => go(today)}>Oggi</button>}
          </div>
        )} />
      {isToday && t.data && <Standup tables={t.data} owner={owner} />}
      <Async loading={rep.loading && !rep.data} error={rep.data ? null : rep.error} onRetry={() => rep.reload()}
        label={`Preparo il giorno: leggo DevOps e le chat (${isToday ? 'pochi secondi' : 'fino a 40 secondi per un giorno passato'} la prima volta)…`} lines={4} block>
        {() => rep.data && <DoneView rep={rep.data} />}
      </Async>
      <details className="bx-details" open={!isToday || undefined} data-testid="bx-diary">
        <summary>Il diario del giorno · {journal.length} righe</summary>
        <div className="body">
          <DataTable name={`diario-${day}`} label="Diario del giorno" rows={journal} cols={cols} filters={['tag', 'area']} search={false} empty="Nessuna riga nel diario per questo giorno." />
        </div>
      </details>
      {rep.data?.text && (
        <details className="bx-details">
          <summary>Dettaglio tecnico (report completo{rep.data.commits.length ? `, ${rep.data.commits.length} commit` : ''})</summary>
          <div className="body"><Markdown text={rep.data.text} name={`giornata-${day}`} /></div>
        </details>
      )}
    </>
  );
}
