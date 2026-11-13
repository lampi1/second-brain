// The parent's half of the roles' improvement loop, on every chat's own MCP endpoint (/mcp/chat/:chatId/:token): a
// role chat gives its opinion of a run of one of its delegated children (agent_delegate, agents/delegation.ts; the
// runId comes from agent_children) with agent_child_feedback, written through the same lifecycle facade as every other
// verdict (the one feedback store, the metrics, the repeated-gap proposals, the trial evaluation). The caller is the
// chat the token names, never an argument, so a chat judges only its own children, never itself, a sibling or another
// run. Used by wiring.ts (addChatTools); pinned by test/unit/agents/agent-loop.test.ts.
import { AGENT_FEEDBACK_SCHEMA } from '../../shared/agent-lifecycle';
import type { McpTool } from '../mcp/server';
import { callerOf } from '../mcp/caller';
import type { LifecycleApi } from './lifecycle-api';

export function childFeedbackTools(api: Pick<LifecycleApi, 'childFeedback'>): McpTool[] {
  const { sendToRun: _s, ...properties } = AGENT_FEEDBACK_SCHEMA.properties; void _s;
  return [{
    name: 'agent_child_feedback',
    description: 'Your opinion of the run of one of YOUR delegated children (runId from agent_children): verdict, notes, evidence; optionally worked, failed, and gap + a short stable gapKey when part of its definition fell short. An opinion, never the user\'s verdict (which always wins); refused on any run that is not your own child\'s.',
    inputSchema: { ...AGENT_FEEDBACK_SCHEMA, properties },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => JSON.stringify(await api.childFeedback(a, callerOf(ctx.params))),
  }];
}
