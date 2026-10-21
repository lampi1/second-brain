// «Apprendimento» (Andamento, G J; ADR 0109, move 12 of the 2026-10-20 analysis): whether what the app changed by itself
// in the brain really helped. Top: the counter (beneficio provato · senza effetto · in raccolta · peggiora · annullati),
// each tile a filter of the list. Then the changes that made things worse, each with its Annulla (never undone silently).
// Then per role the corrections per run of the last 12 weeks, with the changes measured on its runs as vertical marks in
// their verdict's color: the real progress, without levels. Then every change with its hypothesis, scope and numbers
// (MaintenancePanel Change), and how to read it all. Zero tokens: data from BrainModelState.changes[].claim and
// .learning. Rendered by App.tsx PageFrame for 'apprendimento'; styles: styles/learning.css.
import { useId, useState, type CSSProperties } from 'react';
import type { BrainChange, ClaimVerdict, LearningRole, LearningState } from '@shared/brain-model';
import { locale, t } from '../../i18n';
import { useBrainModel } from '../../store/brain-model';
import { PageHead } from '../../brain/components/States';
import { curve, num, VERDICTS, verdictTone } from '../../lib/learning-view';
import { HelpTip } from '../HelpTip';
import { Change } from './MaintenancePanel';
import '../../styles/agent-catalog.css';
import '../../styles/brain-model.css';
import '../../styles/learning.css';

const day = (ms: number): string => new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const TONE_VAR: Record<ReturnType<typeof verdictTone>, string> = { green: 'var(--green)', amber: 'var(--amber)', blue: 'var(--blue)', muted: 'var(--text-4)' };

function Counter({ counts, filter, onFilter }: { counts: Record<ClaimVerdict, number>; filter: ClaimVerdict | null; onFilter: (v: ClaimVerdict | null) => void }) {
  return <div className="bx-kpis lr-kpis" role="group" aria-label={t('learn.filterLabel')} data-testid="lr-counter">
    {VERDICTS.map(v => <div key={v} className={`bx-kpi lr-kpi ${filter === v ? 'on' : ''}`} data-tone={verdictTone(v)} data-testid={`lr-k-${v}`}>
      <span className="k">{t(`learn.k.${v}`)} <HelpTip label={t(`learn.k.${v}`)}>{t(`learn.k.${v}Help`)}</HelpTip></span>
      <button type="button" className="v" aria-pressed={filter === v} onClick={() => onFilter(filter === v ? null : v)}>{counts[v]}</button>
    </div>)}
  </div>;
}

/** One role's weekly corrections per run (a small multiple) with the changes on its runs as marks. */
function RoleCurve({ r, from, week, max }: { r: LearningRole; from: number; week: number; max: number }) {
  const id = useId();
  const W = 320, H = 116, L = 26, R = 8, T = 10, B = 20, weeks = r.weeks.length;
  const pts = curve(r), runs = r.weeks.reduce((n, w) => n + w.runs, 0);
  const X = (i: number) => L + (weeks > 1 ? (i * (W - L - R)) / (weeks - 1) : 0);
  const Y = (v: number) => T + (H - T - B) * (1 - v / max);
  const XT = (at: number) => L + ((at - from) / (week * (weeks - 1))) * (W - L - R);
  const last = pts.at(-1);
  return <article className="lr-curve" data-testid={`lr-curve-${r.id}`}>
    <header><h4>{r.name}</h4><span>{t('learn.runs', { n: runs })}{last ? ` · ${num(last.mean)}` : ''}</span></header>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}t`}>
      <title id={`${id}t`}>{t('learn.curveDesc', { name: r.name, runs, last: last ? num(last.mean) : '—' })}</title>
      <line className="lr-axis" x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} />
      <line className="lr-grid" x1={L} x2={W - R} y1={Y(max)} y2={Y(max)} />
      <text className="lr-tick" x={L - 5} y={Y(0) + 3} textAnchor="end">0</text>
      <text className="lr-tick" x={L - 5} y={Y(max) + 3} textAnchor="end">{num(max)}</text>
      {r.changes.map(c => {
        const x = Math.min(W - R, Math.max(L, XT(c.at)));
        return <g key={c.id} className="lr-mark" data-verdict={c.verdict}>
          <title>{`${day(c.at)} · ${t(`learn.v.${c.verdict}`)} · ${c.summary}`}</title>
          <line x1={x} x2={x} y1={T - 2} y2={Y(0)} style={{ stroke: TONE_VAR[verdictTone(c.verdict)] }} />
          <circle cx={x} cy={T - 2} r={2.5} style={{ fill: TONE_VAR[verdictTone(c.verdict)] }} />
        </g>;
      })}
      {pts.length > 1 && <polyline className="lr-line" points={pts.map(p => `${X(p.i)},${Y(p.mean)}`).join(' ')} />}
      {pts.map(p => <circle key={p.i} className="lr-dot" cx={X(p.i)} cy={Y(p.mean)} r={Math.min(4.5, 2 + p.runs / 4)}>
        <title>{t('learn.weekTip', { week: day(p.start), mean: num(p.mean), n: p.runs })}</title>
      </circle>)}
      <text className="lr-tick" x={L} y={H - 5}>{day(from)}</text>
      <text className="lr-tick" x={W - R} y={H - 5} textAnchor="end">{day(from + (weeks - 1) * week)}</text>
    </svg>
  </article>;
}

function Curves({ s }: { s: LearningState }) {
  const shown = s.roles.filter(r => r.weeks.some(w => w.runs) || r.changes.length);
  const max = Math.max(1, ...shown.flatMap(r => curve(r).map(p => p.mean)));
  const nice = Math.ceil(max * 2) / 2;
  return <section className="bm-section" aria-labelledby="lr-curves-h" data-testid="lr-curves">
    <header><div><h3 id="lr-curves-h">{t('learn.curves')} <HelpTip label={t('learn.curves')} wide>{t('learn.curvesHelp')}</HelpTip></h3><p>{t('learn.curvesLead')}</p></div>
      <ul className="lr-legend" aria-hidden="true">{(['aiuta', 'nessun-effetto', 'raccolta', 'peggiora'] as const).map(v => <li key={v} style={{ '--c': TONE_VAR[verdictTone(v)] } as CSSProperties}>{t(`learn.v.${v}`)}</li>)}</ul>
    </header>
    {shown.length ? <div className="lr-grid-curves">{shown.map(r => <RoleCurve key={r.id} r={r} from={s.from} week={s.week} max={nice} />)}</div>
      : <p className="bm-empty">{t('learn.curvesEmpty')}</p>}
  </section>;
}

export function LearningPage() {
  const { state, error, busy } = useBrainModel();
  const [filter, setFilter] = useState<ClaimVerdict | null>(null);
  const [limit, setLimit] = useState(20);
  const learning = state?.learning;
  const changes: BrainChange[] = (state?.changes ?? []).filter(c => c.claim);
  const worse = changes.filter(c => c.claim!.verdict === 'peggiora');
  const listed = filter ? changes.filter(c => c.claim!.verdict === filter) : changes;
  return <div className="bm-page agent-overview lr-page" data-testid="learning-page">
    <PageHead title={t('learn.title')} lead={t('learn.lead')} />
    {error && <p role="alert">{error}</p>}
    {state && !state.root ? <p className="bm-empty">{t('bm.noBrain')}</p> : learning && <>
      <Counter counts={learning.counts} filter={filter} onFilter={v => { setFilter(v); setLimit(20); }} />
      {worse.length > 0 && <section className="bm-panel lr-worse" aria-labelledby="lr-worse-h" data-testid="lr-worse">
        <header className="bm-panel-head"><div><h3 id="lr-worse-h">{t('learn.worse')}</h3><p>{t('learn.worseLead')}</p></div></header>
        <ul className="bm-changes">{worse.map(c => <Change key={c.id} c={c} busy={busy} />)}</ul>
      </section>}
      <Curves s={learning} />
      <section className="bm-section" aria-labelledby="lr-changes-h" data-testid="lr-changes">
        <header><div><h3 id="lr-changes-h">{t('learn.changes')}</h3><p>{t('learn.changesLead')}</p></div>
          <div className="lr-chips" role="group" aria-label={t('learn.filterLabel')}>
            <button type="button" className="lr-chip" aria-pressed={!filter} onClick={() => setFilter(null)}>{t('learn.filterAll')} {changes.length}</button>
            {VERDICTS.filter(v => learning.counts[v]).map(v => <button key={v} type="button" className="lr-chip" data-tone={verdictTone(v)} aria-pressed={filter === v} onClick={() => setFilter(filter === v ? null : v)}>{t(`learn.v.${v}`)} {learning.counts[v]}</button>)}
          </div>
        </header>
        {listed.length ? <ul className="bm-changes">{listed.slice(0, limit).map(c => <Change key={c.id} c={c} busy={busy} />)}</ul>
          : <p className="bm-empty">{changes.length ? t('learn.changesNone') : t('learn.changesEmpty')}</p>}
        {listed.length > limit && <button type="button" className="link-btn bm-more" onClick={() => setLimit(n => n + 20)}>{t('bm.maint.more', { n: Math.min(20, listed.length - limit) })}</button>}
      </section>
      <p className="bm-note lr-note" data-testid="lr-note">{t('learn.note')}</p>
    </>}
  </div>;
}
