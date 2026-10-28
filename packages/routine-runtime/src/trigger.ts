// The DevOps trigger loop of the routine runtime (ADR 0175): polls the package's trigger rule (states, tags, ids,
// iteration; e.g. state New + tag ai-fixable) with the shared read-only detector, and starts ONE run per work item
// through the runtime's `startItem`, the same path a single-item start takes. The cursor and the dedup subjects live in
// the runs root's trigger.json, so a restarted loop (app or `routine watch`) never starts an item twice. A parking
// package (escalation.park) is driven by comments: each pass first offers every started item to `resume` (a parked
// run goes on when its contact answered), then starts new items that `admit` accepts, at most `maxActive` at once.
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
  /** resumes a started item's run when it is parked and answered (runtime.resumeParked); null = nothing to do */
  resume?(runId: string): Promise<{ runId: string } | null>;
  /** whether a new item may start (runtime.admitItem): false keeps it seen until its next change */
  admit?(workItem: number): Promise<boolean>;
  /** runs going on now (for trigger.maxActive) */
  active?(): number;
  /** the detector (default: the shared one with `authorization`) */
  detect?: Detect;
  authorization?: TokenProvider;
  clock?: Clock;
  log?: RuntimeLog;
}

export interface TickResult { started: { workItem: number; runId: string }[]; resumed: { workItem: number; runId: string }[]; skipped: number; summary: string }

export const subjectKeyOf = (workItem: number): string => `item:${workItem}`;
const HOUR = 3_600_000;

export function createTriggerLoop(options: TriggerLoopOptions) {
  const clock = options.clock ?? { now: () => Date.now() };
  const detect: Detect = options.detect ?? createDevOpsDetector(options.authorization ? { authorization: options.authorization } : {});
  let timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined, busy: Promise<TickResult> | undefined, stopped = true;
  // the detector sees one area per call: the trigger's own, then each further one with its own cursor and its overrides
  // (an override replaces the rule's value: an area's includeTags narrows only that area)
  const scopes = (): { key: string; trigger: FlowAutomationConfig['trigger'] }[] => {
    const { areas, maxActive: _maxActive, ...base } = options.trigger;
    return [{ key: '', trigger: { ...base } }, ...(areas ?? []).map(a => ({ key: `${a.project}|${a.areaPath}`, trigger: { ...base, ...a } }))];
  };
  const config = (trigger: FlowAutomationConfig['trigger']): FlowAutomationConfig => ({ flowId: options.routineId, flowVersion: 1, trigger, scope: {}, inputs: {}, priority: 'normal' });
  const busyNow = () => options.trigger.maxActive !== undefined && (options.active?.() ?? 0) >= options.trigger.maxActive;
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);

  async function pass(signal: AbortSignal): Promise<TickResult> {
    const state: TriggerState = options.store.trigger();
    const at = clock.now();
    const started: TickResult['started'] = [], resumed: TickResult['resumed'] = [], summaries: string[] = [];
    let skipped = 0, checked = 0;
    // answered parked runs first: they hold a branch and a person waits for them
    if (options.resume) for (const [key, subject] of Object.entries(state.subjects)) {
      if (!subject.runId || busyNow() || signal.aborted) continue;
      try {
        const handle = await options.resume(subject.runId);
        if (handle) resumed.push({ workItem: Number(key.slice('item:'.length)), runId: handle.runId });
      } catch (error) { options.log?.warn('routine', 'parked run not resumed', { data: { runId: subject.runId }, cause: message(error) }); }
    }
    const starts = state.starts.filter(t => t > at - HOUR);
    const max = options.trigger.maxPerHour;
    for (const scope of scopes()) {
      const before = scope.key ? state.cursors?.[scope.key] ?? {} : state.cursor;
      let result: FlowDetectionResult;
      try { result = await detect(config(scope.trigger), before, signal); }
      catch (error) {
        summaries.push(message(error));
        options.log?.warn('routine', 'trigger check failed', { cause: message(error) });
        continue;
      }
      const notAdmitted = new Set<number>();
      for (const item of result.items) {
        const id = Number(item.inputs['work-item-id']);
        if (!Number.isSafeInteger(id) || id <= 0) { skipped++; continue; }
        const key = subjectKeyOf(id);
        if (state.subjects[key]) { skipped++; continue; }
        if ((max && starts.length >= max) || busyNow()) { skipped++; continue; }
        if (options.admit) {
          let ok: boolean;
          try { ok = await options.admit(id); } catch (error) { options.log?.warn('routine', 'item not checked', { data: { workItem: id }, cause: message(error) }); skipped++; continue; }
          if (!ok) { notAdmitted.add(id); skipped++; continue; }
        }
        // the subject is saved before the start: a crash in between never starts the item twice
        state.subjects[key] = { runId: '', at, title: item.title };
        options.store.setTrigger({ ...state, starts });
        let handle: { runId: string };
        try { handle = await options.start(id, {}); }
        catch (error) {
          // not started (e.g. another terminal's run holds the item): forgotten, so the next pass tries it again
          delete state.subjects[key];
          options.store.setTrigger({ ...state, starts });
          options.log?.warn('routine', 'run not started', { data: { workItem: id }, cause: message(error) });
          skipped++; continue;
        }
        state.subjects[key] = { runId: handle.runId, at, title: item.title };
        starts.push(at);
        started.push({ workItem: id, runId: handle.runId });
      }
      // the cursor advances even for items skipped by a cap: they stay deduplicated only once started; an item not
      // admitted keeps its revision and comes back on its next change (a new comment)
      for (const item of result.items) {
        const id = item.inputs['work-item-id'];
        if (id && !state.subjects[subjectKeyOf(Number(id))] && !notAdmitted.has(Number(id))) delete result.cursor[id];
      }
      if (scope.key) state.cursors = { ...(state.cursors ?? {}), [scope.key]: result.cursor };
      else state.cursor = result.cursor;
      summaries.push(result.summary); checked++;
    }
    // every check failed and nothing resumed: the summary is the failure itself
    const summary = !checked && !resumed.length ? summaries.join(' ')
      : `${summaries.join(' ')}${resumed.length ? ` Riprese ${resumed.length} run.` : ''} Avviate ${started.length} run.`;
    options.store.setTrigger({ ...state, starts, lastCheckAt: at, lastResult: summary });
    if (started.length || resumed.length) options.log?.info('routine', 'trigger started runs', { data: { started, resumed } });
    return { started, resumed, skipped, summary };
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
