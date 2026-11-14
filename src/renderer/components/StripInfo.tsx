// The rest of a strip, behind one small mark (ADR 0307; the owner, 2026-11-14: «mi interessa vedere a colpo d'occhio
// cosa fanno a livello di task e se sono in attività, il resto posso guardarlo da un tooltip informativo»). A closed
// strip (ChatTile.tsx) and a delegated chat's row (DelegationCard.tsx) say what the chat does and its state; the model
// and the effort it runs with, the work time and the cost so far next to their estimate, and the context are lines of
// this mark's tip (the global TooltipLayer, components/ui.tsx). The mark is amber when the work is past its estimate or
// the context is long, and the tip says which. Open, the window's own ⓘ opens
// the details row; the full screen keeps the figures on its bar (StripMeta.tsx).
import type { ChatSummary } from '@shared/contract';
import type { TaskEstimate } from '@shared/task-estimate';
import { chatCost, minutes, modelWithEffort, tokensShort } from '../lib/format';
import { estimateText, useRunEstimates } from '../lib/run-estimates';
import { tipOf } from '../lib/tips';
import { IconInfo } from './Icons';
import { t } from '../i18n';

interface StripFacts { title: string; lines: string[]; over: boolean; tip: string }

/** What the tip says: the task whole on the first line, then one fact per line; `over` when something asks for a look. */
export function stripInfo(chat: ChatSummary, workMs: number | null, estimate: Pick<TaskEstimate, 'timeMs' | 'costUsd'> | null, longContext = false): Omit<StripFacts, 'tip'> {
  const costNow = chat.costLedgerUsd ?? (chat.costKnown === false ? null : chat.costUsd || null);
  const est = estimate ? estimateText(estimate) : null;
  const overTime = !!estimate && estimate.timeMs !== null && workMs !== null && workMs > estimate.timeMs;
  const overCost = !!estimate && estimate.costUsd !== null && costNow !== null && costNow > estimate.costUsd * 1.5;
  const figure = (now: string, about: string | null, over: boolean): string => `${now}${about ? ` · ${t('aw.info.estimate', { v: about })}` : ''}${over ? ` · ${t('aw.info.over')}` : ''}`;
  const model = modelWithEffort(chat), n = chat.contextTokens;
  const lines = [
    model ? t('aw.info.model', { v: model }) : null,
    workMs !== null ? t('aw.info.time', { v: figure(minutes(workMs), est?.time ?? null, overTime) }) : null,
    costNow !== null ? t('aw.info.cost', { v: figure(chatCost(chat), est?.cost ?? null, overCost) }) : null,
    n ? t('aw.info.context', { v: `${chat.contextEstimated ? '~' : ''}${tokensShort(n)}${chat.contextMaxTokens ? ` / ${tokensShort(chat.contextMaxTokens)}` : ''}${longContext ? ` · ${t('aw.info.long')}` : ''}` }) : null,
  ].filter((l): l is string => !!l);
  return { title: chat.title, lines, over: overTime || overCost || longContext };
}

/** The strip's facts with their tip, from the estimates the caller read with useRunEstimates (a hook: a component
 *  that can return early calls it first and this after, ChatTile.tsx). */
export function stripFacts(chat: ChatSummary, workMs: number | null, estimates: ReturnType<typeof useRunEstimates>, longContext = false): StripFacts {
  const info = stripInfo(chat, workMs, chat.run ? estimates?.runs[chat.run.runId]?.estimate ?? null : null, longContext);
  return { ...info, tip: tipOf(info.title, info.lines) };
}
/** The same for a component with no early return: the mark and the task's own text carry the one tip. */
export const useStripInfo = (chat: ChatSummary, workMs: number | null, longContext = false): StripFacts => stripFacts(chat, workMs, useRunEstimates(), longContext);

export function StripInfo({ chatId, info }: { chatId: string; info: StripFacts }) {
  if (!info.lines.length) return null;
  return <span className={`strip-info${info.over ? ' over' : ''}`} tabIndex={0} role="note" aria-label={[info.title, ...info.lines].join('. ')} data-tip={info.tip} data-over={info.over || undefined} data-testid={`chat-info-${chatId}`}>
    <IconInfo size={13} />
  </span>;
}
