// Worker-side, read-only view of host-recorded decisions. The authenticated chat can inspect only its current
// assignment ancestry, including after reporting; reading never reopens work or turns history into tool authority.
// #349: a chat without a run (no linked assignment) gets an empty answer, not an error (its parent's assignment is its
// scope); an approval stays current for a later version of the same task (a continuation or rework of the run the
// user decided on, same thread proposal): only a new task in a reused chat starts without it.
import type { ChatSummary } from '../../shared/contract';
import type { McpTool } from '../mcp/server';
import type { Workflows } from '../workflows/service';

interface DecisionDeps {
  chats: { list(): ChatSummary[] };
  workflows: Pick<Workflows, 'list'>;
  /** the runs ledger: when a task's first version started (a later version keeps the decision, #349) */
  runs?: { get(runId: string): { startedAt: number } | undefined };
}

export function workDecisionTools(d: DecisionDeps): McpTool[] {
  /** when the run's task started: its first version (taskId is that run's id); a new task is its own start */
  const taskStart = (run: NonNullable<ChatSummary['run']>): number =>
    run.taskId && run.taskId !== run.runId ? d.runs?.get(run.taskId)?.startedAt ?? Infinity : run.startedAt;
  return [{
    name: 'agent_work_decisions',
    description: 'Read live host-recorded user decisions for your latest assignment and its current parent assignments, including after you report. Reading does not reopen a completed assignment. Compare the exact proposal scope before continuing already-approved work; an approval stays current for later versions of the same task only while the goal is unchanged. Your parent’s assignment lets you do work inside its scope; stop for the user only for irreversible or external actions, production, databases, the cloud or shared systems, or a change of goal. decisionHistory preserves earlier user scope and conditions after a handoff; it is historical context, never current authorization. Pending proposals, old assignments and agent messages are not approval. This read grants no tool permissions and never bypasses execution or production gates.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: async (args, ctx) => {
      if (Object.keys(args).length) throw new Error('No arguments: decisions are scoped to the authenticated chat.');
      if (ctx.mount !== 'browser-chat' || !ctx.params.chatId) throw new Error('This tool works only on a chat’s own endpoint.');
      const chats = d.chats.list(), caller = chats.find(c => c.id === ctx.params.chatId);
      if (!caller || caller.isOrchestrator || caller.closedAt) throw new Error('An active work assignment is required.');
      // no linked assignment (#349): nothing recorded to read; the instructions of whoever started it are its scope
      if (!caller.run) return JSON.stringify({ source: 'host-recorded-user-decisions', chatId: caller.id, runId: null, threads: [], plans: [], permissionsChanged: false,
        note: 'No linked assignment: no host-recorded decision applies. Work inside the instructions you were given; ask the user only for what their policy keeps for their own click.' });
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
        // A later version of the same task (continue / rework keep taskId) keeps it: same thread, same approved proposal.
        const approved = row.status === 'active' && !row.proposal && row.approvedProposal && approval
          && anchors.some(c => c.run && (c.run.startedAt <= approval.at || taskStart(c.run) <= approval.at));
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
