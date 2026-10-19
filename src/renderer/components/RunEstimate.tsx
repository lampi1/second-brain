// The task estimate on screen (ADR 0087; owner, 2026-10-19: «stime leggibili … e il progresso dei classificatori nelle
// stime»). EstimateChip sits in a strip's facts: «STIMA ~4 min · ~0,12 $ · su 12 task simili ?» while the run is open
// (with the time left once it is at work), «STIMA ~4 min → 6 min ✓» once it ended (✓ = the actual time fell between half
// and double). Its "?" says how the figure is computed (which similar tasks, the classifier's kind, the middle-half range,
// the confidence) and how accurate the estimates have been, week by week. OrchestratorPlan is the plan block under the
// Orchestrator's head: the agents it started today with their estimates (a «via rapida» mark on a quick single-agent
// job), the sum, and the accuracy line with its weekly bars. Data: lib/run-estimates.ts. Used by ChatTile.tsx and
// OrchestratorTile.tsx.
import type { ChatSummary } from '@shared/contract';
import type { RunEstimateView } from '@shared/task-estimate';
import { accuracySummary, estimateText, planOf, useRunEstimates, type AccuracySummary } from '../lib/run-estimates';
import { formatCost, minutes } from '../lib/format';
import { useNow } from '../lib/clock';
import { useApp } from '../store/store';
import { focusChat } from '../actions';
import { locale, t } from '../i18n';
import { HelpTip } from './HelpTip';
import { AgentAvatar } from './AgentAvatar';
import { StatePill } from './ui';
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

const trendText = (s: AccuracySummary) => s.trendPts === null ? null : s.trendPts > 0 ? t('estimate.trendUp', { pts: s.trendPts, weeks: s.weeks }) : s.trendPts < 0 ? t('estimate.trendDown', { pts: -s.trendPts, weeks: s.weeks }) : t('estimate.trendFlat');

/** «precisione 68% · +14 pt in 8 settimane ▂▃▅▆» and, below, the share now on the most specific match. */
export function AccuracyNote({ summary, compact }: { summary: AccuracySummary | null; compact?: boolean }) {
  if (!summary) return compact ? null : <p className="est-acc-none">{t('estimate.noAccuracy')}</p>;
  const trend = trendText(summary);
  return <div className={`est-acc${compact ? ' compact' : ''}`} data-testid="estimate-accuracy" data-pct={summary.pct}>
    <span className="est-acc-k">{t('estimate.accuracy', { pct: summary.pct })}</span>
    {trend && <span className={`est-acc-trend${summary.trendPts! > 0 ? ' up' : summary.trendPts! < 0 ? ' down' : ''}`}>{trend}</span>}
    <AccuracyBars summary={summary} />
  </div>;
}

/** The "?" of an estimate: how it is computed, its range and confidence, the actual once ended, the accuracy. */
function EstimateHelp({ view, agent, summary }: { view: RunEstimateView; agent: string; summary: AccuracySummary | null }) {
  const e = view.estimate!;
  const kind = t(`estimate.kind.${e.kind}` as 'estimate.kind.fix');
  const basis = t(`estimate.basis.${e.basis!}` as 'estimate.basis.kind', { agent });
  const est = estimateText(e);
  return <HelpTip title={t('estimate.tipTitle')} label={t('estimate.tipTitle')} wide testid={`estimate-help-${view.runId}`} example={t('estimate.example')}>
    <p>{t('estimate.tipBody', { n: e.n, basis, kind })}</p>
    <p>{t('estimate.tipFigures')}</p>
    {e.timeLowMs !== null && e.timeHighMs !== null && <p>{t('estimate.tipRange', { low: minutes(e.timeLowMs), high: minutes(e.timeHighMs) })}</p>}
    {e.confidence && <p>{t('estimate.tipConfidence', { c: t(`estimate.conf.${e.confidence}` as 'estimate.conf.low') })}</p>}
    {view.actual?.timeMs != null && est.time && view.hit !== null && <p>{t('estimate.tipActual', { est: est.time, act: minutes(view.actual.timeMs), ok: view.hit })}</p>}
    <p className="est-tip-acc"><b>{t('estimate.accuracyTitle')}.</b> {summary ? t('estimate.accuracyLong', { pct: summary.pct, n: summary.n }) : t('estimate.noAccuracy')} {t('estimate.accuracyTip')}</p>
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

/** The Orchestrator's plan: what it started today, each with its estimate, the sum and the accuracy. Hidden when empty. */
export function OrchestratorPlan() {
  const data = useRunEstimates();
  const now = useNow(60_000);
  const chats = useApp(s => s.chats);
  const plan = planOf(Object.values(chats), data?.runs, now);
  if (!plan.rows.length) return null;
  const summary = accuracySummary(data?.accuracy);
  const total = [plan.timeMs ? `~${minutes(plan.timeMs)}` : null, plan.costUsd ? `~${formatCost(plan.costUsd)}` : null].filter(Boolean).join(' · ');
  return <section className="est-plan" aria-label={t('estimate.plan.title')} data-testid="orchestrator-plan" data-rows={plan.rows.length} data-quick={plan.quick}>
    <header className="est-plan-head">
      <span className="est-plan-title">{t('estimate.plan.title')}</span>
      <span className="est-plan-count">{t('estimate.plan.count', { n: plan.rows.length })}</span>
      {total && <span className="est-plan-total" data-testid="orchestrator-plan-total"><span className="th-estimate-label">{t('estimate.plan.total')}</span>{total}</span>}
      <HelpTip title={t('estimate.plan.title')} label={t('estimate.plan.title')} wide testid="orchestrator-plan-help">
        <p>{t('estimate.plan.tip')}</p>
        <p className="est-tip-acc"><b>{t('estimate.accuracyTitle')}.</b> {summary ? t('estimate.accuracyLong', { pct: summary.pct, n: summary.n }) : t('estimate.noAccuracy')} {t('estimate.accuracyTip')}</p>
        {summary?.specificPct != null && <p className="est-tip-specific">{t('estimate.specific', { pct: summary.specificPct })}</p>}
      </HelpTip>
    </header>
    <ul className="est-plan-rows">
      {plan.rows.slice(0, 6).map(({ chat, view, ended }) => {
        const e = view?.estimate, est = e ? estimateText(e) : null;
        const actual = ended && view?.actual?.timeMs != null ? minutes(view.actual.timeMs) : null;
        return <li key={chat.id}>
          <button type="button" className="est-plan-row" onClick={() => focusChat(chat.id)} data-testid={`orchestrator-plan-row-${chat.id}`}>
            <AgentAvatar avatar={chat.agent?.avatar} name={chat.agent?.name || chat.title} size={18} />
            <span className="est-plan-name" title={chat.title}>{chat.title}</span>
            {e?.quick && e.path !== 'tree' && <span className="est-quick" title={t('estimate.plan.quickTip')}>{t('estimate.plan.quick')}</span>}
            <span className="est-plan-fig">{e && est ? (actual ? `${est.time ?? est.cost} → ${actual}` : [est.time, est.cost].filter(Boolean).join(' · ')) : <span className="est-plan-few">{t('estimate.plan.few')}</span>}
              {actual && view?.hit != null && <span className={`th-estimate-mark ${view.hit ? 'est-held' : 'est-missed'}`} aria-label={t(view.hit ? 'estimate.held' : 'estimate.missed')}>{view.hit ? '✓' : '✗'}</span>}
            </span>
            <StatePill chat={chat} />
          </button>
        </li>;
      })}
    </ul>
    <AccuracyNote summary={summary} compact />
  </section>;
}
