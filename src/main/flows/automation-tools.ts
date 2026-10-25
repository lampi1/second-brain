// Authenticated Orchestrator automation tools expose proposals and event starts, never user approval controls.
import type { ToolDef } from '../appctl/tools';
import type { FlowAutomationPropose } from '../../shared/flow-automation';
import type { FlowAutomationService } from './automation';
import { keys, object, text } from './schema';
export interface FlowAutomationToolsDeps { service: () => FlowAutomationService; contextKey: () => string; ownerId: string }
const string = { type: 'string' };
export function automationTools(deps: FlowAutomationToolsDeps): ToolDef[] {
  if (!deps.ownerId.trim()) return [];
  const tool = (name: string, description: string, properties: Record<string, unknown>, run: (service: FlowAutomationService, args: Record<string, unknown>) => unknown, readOnly = false): ToolDef => ({
    name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
    run: args => {
      keys(object(args, 'arguments'), Object.keys(properties), 'arguments');
      // The runtime getter checks that the authenticated owner is still a live Orchestrator.
      const service = deps.service(), contextKey = deps.contextKey();
      if (!readOnly && args.contextKey !== contextKey) throw new Error('Brain context changed; reread app_flow_auto_list before acting');
      const clean = { ...args }; delete clean.contextKey; return run(service, clean) as object;
    },
  });
  return [
    tool('app_flow_auto_list', 'Read all automatic flow configurations with owner IDs and only events owned by this Orchestrator in the selected brain. A configuration owned by a closed Orchestrator can be replaced by an exact-revision proposal requiring fresh user approval. Activation requires the user exact-revision native decision; automation detects and notifies, enforces only the explicit approved host grants, and never approves flow steps.', {}, service => {
      const snapshot = service.snapshot(), rules = snapshot.rules.filter(rule => rule.ownerOrchestratorId === deps.ownerId), ids = new Set(rules.map(rule => rule.id));
      return { ...snapshot, contextKey: deps.contextKey(), events: snapshot.events.filter(event => ids.has(event.ruleId)) };
    }, true),
    tool('app_flow_auto_propose', 'Propose an inert automatic configuration for a current user-activated flow version. expectedRevision is the current rule revision or 0. Config: flowId,flowVersion,scope,inputs,priority(urgent|normal),trigger, optional devopsWrite {organization,projects,ops(tags|comment|fields|test-plans|test-results|pr-links|rich-comments|attachments|related-links|pr-create|pr-comment|pr-publish|pr-abandon|test-deploy),fields,optional deployTargets (exact entries from app_flow_test_targets, required with test-deploy; only dedicated single-environment/single-node test releases),optional mentions (identity GUIDs a comment may @mention; needs comment)} (devops trigger only; absent = no DevOps writes; the user approves it in the modal). Optional testDbRead {targetIds: string[]} grants read-only queries against explicitly named local test targets; absent = deny-all, exact user modal approval required. Trigger is interval {kind,everyMinutes} or devops {kind,everyMinutes,organization,project,areaPath,workItemType,states,includeExisting}. DevOps scope must match exactly; work-item-id,work-item-revision,work-item-url are reserved host inputs. Replacing a configuration invalidates queued events and requires exact user approval again.', { contextKey: string, config: { type: 'object' }, expectedRevision: { type: 'integer', minimum: 0 } }, (service, args) => service.propose(args as unknown as FlowAutomationPropose, deps.ownerId)),
    tool('app_flow_auto_start', 'Start a detected event owned by this authenticated Orchestrator. Supply only eventId: the host derives pinned flow, scope, inputs and idempotent subject. Global and per-rule limits preserve queued events. This creates the flow run only; existing gates and visible delegation still apply.', { contextKey: string, eventId: string }, (service, args) => service.startEvent(text(args.eventId, 'eventId', 200), deps.ownerId)),
  ];
}
