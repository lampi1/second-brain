// The task estimate on screen (ADR 0087; owner, 2026-10-19: «stime leggibili … e il progresso dei classificatori nelle
// stime»). EstimateChip sits in a strip's facts: «STIMA ~4 min · ~0,12 $ · su 12 task simili ?» while the run is open
// (with the time left once it is at work), «STIMA ~4 min → 6 min ✓» once it ended (✓ = the actual time fell between half
// and double). Its "?" says how the figure is computed (which similar tasks, the classifier's kind, the middle-half range,
// the confidence) and how accurate the estimates have been, week by week. The Orchestrator's plan panel is gone (#124): the
// same facts are on the strips and in each run's verdict. Data: lib/run-estimates.ts. Used by ChatTile.tsx.
import type { ChatSummary } from '@shared/contract';
import type { RunEstimateView } from '@shared/task-estimate';
import { accuracySummary, estimateText, useRunEstimates, type AccuracySummary } from '../lib/run-estimates';
import { minutes } from '../lib/format';
import { locale, t } from '../i18n';
import { HelpTip } from './HelpTip';
import '../styles/estimate.css';

const weekLabel = (at: number) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(at);

/** The weekly accuracy as small bars (the last week darkest); a missing week is a dot on the baseline. */
export function AccuracyBars({ summary, testid }: { summary: AccuracySummary; testid?: string }) {
  const w = 6, gap = 3, h = 16;
  return <svg className="est-bars" width={summary.bars.length * (w + gap) - gap} height={h} viewBox={`0 0 ${summary.bars.length * (w + gap) - gap} ${h}`} role="img"
    aria-label={summary.bars.filter(b => b.pct !== null).map(b => t('estimate.weekBar', { week: weekLabel(b.weekStart), pct: b.pct!, n: b.n })).join('; ')} data-testid={testid}>
    {summary.bars.map((b, i) => b.pct === null
      ? <rect key={b.weekStart} x={i * (w + gap)} y={h - 2} width={w} height={2} rx={1} className="est-bar-none" />
      : <rect key={b.weekStart} x={i * (w + gap)} y={h - Math.max(2, (b.pct / 100) * h)} width={w} height={Math.max(2, (b.pct / 100) * h)} rx={1.5} className={i === summary.bars.length - 1 ? 'est-bar-last' : 'est-bar'} />)}
  </svg>;
}

/** «entro ×2: 34/50 ▂▃▅▆»: how many estimates held, out of how many, and one bar per week. No "precisione" (it is the
 *  share inside a ×0.5-×2 band, not a precision) and no "+N pt in K settimane" trend (ADR 0101). */
export function AccuracyNote({ summary }: { summary: AccuracySummary | null }) {
  if (!summary) return <p className="est-acc-none">{t('estimate.noAccuracy')}</p>;
  return <div className="est-acc" data-testid="estimate-accuracy" data-pct={summary.pct}>
    <span className="est-acc-k">{t('estimate.accuracy', { k: summary.k, n: summary.n })}</span>
    <AccuracyBars summary={summary} />
  </div>;
}

/** The "?" of an estimate: how it is computed, its range and confidence, the actual once ended, the accuracy. */
function EstimateHelp({ view, agent, summary }: { view: RunEstimateView; agent: string; summary: AccuracySummary | null }) {
  const e = view.estimate!;
  const kind = t(`estimate.kind.${e.kind}` as 'estimate.kind.fix');
  const basis = t(`estimate.basis.${e.basis!}` as 'estimate.basis.kind', { agent });
  const est = estimateText(e);
  return <HelpTip title={t('estimate.tipTitle')} label={t('estimate.tipTitle')} wide guide="classifiers" testid={`estimate-help-${view.runId}`} example={t('estimate.example')}>
    <p>{t('estimate.tipBody', { n: e.n, basis, kind })}</p>
    <p>{t('estimate.tipFigures')}</p>
    {e.timeLowMs !== null && e.timeHighMs !== null && <p>{t('estimate.tipRange', { low: minutes(e.timeLowMs), high: minutes(e.timeHighMs) })}</p>}
    {e.confidence && <p>{t('estimate.tipConfidence', { c: t(`estimate.conf.${e.confidence}` as 'estimate.conf.low') })}</p>}
    {view.actual?.timeMs != null && est.time && view.hit !== null && <p>{t('estimate.tipActual', { est: est.time, act: minutes(view.actual.timeMs), ok: view.hit })}</p>}
    <p className="est-tip-acc"><b>{t('estimate.accuracyTitle')}.</b> {summary ? t('estimate.accuracyLong', { pct: summary.pct, k: summary.k, n: summary.n }) : t('estimate.noAccuracy')} {t('estimate.accuracyTip')}</p>
    {summary && <AccuracyNote summary={summary} />}
    {summary?.specificPct != null && <p className="est-tip-specific">{t('estimate.specific', { pct: summary.specificPct })}</p>}
  </HelpTip>;
}

/** A strip's estimate: dashed and labelled «stima» so it never reads as the run's own time or cost. */
/** workMs = the strip's own work time so far (waits excluded, like the estimate's figures): the time left counts against it. */
export function EstimateChip({ chat, view, summary, busy, workMs }: { chat: ChatSummary; view: RunEstimateView | undefined; summary: AccuracySummary | null; busy: boolean; workMs: number | null }) {
  const e = view?.estimate;
  if (!view || !e || !chat.run) return null;
  const est = estimateText(e);
  const figures = [est.time, est.cost].filter(Boolean).join(' · ');
  const ended = chat.run.endedAt !== undefined;
  const live = !ended && busy && e.timeMs !== null && workMs !== null;
  const over = live && workMs! > e.timeMs!;
  const left = live ? (over ? t('estimate.over') : t('estimate.left', { d: minutes(Math.max(0, e.timeMs! - workMs!)) })) : null;
  const actual = ended && view.actual?.timeMs != null ? minutes(view.actual.timeMs) : null;
  const tone = ended && view.hit !== null ? (view.hit ? ' est-held' : ' est-missed') : over ? ' over' : '';
  const text = ended && actual ? `${est.time ?? est.cost} → ${actual}` : [figures, t('estimate.similar', { n: e.n })].join(' · ');
  return <span className={`th-estimate${tone}`} data-testid={`chat-estimate-${chat.id}`} data-path={e.path} data-hit={view.hit ?? undefined}>
    <span className="sr-only">{t('estimate.aria', { text: [text, left].filter(Boolean).join(', ') })}</span>
    <span aria-hidden="true" className="th-estimate-label">{t('estimate.label')}</span>
    <span aria-hidden="true" className="th-estimate-text">{text}</span>
    {ended && view.hit !== null && <span aria-hidden="true" className="th-estimate-mark" title={t(view.hit ? 'estimate.held' : 'estimate.missed')}>{view.hit ? '✓' : '✗'}</span>}
    {left && <span aria-hidden="true" className="th-estimate-left">{left}</span>}
    <EstimateHelp view={view} agent={chat.agent?.name || chat.run.agentId} summary={summary} />
  </span>;
}

/** The strip's chip with the shared read (one hook per strip; the read itself is shared). */
export function StripEstimate({ chat, busy, workMs }: { chat: ChatSummary; busy: boolean; workMs: number | null }) {
  const data = useRunEstimates();
  if (!chat.run || !data) return null;
  return <EstimateChip chat={chat} view={data.runs[chat.run.runId]} summary={accuracySummary(data.accuracy)} busy={busy} workMs={workMs} />;
}
