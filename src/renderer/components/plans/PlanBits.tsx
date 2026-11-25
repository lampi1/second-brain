// The small pieces the plans' list and page share (ADR 0359): a state chip, the progress bar with its percentage (the share done,
// «fatto in parte» half), and running an action of a plan (its IPC call; a refusal is told with main's own reason). Used by
// PlansPage.tsx, PlanView.tsx and PlanSteps.tsx.
import { useRef, useState } from 'react';
import type { PlanAction, PlanInfo } from '@shared/plan';
import { t } from '../../i18n';
import { errText } from '../../lib/ipc-error';
import { callOf, type PlanButton } from '../../lib/plans';
import { toast } from '../../store/ui';

export function StateChip({ info }: { info: Pick<PlanInfo, 'state' | 'planning' | 'deleted'> }) {
  const s = info.deleted ? 'deleted' : info.state;
  return <span className="pl-chip" data-s={s}>{info.planning && info.state === 'idea' && !info.deleted ? t('plans.planning') : t(`plans.state.${s}`)}</span>;
}

/** The bar: segments for what is done, done in part, under way and blocked, and the percentage beside it. */
export function ProgressBar({ info, testid }: { info: Pick<PlanInfo, 'steps' | 'done' | 'partial' | 'now' | 'blocked' | 'percent'>; testid: string }) {
  if (!info.steps) return null;
  const share = (n: number) => `${(n / info.steps) * 100}%`;
  return <span className="pl-progress" data-testid={testid}>
    <span className="pl-bar-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={info.percent} aria-label={t('plans.bar', { n: info.percent })}>
      <i data-s="done" style={{ width: share(info.done) }} /><i data-s="partial" style={{ width: share(info.partial) }} /><i data-s="now" style={{ width: share(info.now) }} /><i data-s="blocked" style={{ width: share(info.blocked) }} />
    </span>
    <b className="pl-percent" data-testid={`${testid}-percent`}>{t('plans.percent', { n: info.percent })}</b>
    <span className="pl-of">{t('plans.of', { done: info.done, n: info.steps })}</span>
  </span>;
}

/** What a button says: the start of an idea is its plan. */
export const actionLabel = (a: PlanButton, state: PlanInfo['state']): string => t(a === 'start' && state === 'idea' ? 'plans.do.plan' : `plans.do.${a}`);

/** Runs an action of a plan, once at a time: the plan moves by itself at plans:changed. Resolves true when main took it. */
export function usePlanAction(): { busy: boolean; run: (info: PlanInfo, action: PlanAction, text?: string) => Promise<boolean> } {
  const [busy, setBusy] = useState(false);
  const going = useRef(false);
  const run = async (info: PlanInfo, action: PlanAction, text?: string): Promise<boolean> => {
    const call = callOf(info, action, text);
    if (!call || going.current) return false;
    going.current = true; setBusy(true);
    try {
      if (call.channel === 'plans:approve' || call.channel === 'plans:keep') await window.sb.invoke(call.channel, call.args);
      else if (call.channel === 'plans:replan') await window.sb.invoke(call.channel, call.args);
      else await window.sb.invoke(call.channel, call.args);
      return true;
    } catch (e) {
      toast(action === 'seen' ? errText(e) : t('plans.failedDo', { what: actionLabel(action as PlanButton, info.state), why: errText(e) }), 'err');
      return false;
    } finally { going.current = false; setBusy(false); }
  };
  return { busy, run };
}
