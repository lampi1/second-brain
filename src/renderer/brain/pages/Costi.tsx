// Costi: what the chats cost (list-price estimate: with a subscription it is not a bill) for a period, where the
// biggest savings are, charts by day (today highlighted), kind of work, model and area, and every chat with its
// longest context and what restarting it would have saved ('chat:list').
// The period's total is read against the period before (ADR 0037: /api/cost?days=2N, the brain caps at 90 days, so
// "90 giorni" says it has no comparison), and the total, the advice and every chart end with the discussion bar.
// On top, "Adesso": every chat of today by cost, live from the app's own streams (LiveCosts.tsx, zero tokens), then
// "Contesto adesso": every open chat's context against its window (once the Dashboard's context tab, ADR 0122). Under the
// KPIs, the curious facts of the period (lib/cost-facts.ts). It is the one costs page (#125, and the Dashboard is gone,
// ADR 0122), and the per-agent costs are on the back of each agent card (AgentCatalogCard.tsx), never here: no role,
// current or retired, is listed on this page.
// What the chat composer's model suggestions spent today against their daily budget sits beside them ('suggest:state',
// ADR 0118).
// Data: /api/cost?days=N (the brain's cost tool). The per-job cost/time estimate and its calculator were removed
// (ADR 0053): measured on 178 past chats, the real cost fell inside the estimate's range only 47% of the time.
import { lazy, Suspense, useContext, useEffect, useMemo, useState } from 'react';
import type { Usage } from '@shared/contract';
import { normCost, type CostChat } from '../types';
import { useBrain } from '../api';
import { fmt } from '../lib/format';
import { moneyEntries, topN } from '../lib/chart';
import { previousSpend, trend } from '../lib/stats';
import type { Quote } from '../lib/discuss';
import { baseName, short, sum } from '../lib/text';
import { Async, PageHead } from '../components/States';
import { BarChart, HBarChart } from '../components/Charts';
import { DataTable, type Col } from '../components/DataTable';
import { Kpi, Pill, Section, Seg } from '../components/ui';
import { DiscussBar, DiscussContext } from '../components/Discuss';
import { Reading } from '../components/Stats';
import { costFacts, cursorCoverage } from '../lib/cost-facts';
import { useAppChats } from '../lib/app-chats';
import { LiveCostList } from '../../components/LiveCosts';
import { costRows } from '../../lib/live-costs';
import { t } from '../../i18n';
import '../../styles/classifiers.css'; // the facts' err-fact cards
import '../../styles/memory-hub.css'; // «Contesto adesso» (mh-ctx)
import { useSuggestState } from '../../lib/suggest-state';
import { formatCost } from '../../lib/format';
// app-side parts (they read the app's live store): loaded when shown, so the brain pages stay importable alone
const ContextNow = lazy(() => import('../../components/ContextNow'));

const PERIODS = [1, 7, 30, 90] as const;
/** the brain's cost API reads at most 90 days: the period before is known up to 45 */
const MAX_DAYS = 90;
const help = () => ({
  usd: t('costs.help.usd'),
  ctx: t('costs.help.ctx'),
  save: t('costs.help.save'),
  saveKpi: t('costs.help.saveKpi'),
  fixed: t('costs.help.fixed'),
});

/** "Adesso": today's chats by cost, re-sorted at each message (the app's streams + the brain's last count). */
function LiveNow() {
  const usage = useAppUsage();
  const chats = useAppChats();
  const bridge = useContext(DiscussContext);
  const rows = useMemo(() => costRows(usage, chats ?? []), [usage, chats]);
  const unpriced = usage?.cursorUnpriced?.models;
  return (
    <Section title={t('costs.live')} count={rows.length} note={t('costs.liveNote')} testId="bx-cost-live">
      <div className="bx-card tight"><LiveCostList rows={rows} onOpen={bridge ? id => bridge.showChat(id) : undefined} unpricedModels={unpriced} testid="bx-cost-live-list" /></div>
    </Section>
  );
}

/** The composer's suggestions today: model calls, their cost against the budget, the answers served from the cache. */
function SuggestToday() {
  const st = useSuggestState();
  if (!st) return null;
  return (
    <div className="bx-kpis" data-testid="bx-cost-suggest">
      <Kpi k={t('suggest.kpi')} help={t('suggest.kpiHelp')} v={formatCost(st.usd)} tone={st.usd >= st.budgetUsd ? 'warn' : undefined}
        s={st.modelOn ? t('suggest.kpiSub', { calls: st.calls, hits: st.cacheHits, limit: formatCost(st.budgetUsd) }) : t('suggest.kpiOff')} testId="bx-suggest-today" />
    </div>
  );
}

/** The app's usage snapshot ('app:usage', then 'usage' events): today's Cursor from the ledger, estimated or exact. */
function useAppUsage(): Usage | null {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => {
    let alive = true;
    window.sb.invoke('app:usage', undefined).then(x => { if (alive) setU(x); }, () => {});
    const off = window.sb.on('usage', x => setU(x));
    return () => { alive = false; off(); };
  }, []);
  return u;
}

/** Cursor today: "≈ $" with its margin until a usage export confirms it. */
function CursorToday({ u }: { u: Usage | null }) {
  if (u?.cursorTodayUsd == null) return <Kpi k={t('costs.cursorToday')} v={t('costs.unavailable')} s={u?.cursorNote || t('costs.noTurns')} testId="bx-cursor-today" />;
  const est = u.cursorExact === false;
  return <Kpi k={t('costs.cursorToday')} help={est ? t('costs.cursorHelp',{margin:u.cursorMarginPct??20}) : undefined} v={`${est ? '≈ ' : ''}${fmt.usd(u.cursorTodayUsd)}`} s={est ? t('costs.cursorEstimate',{margin:u.cursorMarginPct??20}) : t('costs.cursorExact')} testId="bx-cursor-today" />;
}

export function Costi({ arg, nav }: { arg?: string; nav: (t: string) => void }) {
  const days = (PERIODS as readonly number[]).includes(Number(arg)) ? Number(arg) : 7;
  const r = useBrain(`/api/cost?days=${days}`, normCost);
  const appUsage = useAppUsage();
  const c = r.data;
  const HELP = help();
  // today is never finished: "Oggi" has no comparison (half a day against a whole one would always read "in calo"), the
  // longer periods say that today is in, half done
  const compare = days > 1 && days * 2 <= MAX_DAYS;
  const r2 = useBrain(compare ? `/api/cost?days=${days * 2}` : null, normCost);
  const prev = c && r2.data ? previousSpend(r2.data.byDay, c.to, days, r2.data.from) : null;
  const reading = !c ? null
    : days === 1 ? { dir: null, good: null, text: t('costs.todayReading',{amount:fmt.usd(c.total)}) }
      : !compare ? { dir: null, good: null, text: t('costs.limitedReading',{amount:fmt.usd(c.total),days,max:MAX_DAYS}) }
        : prev?.since ? { dir: null, good: null, text: t('costs.partialReading',{amount:fmt.usd(c.total),days,since:fmt.day(prev.since),previous:fmt.usd(prev.usd)}) }
        : r2.data ? trend(c.total, prev ? prev.usd : null, { what: '', now: t('costs.currentPeriod',{days}), before: t('costs.previousPeriod',{days}), fmtN: fmt.usd })
          : null;
  const range = c ? (c.from === c.to ? t('costs.onDay',{day:fmt.day(c.to)}) : t('costs.range',{from:fmt.day(c.from),to:fmt.day(c.to)})) : '';
  const q = (id: string, title: string, facts: string[], question?: string): Quote => ({ id: `costi|${id}`, what: 'numero', title, source: `${t('costs.source')}, ${range}`, facts, question });
  const byDay = c ? Object.entries(c.byDay).sort(([a], [b]) => a.localeCompare(b)) : [];
  const nDays = Math.max(1, byDay.length);
  const kinds = c ? topN(moneyEntries(c.byKind), 7) : [];
  const models = c ? moneyEntries(c.byModel) : [];
  const areas = c ? moneyEntries(c.byArea) : [];
  const top3 = c?.chats.slice(0, 3) ?? [];
  const advice = c ? [...c.advice].sort((a, b) => b.usd - a.usd) : [];
  const todayI = byDay.findIndex(([d]) => d === c?.to);
  const cols: Col<CostChat>[] = [
    { key: 'title', label: t('costs.chat'), clip: true, render: x => <b>{x.title || t('costs.untitled')}</b>, value: x => x.title },
    { key: 'usd', label: t('costs.spend'), type: 'usd', width: '96px', help: HELP.usd },
    { key: 'ctxMax', label: t('costs.maxContext'), type: 'num', width: '110px', help: HELP.ctx, render: x => (x.ctxMax > 400e3 ? <Pill tone="warn">{fmt.k(x.ctxMax)}</Pill> : fmt.k(x.ctxMax)) },
    { key: 'longSave', label: t('costs.saveable'), type: 'usd', width: '112px', help: HELP.save, render: x => (x.longSave > 0 ? fmt.usd(x.longSave) : '') },
    { key: 'calls', label: t('costs.calls'), type: 'num', width: '90px', hidden: true },
    { key: 'folder', label: t('costs.folder'), width: '130px', value: x => baseName(x.folder) },
    { key: 'to', label: t('costs.lastActivity'), type: 'date', width: '130px', value: x => x.to, render: x => fmt.when(x.to) },
  ];

  return (
    <>
      <PageHead title={t('costs.title')} at={r.at} refreshing={r.refreshing} onRefresh={() => r.reload(true)}
        lead={c ? <><b>{fmt.usd(c.total)} in {days === 1 ? t('costs.oneDay') : t('costs.days',{days})}</b>, {fmt.usd(c.total / nDays)} {t('costs.perDay')}.{advice[0] ? <> {t('costs.biggestSaving')}: <b>{advice[0].text.split(':')[0]?.toLowerCase()}, {fmt.usd(advice[0].usd)}</b>.</> : null}</> : undefined}
        what={t('costs.what')} guide="costs"
        actions={<Seg label={t('costs.period')} value={days} onChange={d => nav(d === 7 ? 'costi' : `costi/${d}`)} items={PERIODS.map(d => ({ id: d, label: d === 1 ? t('costs.today') : t('costs.days',{days:d}) }))} />} />
      <LiveNow />
      <Suspense fallback={null}><ContextNow /></Suspense>
      <SuggestToday />
      <Async loading={r.loading && !c} error={c ? null : r.error} onRetry={() => r.reload()} label={t('costs.loading')} lines={5} block>
        {() => c && (
          <>
            <div className="bx-kpis" data-testid="bx-cost-kpis">
              <Kpi k={t('costs.inPeriod')} help={HELP.usd} v={fmt.usd(c.total)} s={`${t('costs.callCount',{count:fmt.int(c.calls)})} · ${c.from === c.to ? fmt.day(c.to) : `${fmt.day(c.from)} – ${fmt.day(c.to)}`}`} />
              <Kpi k={t('costs.perDay')} v={fmt.usd(c.total / nDays)} s={todayI >= 0 ? t('costs.todayAmount',{amount:fmt.usd(byDay[todayI]?.[1].usd)}) : undefined} />
              <Kpi k={t('costs.saveable')} help={HELP.saveKpi} v={fmt.usd(c.longSave)} s={t('costs.savingsNote')} tone={c.longSave > c.total * 0.15 ? 'warn' : undefined} />
              <CursorToday u={appUsage} />
              {c.cursor ? <Kpi k="Cursor" v={fmt.usd(c.cursor.total)} s={c.cursor.downloaded ? `${t('costs.fromUsage',{when:fmt.when(c.cursor.downloaded)})}${cursorCoverage(c.cursor, c.to) === false ? ` · ${t('costs.cursorPartial')}` : ''}` : t('costs.actualSpend')} testId="bx-cost-cursor" /> : <Kpi k={t('costs.fixedContext')} help={HELP.fixed} v={c.fixed ? t('costs.characters',{count:fmt.k(c.fixed.chars)}) : '—'} s={c.fixed ? t('costs.periodAmount',{amount:fmt.usd(c.fixed.usd)}) : undefined} />}
            </div>
            {(() => { const facts = costFacts(c, fmt.usd); return facts.length > 0 && <div className="err-facts" data-testid="cost-facts">{facts.map((f, i) => <p className="err-fact" key={i}><span aria-hidden="true">✦</span><span>{f}</span></p>)}</div>; })()}
            <div className="bx-card tight bx-stat-discuss" data-testid="bx-cost-period">
              {reading ? <Reading t={reading} testId="bx-cost-reading" />
                : r2.error ? <p className="bx-warnline" role="note" data-testid="bx-cost-reading-error">{t('costs.comparisonError')}: {r2.error} <button type="button" className="bx-btn s" onClick={() => r2.reload(true)}>{t('costs.retry')}</button></p>
                  : <p className="small muted">{t('costs.comparing')}</p>}
              <DiscussBar testId="bx-cost-discuss" topic={{ kind: 'quote', quote: q('totale', t('costs.spendTitle',{days}), [
                `${fmt.usd(c.total)} ${range}, ${fmt.usd(c.total / nDays)} ${t('costs.perDay')}, ${t('costs.callCount',{count:fmt.int(c.calls)})}`,
                reading ? reading.text : '',
                c.longSave > 0 ? t('costs.savingFact',{amount:fmt.usd(c.longSave)}) : '',
                top3.length ? t('costs.expensiveFact',{chats:top3.map(x => `${short(x.title, 40)} ${fmt.usd(x.usd)}`).join(', ')}) : '',
                t('costs.listEstimate'),
              ]) }} />
            </div>

            {advice.length > 0 && (
              <Section title={t('costs.saveWhere')} note={t('costs.saveWhereNote')} testId="bx-advice">
                <div className="bx-card tight">
                  <ul className="bx-list">{advice.slice(0, 3).map((a, i) => <li key={i}><Pill tone="warn">{fmt.usd(a.usd)}</Pill><span className="t">{a.text}</span></li>)}</ul>
                  {advice.length > 3 && <details style={{ marginTop: 6 }}><summary className="small muted" style={{ cursor: 'pointer' }}>{t('costs.more',{count:advice.length-3})}</summary><ul className="bx-list">{advice.slice(3).map((a, i) => <li key={i}><Pill>{fmt.usd(a.usd)}</Pill><span className="t">{a.text}</span></li>)}</ul></details>}
                  <DiscussBar testId="bx-advice-discuss" topic={{ kind: 'quote', quote: q('risparmio', t('costs.saveWhere'), advice.slice(0, 5).map(a => `${fmt.usd(a.usd)}: ${a.text}`),
                    t('costs.saveQuestion')) }} />
                </div>
              </Section>
            )}

            <div className="bx-grid-2">
              <BarChart title={t('costs.spendDay')} note={todayI >= 0 ? t('costs.todayHighlight') : undefined} name={`spesa-giorni-${days}`} money
                labels={byDay.map(([d]) => fmt.day(d))} values={byDay.map(([, v]) => v.usd)} highlight={todayI >= 0 ? todayI : undefined}
                discuss={byDay.length > 1 ? q('giorni', t('costs.spendDay'), byDay.map(([d, v]) => `${fmt.day(d)}: ${fmt.usd(v.usd)}`).slice(-14)) : undefined}
                explain={(() => { const m = [...byDay].sort((a, b) => b[1].usd - a[1].usd)[0]; return m && byDay.length > 2 ? { find: t('costs.dayFinding',{day:fmt.day(m[0]),amount:fmt.usd(m[1].usd),pct:fmt.pct(m[1].usd,c.total)}) } : undefined; })()} />
              <HBarChart title={t('costs.byKind')} name={`spesa-tipo-${days}`} money labels={kinds.map(([k]) => k)} series={[{ label: t('costs.spend'), values: kinds.map(([, v]) => v) }]}
                note={kinds[0] ? t('costs.kindShare',{kind:kinds[0][0],pct:fmt.pct(kinds[0][1],c.total)}) : undefined}
                discuss={kinds.length ? q('tipo', t('costs.spendKind'), kinds.map(([k, v]) => `${k}: ${fmt.usd(v)} (${fmt.pct(v, c.total)}%)`)) : undefined}
                explain={{ says: t('costs.kindSays'), why: t('costs.kindWhy') }} />
            </div>
            <div className="bx-grid-2">
              <HBarChart title={t('costs.byModel')} name={`spesa-modello-${days}`} money labels={models.map(([k]) => k)} series={[{ label: t('costs.spend'), values: models.map(([, v]) => v) }]}
                note={models[0] ? `${models[0][0]}: ${fmt.pct(models[0][1], c.total)}%` : undefined}
                discuss={models.length ? q('modello', t('costs.spendModel'), models.map(([k, v]) => `${k}: ${fmt.usd(v)} (${fmt.pct(v, c.total)}%)`)) : undefined} />
              <HBarChart title={t('costs.byArea')} name={`spesa-area-${days}`} money labels={areas.map(([k]) => k)} series={[{ label: t('costs.spend'), values: areas.map(([, v]) => v) }]}
                discuss={areas.length ? q('area', t('costs.spendArea'), areas.map(([k, v]) => `${k}: ${fmt.usd(v)} (${fmt.pct(v, c.total)}%)`)) : undefined} />
            </div>

            <Section title={t('costs.chatByChat')} count={c.chats.length} testId="bx-cost-chats">
              {c.chats.length > 1 && <HBarChart title={t('costs.expensiveChats')} name={`spesa-chat-${days}`} money categorical={false}
                labels={c.chats.slice(0, 8).map(x => short(x.title || t('costs.untitled'), 60))} series={[{ label: t('costs.spend'), values: c.chats.slice(0, 8).map(x => x.usd), color: 'var(--bx-cat-1)' }, { label: t('costs.saveable'), values: c.chats.slice(0, 8).map(x => x.longSave), color: 'var(--bx-cat-2)' }]}
                note={t('costs.savingsLegend')}
                discuss={q('chat', t('costs.expensiveChats'), c.chats.slice(0, 8).map(x => t('costs.chatFact',{title:short(x.title||t('costs.untitled'),60),amount:fmt.usd(x.usd),context:fmt.k(x.ctxMax),saving:x.longSave>0?fmt.usd(x.longSave):''})))} />}
              <DataTable name={`chat-costi-${days}`} label={t('costs.eachChat')} rows={c.chats} cols={cols} sort={{ key: 'usd', dir: -1 }}
                explain={top3.length ? { find: t('costs.topFinding',{pct:fmt.pct(sum(top3.map(x=>x.usd)),c.total),chats:top3.map(x=>short(x.title,40)).join(', ')}), next: c.longSave>0?t('costs.tableNext'):undefined,says:t('costs.tableSays'),why:t('costs.tableWhy') } : undefined} />
            </Section>
            <p className="small muted">
              {c.uncalibrated.length ? t('costs.uncalibrated',{count:c.uncalibrated.length}) : ''}
              {c.fixed ? t('costs.fixedNote',{chars:fmt.k(c.fixed.chars),amount:fmt.usd(c.fixed.usd)}) : ''}
              {c.cursor?.downloaded ? t('costs.cursorNote',{amount:fmt.usd(c.cursor.total),when:fmt.when(c.cursor.downloaded),last:c.cursor.lastRow?fmt.when(c.cursor.lastRow):''}) : ''}
            </p>
          </>
        )}
      </Async>
    </>
  );
}
