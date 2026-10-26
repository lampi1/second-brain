// What a collapsed agent strip says while its chat works (ADR 0102, owner: "l'app deve essere viva"): instead of a bare
// "sta lavorando…", the current step read from the transcript with zero tokens (lib/run-steps.ts, the same lines as the
// delegated cards): the command or tool running now, else the engine's plan item in progress, else the last action;
// "passo 3/7" when the engine keeps a plan; and how long the chat has been silent, computed from its last item's `at`
// ("da 6 min" on a tool still running, "ferma da 6 min" otherwise), stalled (amber) after the delegation stall
// threshold (Impostazioni → Ruoli e deleghe, stallMin; the same rule agents/delegation.ts stalledMin gives a parent).
// Pure: used by components/StripActivity.tsx, pinned by test/unit/strip-status.test.ts.
import type { ChatItem } from '@shared/contract';
import { lastActionStep, enginePlan, type RunStep } from './run-steps';

/** Below this silence the line shows no clock: a model thinking for a minute is normal. */
export const QUIET_MIN = 2;

export interface StripStatus {
  /** the step in words (null: nothing readable yet, the generic "sta pensando…" stays) */
  step: RunStep | null;
  /** the engine's plan: the item in progress (1-based) of how many; null without a plan of at least two items */
  plan: { at: number; of: number } | null;
  /** whole minutes since the last item, when at least QUIET_MIN; null otherwise */
  quietMin: number | null;
  /** the silence is a running tool's (a long command): "da N min", not "ferma" */
  toolRunning: boolean;
  /** silent for stallMin minutes or more */
  stalled: boolean;
}

export function stripStatus(items: readonly ChatItem[] | undefined, now: number, stallMin: number): StripStatus {
  const list = items ?? [];
  const plan = enginePlan(list);
  const action = lastActionStep(list, true);
  const last = list[list.length - 1];
  const toolRunning = last?.kind === 'tool' && last.status === 'running';
  const current = action?.mark === 'cur' ? action : null;
  const planCur = plan?.find(p => p.mark === 'cur') ?? null;
  const step = current ?? planCur ?? action;
  let planPos: StripStatus['plan'] = null;
  if (plan && plan.length >= 2) {
    const done = plan.filter(p => p.mark === 'done' || p.mark === 'bad').length;
    planPos = { at: Math.min(done + 1, plan.length), of: plan.length };
  }
  // a reply streaming in is no silence; otherwise the clock runs from the newest item's time
  const streaming = last?.kind === 'assistant' && last.streaming;
  const newest = list.reduce((m, i) => Math.max(m, i.at || 0), 0);
  const quiet = !streaming && newest > 0 ? Math.floor(Math.max(0, now - newest) / 60_000) : 0;
  const quietMin = quiet >= QUIET_MIN ? quiet : null;
  return { step, plan: planPos, quietMin, toolRunning, stalled: quietMin !== null && quiet >= Math.max(1, stallMin) };
}
