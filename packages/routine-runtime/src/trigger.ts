// The DevOps trigger loop of the routine runtime (ADR 0175): polls the package's trigger rule (states, tags, ids,
// iteration; e.g. state New + tag ai-fixable) with the shared read-only detector, and starts ONE run per work item
// through the runtime's `startItem`, the same path a single-item start takes. The cursor and the dedup subjects live in
// the runs root's trigger.json, so a restarted loop (app or `routine watch`) never starts an item twice.
import type { FlowAutomationConfig, FlowDetectionResult } from '../../../src/shared/flow-automation';
import type { RoutineTrigger } from './format';
import type { RunStore, TriggerState } from './run-store';
import type { Clock, RuntimeLog, TokenProvider } from './ports';
import { createDevOpsDetector } from './devops-detector';

export type Detect = (config: FlowAutomationConfig, cursor: Record<string, string>, signal?: AbortSignal) => Promise<FlowDetectionResult>;

export interface TriggerLoopOptions {
  routineId: string;
  trigger: RoutineTrigger;
  store: RunStore;
  /** starts one run for a work item (runtime.startItem) */
  start(workItem: number, inputs: Record<string, string>): { runId: string } | Promise<{ runId: string }>;
  /** the detector (default: the shared one with `authorization`) */
  detect?: Detect;
  authorization?: TokenProvider;
  clock?: Clock;
  log?: RuntimeLog;
}

export interface TickResult { started: { workItem: number; runId: string }[]; skipped: number; summary: string }

export const subjectKeyOf = (workItem: number): string => `item:${workItem}`;
const HOUR = 3_600_000;

export function createTriggerLoop(options: TriggerLoopOptions) {
  const clock = options.clock ?? { now: () => Date.now() };
  const detect: Detect = options.detect ?? createDevOpsDetector(options.authorization ? { authorization: options.authorization } : {});
  let timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined, busy: Promise<TickResult> | undefined, stopped = true;
  const config = (): FlowAutomationConfig => ({ flowId: options.routineId, flowVersion: 1, trigger: { ...options.trigger }, scope: {}, inputs: {}, priority: 'normal' });

  async function pass(signal: AbortSignal): Promise<TickResult> {
    const state: TriggerState = options.store.trigger();
    const at = clock.now();
    let result: FlowDetectionResult;
    try { result = await detect(config(), state.cursor, signal); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.store.setTrigger({ ...state, lastCheckAt: at, lastResult: message });
      options.log?.warn('routine', 'trigger check failed', { cause: message });
      return { started: [], skipped: 0, summary: message };
    }
    const started: TickResult['started'] = [];
    let skipped = 0;
    const starts = state.starts.filter(t => t > at - HOUR);
    const max = options.trigger.maxPerHour;
    for (const item of result.items) {
      const id = Number(item.inputs['work-item-id']);
      if (!Number.isSafeInteger(id) || id <= 0) { skipped++; continue; }
      const key = subjectKeyOf(id);
      if (state.subjects[key]) { skipped++; continue; }
      if (max && starts.length >= max) { skipped++; continue; }
      // the subject is saved before the start: a crash in between never starts the item twice
      state.subjects[key] = { runId: '', at, title: item.title };
      options.store.setTrigger({ ...state, starts });
      const handle = await options.start(id, {});
      state.subjects[key] = { runId: handle.runId, at, title: item.title };
      starts.push(at);
      started.push({ workItem: id, runId: handle.runId });
    }
    const summary = `${result.summary} Avviate ${started.length} run.`;
    // the cursor advances even for items skipped by the hourly cap: they stay deduplicated only once started
    for (const item of result.items) {
      const id = item.inputs['work-item-id'];
      if (id && !state.subjects[subjectKeyOf(Number(id))]) delete result.cursor[id];
    }
    options.store.setTrigger({ ...state, cursor: result.cursor, starts, lastCheckAt: at, lastResult: summary });
    if (started.length) options.log?.info('routine', 'trigger started runs', { data: { started } });
    return { started, skipped, summary };
  }

  const loop = {
    /** One poll now: detect, start one run per new work item. Concurrent calls share the same pass. */
    tick(): Promise<TickResult> {
      if (busy) return busy;
      controller = new AbortController();
      busy = pass(controller.signal).finally(() => { busy = undefined; });
      return busy;
    },
    /** Polls every trigger.everyMinutes until stop(). */
    start(): void {
      if (!stopped) return;
      stopped = false;
      const every = Math.max(1, options.trigger.everyMinutes) * 60_000;
      const next = () => { if (!stopped) timer = setTimeout(() => { void loop.tick().catch(() => undefined).finally(next); }, every); };
      void loop.tick().catch(() => undefined).finally(next);
    },
    stop(): void { stopped = true; if (timer) clearTimeout(timer); timer = undefined; controller?.abort(); },
    get running(): boolean { return !stopped; },
  };
  return loop;
}
export type TriggerLoop = ReturnType<typeof createTriggerLoop>;
