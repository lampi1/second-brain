// Views of a day shared by Oggi, Fatto and Da fare: what was done grouped by topic (PRs, work items, diary outcomes,
// chats; names not numbers, the id only inside the link), what is open grouped by topic (your PRs named after their
// bug, work items, now.md threads, the AI-found bugs that wait for a human), and the stand-up box (3-5 sentences to
// read aloud, with Copia). Data: /api/day (report or brief, from the brain's day tool) and /api/tables.
import type { ReactNode } from 'react';
import { normBrief, normReport, type Brief, type BriefPr, type DayReport, type DayRow, type Tables } from '../types';
import { useBrain, combine } from '../api';
import { bugName, clean, devopsIndex, firstClause, firstPerson, isAgentsSection, isDecision, lastDiaryDay, linkify, nextText, prName, short, standupText, topicOf } from '../lib/text';
import { dayName } from '../lib/format';
import { Async, NoDevops } from '../components/States';
import { copyText, ExtLink, IconCopy, Linked, Pill, toast, type Tone } from '../components/ui';

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

function prLine(p: BriefPr) {
  const build = p.build === 'succeeded' ? <Pill tone="good">build verde</Pill> : p.build ? <Pill tone="bad">build {p.build}</Pill> : p.draft ? <Pill tone="outline">bozza</Pill> : <Pill>PR</Pill>;
  return (
    <>
      {build}
      <span className="t">
        <ExtLink href={p.url}>{prName(p)}</ExtLink>
        <span className="sub"> · PR verso {p.target || '?'}{p.votes ? ` · voti: ${p.votes}` : ''}</span>
        {p.items.length > 0 && (
          <details>
            <summary>{p.items.length} work item collegati</summary>
            <ul>{p.items.map((i, k) => <li key={k}><Pill tone={stateTone(i.state)}>{i.state}</Pill> <ExtLink href={i.url}>{bugName(i.title)}</ExtLink>{i.assignee && <span className="muted"> · a {i.assignee}</span>}</li>)}</ul>
          </details>
        )}
      </span>
    </>
  );
}

/** What is open, one card per topic: PRs, work items, now.md threads; the AI-found bugs apart (a human validates them first). */
export function TodoView({ br, owner }: { br: Brief; owner: string }) {
  const idx = devopsIndex(br);
  type Line = { k: string; node: ReactNode };
  const by = new Map<string, Line[]>();
  const push = (a: string, l: Line) => by.set(a, [...(by.get(a) ?? []), l]);
  br.prs.forEach((p, i) => push(p.area, { k: `p${i}`, node: prLine(p) }));
  br.items.filter(i => !i.aiFound).forEach((i, k) => push(i.area, { k: `i${k}`, node: <><Pill tone={stateTone(i.state)}>{i.state}</Pill><span className="t"><ExtLink href={i.url}>{bugName(i.title)}</ExtLink><span className="sub"> · {i.type}{topicOf(i.title) ? ` · ${topicOf(i.title)}` : ''}</span></span></> }));
  br.threads.filter(t => !t.done && !isAgentsSection(t.section)).forEach((t, k) => push(t.area, {
    k: `t${k}`, node: <>{t.stale ? <Pill tone="bad">fermo</Pill> : isDecision(t, owner) ? <Pill tone="warn">decidi</Pill> : <Pill>filo</Pill>}<span className="t"><b>{t.label}</b>{t.next && <> · <Linked parts={linkify(short(firstPerson(nextText(t.next), owner), 140), idx)} /></>}</span></>,
  }));
  const found = br.items.filter(i => i.aiFound);
  const order = [...new Set([...br.areas, ...by.keys()])].filter(a => by.get(a)?.length);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {br.devops === false && <NoDevops />}
      <div className="bx-topics">
        {order.map(a => (
          <div key={a} className="bx-topic bx-card" data-testid={`bx-todo-${a}`}>
            <h3>{a}<span className="count">{by.get(a)?.length}</span></h3>
            <ul className="bx-done">{by.get(a)?.map(l => <li key={l.k}>{l.node}</li>)}</ul>
          </div>
        ))}
        {found.length > 0 && (
          <div className="bx-topic bx-card">
            <h3>Bug trovati dall'IA<span className="count">{found.length}</span></h3>
            <p className="small muted">Da validare: si toccano solo dopo che un umano li ha guardati.</p>
            <ul className="bx-done">{found.map((i, k) => <li key={k}><Pill tone="outline">{i.state}</Pill><span className="t"><ExtLink href={i.url}>{bugName(i.title)}</ExtLink></span></li>)}</ul>
          </div>
        )}
      </div>
      {!order.length && !found.length && <p className="muted">Niente di aperto: nessuna PR, nessun work item, nessun filo.</p>}
    </div>
  );
}

/** The stand-up box: the last work day and today, in sentences to read aloud. */
export function Standup({ tables, owner }: { tables: Tables; owner: string }) {
  const prev = lastDiaryDay(tables.journal, tables.today);
  const rep = useBrain(`/api/day?kind=report&date=${prev}`, normReport);
  const br = useBrain('/api/day?kind=brief', normBrief);
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
