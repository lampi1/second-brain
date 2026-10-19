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

const STATUS: Record<string, { label: string; tone: Tone }> = {
  tornato: { label: 'tornato', tone: 'bad' }, 'non-tornato': { label: 'non tornato', tone: 'good' },
  'troppo-presto': { label: 'troppo presto', tone: '' }, 'senza-tipo': { label: 'senza tipo', tone: 'warn' },
};
const range = (from: string | null | undefined, to: string | null | undefined) => (from && to ? (from === to ? `il ${fmt.day(from)}` : `dal ${fmt.day(from)} al ${fmt.day(to)}`) : 'nessun dato');

function Metric({ id, title, help, value, unit, tone, reading, find, next, source, quote, children }: {
  id: string; title: string; help?: ReactNode; value: ReactNode; unit?: ReactNode; tone?: 'warn' | 'bad'; reading?: Trend | null; find?: ReactNode; next?: ReactNode; source: ReactNode;
  quote?: Quote; children?: ReactNode;
}) {
  return (
    <section className={`bx-card bx-q ${tone ?? ''}`} data-testid={`bx-q-${id}`} aria-labelledby={`bx-q-${id}-h`}>
      <h2 className="bx-eyebrow"><span id={`bx-q-${id}-h`}>{title}</span>{help && <HelpTip label={title} testid={`bx-q-${id}-help`}>{help}</HelpTip>}</h2>
      <p className="bx-q-v"><span className="bx-big">{value}</span>{unit && <span className="u"> {unit}</span>}</p>
      {reading && <Reading t={reading} testId={`bx-q-${id}-reading`} />}
      <Explain find={find} next={next} />
      <p className="bx-q-src"><b>Fonte:</b> {source}</p>
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
    ? trend(weeks.cur, weeks.prev, { what: 'ogni 100 turni', now: 'negli ultimi 7 giorni', before: 'nei 7 prima' }) : null;
  const patterns = d ? errorPatterns(d.errors, q?.rules ?? [], d.today, ownerOf(d.ideas)) : null;
  const errReading = patterns && patterns.to ? trend(patterns.week, patterns.prevWeek, { what: patterns.week === 1 ? 'errore registrato' : 'errori registrati', now: 'negli ultimi 7 giorni', before: 'nei 7 prima' }) : null;
  const applied = d?.proposals.filter(p => p.stato === 'applicata').length ?? 0;
  const measured = d?.proposals.filter(p => /confermata|inutile|peggiorata/.test(p.stato)).length ?? 0;

  return (
    <>
      <PageHead title="Qualità" at={t.at} onRefresh={reload} refreshing={app?.reopen.refreshing}
        lead={caught && rules && app ? <>
          {caught.per100 !== null ? <><b>{caught.per100.toLocaleString('it-IT')} errori ogni 100 turni</b> li hai dovuti trovare tu</> : <>Turni non ancora misurati</>};{' '}
          <b>{rules.tornato} regole su {rules.judged}</b> non hanno fermato il loro errore; {app.prs.at ? <><b>{app.prs.blocked.length} PR ferme</b></> : <>PR non lette</>}; {app.reopen.at ? <><b>{app.reopen.bugs.length} bug</b> tornati attivi in {app.reopen.days} giorni</> : <>bug riaperti non ancora letti</>}.
        </> : undefined}
        what="Quattro misure dai registri veri: ognuna dice da dove viene e che giorni copre." />
      <Async loading={t.loading && !d} error={d ? null : t.error} onRetry={reload} lines={6} block>
        {() => d && (
          <div className="bx-section" data-testid="bx-quality">
            {!q && <p className="bx-warnline" role="note">Il cervello non calcola ancora la qualità degli errori (manca quality() in ops/tools/recurrence.mjs): aggiorna il brain.</p>}
            <div className="bx-grid-2">
              {q && <Metric id="trovati" title="Errori che hai dovuto trovare tu"
                help="Errori degli agenti che hai scoperto tu, non un reviewer, la QA o un controllo automatico. Più il numero è basso, meno tempo perdi a ricontrollare il loro lavoro."
                value={caught?.per100 != null ? caught.per100.toLocaleString('it-IT') : '—'} unit="ogni 100 turni" tone={caught?.per100 ? 'warn' : undefined}
                reading={caughtReading}
                quote={caught?.per100 != null ? { id: 'q|trovati', what: 'numero', title: 'errori che ho dovuto trovare io, ogni 100 turni', source: 'ai-errors.md («visto da») ÷ turni nei log dell\'app',
                  facts: [`${caught.per100.toLocaleString('it-IT')} ogni 100 turni ${range(caught.from, caught.to)}: ${caught.caught} trovati da me su ${caught.turns} turni, ${caught.others} trovati da altri`,
                    caughtReading ? caughtReading.text : '', 'le chat fuori dall\'app hanno errori ma non turni: il numero può essere più alto del vero'],
                  question: 'Cosa ci dice questo numero? Quali errori avrei potuto non dover trovare io, e con quale controllo automatico?' } : undefined}
                find={caught && caught.from ? <>{range(caught.from, caught.to)}: <b>{caught.caught} errori li hai visti tu</b> su {fmt.int(caught.turns)} turni; altri {caught.others} li hanno trovati reviewer, QA, hook o l'agente stesso.{caught.unknown ? <> {caught.unknown} righe senza «visto da».</> : null}</>
                  : <>I log dell'app non hanno ancora turni: il conto parte dal primo giorno di log.</>}
                next={caught?.caught ? <>apri gli errori trovati da te (<button type="button" className="bx-go" onClick={() => nav('esplora/ai-errors.md')}>ai-errors.md</button>): quelli che si ripetono chiedono un controllo automatico, non una regola in più</> : undefined}
                source={<>ai-errors.md (campo «visto da» con il tuo nome) ÷ turni finiti nei log dell'app, solo nei giorni coperti da entrambi ({range(app?.turns.from, app?.turns.to)}; i log tengono 14 giorni).
                  Le chat fuori dall'app (Claude desktop, Cursor) hanno errori ma non turni: il numero può essere più alto del vero.{caught?.before ? <> {caught.before} errori trovati da te prima dei log restano fuori.</> : null}</>}>
                {caught && caught.days.length > 0 && (
                  <details className="bx-q-more"><summary>Giorno per giorno</summary>
                    <ul className="bx-list compact" data-testid="bx-q-trovati-days">
                      {caught.days.map(x => <li key={x.date}><span className="meta">{fmt.day(x.date)}</span><span className="t">{x.caught} su {fmt.int(x.turns)} turni</span><span className="meta">{rate(x.caught, x.turns)} / 100</span></li>)}
                    </ul>
                  </details>
                )}
              </Metric>}

              {q && rules && out && <Metric id="tornati" title="Errori tornati dopo la regola"
                help="Dopo un errore si scrive una regola perché non si ripeta. Qui conti le regole che non sono bastate: lo stesso tipo di errore è tornato entro pochi giorni."
                value={rules.judged ? `${rules.tornato} su ${rules.judged}` : '—'} unit={`regole: l'errore è tornato entro ${q.windowDays} giorni`} tone={rules.tornato ? 'bad' : undefined}
                quote={rules.judged ? { id: 'q|tornati', what: 'numero', title: 'regole che non hanno fermato il loro errore', source: 'ai-errors.md, righe con «regola:»',
                  facts: [`${rules.tornato} ${rules.tornato === 1 ? 'regola' : 'regole'} su ${rules.judged} giudicate: l'errore è tornato entro ${q.windowDays} giorni (${range(q.from, q.to)})`,
                    ...rules.rules.filter(r => r.status === 'tornato').slice(0, 4).map(r => `non ha tenuto: ${r.rule} (${r.type}, ${r.area}; di nuovo il ${r.again.map(x => fmt.day(x.date)).join(', ')})`),
                    `${rules.presto} ${rules.presto === 1 ? 'regola troppo recente' : 'regole troppo recenti'} per dirlo`],
                  question: 'Perché queste regole non hanno fermato il loro errore? Per ognuna: regola da riscrivere o controllo automatico?' } : undefined}
                find={<><b>{rules.presto} regole troppo recenti</b> per dirlo (meno di {q.windowDays} giorni){rules.senzaTipo ? <>, {rules.senzaTipo} senza un tipo valido</> : null}.</>}
                next={rules.tornato ? <>riscrivi la regola del primo «tornato» qui sotto: chiedilo all’Orchestrator con le parole dell'errore</> : out.total ? <>correggi il tipo delle righe fuori conteggio (uno degli 11 dell'intestazione di ai-errors.md)</> : undefined}
                source={<>ai-errors.md, righe con «regola:» ({range(q.from, q.to)}). Tornato = stesso tipo (gli 11 ufficiali; i sinonimi evidenti contano come il loro tipo) e un'area con una parola in comune, entro {q.windowDays} giorni dalla regola.</>}>
                {out.total > 0 && <p className="bx-warnline" role="note" data-testid="bx-q-fuori">{out.total} righe su {q.lines} fuori dal conteggio: {out.unparsed} illeggibili (manca «detto:» o un campo), {out.invalid} senza tipo valido.</p>}
                {out.total > 0 && (
                  <details className="bx-q-more"><summary>Quali righe</summary>
                    <ul className="bx-list compact">
                      {out.labels.map(([l, c]) => <li key={l}><span className="t">«{short(l, 70)}»</span><span className="meta">{c} {c === 1 ? 'riga' : 'righe'}</span></li>)}
                      {q.unparsed.map((u, i) => <li key={`u${i}`}><span className="meta">{fmt.day(u.date)}</span><span className="t">{short(u.line.replace(/^- \S+ (\S+ )?· /, ''), 110)}</span><span className="meta">illeggibile</span></li>)}
                    </ul>
                  </details>
                )}
                {rules.rules.length > 0 && (
                  <ul className="bx-list" data-testid="bx-q-regole">
                    {rules.rules.slice(0, 6).map((r, i) => (
                      <li key={i}><Pill tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label}</Pill><span className="t" title={r.rule}>{short(r.rule, 90)}</span><span className="meta">{r.type} · {fmt.day(r.date)}{r.again.length ? ` · tornato il ${r.again.map(x => fmt.day(x.date)).join(', ')}` : ''}</span></li>
                    ))}
                    {rules.rules.length > 6 && (
                      <li><details className="bx-q-more"><summary>{rules.rules.length === 7 ? 'Un’altra regola' : `Altre ${rules.rules.length - 6} regole`}</summary>
                        <ul className="bx-list compact">
                          {rules.rules.slice(6).map((r, i) => <li key={i}><Pill tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label}</Pill><span className="t" title={r.rule}>{short(r.rule, 90)}</span><span className="meta">{r.type} · {fmt.day(r.date)}</span></li>)}
                        </ul>
                      </details></li>
                    )}
                  </ul>
                )}
              </Metric>}

              {app && <Metric id="pr" title="Tue PR ferme per QA o build"
                help="Una PR è ferma quando il prossimo passo è tuo: build fallita, un test fallito o bloccato, oppure un revisore che rifiuta o chiede modifiche."
                value={app.prs.blocked.length} unit={`su ${app.prs.total} PR attive`} tone={app.prs.blocked.length ? 'bad' : undefined}
                quote={app.prs.blocked.length ? { id: 'q|pr', what: 'numero', title: 'mie PR ferme per QA o build', source: `lettura DevOps delle mie PR attive${app.prs.at ? `, ${fmt.when(app.prs.at)}` : ''}`,
                  facts: [`${app.prs.blocked.length} PR ferme su ${app.prs.total} attive`, ...app.prs.blocked.slice(0, 5).map(p => `${p.title} (${p.repo}): ${p.reasons.join(', ')}`)],
                  question: 'Da quale parto e qual è il primo passo per sbloccarla?' } : undefined}
                find={app.prs.blocked.length ? <><b>{app.prs.blocked.length} PR</b> aspettano te prima del lavoro nuovo.</> : app.prs.total ? <>Nessuna PR ferma: nessuna build fallita, nessun test case fallito o voto negativo.</> : <>Nessuna PR attiva all'ultima lettura.</>}
                next={app.prs.blocked.length ? <>sistema queste prima di tutto il resto: la QA è ferma su di te</> : undefined}
                source={<>lettura DevOps delle tue PR attive (pagina Task, sola lettura){app.prs.at ? <>, {fmt.when(app.prs.at)}</> : <>: mai letta</>}. Ferma = build fallita, test case collegato Failed o Blocked, voto «rifiutata» o «in attesa dell'autore».</>}>
                {app.prs.error && <p className="bx-warnline" role="note">{app.prs.error}</p>}
                {app.prs.blocked.length > 0 && (
                  <ul className="bx-list" data-testid="bx-q-pr-list">
                    {app.prs.blocked.map(p => <li key={p.id}><span className="t"><ExtLink href={p.url}>{p.title}</ExtLink><br /><span className="meta">{p.reasons.join(' · ')}</span></span><span className="meta">{p.repo}</span></li>)}
                  </ul>
                )}
              </Metric>}

              {app && <Metric id="riaperti" title="Bug tornati attivi dopo il tuo fix"
                help="Bug che avevi messo Resolved e che qualcuno, di solito la QA, ha riaperto: il fix non bastava. La percentuale è su tutti i bug che hai risolto nel periodo."
                value={app.reopen.at ? app.reopen.reopened : '—'} unit={app.reopen.at ? <>su {app.reopen.resolved} risolti da te{share !== null ? ` (${share}%)` : ''}</> : undefined} tone={app.reopen.reopened ? 'warn' : undefined}
                quote={app.reopen.reopened ? { id: 'q|riaperti', what: 'numero', title: 'bug tornati attivi dopo il mio fix', source: `storico degli stati su DevOps, ultimi ${app.reopen.days} giorni`,
                  facts: [`${app.reopen.reopened} su ${app.reopen.resolved} risolti da me${share !== null ? ` (${share}%)` : ''}`,
                    ...app.reopen.bugs.slice(0, 5).map(b => `${b.title}: ${b.reopened.map(r => `riaperto il ${fmt.day(r.reopenedAt.slice(0, 10))}${r.by ? ` da ${r.by}` : ''}`).join(', ')}`)],
                  question: 'Cosa è sfuggito ai miei test in questi bug, e cosa controllo prima del prossimo Resolved?' } : undefined}
                find={app.reopen.at ? (app.reopen.reopened ? <><b>{app.reopen.bugs.length} bug</b> sono tornati Active (o New) dopo che li avevi messi Resolved.</> : <>Nessun bug tornato indietro dopo un tuo Resolved.</>)
                  : app.reopen.refreshing ? <>Lettura in corso: premi Aggiorna tra un minuto.</> : <>Non ancora letto.</>}
                next={app.reopen.reopened ? <>apri il più recente e leggi il commento di chi l'ha riaperto: cosa è sfuggito al test?</> : undefined}
                source={<>storico degli stati su DevOps (ops/tools/bug-reopen.mjs, sola lettura), ultimi {app.reopen.days} giorni{app.reopen.at ? <>, letto {fmt.when(app.reopen.at)}</> : null}; si rilegge da solo ogni 12 ore quando la lettura DevOps è accesa. Conta solo i Resolved fatti da te.</>}>
                {app.reopen.error && <p className="bx-warnline" role="note">{app.reopen.error}</p>}
                {app.reopen.bugs.length > 0 && (
                  <ul className="bx-list" data-testid="bx-q-riaperti-list">
                    {[...app.reopen.bugs].sort((x, y) => (y.reopened.at(-1)?.reopenedAt ?? '').localeCompare(x.reopened.at(-1)?.reopenedAt ?? '')).slice(0, 6).map(b => (
                      <li key={b.id}><span className="t"><ExtLink href={b.url || undefined}>{short(b.title, 90)}</ExtLink><br />
                        <span className="meta">{b.reopened.map(r => `risolto ${fmt.day(r.resolvedAt.slice(0, 10))}, riaperto ${fmt.day(r.reopenedAt.slice(0, 10))}${r.by ? ` da ${r.by}` : ''}`).join(' · ')}</span></span>
                        <span className="meta">{b.state}</span></li>
                    ))}
                  </ul>
                )}
              </Metric>}
            </div>
            {a.error && !app && <p className="bx-warnline" role="note">Turni, PR e bug riaperti non letti: {a.error}</p>}

            {patterns && (
              <Section title="Errori che si ripetono" count={patterns.recurring.length} testId="bx-q-errori" actions={<PatternsHelp />}
                note={<>raggruppati per tipo, da ai-errors.md ({range(patterns.from, patterns.to)}); prima i più frequenti di questa settimana</>}>
                {errReading && <Reading t={errReading} testId="bx-q-errori-reading" />}
                <ErrorPatterns p={patterns} nav={nav} />
              </Section>
            )}

            <FeedbackOrigins rows={d.wins} />
            <p className="bx-q-row" data-testid="bx-q-proposte">
              <b>Proposte di miglioramento:</b> {d.proposals.length}, di cui {applied} applicate, {measured} misurate (confermate, inutili o peggiorate).
              {' '}<button type="button" className="bx-go" onClick={() => nav('esplora/proposals.md')}>Apri proposals.md</button>
            </p>
          </div>
        )}
      </Async>
    </>
  );
}
