// The small pieces the work maps' list and page share (ADR 0343): a state chip, one round dot per step, and running an
// action of a map (its IPC call; a refusal is told with main's own reason). Used by PlansPage.tsx, PlanFull.tsx and
// project-map/ProjectMapView.tsx.
import { useRef, useState } from 'react';
import type { PlanAction, PlanInfo } from '@shared/plan';
import { t } from '../../i18n';
import { errText } from '../../lib/ipc-error';
import { callOf } from '../../lib/plans';
import { toast } from '../../store/ui';

export function StateChip({ info }: { info: Pick<PlanInfo, 'state' | 'planning'> }) {
  return <span className="pl-chip" data-s={info.state}>{info.planning && info.state === 'idea' ? t('plans.planning') : t(`plans.state.${info.state}`)}</span>;
}

/** One round dot per step, the finished first: how far it is at a glance (the order of the steps is on the map). */
export function StepDots({ info }: { info: Pick<PlanInfo, 'steps' | 'done' | 'now' | 'blocked'> }) {
  if (!info.steps) return null;
  const todo = Math.max(0, info.steps - info.done - info.now - info.blocked);
  const dots = [...Array<string>(info.done).fill('done'), ...Array<string>(info.now).fill('now'), ...Array<string>(info.blocked).fill('blocked'), ...Array<string>(todo).fill('todo')];
  return <span className="pl-dots" aria-hidden="true">{dots.map((s, i) => <i key={i} data-s={s} />)}</span>;
}

/** What a button says: the start of an idea is its plan. */
export const actionLabel = (a: Exclude<PlanAction, 'seen'>, state: PlanInfo['state']): string => t(a === 'start' && state === 'idea' ? 'plans.do.plan' : `plans.do.${a}`);

/** Runs an action of a map, once at a time: the map moves by itself at plans:changed. Resolves true when main took it. */
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
      toast(action === 'seen' ? errText(e) : t('plans.failedDo', { what: actionLabel(action, info.state), why: errText(e) }), 'err');
      return false;
    } finally { going.current = false; setBusy(false); }
  };
  return { busy, run };
}
