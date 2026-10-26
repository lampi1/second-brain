// Evidence workbench tools on the authenticated Orchestrator mount; observations never grant execution authority.
import type { ToolDef } from '../appctl/tools';
import type { RoutineWorkbench } from './workbench';
import type { RoutineWorkbenchRequest } from '../../shared/routine-workbench';
import { keys, object, text } from './schema';
export function workbenchTools(get: (contextKey: string) => RoutineWorkbench, ownerId: string): ToolDef[] {
  const string = { type: 'string' }, version = { type: 'integer', minimum: 1 };
  const tool = (name: string, op: RoutineWorkbenchRequest['op'], description: string, properties: Record<string, unknown>, required = Object.keys(properties)): ToolDef => ({
    name, description, inputSchema: { type: 'object', properties: { contextKey: string, ...properties }, required: ['contextKey', ...required], additionalProperties: false },
    annotations: { readOnlyHint: op !== 'suite-save', destructiveHint: false, openWorldHint: false },
    run: args => { keys(object(args, 'arguments'), ['contextKey', ...Object.keys(properties)], 'arguments'); const { contextKey, ...input } = args; return get(text(contextKey, 'contextKey', 64)).perform({ ...input, op } as RoutineWorkbenchRequest, ownerId); },
  });
  return [
    tool('app_flow_doctor', 'readiness', 'Read-only readiness snapshot for an exact routine version: package integrity, inputs, workspace, models, current approved grants and targets. Unknown checks remain explicit. Combine with app_flow_start_item dryRun:true for scripts. This executes nothing, proves no remote availability and never grants permission.', { flowId: string, version, inputs: { type: 'object', additionalProperties: string } }, ['flowId', 'version']),
    tool('app_flow_compare_versions', 'compare', 'Compare host-observed outcomes, retries, evidence coverage and observed user decisions by immutable routine version. Counts are descriptive, not causal rankings. Inspect dossiers and matched cases before proposing changes; never auto-promote.', { flowId: string }),
    tool('app_flow_eval_suites', 'suites', 'Read immutable deterministic routine evaluation cases. These check recorded host runs, not a newly executed workload or an AI quality score.', { flowId: string }),
    tool('app_flow_eval_save', 'suite-save', 'Save explicitly defined retrospective evaluation cases under a NEW immutable suite id. Suite: {id,flowId,cases:[{id,subjectKey,expected:completed|needs-human|skipped|blocked,evidence:[{stepId,label}],split:tuning|holdout}]}. Do not relabel subjects across tuning/holdout. This only saves checks, changes no routine and executes nothing.', { suite: { type: 'object' } }),
    tool('app_flow_eval', 'evaluate', 'Evaluate a suite against host runs pinned to one exact routine version. Missing/running cases are unknown, never passes. Reports presence of evidence, not truth of every claim; no inference calls or promotion.', { suiteId: string, version }),
  ];
}
