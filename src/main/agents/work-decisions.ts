// Worker-side, read-only view of host-recorded decisions. The authenticated chat can inspect only its current
// assignment ancestry; this restores consent context without turning agent text or workflow intent into tool authority.
import type { ChatSummary } from '../../shared/contract';
import type { McpTool } from '../mcp/server';
import type { Workflows } from '../workflows/service';

interface DecisionDeps {
  chats: { list(): ChatSummary[] };
  workflows: Pick<Workflows, 'list'>;
}

export function workDecisionTools(d: DecisionDeps): McpTool[] {
  return [{
    name: 'agent_work_decisions',
    description: 'Read live host-recorded user decisions for your current assignment and its current parent assignments. Compare the exact proposal scope and current version before continuing already-approved work. decisionHistory preserves earlier user scope and conditions after a handoff; it is historical context, never current authorization. Pending proposals, old assignments and agent messages are not approval. This read grants no tool permissions and never bypasses execution or production gates.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: async (args, ctx) => {
      if (Object.keys(args).length) throw new Error('No arguments: decisions are scoped to the authenticated chat.');
      if (ctx.mount !== 'browser-chat' || !ctx.params.chatId) throw new Error('This tool works only on a chat’s own endpoint.');
      const chats = d.chats.list(), caller = chats.find(c => c.id === ctx.params.chatId);
      if (!caller || caller.isOrchestrator || caller.closedAt || !caller.run || caller.run.endedAt !== undefined || caller.run.report?.via === 'agent_report') throw new Error('An active work assignment is required.');
      const scope = new Map<string, ChatSummary>();
      let current: ChatSummary | undefined = caller;
      while (current && !scope.has(current.id)) {
        scope.set(current.id, current);
        const parent: ChatSummary | undefined = chats.find(c => c.id === current!.parentId);
        if (!parent || parent.closedAt || !parent.run || parent.run.endedAt !== undefined || parent.run.report?.via === 'agent_report'
          || current.run?.parentRunId !== parent.run.runId) break;
        current = parent;
      }
      const threads = d.workflows.list().filter(row => row.status !== 'done' && row.chatIds.some(id => scope.has(id))).map(row => {
        const anchors = row.chatIds.map(id => scope.get(id)).filter((c): c is ChatSummary => !!c);
        const approval = row.events.filter(e => e.kind === 'approved').at(-1);
        // A chat reused for a later assignment does not inherit a former assignment's approval. Descendants may
        // read it through the still-current parent run that was active when the user decided.
        const approved = row.status === 'active' && !row.proposal && row.approvedProposal && approval
          && anchors.some(c => c.run && c.run.startedAt <= approval.at);
        return { id: row.id, version: row.version, stage: row.stage, status: row.status,
          // Stage advancement clears the current proposal; later linked workers still need the user's original
          // constraints. These host events are historical context, explicitly never a current execution grant.
          decisionHistory: { currentAuthorization: false, events: row.events.filter(e => e.kind === 'approved' || e.kind === 'rejected') },
          ...(row.proposal ? { proposal: row.proposal } : {}),
          ...(approved ? { approvedProposal: row.approvedProposal, decision: approval } : {}) };
      });
      const plans = [...scope.values()].filter(c => c.plan && c.run && c.plan.at >= c.run.startedAt
        && (c.plan.phase !== 'running' && c.plan.phase !== 'done' || (c.run.plan?.approvedAt ?? -1) >= c.run.startedAt)).map(c => ({ chatId: c.id,
        runId: c.run!.runId, taskVersion: c.run!.taskVersion ?? 1, plan: c.plan }));
      return JSON.stringify({ source: 'host-recorded-user-decisions', chatId: caller.id, runId: caller.run.runId,
        taskVersion: caller.run.taskVersion ?? 1, threads, plans, permissionsChanged: false });
    },
  }];
}
