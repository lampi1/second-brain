// The figures of a strip (ADR 0292): the work time and the cost so far, each next to its estimate from similar jobs
// when there is one («22 min / ~19 min · 1,84 $ / ~0,60 $»), amber once past it (time: past it; cost: past 1.5 times).
// Always on a root strip (ChatTile.tsx) and on a delegated chat's row (DelegationCard.tsx). The cost is read as
// lib/format.ts chatCost reads it: the ledger's for an engine that reports none, nothing when unknown or zero.
import type { ChatSummary } from '@shared/contract';
import { chatCost, minutes } from '../lib/format';
import { estimateText, useRunEstimates } from '../lib/run-estimates';
import { t } from '../i18n';

export function StripMeta({ chat, workMs }: { chat: ChatSummary; workMs: number | null }) {
  const estimates = useRunEstimates();
  const estimate = chat.run ? estimates?.runs[chat.run.runId]?.estimate ?? null : null;
  const costNow = chat.costLedgerUsd ?? (chat.costKnown === false ? null : chat.costUsd || null);
  if (workMs === null && costNow === null) return null;
  const est = estimate ? estimateText(estimate) : null;
  const overTime = !!estimate && estimate.timeMs !== null && workMs !== null && workMs > estimate.timeMs;
  const overCost = !!estimate && estimate.costUsd !== null && costNow !== null && costNow > estimate.costUsd * 1.5;
  const withEstimate = (workMs !== null && !!est?.time) || (costNow !== null && !!est?.cost);
  return <span className="strip-meta" data-testid={`chat-meta-${chat.id}`} data-tip={t(withEstimate ? 'aw.metaTipEst' : 'aw.metaTip')}>
    {workMs !== null && <span className={overTime ? 'over' : undefined}>{minutes(workMs)}{est?.time && <i> / {est.time}</i>}</span>}
    {costNow !== null && <span className={overCost ? 'over' : undefined}>{chatCost(chat)}{est?.cost && <i> / {est.cost}</i>}</span>}
    {(overTime || overCost) && <span className="sr-only" data-testid={`chat-over-${chat.id}`}>{t('aw.overTip')}</span>}
  </span>;
}
