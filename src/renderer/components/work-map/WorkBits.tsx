// The small pieces the work maps' list and page share (ADR 0343): a state chip, one round dot per step, and running an
// action of a map (its IPC call; a refusal is told with main's own reason). Used by WorksView.tsx, WorkMapView.tsx and
// project-map/ProjectMapView.tsx.
import { useRef, useState } from 'react';
import type { WorkMapAction, WorkMapInfo } from '@shared/work-map';
import { t } from '../../i18n';
import { errText } from '../../lib/ipc-error';
import { callOf } from '../../lib/work-maps';
import { toast } from '../../store/ui';

export function StateChip({ info }: { info: Pick<WorkMapInfo, 'state' | 'planning'> }) {
  return <span className="wm-chip" data-s={info.state}>{info.planning && info.state === 'idea' ? t('wm.planning') : t(`wm.state.${info.state}`)}</span>;
}

/** One round dot per step, the finished first: how far it is at a glance (the order of the steps is on the map). */
export function StepDots({ info }: { info: Pick<WorkMapInfo, 'steps' | 'done' | 'now' | 'blocked'> }) {
  if (!info.steps) return null;
  const todo = Math.max(0, info.steps - info.done - info.now - info.blocked);
  const dots = [...Array<string>(info.done).fill('done'), ...Array<string>(info.now).fill('now'), ...Array<string>(info.blocked).fill('blocked'), ...Array<string>(todo).fill('todo')];
  return <span className="wm-dots" aria-hidden="true">{dots.map((s, i) => <i key={i} data-s={s} />)}</span>;
}

/** What a button says: the start of an idea is its plan. */
export const actionLabel = (a: Exclude<WorkMapAction, 'seen'>, state: WorkMapInfo['state']): string => t(a === 'start' && state === 'idea' ? 'wm.do.plan' : `wm.do.${a}`);

/** Runs an action of a map, once at a time: the map moves by itself at workmap:changed. Resolves true when main took it. */
export function useWorkAction(): { busy: boolean; run: (info: WorkMapInfo, action: WorkMapAction, text?: string) => Promise<boolean> } {
  const [busy, setBusy] = useState(false);
  const going = useRef(false);
  const run = async (info: WorkMapInfo, action: WorkMapAction, text?: string): Promise<boolean> => {
    const call = callOf(info, action, text);
    if (!call || going.current) return false;
    going.current = true; setBusy(true);
    try {
      if (call.channel === 'workmap:approve' || call.channel === 'workmap:keep') await window.sb.invoke(call.channel, call.args);
      else if (call.channel === 'workmap:replan') await window.sb.invoke(call.channel, call.args);
      else await window.sb.invoke(call.channel, call.args);
      return true;
    } catch (e) {
      toast(action === 'seen' ? errText(e) : t('wm.failedDo', { what: actionLabel(action, info.state), why: errText(e) }), 'err');
      return false;
    } finally { going.current = false; setBusy(false); }
  };
  return { busy, run };
}
