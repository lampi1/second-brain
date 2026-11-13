// The figures of a strip (ADR 0292): the work time and the cost so far, each next to its estimate from similar jobs
// when there is one («22 min / ~19 min · 1,84 $ / ~0,60 $»), amber once past it (time: past it; cost: past 1.5 times).
// Always on a root strip (ChatTile.tsx) and on a delegated chat's row (DelegationCard.tsx). The cost is read as
// lib/format.ts chatCost reads it: the ledger's for an engine that reports none, nothing when unknown or zero.
// Before the figures, in plain words, the model the chat runs on and the effort it runs with («Opus 5.5 · high», the
// owner, 2026-11-13: «voglio vedere il modello e effort nelle striscioline degli agenti»): the effort as the engine
// reports it or as the last turn sent it, never the one only asked for (lib/format.ts modelWithEffort).
import type { ChatSummary } from '@shared/contract';
import { chatCost, minutes, modelWithEffort } from '../lib/format';
import { estimateText, useRunEstimates } from '../lib/run-estimates';
import { t } from '../i18n';

export function StripMeta({ chat, workMs }: { chat: ChatSummary; workMs: number | null }) {
  const estimates = useRunEstimates();
  const estimate = chat.run ? estimates?.runs[chat.run.runId]?.estimate ?? null : null;
  const costNow = chat.costLedgerUsd ?? (chat.costKnown === false ? null : chat.costUsd || null);
  const name = modelWithEffort(chat);
  // the tip says it whole: on a narrow strip the text is cut
  const model = <span className="strip-model" data-testid={`strip-model-${chat.id}`} data-tip={`${name}. ${t('aw.modelTip')}`}>{name}</span>;
  if (workMs === null && costNow === null) return model;
  const est = estimate ? estimateText(estimate) : null;
  const overTime = !!estimate && estimate.timeMs !== null && workMs !== null && workMs > estimate.timeMs;
  const overCost = !!estimate && estimate.costUsd !== null && costNow !== null && costNow > estimate.costUsd * 1.5;
  const withEstimate = (workMs !== null && !!est?.time) || (costNow !== null && !!est?.cost);
  return <>{model}<span className="strip-meta" data-testid={`chat-meta-${chat.id}`} data-tip={t(withEstimate ? 'aw.metaTipEst' : 'aw.metaTip')}>
    {workMs !== null && <span className={overTime ? 'over' : undefined}>{minutes(workMs)}{est?.time && <i> / {est.time}</i>}</span>}
    {costNow !== null && <span className={overCost ? 'over' : undefined}>{chatCost(chat)}{est?.cost && <i> / {est.cost}</i>}</span>}
    {(overTime || overCost) && <span className="sr-only" data-testid={`chat-over-${chat.id}`}>{t('aw.overTip')}</span>}
  </span></>;
}
