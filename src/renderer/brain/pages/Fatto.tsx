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
import { t as tr } from '../../i18n';

const tagTone = (tag: string): Tone => (/fatto|verificato/.test(tag) ? 'good' : /decisione/.test(tag) ? 'violet' : /attrito/.test(tag) ? 'warn' : /lezione/.test(tag) ? 'blue' : '');

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
    { key: 'ora', label: tr('brainPages.fatto.colTime'), nowrap: true, width: '70px' },
    { key: 'tag', label: tr('brainPages.fatto.colType'), width: '120px', help: tr('brainPages.fatto.colTypeHelp'), render: r => <Pill tone={tagTone(r.tag)}>{r.tag || '—'}</Pill> },
    { key: 'area', label: tr('brainPages.fatto.colArea'), width: '100px' },
    { key: 'testo', label: tr('brainPages.fatto.colWhat'), clip: true },
  ];

  return (
    <>
      <PageHead title={isToday ? tr('brainPages.fatto.titleToday') : tr('brainPages.fatto.titleDay', { day: dayName(day, today).toLowerCase(), dayLong: fmt.dayLong(day) })}
        at={rep.at} refreshing={rep.refreshing} onRefresh={() => rep.reload(true)}
        lead={rep.data ? <><b>{tr('brainPages.fatto.outcomes', { n: outcomes.length })}</b>{prs ? `, ${prs} ${tr('brainPages.fatto.pr')}` : ''}{items ? `, ${items} ${tr('brainPages.fatto.workItem')}` : ''} · {tr('brainPages.fatto.diaryRows', { n: journal.length })}</> : undefined}
        what={tr('brainPages.fatto.what')}
        actions={day && (
          <div className="bx-row" role="group" aria-label={tr('brainPages.fatto.dayGroup')}>
            <button type="button" className="bx-btn s" aria-label={tr('brainPages.fatto.prevDay')} onClick={() => go(shiftDay(day, -1))}><IconChevL /></button>
            <input className="bx-input" style={{ height: 24, fontSize: 12 }} type="date" value={day} max={today} aria-label={tr('brainPages.fatto.chooseDay')} onChange={e => { if (isDay(e.target.value)) go(e.target.value); }} />
            <button type="button" className="bx-btn s" aria-label={tr('brainPages.fatto.nextDay')} disabled={isToday} onClick={() => go(shiftDay(day, 1))}><IconChevR /></button>
            {!isToday && <button type="button" className="bx-btn s" onClick={() => go(today)}>{tr('brainPages.fatto.today')}</button>}
          </div>
        )} />
      {isToday && t.data && <Standup tables={t.data} owner={owner} />}
      <Async loading={rep.loading && !rep.data} error={rep.data ? null : rep.error} onRetry={() => rep.reload()}
        label={tr('brainPages.fatto.preparing', { isToday })} lines={4} block>
        {() => rep.data && <DoneView rep={rep.data} />}
      </Async>
      <details className="bx-details" open={!isToday || undefined} data-testid="bx-diary">
        <summary>{tr('brainPages.fatto.diaryTitle', { n: journal.length })}</summary>
        <div className="body">
          <DataTable name={`diario-${day}`} label={tr('brainPages.fatto.diaryLabel')} rows={journal} cols={cols} filters={['tag', 'area']} search={false} empty={tr('brainPages.fatto.diaryEmpty')} />
        </div>
      </details>
      {rep.data?.text && (
        <details className="bx-details">
          <summary>{tr('brainPages.fatto.detailTitle', { commits: rep.data.commits.length })}</summary>
          <div className="body"><Markdown text={rep.data.text} name={`giornata-${day}`} /></div>
        </details>
      )}
    </>
  );
}
