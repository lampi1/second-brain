// Authenticated Orchestrator flow tools; approval and user decisions intentionally have no agent tool.
import type { ToolDef } from '../appctl/tools';
import type { FlowAgentBinding, FlowPropose, FlowReport, FlowStart } from '../../shared/flows';
import type { FlowService } from './service';
import { keys, object, text, validateScope } from './schema';

export interface FlowToolsDeps {
  service: () => FlowService; ownerId: string;
  resolveBinding: (chatId: string, ownerId: string, workspace: string) => FlowAgentBinding | null;
}
const string = { type: 'string' }, integer = { type: 'integer', minimum: 0 };
const scope = { type: 'object', properties: { project: string, areaPath: string }, additionalProperties: false };
const schema = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)): object => ({ type: 'object', properties, required, additionalProperties: false });
const revision = { runId: string, expectedRevision: integer, stepId: string };
export function flowTools(deps: FlowToolsDeps): ToolDef[] {
  if (!deps.ownerId.trim()) return [];
  const tool = (name: string, description: string, properties: Record<string, unknown>, run: (service: FlowService, args: Record<string, unknown>) => unknown, readOnly = false, required?: string[]): ToolDef => ({
    name, description, inputSchema: schema(properties, required), annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
    run: args => {
      keys(object(args, 'arguments'), Object.keys(properties), 'arguments');
      const service = deps.service();
      if (!readOnly && args.contextKey !== service.snapshot().contextKey) throw new Error('Brain context changed; reread app_flow_list before acting');
      const clean = { ...args }; delete clean.contextKey;
      return run(service, clean) as object;
    },
  });
  return [
    tool('app_flow_list', 'Read reusable flows and owned runs in the current brain. Empty means define one with the user using brain context and native questions; never invent company workflows. No flow is executable until the user activates the exact draft revision.', {}, service => {
      const snapshot = service.snapshot(); return { ...snapshot, runs: snapshot.runs.filter(run => run.ownerOrchestratorId === deps.ownerId) };
    }, true),
    tool('app_flow_match', 'Deterministically match active flow ids or aliases. Without scope this discovers candidates only; start always checks scope. Ambiguity requires a native user question, never a guessed selection.', { text: string, scope }, (service, args) => ({ contextKey: service.snapshot().contextKey, ...service.match(text(args.text, 'text', 16000), args.scope === undefined ? undefined : validateScope(args.scope)) }), true, ['text']),
    tool('app_flow_propose', 'Create or revise an inert flow draft from user answers and the selected brain. expectedRevision is 0 for new definitions. The user reviews and activates via the native decision modal. No tool can approve it. Definition fields: id,title,description,optional category,aliases,scope,steps. Each step: id,title,kind(check|agent|approval|manual),instructions,inputs,evidence,timeoutMs,maxAttempts,effect(read-only|code|external-write|production),optional action{kind,ref},optional reviewOf earlier agent step id. Every agent step requires workspaceInput naming one declared inputs key whose run value is its exact local workspace path. Only builtin scope-present and inputs-present metadata checks are configured; script/query/action refs and external/production actions block.', { contextKey: string, definition: { type: 'object' }, expectedRevision: integer }, (service, args) => service.propose(args as unknown as FlowPropose)),
    tool('app_flow_start', 'Start a current user-activated version for a subject, owned by this authenticated Orchestrator. Repeating the same flow version/scope/subject returns the existing run. This does not launch agents; delegate visibly and bind the ready step. Inputs are text only.', { contextKey: string, flowId: string, flowVersion: { type: 'integer', minimum: 1 }, subjectKey: string, scope, inputs: { type: 'object', additionalProperties: string } }, (service, args) => service.start(args as unknown as FlowStart, deps.ownerId)),
    tool('app_flow_status', 'Read an owned run, its pinned version, current step, blockers and host receipts. A blocked step needs a user decision or a correctly configured new definition; never claim it ran.', { runId: string }, (service, args) => service.status(text(args.runId, 'runId', 200), deps.ownerId), true),
    tool('app_flow_bind', 'Bind the current ready agent step to a visible fresh work chat with the configured workspace. Host resolves its immutable run identity. A review must use an independent Sentinel chat reviewing the earlier step run.', { contextKey: string, ...revision, chatId: string }, (service, args) => {
      const run = service.status(text(args.runId, 'runId', 200), deps.ownerId);
      if (run.revision !== args.expectedRevision || run.steps[run.currentStep]?.stepId !== args.stepId) throw new Error('Flow changed; review the current step');
      const definition = service.snapshot().versions.find(v => v.definition.id === run.flowId && v.version === run.flowVersion)?.definition.steps[run.currentStep];
      const workspace = definition?.workspaceInput ? run.inputs[definition.workspaceInput] : undefined;
      if (!workspace) throw new Error('The current agent step needs its configured workspace input');
      const binding = deps.resolveBinding(text(args.chatId, 'chatId', 200), deps.ownerId, workspace);
      if (!binding) throw new Error('No eligible fresh agent run for this chat');
      return service.bindAgent(text(args.runId, 'runId', 200), args.expectedRevision as number, text(args.stepId, 'stepId', 80), binding, deps.ownerId);
    }),
    tool('app_flow_report', 'Propose completion using a host-recorded canonical agent report id (<chatRunId>:<report timestamp>). Text supplied here cannot certify anything. Host checks bound run/task identity, successful final report, required evidence labels and independent review. No approval bypass.', { contextKey: string, ...revision, reportId: string }, (service, args) => service.report(args as unknown as FlowReport, deps.ownerId)),
  ];
}
