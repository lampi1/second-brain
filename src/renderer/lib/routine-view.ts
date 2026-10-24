// What the Routine page shows, computed from the flow snapshot (ADR 0153): which runs need the user, which work by
// themselves, each step's plain state, a trigger in words. Pure, so the page and its tests read the same rules.
// Used by brain/pages/Flows.tsx and components/Routine*.tsx. Unit tests: test/unit/renderer/routine-view.test.ts.
import type { FlowDefinition, FlowRun, FlowSnapshot, FlowStep, FlowVersion } from '@shared/flows';
import type { FlowAutomationRule } from '@shared/flow-automation';
import { healable } from '@shared/routine';
import { locale } from '../i18n';

export const definitionOf = (snapshot: FlowSnapshot, run: FlowRun): FlowDefinition | undefined =>
  snapshot.versions.find(version => version.definition.id === run.flowId && version.version === run.flowVersion)?.definition;
export const activeVersion = (snapshot: FlowSnapshot, flowId: string): FlowVersion | undefined =>
  snapshot.versions.find(version => version.definition.id === flowId && version.version === snapshot.active[flowId]);
const open = (run: FlowRun): boolean => run.status !== 'completed' && run.status !== 'cancelled';

/** «Tocca a te»: a prod command waiting for «Esegui», a gate, or a block the runner will not heal. */
export function needsYou(snapshot: FlowSnapshot, run: FlowRun): boolean {
  if (!open(run) || run.paused) return false;
  if (run.awaitingUser || run.status === 'approval' || run.pendingCancellation || run.pendingRecovery) return true;
  return run.status === 'blocked' && !healable(run, definitionOf(snapshot, run));
}
export const working = (snapshot: FlowSnapshot, run: FlowRun): boolean => open(run) && !needsYou(snapshot, run);
export const retrying = (snapshot: FlowSnapshot, run: FlowRun): boolean => run.status === 'blocked' && healable(run, definitionOf(snapshot, run));

export type StepLook = 'done' | 'now' | 'retry' | 'you' | 'todo' | 'sent';
/** One step's look on a run card: done, working now, retrying by itself, waiting for the user, to do, or sent back. */
export function stepLook(snapshot: FlowSnapshot, run: FlowRun, index: number): StepLook {
  const step = run.steps[index]!;
  if (step.status === 'completed') return 'done';
  if (index === run.currentStep) {
    if (run.awaitingUser || run.status === 'approval') return 'you';
    if (run.status === 'blocked') return retrying(snapshot, run) ? 'retry' : 'you';
    return step.status === 'running' ? 'now' : 'todo';
  }
  // a later step already tried once and sent the work back here
  if (index > run.currentStep && (run.heal ?? []).some(entry => entry.action === 'goto' && entry.stepId === step.stepId)) return 'sent';
  return 'todo';
}
/** The latest thing the runner did by itself on this run, if it is about the current attempt. */
export const lastHeal = (run: FlowRun) => run.heal?.at(-1);

export const queued = (snapshot: FlowSnapshot, ruleId: string) =>
  (snapshot.automation?.events ?? []).filter(event => event.ruleId === ruleId && ['pending', 'notified', 'blocked'].includes(event.status) && !event.sourceKey.startsWith('restart:')).sort((a, b) => a.createdAt - b.createdAt);
export const ruleFor = (snapshot: FlowSnapshot, flowId: string): FlowAutomationRule | undefined =>
  snapshot.automation?.rules.find(rule => rule.config.flowId === flowId && ['enabled', 'paused', 'proposed'].includes(rule.status));
/** Steps only the user runs: prod commands. */
export const prodSteps = (definition: FlowDefinition): FlowStep[] => definition.steps.filter(step => step.env === 'prod' || step.effect === 'production');

/** «12 min fa», «ieri», in the UI language. */
export function ago(at: number, now = Date.now()): string {
  const s = Math.round((at - now) / 1000), rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (Math.abs(s) < 60) return rtf.format(s, 'second');
  if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}
export function duration(ms: number): string {
  const m = Math.round(ms / 60000);
  return m < 1 ? '<1 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
/** The work item a run is about: its title and link, when the run has one. */
export function itemOf(run: FlowRun): { title: string; url?: string; id?: string } | undefined {
  const id = run.inputs['work-item-id'], url = run.inputs['work-item-url'];
  if (!run.title && !id) return undefined;
  return { title: run.title ?? `#${id}`, ...(url ? { url } : {}), ...(id ? { id } : {}) };
}
/** Splits «a, b; c» into clean values. */
export const list = (text: string): string[] => text.split(/[,;\n]+/).map(value => value.trim()).filter(Boolean);
