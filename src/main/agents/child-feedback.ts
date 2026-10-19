// The sub-agent half of the improvement loop, on every chat's own MCP endpoint (/mcp/chat/:chatId/:token): an agent that
// had a catalog sub-agent started for it (a run whose parentRunId is one of its runs: the Orchestrator's app_create_chat
// with parentRunId, or the agent's own agent_start_subagent, agents/subagent-tool.ts) lists those runs with agent_children and gives its opinion of them with
// agent_child_feedback, which writes through the same lifecycle facade as the Orchestrator's agent_feedback (the one
// feedback store, the metrics, the repeated-gap proposals, the trial evaluation). Why: the owner (2026-10-18) wants the
// agents that use sub-agents to go through the same request and feedback as the Orchestrator. The caller is the chat the
// token names, never an argument, so a chat can judge only its own sub-agents, never itself, a sibling or another run.
// Used by wiring.ts (addChatTools); pinned by test/unit/agents/agent-loop.test.ts.
import type { AgentRun } from '../../shared/agents';
import { AGENT_FEEDBACK_SCHEMA } from '../../shared/agent-lifecycle';
import type { McpTool } from '../mcp/server';
import type { LifecycleApi } from './lifecycle-api';

export function childFeedbackTools(api: Pick<LifecycleApi, 'childFeedback' | 'children'>, runs: () => readonly AgentRun[]): McpTool[] {
  const caller = (params: Record<string, string>): string => {
    const id = params.chatId;
    if (!id) throw new Error('This tool works only on a chat\'s own endpoint.');
    return id;
  };
  const { sendToRun: _s, ...properties } = AGENT_FEEDBACK_SCHEMA.properties; void _s;
  return [{
    name: 'agent_children',
    description: 'Your agent run ids and the catalog sub-agent runs started for you (parentRunId = one of your runs), with their runId, agent, version, state and outcome. To get a sub-agent, start one from the catalog with agent_start_subagent (or ask the Orchestrator with send_to_chat); when its run ends, judge it with agent_child_feedback.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (_a, ctx) => {
      const id = caller(ctx.params), all = runs();
      const own = all.filter(r => r.chatId === id).sort((a, b) => b.startedAt - a.startedAt).map(r => ({ runId: r.runId, agentId: r.agentId, version: r.version, state: r.endedAt === undefined ? 'open' : 'ended' }));
      return JSON.stringify({ yourRuns: own, children: api.children(id, all) });
    },
  }, {
    name: 'agent_child_feedback',
    description: 'Your opinion of one of YOUR sub-agent runs (runId from agent_children): verdict, notes, evidence; optionally worked, failed, and gap + a short stable gapKey when part of its definition fell short. An opinion, never the user\'s verdict (which always wins); refused on any run that is not your own sub-agent\'s.',
    inputSchema: { ...AGENT_FEEDBACK_SCHEMA, properties },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => JSON.stringify(await api.childFeedback(a, caller(ctx.params))),
  }];
}
