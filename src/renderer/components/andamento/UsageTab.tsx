// Andamento → «Uso» (ADR 0202; report «Cosa tenere» A0): the local usage counter of the last 14 days, to decide which
// features to keep. The tab's toolbar says what it is for; three KPIs (uses, days with the app, features used and how
// many never opened), the uses per day (today highlighted), every page, tab and main action from the most used with a
// bar, its days and its last day (a page opens on click), and the places never opened in the period as chips. Zero
// tokens: 'usecount:report' reads userData/app.db (main/use-counter.ts); nothing here leaves the PC. Words and places
// from lib/use-view.ts.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UseCountReport } from '@shared/contract';
import { goTarget } from '../../actions';
import { t, type Key } from '../../i18n';
import { pageLabel } from '../../store/ui';
import { BRAIN_PAGES } from '../../brain';
import { HUB_PAGES, HUB_TABS } from '../../lib/memory-hub';
import { TREND_TABS, parseTrendArg } from '../../lib/andamento';
import { settingsSections } from '../../lib/settings-sections';
import { activeDays, neverOpened, placeOfKey, useItems } from '../../lib/use-view';
import { errText } from '../../lib/ipc-error';
import { fmt } from '../../brain/lib/format';
import { BarChart } from '../../brain/components/Charts';
import { Async, PageHead } from '../../brain/components/States';
import { Kpi, Pill, Section } from '../../brain/components/ui';

const DAYS = 14;
/** a counted place opened from the list, through the same route as a link */
const open = (p: { page: string; arg: string | null }) => goTarget(p.arg ? `${p.page}/${p.arg}` : p.page);
/** pages that are not a feature of their own: the file viewer, Settings, and the pages that are tabs elsewhere */
const NOT_A_PLACE = new Set(['file', 'impostazioni', 'memoria', 'andamento', ...Object.keys(HUB_PAGES)]);

/** Every place the user can open: the pages, Memoria's and Andamento's tabs, the 3D map. */
function candidates(): string[] {
  return [
    ...BRAIN_PAGES.map(p => p.id).filter(id => !NOT_A_PLACE.has(id)).map(id => `page:${id}`),
    ...HUB_TABS.map(tab => `page:memoria/${tab}`),
    ...TREND_TABS.map(tab => `page:andamento/${tab}`),
    'page:mappa',
  ];
}

function name(kind: 'page' | 'action', id: string, sub: string | null): string {
  if (kind === 'action') { const v = (t as (k: Key) => string)(`use.action.${id}` as Key); return typeof v === 'string' && v ? v : id; }
  const page = pageLabel(id);
  if (!sub) return page;
  const text = t as (k: Key) => string;
  // an old tab's counts (andamento/classificatori, folded into Qualità by ADR 0210) are named after the tab it opens now
  const tab = id === 'memoria' ? text(`mh.tab.${sub}` as Key) : id === 'andamento' ? text(`trend.tab.${parseTrendArg(sub).tab}` as Key)
    : id === 'impostazioni' ? (settingsSections([]) as Record<string, { title: string }>)[sub]?.title : undefined;
  return `${page} › ${typeof tab === 'string' && tab ? tab : sub}`;
}

export function UsageTab() {
  const [r, setR] = useState<UseCountReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const load = useCallback(async () => {
    try { setR(await window.sb.invoke('usecount:report', { days: DAYS })); setError(null); setAt(Date.now()); } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const items = useMemo(() => (r ? useItems(r.rows, name) : []), [r]);
  const never = useMemo(() => (r ? neverOpened(r.rows, candidates()) : []), [r]);
  const max = items[0]?.n ?? 1;
  const today = r?.to ?? '';
  const day = (d: string) => (d === today ? t('use.today') : fmt.day(d));
  return <div className="bx-section an-use" data-testid="use-tab">
    <PageHead what={t('use.what')} at={at} onRefresh={() => { void load(); }} />
    <Async loading={!r && !error} error={r ? null : error ? `${t('use.error')}: ${error}` : null} onRetry={() => { void load(); }} lines={4} block>
      {() => r && <>
        {r.since && r.since > r.from && <p className="bx-warnline an-note" role="note" data-testid="use-since">{t('use.since', { day: fmt.dayLong(r.since) })}</p>}
        <div className="bx-kpis" data-testid="use-kpis">
          <Kpi k={t('use.kpi.total')} v={fmt.int(r.total)} testId="use-kpi-total" />
          <Kpi k={t('use.kpi.days')} v={activeDays(r.byDay)} s={t('use.kpi.daysSub', { n: r.days })} />
          <Kpi k={t('use.kpi.features')} v={items.length} s={t('use.kpi.featuresSub', { n: never.length })} />
        </div>
        {r.total === 0 ? <p className="bm-empty" data-testid="use-empty">{t('use.empty')}</p> : <>
          <BarChart title={t('use.byDay')} note={t('use.byDayNote')} name="uso-giorni" testId="use-by-day"
            labels={r.byDay.map(d => fmt.day(d.day))} values={r.byDay.map(d => d.n)} highlight={r.byDay.length - 1} height={150} />
          <Section title={t('use.ranking')} count={items.length} note={t('use.rankingNote')} testId="use-ranking">
            <ol className="an-rank bx-card tight" data-testid="use-list">
              {items.map((x, i) => {
                const place = x.place;
                const label = place ? <button type="button" className="an-rank-name" onClick={() => open(place)} aria-label={t('use.open', { name: x.label })}>{x.label}</button>
                  : <span className="an-rank-name">{x.label}</span>;
                return <li key={x.key} data-kind={x.kind} data-testid={`use-row-${x.key.replace(/[:/]/g, '-')}`}>
                  <span className="an-rank-i">{i + 1}</span>
                  <span className="an-rank-main">
                    <span className="an-rank-top">{label}<Pill tone={x.kind === 'page' ? 'outline' : 'violet'}>{t(x.kind === 'page' ? 'use.kind.page' : 'use.kind.action')}</Pill></span>
                    <span className="an-rank-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, (x.n / max) * 100)}%` }} /></span>
                  </span>
                  <span className="an-rank-n">{t('use.times', { n: x.n })}</span>
                  <span className="an-rank-meta">{t('use.daysOf', { n: x.days, of: r.days })} · {t('use.last', { day: day(x.last) })}</span>
                </li>;
              })}
            </ol>
          </Section>
        </>}
        {never.length > 0 && <Section title={t('use.never')} count={never.length} note={t('use.neverNote')} testId="use-never">
          <div className="an-chips">{never.map(k => { const p = placeOfKey(k)!; const label = name('page', p.page, p.arg);
            return <button key={k} type="button" className="an-chip" onClick={() => open(p)} aria-label={t('use.open', { name: label })}>{label}</button>; })}</div>
        </Section>}
      </>}
    </Async>
  </div>;
}
