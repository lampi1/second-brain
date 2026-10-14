// Views of a day for Fatto: what was done grouped by topic (PRs, work items, diary outcomes, chats; names not numbers,
// the id only inside the link) and the stand-up box (3-5 sentences to read aloud, with Copia), both without the app's
// own work (lib/appwork.ts). Data: /api/day (report or brief, from the brain's day tool) and /api/tables.
import type { ReactNode } from 'react';
import type { DayReport, DayRow, Tables } from '../types';
import { useBrain, combine } from '../api';
import { bugName, clean, firstClause, lastDiaryDay, short, standupText, topicOf } from '../lib/text';
import { normWorkBrief, normWorkReport } from '../lib/appwork';
import { dayName } from '../lib/format';
import { Async, NoDevops } from '../components/States';
import { copyText, ExtLink, IconCopy, Pill, toast, type Tone } from '../components/ui';

export const DONE_TAGS = /fatto|verificato|decisione/i;
const stateTone = (s: string): Tone => (/resolved|closed|done|chius|fatt/i.test(s) ? 'good' : /active|in corso|progress/i.test(s) ? 'blue' : /new|nuov/i.test(s) ? 'outline' : '');

function doneLine(r: DayRow): ReactNode {
  if (r.kind === 'pr-unita') return <><Pill tone="good">PR unita</Pill><span className="t"><ExtLink href={r.url}>{clean(r.title)}</ExtLink></span></>;
  if (r.kind === 'pr-aperta') return <><Pill tone="blue">PR aperta</Pill><span className="t"><ExtLink href={r.url}>{clean(r.title)}</ExtLink></span></>;
  if (r.kind === 'work-item') return <><Pill tone={stateTone(r.state ?? '')}>{r.state || 'work item'}</Pill><span className="t"><ExtLink href={r.url}>{bugName(r.title)}</ExtLink>{topicOf(r.title) && <span className="sub"> · {topicOf(r.title)}</span>}</span></>;
  if (r.kind === 'diario') return <><Pill tone={/decisione/i.test(r.tag ?? '') ? 'violet' : 'good'}>{(r.tag ?? '').replace(/\[personale\]\s*/i, '') || 'diario'}</Pill><span className="t">{firstClause(r.title)}</span></>;
  if (r.kind === 'chat') return <><Pill>chat</Pill><span className="t">{r.title}<span className="sub"> · {r.from}–{r.to}{r.his ? ` · ${r.his} tuoi messaggi` : ''}</span></span></>;
  return <><Pill tone="outline">{/cursor/i.test(r.kind) ? 'chat' : r.kind || 'altro'}</Pill><span className="t">{short(r.title.replace(/ · id \w+$/, ''), 90)}</span></>;
}

/** What was done, one card per topic. `max` lines per topic (the rest counted). */
export function DoneView({ rep, max = 12, compact = false }: { rep: DayReport; max?: number; compact?: boolean }) {
  const by = new Map<string, DayRow[]>();
  for (const r of rep.rows) {
    if (r.kind === 'diario' && !DONE_TAGS.test(r.tag ?? '')) continue;
    if (compact && /cursor/.test(r.kind)) continue;
    by.set(r.area, [...(by.get(r.area) ?? []), r]);
  }
  const order = [...new Set([...rep.areas, ...by.keys()])].filter(a => by.get(a)?.length);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rep.devops === false && <NoDevops />}
      {!order.length ? <p className="muted">Niente registrato per questo giorno.</p> : (
        <div className={compact ? '' : 'bx-topics'} style={compact ? { display: 'grid', gap: 14 } : undefined}>
          {order.map(a => {
            const rows = by.get(a) ?? [];
            const body = (
              <>
                <h3>{a}<span className="count">{rows.length}</span></h3>
                <ul className="bx-done">{rows.slice(0, max).map((r, i) => <li key={i}>{doneLine(r)}</li>)}</ul>
                {rows.length > max && <p className="small muted">… e altre {rows.length - max}</p>}
              </>
            );
            return compact ? <div key={a} className="bx-topic">{body}</div> : <div key={a} className="bx-topic bx-card">{body}</div>;
          })}
        </div>
      )}
    </div>
  );
}

/** The stand-up box: the last work day and today, in sentences to read aloud. */
export function Standup({ tables, owner }: { tables: Tables; owner: string }) {
  const prev = lastDiaryDay(tables.journal, tables.today);
  const rep = useBrain(`/api/day?kind=report&date=${prev}`, normWorkReport);
  const br = useBrain('/api/day?kind=brief', normWorkBrief);
  const st = combine(rep, br);
  const text = rep.data && br.data ? standupText(rep.data, br.data, owner) : '';
  return (
    <section className="bx-card bx-standup bx-section" aria-labelledby="bx-standup-h" data-testid="bx-standup">
      <div className="bx-section-head">
        <h2 id="bx-standup-h">Per lo standup</h2>
        <p>{dayName(prev, tables.today).toLowerCase()} e oggi, da leggere a voce</p>
        <span className="sp" />
        {text && <button type="button" className="bx-btn s" onClick={() => void copyText(text).then(ok => toast(ok ? 'Frasi copiate' : 'Copia non riuscita: seleziona il testo'))}><IconCopy /> Copia</button>}
      </div>
      <Async loading={st.loading} error={st.error} onRetry={() => { rep.reload(); br.reload(); }} label="Preparo le frasi (DevOps e diario)…" lines={3}>
        {() => (
          <>
            {(rep.data?.devops === false || br.data?.devops === false) && <NoDevops />}
            <div className="lines">{text.split('\n').map((s, i) => <p key={i}>{s}</p>)}</div>
            <p className="small muted">Fatto dal diario, dalle chat{rep.data?.devops === false ? '' : ' e da DevOps'}; da fare dal brief e dai fili aperti.</p>
          </>
        )}
      </Async>
    </section>
  );
}
