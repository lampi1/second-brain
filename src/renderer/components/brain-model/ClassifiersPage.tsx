// "Classificatori" (G K, ADR 0077, #84; redesigned with the owner's words of 2026-10-19: "i classificatori li voglio
// con card e statistiche per ciascuno, con spiegazione", "il progresso dei classificatori nelle stime"). Read only. A
// summary strip (decisions, this week, verified outcomes, tokens spent: always zero), then one card per classifier in
// a grid: what it decides in plain Italian, its numbers (decisions, its own hit measure, verified success, cost or
// threshold), an 8-week trend, its learning progress toward the 20 verified cases the loop needs, and one curious
// fact built from the data. A click opens its detail (ClassifierDetail.tsx) with the history, the slices and the
// tables of before (routing table, outcomes per kind, skill choices, quality by week). Two classifiers that keep no
// record (the Orchestrator's mail, sensitive commands) get a small explained card. Every number has a "?" saying how
// it is computed. A clean install shows the cards empty with what will appear. Data: 'classifiers:state'
// (main/brainmodel/classifiers.ts + classifier-cards.ts), /api/improve (the estimates loop) and agents:estimates (the
// task estimator's weekly backtest, ADR 0087, via lib/run-estimates.ts). Rendered by App.tsx
// PageFrame for 'classificatori'; view helpers in lib/classifier-view.ts; styles in styles/classifiers.css.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClassifiersState } from '@shared/brain-model';
import { t } from '../../i18n';
import { sb } from '../../sb';
import { useBrain } from '../../brain/api';
import { normLearnData } from '../../brain/lib/learn';
import { useRunEstimates } from '../../lib/run-estimates';
import { cardViews, facts, hitSeries, pctOf, weekLabel, type CardId, type CardView } from '../../lib/classifier-view';
import { ClsIcon, Num, Progress, ct, intFmt, pctFmt, third } from './ClassifierParts';
import { when } from './MaintenancePanel';
import { TrendChart } from './TrendChart';
import { ClassifierDetail } from './ClassifierDetail';
import '../../dashboard/dashboard.css';
import '../../styles/agent-catalog.css';
import '../../styles/brain-model.css';
import '../../styles/classifiers.css';

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
function Card({ c, sources, onOpen }: { c: CardView; sources: ClassifiersState['sources']; onOpen: () => void }) {
  const name = ct(c.id, 'name'), fact = facts(c, sources)[0];
  const k3 = third(c);
  const empty = c.decisions === 0;
  return <article className="catalog-card cls-card" data-id={c.id} data-empty={empty} data-testid={`cls-card-${c.id}`}>
    <header className="cls-card-head"><ClsIcon id={c.id} />
      <div className="cls-card-id"><h3><button type="button" onClick={onOpen} aria-label={t('stats.cls.open', { name })}>{name}</button></h3>
        {c.lastAt && <small>{t('stats.cls.lastAt', { at: when(c.lastAt) })}</small>}</div>
      {c.id === 'estimates' && c.estimates?.version != null && <span className="bm-badge" data-tone={c.estimates.pending ? 'amber' : 'muted'}>{c.estimates.pending ? ct('estimates', 'pending') : t('stats.c.estimates.version', { v: c.estimates.version })}</span>}
    </header>
    <p className="cls-decides">{ct(c.id, 'decides')}</p>
    <div className="cls-nums">
      <Num label={t('stats.cls.decisions')} value={empty ? null : intFmt(c.decisions)} help={ct(c.id, 'decisionsHelp')} testId={`cls-${c.id}-decisions`} />
      <Num label={ct(c.id, 'hit')} value={pctOf(c.hit)} sub={t('stats.cls.n', { n: c.hit.n })} help={ct(c.id, 'hitHelp')} testId={`cls-${c.id}-hit`} />
      {c.id === 'estimates' || c.id === 'jobkind' || c.id === 'tasks'
        ? <Num label={k3.label} value={k3.value} help={k3.help} />
        : <Num label={t('stats.cls.success')} value={pctOf(c.success)} sub={t('stats.cls.n', { n: c.success.n })} help={t('stats.cls.successHelp')} />}
    </div>
    {empty ? <p className="cls-empty">{ct(c.id, 'empty')}</p> : <>
      {c.weeks && c.weeks.some(w => w.decisions) && <div className="cls-card-trend">
        <span className="cls-cap">{t('stats.cls.weeks')} · {ct(c.id, 'hit')}</span>
        <TrendChart compact labels={c.weeks.map(w => weekLabel(w.week))} series={[{ label: ct(c.id, 'hit'), values: hitSeries(c.weeks) }]} format={pctFmt}
          extra={i => `${t('stats.cls.decisions')}: ${c.weeks![i]!.decisions}`} label={`${name}: ${ct(c.id, 'hit')}`} />
      </div>}
      {c.id === 'estimates' && c.spark.length > 1 && <div className="cls-card-trend">
        <span className="cls-cap">{t('stats.cls.sparkTitle')}</span>
        <TrendChart compact labels={c.spark.map((_, i) => `#${i + 1}`)} series={[{ label: ct('estimates', 'typical'), values: c.spark, slot: 3 }]} max={Math.max(2, ...c.spark)} format={v => `×${v.toFixed(1)}`} label={t('stats.cls.sparkTitle')} />
      </div>}
    </>}
    <Progress c={c} />
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
  const learn = useBrain('/api/improve', normLearnData);
  const taskEst = useRunEstimates();
  const load = useCallback(async () => {
    try { setState(await sb.invoke('classifiers:state', undefined)); setError(null); } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const estimates = learn.data?.policies.find(p => p.domain === 'estimates');
  const cards = useMemo(() => cardViews(state, estimates, taskEst?.accuracy), [state, estimates, taskEst]);
  const total = cards.reduce((s, c) => s + c.decisions, 0);
  const week = cards.reduce((s, c) => s + (c.weeks?.[c.weeks.length - 1]?.decisions ?? 0), 0);
  const verified = cards.find(c => c.id === 'kind')?.success.n ?? 0;
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
    <header className="dash-header"><div><span className="dash-eyebrow">{t('stats.cls.eyebrow')}</span><h1>{t('stats.cls.title')}</h1><p className="cls-lead">{t('stats.cls.lead')}</p></div>
      <button type="button" className="btn btn-ghost btn-s" onClick={() => { void load(); learn.reload(true); }}><span aria-hidden="true">↻</span> {t('stats.cls.refresh')}</button></header>
    {error && <p role="alert" className="dash-note">{error}</p>}
    {!state && !error && <p role="status">{t('bm.loading')}</p>}
    {state && active && <ClassifierDetail c={active} state={state} onBack={() => setOpen(null)} />}
    {state && !active && <>
      <div className="cls-summary" data-testid="cls-summary">
        <Num label={t('stats.cls.summary.decisions')} value={intFmt(total)} help={t('stats.cls.summary.decisionsHelp')} />
        <Num label={t('stats.cls.summary.week')} value={intFmt(week)} help={t('stats.cls.summary.weekHelp')} />
        <Num label={t('stats.cls.summary.verified')} value={intFmt(verified)} help={t('stats.cls.summary.verifiedHelp')} />
        <Num label={t('stats.cls.summary.tokens')} value="0" help={t('stats.cls.summary.tokensHelp')} />
      </div>
      {total === 0 && <p className="cls-clean" role="status" data-testid="cls-clean">{t('stats.cls.empty')}</p>}
      <div className="catalog-grid cls-grid" data-testid="cls-grid">
        {cards.map(c => <Card key={c.id} c={c} sources={state.sources} onOpen={() => setOpen(c.id)} />)}
      </div>
      <section className="cls-plain-wrap"><h2>{t('stats.cls.noRecord')}</h2><p>{t('stats.cls.noRecordLead')}</p>
        <div className="catalog-grid cls-grid">{(['mail', 'cmd'] as const).map(id => <Plain key={id} id={id} />)}</div></section>
    </>}
  </div>;
}
