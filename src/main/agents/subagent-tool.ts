// agent_start_subagent: a work chat starts an app agent from the catalog as its own sub-agent (issue #70, ADR 0078).
// Why: workers used only their engine's internal sub-agents; a catalog agent could become a sub-agent only through the
// Orchestrator. Now the worker picks one (agent_catalog with `request`) and starts it here: the new chat runs as that
// agent (its profile decides engine, model and effort), its run is linked by parentRunId to the worker's open run (so
// agent_children / agent_child_feedback see it), it answers to the worker's Orchestrator and reports to the worker.
// The caller is the chat the endpoint token names, never an argument. Bounded: one open run required, at most
// MAX_OPEN_CHILDREN open sub-agents per run, sub-agents at most MAX_DEPTH levels deep. The chat itself is created by
// the Orchestrator's own app_create_chat (same checks: catalog, engine policy, cross-engine rule, CPU queue).
// Bounded by its parent: the child profile's tools, MCP servers and permission ceiling must fit inside the worker's own
// effective policy (never wider than the chat that starts it), and it runs in the worker's folder or one of its git
// worktrees. The open-children cap is reserved before the chat is created, so concurrent calls cannot overshoot it.
// Used by wiring.ts (addChatTools); pinned by test/unit/agents/agent-first.test.ts.
import type { AgentRun } from '../../shared/agents';
import type { ChatSummary } from '../../shared/contract';
import path from 'node:path';
import type { McpTool } from '../mcp/server';
import { narrowest, type AgentPolicy } from './tool-policy';

export const MAX_OPEN_CHILDREN = 3;
export const MAX_DEPTH = 2;

export interface SubagentDeps {
  chats: () => ChatSummary[];
  runs: () => readonly AgentRun[];
  /** app_create_chat as the Orchestrator `regiaId` (its unified endpoint), with these arguments */
  create: (regiaId: string, args: Record<string, unknown>) => Promise<unknown>;
  /** the effective tool policy and ceiling the chat runs with (null = no agent policy: the engine's own gates) */
  policy: (chatId: string) => AgentPolicy | null;
  /** a catalog agent's policy (undefined = unknown agent) */
  profile: (agentId: string) => AgentPolicy | undefined;
  /** the git worktrees of the repository at this folder (absolute paths; empty when it is no repository) */
  worktrees: (cwd: string) => Promise<string[]>;
}

const norm = (v: unknown): unknown => Array.isArray(v) ? [...v].sort() : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, norm((v as Record<string, unknown>)[k])])) : v ?? null;
const canon = (p: AgentPolicy | null): string => JSON.stringify(norm(p ? { tools: p.tools ? { allow: p.tools.allow, mcp: p.tools.mcp ?? null } : null, ceiling: p.ceiling } : { tools: null, ceiling: null }));
/** True when `child` asks for nothing `parent` does not have: narrowing it by the parent leaves it unchanged. */
export function withinPolicy(child: AgentPolicy, parent: AgentPolicy | null): boolean {
  return canon(narrowest(child, parent) ?? { tools: null, ceiling: null }) === canon(child);
}
const samePath = (a: string, b: string): boolean => {
  const x = path.resolve(a), y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

const text = (v: unknown, max: number, label: string): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`${label}: 1 to ${max} characters.`);
  return v.trim();
};

export function subagentTools(d: SubagentDeps): McpTool[] {
  /** children being created per parent run: counted with the open ones, so the cap holds across concurrent calls */
  const reserved = new Map<string, number>();
  return [{
    name: 'agent_start_subagent',
    description: 'Start an app agent from the catalog as YOUR sub-agent for a sub-task (not only your engine\'s internal sub-agents). Pick it with agent_catalog (pass request = the sub-task to see the scores); its profile decides engine, model and effort. The new chat is linked to your agent run (parentRunId), answers to your Orchestrator and sends you its result with send_to_chat; judge it with agent_child_feedback when its run ends. Needs your chat to have an open agent run; at most 3 open sub-agents per run, 2 levels deep.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['agentId', 'title', 'prompt'], properties: {
      agentId: { type: 'string', description: 'profile id from agent_catalog' },
      title: { type: 'string', description: '"Area · cosa"' },
      prompt: { type: 'string', description: 'a self-contained brief: goal, context, scope, done-criteria, what to send back' },
      goal: { type: 'string', description: 'optional run goal (default: the prompt), up to 2000 characters' },
      cwd: { type: 'string', description: 'optional absolute folder: your own (default) or one of its git worktrees' },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => {
      if (Object.keys(a).some(k => !['agentId', 'title', 'prompt', 'goal', 'cwd'].includes(k))) throw new Error('agent_start_subagent: unknown argument.');
      const all = d.chats(), me = all.find(c => c.id === ctx.params.chatId);
      if (!me) throw new Error('This tool works only on a chat\'s own endpoint.');
      if (me.isRegia) throw new Error('The Orchestrator starts agents with app_create_chat.');
      const runs = d.runs();
      const own = runs.filter(r => r.chatId === me.id && r.endedAt === undefined).sort((x, y) => y.startedAt - x.startedAt)[0];
      if (!own) throw new Error('Your chat has no open agent run: ask your Orchestrator with send_to_chat instead.');
      let depth = 0;
      for (let cur: AgentRun | undefined = own; cur?.parentRunId && depth <= MAX_DEPTH; depth++) cur = runs.find(r => r.runId === cur!.parentRunId);
      if (depth >= MAX_DEPTH) throw new Error(`Sub-agents go at most ${MAX_DEPTH} levels deep: do this part yourself or ask your Orchestrator.`);
      const live = all.filter(c => c.isRegia && !c.closedAt);
      const regia = live.find(c => c.id === me.regiaOf) ?? live.find(c => c.orchestrator);
      if (!regia) throw new Error('No Orchestrator is open: the user must open it before sub-agents can start.');
      const agentId = text(a.agentId, 80, 'agentId'), title = text(a.title, 80, 'title'), prompt = text(a.prompt, 8000, 'prompt');
      const goal = a.goal === undefined ? prompt.slice(0, 2000) : text(a.goal, 2000, 'goal');
      // never wider than the worker: the child's tools, MCP servers and ceiling fit inside the worker's effective policy
      const child = d.profile(agentId);
      if (!child) throw new Error(`Unknown agent: ${agentId} (see agent_catalog).`);
      if (!withinPolicy(child, d.policy(me.id))) throw new Error('This agent may use tools, MCP servers or a permission level your chat does not have: pick one within your own limits, or ask your Orchestrator with send_to_chat.');
      const cwd = a.cwd === undefined ? me.cwd : text(a.cwd, 1000, 'cwd');
      if (!path.isAbsolute(cwd)) throw new Error('cwd: an absolute folder.');
      if (!samePath(cwd, me.cwd)) {
        let trees: string[] = [];
        try { trees = await d.worktrees(me.cwd); } catch { trees = []; }
        if (!trees.some(t => samePath(t, cwd))) throw new Error('cwd: your own folder or one of its git worktrees only.');
      }
      // reserve the slot before creating (no await between the check and the reservation)
      const open = d.runs().filter(r => r.parentRunId === own.runId && r.endedAt === undefined).length + (reserved.get(own.runId) ?? 0);
      if (open >= MAX_OPEN_CHILDREN) throw new Error(`Already ${MAX_OPEN_CHILDREN} open sub-agents: wait for one to finish (agent_children).`);
      reserved.set(own.runId, (reserved.get(own.runId) ?? 0) + 1);
      try {
        return JSON.stringify(await d.create(regia.id, { agentId, title, prompt, parentRunId: own.runId, goal, cwd }));
      } finally {
        const left = (reserved.get(own.runId) ?? 1) - 1;
        if (left > 0) reserved.set(own.runId, left); else reserved.delete(own.runId);
      }
    },
  }];
}
