// Qualità: four numbers about how well the AI works, each with its source and the dates it covers, and the next step
// (the user, 2026-10-13: "la sezione qualità sia veramente utile e veritiera"; few, true, actionable). 1) errors he had
// to catch himself per 100 turns (ai-errors.md "visto da" ÷ the app's finished turns, same days only); 2) rules whose
// error came back within 14 days (11 official types, near-duplicates mapped, rows out of the count shown, young rules
// "troppo presto"); 3) his active PRs held by a failed build or QA; 4) his resolved bugs sent back to an open state.
// The improvement proposals are one row. Praise, notebooks and measures are gone until they have real data. Below the
// numbers, the errors that repeat, grouped by pattern (ADR 0037: count, last seen, chats, rule, this week against the
// one before). Every number and every pattern has its reading and the discussion bar ("Discuti", to the Orchestrator).
// Data: /api/tables (the brain: tables.errors, tables.quality, proposals) and /api/quality (main: turns, PRs, reopened
// bugs); computations in lib/quality.ts and lib/stats.ts.
import type { ReactNode } from 'react';
import { normAppQuality, normTables } from '../types';
import { FeedbackOrigins } from '../components/FeedbackOrigins';
import { useBrain } from '../api';
import { fmt } from '../lib/format';
import { ownerOf, short } from '../lib/text';
import { caughtPer100, caughtWeeks, outOfCount, rate, reopenShare, ruleStats } from '../lib/quality';
import { errorPatterns, trend, type Trend } from '../lib/stats';
import type { Quote } from '../lib/discuss';
import { Async, Explain, PageHead } from '../components/States';
import { HelpTip } from '../../components/HelpTip';
import { DiscussBar } from '../components/Discuss';
import { ErrorPatterns, PatternsHelp, Reading } from '../components/Stats';
import { ExtLink, Pill, Section, type Navigate, type Tone } from '../components/ui';
import { locale, t as tr, type TextKey } from '../../i18n';

const STATUS: Record<string, { label: TextKey; tone: Tone }> = {
  tornato: { label: 'brainText.qualita.status.tornato', tone: 'bad' }, 'non-tornato': { label: 'brainText.qualita.status.nonTornato', tone: 'good' },
  'troppo-presto': { label: 'brainText.qualita.status.presto', tone: '' }, 'senza-tipo': { label: 'brainText.qualita.status.senzaTipo', tone: 'warn' },
};
const statusLabel = (s: string) => { const k = STATUS[s]?.label; return k ? tr(k) : undefined; };
const range = (from: string | null | undefined, to: string | null | undefined) => (from && to ? (from === to ? tr('brainText.qualita.rangeOne', { day: fmt.day(from) }) : tr('brainText.qualita.rangeSpan', { from: fmt.day(from), to: fmt.day(to) })) : tr('brainText.qualita.noData'));
const num = (n: number) => n.toLocaleString(locale());

function Metric({ id, title, help, value, unit, tone, reading, find, next, source, quote, children }: {
  id: string; title: string; help?: ReactNode; value: ReactNode; unit?: ReactNode; tone?: 'warn' | 'bad'; reading?: Trend | null; find?: ReactNode; next?: ReactNode; source: ReactNode;
  quote?: Quote; children?: ReactNode;
}) {
  return (
    <section className={`bx-card bx-q ${tone ?? ''}`} data-testid={`bx-q-${id}`} aria-labelledby={`bx-q-${id}-h`}>
      <h2 className="bx-eyebrow"><span id={`bx-q-${id}-h`}>{title}</span>{help && <HelpTip label={title} guide="quality" testid={`bx-q-${id}-help`}>{help}</HelpTip>}</h2>
      <p className="bx-q-v"><span className="bx-big">{value}</span>{unit && <span className="u"> {unit}</span>}</p>
      {reading && <Reading t={reading} testId={`bx-q-${id}-reading`} />}
      <Explain find={find} next={next} />
      <p className="bx-q-src"><b>{tr('brainText.qualita.source')}</b> {source}</p>
      {children}
      {quote && <DiscussBar topic={{ kind: 'quote', quote }} testId={`bx-q-${id}-discuss`} />}
    </section>
  );
}

export function Qualita({ nav }: { arg?: string; nav: Navigate }) {
  const t = useBrain('/api/tables', normTables);
  const a = useBrain('/api/quality', normAppQuality);
  const d = t.data, app = a.data, q = d?.quality ?? null;
  const reload = () => { t.reload(); a.reload(true); }; // fresh: main reads DevOps again now (brain/quality.ts)

  const caught = q && app ? caughtPer100(q.seenByDay, app.turns) : null;
  const rules = q ? ruleStats(q) : null;
  const out = q ? outOfCount(q) : null;
  const share = app ? reopenShare(app.reopen) : null;
  const weeks = caught ? caughtWeeks(caught) : null;
  const caughtReading = weeks && weeks.cur !== null
    ? trend(weeks.cur, weeks.prev, { what: tr('brainText.qualita.per100'), now: tr('brainText.common.last7'), before: tr('brainText.common.prev7') }) : null;
  const patterns = d ? errorPatterns(d.errors, q?.rules ?? [], d.today, ownerOf(d.ideas)) : null;
  const errReading = patterns && patterns.to ? trend(patterns.week, patterns.prevWeek, { what: tr('brainText.qualita.errLogged', { n: patterns.week }), now: tr('brainText.common.last7'), before: tr('brainText.common.prev7') }) : null;
  const applied = d?.proposals.filter(p => p.stato === 'applicata').length ?? 0;
  const measured = d?.proposals.filter(p => /confermata|inutile|peggiorata/.test(p.stato)).length ?? 0;

  return (
    <>
      <PageHead title={tr('brainText.qualita.title')} at={t.at} onRefresh={reload} refreshing={app?.reopen.refreshing}
        lead={caught && rules && app ? <>
          {caught.per100 !== null ? <><b>{tr('brainText.qualita.leadCaught', { n: num(caught.per100) })}</b>{tr('brainText.qualita.leadCaughtRest')}</> : <>{tr('brainText.qualita.leadNotMeasured')}</>};{' '}
          <b>{tr('brainText.qualita.leadRules', { n: rules.tornato, of: rules.judged })}</b>{tr('brainText.qualita.leadRulesRest')}; {app.prs.at ? <><b>{tr('brainText.qualita.leadPrs', { n: app.prs.blocked.length })}</b></> : <>{tr('brainText.qualita.leadPrsUnread')}</>}; {app.reopen.at ? <><b>{tr('brainText.qualita.leadBugs', { n: app.reopen.bugs.length })}</b>{tr('brainText.qualita.leadBugsRest', { days: app.reopen.days })}</> : <>{tr('brainText.qualita.leadBugsUnread')}</>}.
        </> : undefined}
        what={tr('brainText.qualita.what')} guide="quality" />
      <Async loading={t.loading && !d} error={d ? null : t.error} onRetry={reload} lines={6} block>
        {() => d && (
          <div className="bx-section" data-testid="bx-quality">
            {!q && <p className="bx-warnline" role="note">{tr('brainText.qualita.noQuality')}</p>}
            <div className="bx-grid-2">
              {q && <Metric id="trovati" title={tr('brainText.qualita.caught.title')}
                help={tr('brainText.qualita.caught.help')}
                value={caught?.per100 != null ? num(caught.per100) : '—'} unit={tr('brainText.qualita.per100')} tone={caught?.per100 ? 'warn' : undefined}
                reading={caughtReading}
                quote={caught?.per100 != null ? { id: 'q|trovati', what: 'numero', title: tr('brainText.qualita.caught.quoteTitle'), source: tr('brainText.qualita.caught.quoteSource'),
                  facts: [tr('brainText.qualita.caught.fact', { per100: num(caught.per100), range: range(caught.from, caught.to), caught: caught.caught, turns: caught.turns, others: caught.others }),
                    caughtReading ? caughtReading.text : '', tr('brainText.qualita.caught.factOutside')],
                  question: tr('brainText.qualita.caught.question') } : undefined}
                find={caught && caught.from ? <>{range(caught.from, caught.to)}: <b>{tr('brainText.qualita.caught.find', { n: caught.caught })}</b>{tr('brainText.qualita.caught.findRest', { turns: fmt.int(caught.turns), others: caught.others })}{caught.unknown ? <>{tr('brainText.qualita.caught.unknown', { n: caught.unknown })}</> : null}</>
                  : <>{tr('brainText.qualita.caught.noTurns')}</>}
                next={caught?.caught ? <>{tr('brainText.qualita.caught.nextOpen')}<button type="button" className="bx-go" onClick={() => nav('esplora/ai-errors.md')}>ai-errors.md</button>{tr('brainText.qualita.caught.nextRest')}</> : undefined}
                source={<>{tr('brainText.qualita.caught.source', { range: range(app?.turns.from, app?.turns.to) })}{caught?.before ? <>{tr('brainText.qualita.caught.before', { n: caught.before })}</> : null}</>}>
                {caught && caught.days.length > 0 && (
                  <details className="bx-q-more"><summary>{tr('brainText.qualita.caught.byDay')}</summary>
                    <ul className="bx-list compact" data-testid="bx-q-trovati-days">
                      {caught.days.map(x => <li key={x.date}><span className="meta">{fmt.day(x.date)}</span><span className="t">{tr('brainText.qualita.caught.dayRow', { caught: x.caught, turns: fmt.int(x.turns) })}</span><span className="meta">{rate(x.caught, x.turns)} / 100</span></li>)}
                    </ul>
                  </details>
                )}
              </Metric>}

              {q && rules && out && <Metric id="tornati" title={tr('brainText.qualita.rules.title')}
                help={tr('brainText.qualita.rules.help')}
                value={rules.judged ? tr('brainText.common.ofCount', { n: rules.tornato, of: rules.judged }) : '—'} unit={tr('brainText.qualita.rules.unit', { days: q.windowDays })} tone={rules.tornato ? 'bad' : undefined}
                quote={rules.judged ? { id: 'q|tornati', what: 'numero', title: tr('brainText.qualita.rules.quoteTitle'), source: tr('brainText.qualita.rules.quoteSource'),
                  facts: [tr('brainText.qualita.rules.fact', { n: rules.tornato, of: rules.judged, days: q.windowDays, range: range(q.from, q.to) }),
                    ...rules.rules.filter(r => r.status === 'tornato').slice(0, 4).map(r => tr('brainText.qualita.rules.factFailed', { rule: r.rule, type: r.type, area: r.area, dates: r.again.map(x => fmt.day(x.date)).join(', ') })),
                    tr('brainText.qualita.rules.factYoung', { n: rules.presto })],
                  question: tr('brainText.qualita.rules.question') } : undefined}
                find={<><b>{tr('brainText.qualita.rules.find', { n: rules.presto })}</b>{tr('brainText.qualita.rules.findRest', { days: q.windowDays })}{rules.senzaTipo ? <>{tr('brainText.qualita.rules.findNoType', { n: rules.senzaTipo })}</> : null}.</>}
                next={rules.tornato ? <>{tr('brainText.qualita.rules.nextRewrite')}</> : out.total ? <>{tr('brainText.qualita.rules.nextFix')}</> : undefined}
                source={<>{tr('brainText.qualita.rules.source', { range: range(q.from, q.to), days: q.windowDays })}</>}>
                {out.total > 0 && <p className="bx-warnline" role="note" data-testid="bx-q-fuori">{tr('brainText.qualita.rules.outside', { total: out.total, lines: q.lines, unparsed: out.unparsed, invalid: out.invalid })}</p>}
                {out.total > 0 && (
                  <details className="bx-q-more"><summary>{tr('brainText.qualita.rules.whichRows')}</summary>
                    <ul className="bx-list compact">
                      {out.labels.map(([l, c]) => <li key={l}><span className="t">«{short(l, 70)}»</span><span className="meta">{tr('brainText.qualita.rules.rowCount', { n: c })}</span></li>)}
                      {q.unparsed.map((u, i) => <li key={`u${i}`}><span className="meta">{fmt.day(u.date)}</span><span className="t">{short(u.line.replace(/^- \S+ (\S+ )?· /, ''), 110)}</span><span className="meta">{tr('brainText.qualita.rules.unreadable')}</span></li>)}
                    </ul>
                  </details>
                )}
                {rules.rules.length > 0 && (
                  <ul className="bx-list" data-testid="bx-q-regole">
                    {rules.rules.slice(0, 6).map((r, i) => (
                      <li key={i}><Pill tone={STATUS[r.status]?.tone}>{statusLabel(r.status)}</Pill><span className="t" title={r.rule}>{short(r.rule, 90)}</span><span className="meta">{r.type} · {fmt.day(r.date)}{r.again.length ? tr('brainText.qualita.rules.backOn', { dates: r.again.map(x => fmt.day(x.date)).join(', ') }) : ''}</span></li>
                    ))}
                    {rules.rules.length > 6 && (
                      <li><details className="bx-q-more"><summary>{rules.rules.length === 7 ? tr('brainText.qualita.rules.oneMore') : tr('brainText.qualita.rules.more', { n: rules.rules.length - 6 })}</summary>
                        <ul className="bx-list compact">
                          {rules.rules.slice(6).map((r, i) => <li key={i}><Pill tone={STATUS[r.status]?.tone}>{statusLabel(r.status)}</Pill><span className="t" title={r.rule}>{short(r.rule, 90)}</span><span className="meta">{r.type} · {fmt.day(r.date)}</span></li>)}
                        </ul>
                      </details></li>
                    )}
                  </ul>
                )}
              </Metric>}

              {app && <Metric id="pr" title={tr('brainText.qualita.pr.title')}
                help={tr('brainText.qualita.pr.help')}
                value={app.prs.blocked.length} unit={tr('brainText.qualita.pr.unit', { total: app.prs.total })} tone={app.prs.blocked.length ? 'bad' : undefined}
                quote={app.prs.blocked.length ? { id: 'q|pr', what: 'numero', title: tr('brainText.qualita.pr.quoteTitle'), source: tr('brainText.qualita.pr.quoteSource', { when: app.prs.at ? fmt.when(app.prs.at) : '' }),
                  facts: [tr('brainText.qualita.pr.fact', { n: app.prs.blocked.length, total: app.prs.total }), ...app.prs.blocked.slice(0, 5).map(p => `${p.title} (${p.repo}): ${p.reasons.join(', ')}`)],
                  question: tr('brainText.qualita.pr.question') } : undefined}
                find={app.prs.blocked.length ? <><b>{tr('brainText.qualita.pr.find', { n: app.prs.blocked.length })}</b>{tr('brainText.qualita.pr.findRest')}</> : app.prs.total ? <>{tr('brainText.qualita.pr.noneBlocked')}</> : <>{tr('brainText.qualita.pr.noneActive')}</>}
                next={app.prs.blocked.length ? <>{tr('brainText.qualita.pr.next')}</> : undefined}
                source={<>{tr('brainText.qualita.pr.source')}{app.prs.at ? <>, {fmt.when(app.prs.at)}</> : <>{tr('brainText.qualita.pr.neverRead')}</>}{tr('brainText.qualita.pr.sourceRest')}</>}>
                {app.prs.error && <p className="bx-warnline" role="note">{app.prs.error}</p>}
                {app.prs.blocked.length > 0 && (
                  <ul className="bx-list" data-testid="bx-q-pr-list">
                    {app.prs.blocked.map(p => <li key={p.id}><span className="t"><ExtLink href={p.url}>{p.title}</ExtLink><br /><span className="meta">{p.reasons.join(' · ')}</span></span><span className="meta">{p.repo}</span></li>)}
                  </ul>
                )}
              </Metric>}

              {app && <Metric id="riaperti" title={tr('brainText.qualita.reopen.title')}
                help={tr('brainText.qualita.reopen.help')}
                value={app.reopen.at ? app.reopen.reopened : '—'} unit={app.reopen.at ? <>{tr('brainText.qualita.reopen.unit', { n: app.reopen.resolved, share })}</> : undefined} tone={app.reopen.reopened ? 'warn' : undefined}
                quote={app.reopen.reopened ? { id: 'q|riaperti', what: 'numero', title: tr('brainText.qualita.reopen.quoteTitle'), source: tr('brainText.qualita.reopen.quoteSource', { days: app.reopen.days }),
                  facts: [tr('brainText.qualita.reopen.fact', { n: app.reopen.reopened, of: app.reopen.resolved, share }),
                    ...app.reopen.bugs.slice(0, 5).map(b => `${b.title}: ${b.reopened.map(r => tr('brainText.qualita.reopen.reopenedOn', { day: fmt.day(r.reopenedAt.slice(0, 10)), by: r.by || null })).join(', ')}`)],
                  question: tr('brainText.qualita.reopen.question') } : undefined}
                find={app.reopen.at ? (app.reopen.reopened ? <><b>{tr('brainText.qualita.reopen.find', { n: app.reopen.bugs.length })}</b>{tr('brainText.qualita.reopen.findRest')}</> : <>{tr('brainText.qualita.reopen.none')}</>)
                  : app.reopen.refreshing ? <>{tr('brainText.qualita.reopen.reading')}</> : <>{tr('brainText.qualita.reopen.notRead')}</>}
                next={app.reopen.reopened ? <>{tr('brainText.qualita.reopen.next')}</> : undefined}
                source={<>{tr('brainText.qualita.reopen.source', { days: app.reopen.days })}{app.reopen.at ? <>{tr('brainText.qualita.reopen.readAt', { when: fmt.when(app.reopen.at) })}</> : null}{tr('brainText.qualita.reopen.sourceRest')}</>}>
                {app.reopen.error && <p className="bx-warnline" role="note">{app.reopen.error}</p>}
                {app.reopen.bugs.length > 0 && (
                  <ul className="bx-list" data-testid="bx-q-riaperti-list">
                    {[...app.reopen.bugs].sort((x, y) => (y.reopened.at(-1)?.reopenedAt ?? '').localeCompare(x.reopened.at(-1)?.reopenedAt ?? '')).slice(0, 6).map(b => (
                      <li key={b.id}><span className="t"><ExtLink href={b.url || undefined}>{short(b.title, 90)}</ExtLink><br />
                        <span className="meta">{b.reopened.map(r => tr('brainText.qualita.reopen.row', { resolved: fmt.day(r.resolvedAt.slice(0, 10)), reopened: fmt.day(r.reopenedAt.slice(0, 10)), by: r.by || null })).join(' · ')}</span></span>
                        <span className="meta">{b.state}</span></li>
                    ))}
                  </ul>
                )}
              </Metric>}
            </div>
            {a.error && !app && <p className="bx-warnline" role="note">{tr('brainText.qualita.appError', { error: a.error })}</p>}

            {patterns && (
              <Section title={tr('brainText.qualita.patterns.title')} count={patterns.recurring.length} testId="bx-q-errori" actions={<PatternsHelp />}
                note={<>{tr('brainText.qualita.patterns.note', { range: range(patterns.from, patterns.to) })}</>}>
                {errReading && <Reading t={errReading} testId="bx-q-errori-reading" />}
                <ErrorPatterns p={patterns} nav={nav} />
              </Section>
            )}

            <FeedbackOrigins rows={d.wins} />
            <p className="bx-q-row" data-testid="bx-q-proposte">
              <b>{tr('brainText.qualita.proposals')}</b>{tr('brainText.qualita.proposalsRest', { n: d.proposals.length, applied, measured })}
              {' '}<button type="button" className="bx-go" onClick={() => nav('esplora/proposals.md')}>{tr('brainText.qualita.openProposals')}</button>
            </p>
          </div>
        )}
      </Async>
    </>
  );
}
