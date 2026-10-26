// Authenticated Orchestrator automation tools expose proposals and event starts, never user approval controls.
import type { ToolDef } from '../appctl/tools';
import type { FlowAutomationPropose } from '../../shared/flow-automation';
import type { FlowAutomationService } from './automation';
import { automationList, capFlowResult, listProperties } from './tool-output';
import { keys, object, text } from './schema';
export interface FlowAutomationToolsDeps { service: () => FlowAutomationService; contextKey: () => string; ownerId: string }
const string = { type: 'string' };
export function automationTools(deps: FlowAutomationToolsDeps): ToolDef[] {
  if (!deps.ownerId.trim()) return [];
  const tool = (name: string, description: string, properties: Record<string, unknown>, run: (service: FlowAutomationService, args: Record<string, unknown>) => unknown, readOnly = false, required?: string[]): ToolDef => ({
    name, description, inputSchema: { type: 'object', properties, required: required ?? Object.keys(properties), additionalProperties: false },
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
    run: args => {
      keys(object(args, 'arguments'), Object.keys(properties), 'arguments');
      // The runtime getter checks that the authenticated owner is still a live Orchestrator.
      const service = deps.service(), contextKey = deps.contextKey();
      if (!readOnly && args.contextKey !== contextKey) throw new Error('Brain context changed; reread app_flow_auto_list before acting');
      const clean = { ...args }; delete clean.contextKey; return capFlowResult(run(service, clean)) as object;
    },
  });
  return [
    tool('app_flow_auto_list', 'Compact automation rule/event summaries for this Orchestrator by default. offset/limit (1..25, default 10), nextOffset for paging. allOwners:true explicitly includes other owners rules, never their private events. For full configuration use detail:true and ruleId; concatenate content chunks using nextContentOffset as contentOffset and expectedDigest. Each result is capped at 40,000 characters. Replacing another owner configuration still requires an exact-revision proposal and fresh user approval. Listing grants no authority.', { ...listProperties, allOwners: { type: 'boolean' }, detail: { type: 'boolean' }, ruleId: string }, (service, args) => automationList(service.snapshot(), deps.contextKey(), deps.ownerId, args), true, []),
    tool('app_flow_auto_propose', 'Propose an inert automatic configuration for a current user-activated flow version. expectedRevision is the current rule revision or 0. Config: flowId,flowVersion,scope,inputs,priority(urgent|normal),trigger, optional devopsWrite {organization,projects,ops(tags|comment|fields|test-plans|test-results|pr-links|rich-comments|attachments|related-links|pr-create|pr-comment|pr-publish|pr-abandon|test-deploy|test-environment|git-push|pr-validation),fields,optional pushTargets:[{project,repositoryId,workspaceInput}] (exactly one required for git-push, workspaceInput must be the bound step input),optional deployTargets (exact entries from app_flow_test_targets, required with test-deploy or test-environment; exact App Service or deployment-group test targets),optional mentions (identity GUIDs a comment may @mention; needs comment)} (devops trigger only; absent = no DevOps writes; the user approves it in the modal). Optional testDbRead {targetIds: string[]} grants read-only queries against explicitly named local test targets; absent = deny-all, exact user modal approval required. Trigger is interval {kind,everyMinutes} or devops {kind,everyMinutes,organization,project,areaPath,workItemType,states,includeExisting,includeTags?,excludeTags?,workItemIds?,iterationPath?,maxPerHour?}. DevOps scope must match exactly; work-item-id,work-item-revision,work-item-url are reserved host inputs. Replacing a configuration invalidates queued events and requires exact user approval again.', { contextKey: string, config: { type: 'object' }, expectedRevision: { type: 'integer', minimum: 0 } }, (service, args) => service.propose(args as unknown as FlowAutomationPropose, deps.ownerId)),
    tool('app_flow_auto_start', 'Start a detected event owned by this authenticated Orchestrator. Supply only eventId: the host derives pinned flow, scope, inputs and idempotent subject. Global and per-rule limits preserve queued events. This creates the flow run only; existing gates and visible delegation still apply.', { contextKey: string, eventId: string }, (service, args) => service.startEvent(text(args.eventId, 'eventId', 200), deps.ownerId)),
  ];
}
