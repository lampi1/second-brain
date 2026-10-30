// "Classificatori" (G K, ADR 0077, #84; redesigned with the owner's words of 2026-10-19: "i classificatori li voglio
// con card e statistiche per ciascuno, con spiegazione", "il progresso dei classificatori nelle stime"). Read only. A
// summary strip (decisions, this week, verified outcomes), then one card per classifier in a grid: what it decides in
// plain Italian, its numbers (decisions, its own measure, named for what it is: coverage, agreement, within ×2, each
// with k/n; verified success; cost or threshold; the unverified outcomes, the brain's proxy, on a line apart, ADR 0095),
// an 8-week trend and, from 20 cases up, one piece of advice that ends
// with something to do (ADR 0101: no "Token spesi 0" constant, no calibration meter, no "Lo sapevi?" on 5 cases, no
// card for the brain's retired estimator, ADR 0053). A click opens its detail (ClassifierDetail.tsx) with the history, the slices and the
// tables of before (routing table, outcomes per kind, skill choices, quality by week). Two classifiers that keep no
// record (the Orchestrator's mail, sensitive commands) get a small explained card. Every number has a "?" saying how
// it is computed. A clean install shows the cards empty with what will appear. Data: 'classifiers:state'
// (main/brainmodel/classifiers.ts + classifier-cards.ts) and agents:estimates (the task estimator's weekly backtest,
// ADR 0087, via lib/run-estimates.ts). The kind of work by examples (ADR 0197) has its own wide card at the end of the
// grid (KindModelCard.tsx). A tab of Andamento since ADR 0202 (components/andamento/AndamentoPage.tsx: the tab's
// toolbar instead of its own title; the summary's «verified outcomes» left, the «Tipo di lavoro» card shows them).
// View helpers in lib/classifier-view.ts; styles in styles/classifiers.css.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClassifiersState } from '@shared/brain-model';
import { t } from '../../i18n';
import { sb } from '../../sb';
import { useRunEstimates } from '../../lib/run-estimates';
import { cardViews, facts, hitSeries, kOfN, pctOf, weekLabel, type CardId, type CardView } from '../../lib/classifier-view';
import { ClsIcon, Num, ct, intFmt, pctFmt, third } from './ClassifierParts';
import { PageHead } from '../../brain/components/States';
import { when } from './MaintenancePanel';
import { TrendChart } from './TrendChart';
import { ClassifierDetail } from './ClassifierDetail';
import { KindModelCard } from './KindModelCard';
import '../../dashboard/dashboard.css';
import '../../styles/agent-catalog.css';
import '../../styles/brain-model.css';
import '../../styles/classifiers.css';
import { errText } from '../../lib/ipc-error';

function Card({ c, sources, onOpen }: { c: CardView; sources: ClassifiersState['sources']; onOpen: () => void }) {
  const name = ct(c.id, 'name'), fact = facts(c, sources)[0];
  const k3 = third(c);
  const empty = c.decisions === 0;
  return <article className="catalog-card cls-card" data-id={c.id} data-empty={empty} data-testid={`cls-card-${c.id}`}>
    <header className="cls-card-head"><ClsIcon id={c.id} />
      <div className="cls-card-id"><h3><button type="button" onClick={onOpen} aria-label={t('stats.cls.open', { name })}>{name}</button></h3>
        {c.lastAt && <small>{t('stats.cls.lastAt', { at: when(c.lastAt) })}</small>}</div>
    </header>
    <p className="cls-decides">{ct(c.id, 'decides')}</p>
    <div className="cls-nums">
      <Num label={t('stats.cls.decisions')} value={empty ? null : intFmt(c.decisions)} help={ct(c.id, 'decisionsHelp')} testId={`cls-${c.id}-decisions`} />
      <Num label={ct(c.id, 'hit')} value={pctOf(c.hit)} sub={kOfN(c.hit)} help={ct(c.id, 'hitHelp')} testId={`cls-${c.id}-hit`} />
      {c.id === 'estimates' || c.id === 'jobkind' || c.id === 'tasks'
        ? <Num label={k3.label} value={k3.value} help={k3.help} />
        : <Num label={t('stats.cls.success')} value={pctOf(c.success)} sub={kOfN(c.success)} help={t('stats.cls.successHelp')} />}
    </div>
    {!!c.unverified?.n && <p className="cls-unverified" data-testid={`cls-${c.id}-unverified`} title={t('stats.cls.unverifiedHelp')}>{t('stats.cls.unverified', { n: c.unverified.n, pct: pctOf(c.unverified) ?? '—' })}</p>}
    {empty ? <p className="cls-empty">{ct(c.id, 'empty')}</p> : <>
      {c.weeks && c.weeks.some(w => w.decisions) && <div className="cls-card-trend">
        <span className="cls-cap">{t('stats.cls.weeks')} · {ct(c.id, 'hit')}</span>
        <TrendChart compact labels={c.weeks.map(w => weekLabel(w.week))} series={[{ label: ct(c.id, 'hit'), values: hitSeries(c.weeks) }]} format={pctFmt}
          extra={i => `${t('stats.cls.decisions')}: ${c.weeks![i]!.decisions}`} label={`${name}: ${ct(c.id, 'hit')}`} />
      </div>}
    </>}
    {fact && <p className="cls-fact" data-testid={`cls-fact-${c.id}`}><span aria-hidden="true">✦</span><span><b>{t('stats.cls.fact')}</b> {fact}</span></p>}
    <footer className="cls-card-foot"><span className="cls-why">{ct(c.id, 'why')}</span><span className="cls-more" aria-hidden="true">{t('stats.cls.openShort')} →</span></footer>
  </article>;
}

function Plain({ id }: { id: 'mail' | 'cmd' }) {
  return <article className="catalog-card cls-card cls-plain" data-id={id} data-testid={`cls-card-${id}`}>
    <header className="cls-card-head"><ClsIcon id={id} /><div className="cls-card-id"><h3>{ct(id, 'name')}</h3></div><span className="bm-badge" data-tone="muted">{t('stats.cls.noRecord')}</span></header>
    <p className="cls-decides">{ct(id, 'decides')}</p>
    <p className="cls-why">{ct(id, 'why')}</p>
  </article>;
}

export function ClassifiersPage() {
  const [state, setState] = useState<ClassifiersState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<CardId | null>(null);
  const taskEst = useRunEstimates();
  const load = useCallback(async () => {
    try { setState(await sb.invoke('classifiers:state', undefined)); setError(null); } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // the kind model embeds its examples in the background (ADR 0197): look again while it says «busy»
  const busy = state?.kindModel?.state === 'busy';
  useEffect(() => {
    if (!busy) return;
    const id = setTimeout(() => { void load(); }, 5000);
    return () => clearTimeout(id);
  }, [busy, state, load]);
  const cards = useMemo(() => cardViews(state, undefined, taskEst?.accuracy), [state, taskEst]);
  const total = cards.reduce((s, c) => s + c.decisions, 0);
  const week = cards.reduce((s, c) => s + (c.weeks?.[c.weeks.length - 1]?.decisions ?? 0), 0);
  const active = open ? cards.find(c => c.id === open) : null;
  // Esc goes back from a detail to the grid
  useEffect(() => {
    if (!open) return;
    // capture: before the page frame's own Esc (back to the Grindhouse); an open "?" bubble closes first (HelpTip)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopImmediatePropagation(); setOpen(null); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open]);

  return <div className="dashboard bm-dash cls-page bx" data-testid="bm-classifiers-page">
    <PageHead what={t('stats.cls.lead')} guide="classifiers" onRefresh={() => { void load(); }} />
    {error && <p role="alert" className="dash-note">{error}</p>}
    {!state && !error && <p role="status">{t('bm.loading')}</p>}
    {state && active && <ClassifierDetail c={active} state={state} onBack={() => setOpen(null)} />}
    {state && !active && <>
      <div className="cls-summary" data-testid="cls-summary">
        <Num label={t('stats.cls.summary.decisions')} value={intFmt(total)} help={t('stats.cls.summary.decisionsHelp')} />
        <Num label={t('stats.cls.summary.week')} value={intFmt(week)} help={t('stats.cls.summary.weekHelp')} />
      </div>
      {total === 0 && <p className="cls-clean" role="status" data-testid="cls-clean">{t('stats.cls.empty')}</p>}
      <div className="catalog-grid cls-grid" data-testid="cls-grid">
        {cards.map(c => <Card key={c.id} c={c} sources={state.sources} onOpen={() => setOpen(c.id)} />)}
        {state.kindModel && <KindModelCard c={state.kindModel} />}
      </div>
      <section className="cls-plain-wrap"><h2>{t('stats.cls.noRecord')}</h2><p>{t('stats.cls.noRecordLead')}</p>
        <div className="catalog-grid cls-grid">{(['mail', 'cmd'] as const).map(id => <Plain key={id} id={id} />)}</div></section>
    </>}
  </div>;
}
