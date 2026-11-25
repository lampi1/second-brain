// The live status of a plan in words (ADR 0342): what it, or a step, is doing and for whom it waits, who works, what
// failed or was lost, since when nobody confirms it and why it stopped. Nothing is added to what main says.
// Used by PlansPage.tsx (rows), PlanView.tsx, WorkDrawing.tsx (boxes), WorkSide.tsx and plans/PlanSteps.tsx.
import type { PlanInfo, PlanLive, PlanSay, PlanWaitFor, PlanWorker } from '@shared/plan';
import { t } from '../../i18n';
import { ago } from '../../lib/format';
import { liveKind } from '../../lib/plans';

type Say = { say?: PlanSay; waits?: PlanWaitFor };
/** What it is doing; '' = nothing to say. */
export const sayLabel = (l: Say): string => (!l.say ? '' : l.say === 'waiting' && l.waits ? t(`plans.waits.${l.waits}`) : t(`plans.say.${l.say}`));

/** Why a map is stopped, as far as the app knows; '' = it is not. */
export const whyOf = (i: Pick<PlanInfo, 'stopped' | 'live'>): string => (i.live?.why ? t(`plans.why.${i.live.why}`) : i.stopped ? t(`plans.stop.${i.stopped.by}`) : '');

export function LiveChip({ live, testid }: { live: Say & { stale?: number } | undefined; testid: string }) {
  const label = live ? sayLabel(live) : '';
  if (!live || !label) return null;
  return <span className="pl-live" data-k={liveKind(live)} data-testid={testid}>{label}</span>;
}

export function Stale({ live, now, testid }: { live: { stale?: number } | undefined; now: number; testid: string }) {
  return live?.stale === undefined ? null : <span className="pl-stale" data-testid={testid}>{t('plans.stale', { at: ago(live.stale, now) })}</span>;
}

const nameOf = (w: PlanWorker): string => (w.n === undefined && !w.below ? t('plans.self') : w.title || t('plans.say.gone'));
/** Some names, and how many more. */
const names = (ws: readonly PlanWorker[]): string => `${ws.slice(0, 2).map(nameOf).join(', ')}${ws.length > 2 ? ` +${ws.length - 2}` : ''}`;

/** A row's live part: the one thing to say with whose it is, then what else is going on. */
export function LiveLine({ live, id, now }: { live: PlanLive | undefined; id: string; now: number }) {
  if (!live) return null;
  const head = live.say === 'working' ? live.working : live.say === 'waiting' ? live.waiting.filter(w => w.waits === live.waits) : live.say === 'failed' ? live.failed : [];
  return <>
    <LiveChip live={live} testid={`pl-live-${id}`} />
    {head.length > 0 && <span className="pl-who" data-testid={`pl-who-${id}`}>{names(head)}</span>}
    {live.say !== 'working' && live.working.length > 0 && <span>{t('plans.row.working', { who: names(live.working) })}</span>}
    {live.say === 'working' && live.waiting.length > 0 && <span>{t('plans.row.waiting', { n: live.waiting.length })}</span>}
    {live.say !== 'failed' && live.failed.length > 0 && <span className="pl-stuck">{t('plans.row.failed', { n: live.failed.length })}</span>}
    {live.lost.length > 0 && <span className="pl-stuck">{t('plans.row.lost', { n: live.lost.length })}</span>}
    <Stale live={live} now={now} testid={`pl-stale-${id}`} />
  </>;
}
