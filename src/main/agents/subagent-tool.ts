// agent_start_subagent: a work chat starts an app agent from the catalog as its own sub-agent (issue #70, ADR 0078).
// Why: workers used only their engine's internal sub-agents; a catalog agent could become a sub-agent only through the
// Orchestrator. Now the worker picks one (agent_catalog with `request`) and starts it here: the new chat runs as that
// agent (its profile decides engine, model and effort), its run is linked by parentRunId to the worker's open run (so
// agent_children / agent_child_feedback see it), it answers to the worker's Orchestrator and reports to the worker.
// The caller is the chat the endpoint token names, never an argument. Bounded: one open run required, at most
// MAX_OPEN_CHILDREN open sub-agents per run, sub-agents at most MAX_DEPTH levels deep. The chat itself is created by
// the Orchestrator's own app_create_chat (same checks: catalog, engine policy, cross-engine rule, CPU queue).
// Used by wiring.ts (addChatTools); pinned by test/unit/agents/subagent-tool.test.ts.
import type { AgentRun } from '../../shared/agents';
import type { ChatSummary } from '../../shared/contract';
import type { McpTool } from '../mcp/server';

export const MAX_OPEN_CHILDREN = 3;
export const MAX_DEPTH = 2;

export interface SubagentDeps {
  chats: () => ChatSummary[];
  runs: () => readonly AgentRun[];
  /** app_create_chat as the Orchestrator `orchestratorId` (its unified endpoint), with these arguments */
  create: (orchestratorId: string, args: Record<string, unknown>) => Promise<unknown>;
}

const text = (v: unknown, max: number, label: string): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`${label}: 1 to ${max} characters.`);
  return v.trim();
};

export function subagentTools(d: SubagentDeps): McpTool[] {
  return [{
    name: 'agent_start_subagent',
    description: 'Start an app agent from the catalog as YOUR sub-agent for a sub-task (not only your engine\'s internal sub-agents). Pick it with agent_catalog (pass request = the sub-task to see the scores); its profile decides engine, model and effort. The new chat is linked to your agent run (parentRunId), answers to your Orchestrator and sends you its result with send_to_chat; judge it with agent_child_feedback when its run ends. Needs your chat to have an open agent run; at most 3 open sub-agents per run, 2 levels deep.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['agentId', 'title', 'prompt'], properties: {
      agentId: { type: 'string', description: 'profile id from agent_catalog' },
      title: { type: 'string', description: '"Area · cosa"' },
      prompt: { type: 'string', description: 'a self-contained brief: goal, context, scope, done-criteria, what to send back' },
      goal: { type: 'string', description: 'optional run goal (default: the prompt), up to 2000 characters' },
      cwd: { type: 'string', description: 'optional absolute folder; default: your own' },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => {
      if (Object.keys(a).some(k => !['agentId', 'title', 'prompt', 'goal', 'cwd'].includes(k))) throw new Error('agent_start_subagent: unknown argument.');
      const all = d.chats(), me = all.find(c => c.id === ctx.params.chatId);
      if (!me) throw new Error('This tool works only on a chat\'s own endpoint.');
      if (me.isOrchestrator) throw new Error('The Orchestrator starts agents with app_create_chat.');
      const runs = d.runs();
      const own = runs.filter(r => r.chatId === me.id && r.endedAt === undefined).sort((x, y) => y.startedAt - x.startedAt)[0];
      if (!own) throw new Error('Your chat has no open agent run: ask your Orchestrator with send_to_chat instead.');
      let depth = 0;
      for (let cur: AgentRun | undefined = own; cur?.parentRunId && depth <= MAX_DEPTH; depth++) cur = runs.find(r => r.runId === cur!.parentRunId);
      if (depth >= MAX_DEPTH) throw new Error(`Sub-agents go at most ${MAX_DEPTH} levels deep: do this part yourself or ask your Orchestrator.`);
      if (runs.filter(r => r.parentRunId === own.runId && r.endedAt === undefined).length >= MAX_OPEN_CHILDREN) throw new Error(`Already ${MAX_OPEN_CHILDREN} open sub-agents: wait for one to finish (agent_children).`);
      const live = all.filter(c => c.isOrchestrator && !c.closedAt);
      const orchestrator = live[0];
      if (!orchestrator) throw new Error('No Orchestrator is open: the user must open it before sub-agents can start.');
      const prompt = text(a.prompt, 8000, 'prompt');
      return JSON.stringify(await d.create(orchestrator.id, {
        agentId: text(a.agentId, 80, 'agentId'), title: text(a.title, 80, 'title'), prompt,
        parentRunId: own.runId, goal: a.goal === undefined ? prompt.slice(0, 2000) : text(a.goal, 2000, 'goal'),
        cwd: a.cwd === undefined ? me.cwd : text(a.cwd, 1000, 'cwd'),
      }));
    },
  }];
}
