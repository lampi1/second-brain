// The harness × role × required tool matrix (ADR 0356, owner 2026-11-25: «ogni chat, su ogni harness, ha tutti gli
// strumenti dell'app previsti dal suo ruolo»). For every engine of the registry, every role, as a root, as a child and
// with a plan: each tool of the table (shared/role-tools.ts) is built by the app's real tool factories, shown by the
// chat's filter (tool-visibility.ts toolShownToChat) and, on an engine with a tight schema budget (Antigravity), kept in
// the compact list under its budget (fitCompact). The table itself is pinned literally: removing a tool turns it red.
// Problem 1 of 2026-11-25 (agy dropped agent_report in the brain folder) is the compact case. No engine runs.
import { describe, expect, it } from 'vitest';
import { delegationTools } from '../../../src/main/agents/delegation';
import { strategyTools } from '../../../src/main/agents/strategy-tools';
import { workDecisionTools } from '../../../src/main/agents/work-decisions';
import { agentCatalogTool } from '../../../src/main/agents/discovery';
import { askTools } from '../../../src/main/chats/ask-tool';
import { mailTools } from '../../../src/main/chats/mail';
import { artifactSaveTool } from '../../../src/main/library/tools';
import { brainSearchTool } from '../../../src/main/search/hybrid/tool';
import { memoryTools } from '../../../src/main/rules/memory-tool';
import { brainQueriesTool, chatQueryAddTool } from '../../../src/main/brain/queries-tools';
import { brainScriptsTool, chatScriptAddTool } from '../../../src/main/brain/scripts-tools';
import { showUiTool } from '../../../src/main/genui/artifacts';
import { QuestionRelay } from '../../../src/main/chats/relay';
import { COMPACT_BUDGET, COMPACT_LEFT_OUT, compactMcpTool, fitCompact, toolListSize, toolShownToChat } from '../../../src/main/chats/tool-visibility';
import { appAsks, engines } from '../../../src/main/engines/registry';
import { ALL_REQUIRED_TOOLS, QUESTION_TOOL, ROLE_REQUIRED_TOOLS, missingTools, requiredTools } from '../../../src/shared/role-tools';
import type { McpTool } from '../../../src/main/mcp/server';

const d = {} as never;
/** the chat endpoint's tools as wiring.ts adds them (the factories only read their deps when a tool runs) */
const ALL: McpTool[] = [...delegationTools(d), ...strategyTools(d), ...workDecisionTools(d), agentCatalogTool(d), ...askTools(d), ...mailTools(d), artifactSaveTool(d),
  brainSearchTool(d), ...memoryTools(d), brainQueriesTool(d), chatQueryAddTool(d, d), brainScriptsTool(d), chatScriptAddTool(d, d), showUiTool(d),
  new QuestionRelay(d).tool()] as McpTool[];

type Shape = 'root' | 'child' | 'plan';
const ROLES = ['orchestrator', 'strategist', 'scout', 'artisan', 'sentinel', 'herald', 'plain'] as const;
const summary = (role: typeof ROLES[number], shape: Shape) => ({
  isOrchestrator: role === 'orchestrator', research: false,
  ...(role !== 'orchestrator' && role !== 'plain' ? { agent: { id: role, source: 'catalog' as const } } : {}),
  ...(shape === 'child' ? { parentId: 'p' } : {}),
  ...(shape === 'plan' ? { plan: { phase: 'proposed' } } : {}),
}) as never;
const shapes = (role: typeof ROLES[number]): Shape[] => role === 'orchestrator' ? ['root'] : role === 'strategist' ? ['root', 'child', 'plan'] : ['root', 'child'];

describe('the table of required tools (ADR 0356)', () => {
  it('is what the owner asked for, literally', () => {
    expect(ROLE_REQUIRED_TOOLS).toEqual({
      orchestrator: { always: ['show_ui', 'relay_question'], asChild: [], withPlan: [] },
      strategist: { always: ['show_ui', 'agent_delegate', 'agent_assign_task', 'agent_children'], asChild: ['agent_report', 'agent_ask_parent'], withPlan: ['plan_propose', 'plan_update'] },
      scout: { always: ['show_ui'], asChild: ['agent_report', 'agent_ask_parent'], withPlan: [] },
      artisan: { always: ['show_ui'], asChild: ['agent_report', 'agent_ask_parent'], withPlan: [] },
      sentinel: { always: ['show_ui'], asChild: ['agent_report', 'agent_ask_parent'], withPlan: [] },
      herald: { always: ['show_ui'], asChild: ['agent_report', 'agent_ask_parent'], withPlan: [] },
      plain: { always: ['show_ui'], asChild: ['agent_report', 'agent_ask_parent'], withPlan: [] },
    });
    expect(QUESTION_TOOL).toBe('ask_user');
  });

  it('every tool it names is one the app builds', () => {
    expect(missingTools([...ALL_REQUIRED_TOOLS], ALL.map(t => t.name))).toEqual([]);
  });

  it('a role that launches nobody needs no delegation tools; the maintenance research needs none', () => {
    expect(requiredTools({ role: 'strategist', isOrchestrator: false, child: false, plan: false, launches: [], appAsks: false })).toEqual(['show_ui']);
    expect(requiredTools({ role: 'scout', isOrchestrator: false, child: true, plan: false, appAsks: true, research: true })).toEqual([]);
    expect(requiredTools({ role: null, isOrchestrator: false, child: false, plan: false, appAsks: false, reportExpected: true })).toEqual(['show_ui', 'agent_report']);
  });
});

describe.each(engines().map(e => [e.id, e] as const))('%s', (_id, engine) => {
  const asks = appAsks(engine);
  for (const role of ROLES) for (const shape of shapes(role)) {
    it(`${role} (${shape}) has every tool of its role`, () => {
      const s = summary(role, shape);
      const need = requiredTools({ role: role === 'orchestrator' || role === 'plain' ? null : role, isOrchestrator: role === 'orchestrator', child: shape === 'child', plan: shape === 'plan', appAsks: asks });
      // the table's own rows, so that a row emptied by mistake is red here too
      const row = ROLE_REQUIRED_TOOLS[role];
      expect(need).toEqual(expect.arrayContaining([...row.always, ...(shape === 'child' ? row.asChild : []), ...(shape === 'plan' ? row.withPlan : []), ...(asks ? [QUESTION_TOOL] : [])]));
      const shown = ALL.filter(t => toolShownToChat(s, undefined, t.name, asks));
      expect(missingTools(need, shown.map(t => t.name)), 'shown by the chat filter').toEqual([]);
      if (engine.mcpCompact) {
        const fit = fitCompact(shown.map(compactMcpTool), new Set(need));
        expect(missingTools(need, fit.tools.map(t => t.name)), 'kept in the compact list').toEqual([]);
        expect(toolListSize(fit.tools)).toBeLessThanOrEqual(COMPACT_BUDGET);
      }
    });
  }
});

describe('problem 1 of 2026-11-25: Antigravity dropped agent_report (red before ADR 0356)', () => {
  const child = ALL.filter(t => toolShownToChat(summary('scout', 'child'), undefined, t.name, true)).map(compactMcpTool);
  // what his chat in the brain folder was served: 33.6 KB with the browser's tools and the rest (cause.md); fillers of
  // ~1 KB stand for the optional tools beside the chat endpoint's own
  const filler = (i: number): McpTool => ({ name: `browser_tool_${i}`, description: 'x', inputSchema: { type: 'object', properties: { a: { type: 'string', description: 'y'.repeat(900) } } }, run: () => ({ content: [] }) }) as never;
  const served = [...child];
  for (let i = 0; toolListSize(served) < 33_600; i++) served.push(filler(i));
  const need = new Set(['show_ui', 'agent_report', 'agent_ask_parent', 'ask_user']);
  it('before: over the budget, with agent_report the largest after project_map_save (the order agy dropped them in)', () => {
    const bySize = [...served].sort((a, b) => toolListSize([b]) - toolListSize([a])).map(t => t.name);
    expect(bySize.slice(0, 2)).toEqual(['plans', 'agent_report']);
    expect(toolListSize(served)).toBeGreaterThan(COMPACT_BUDGET);
  });
  it('now: under the budget, only optional tools left out, agent_report and agent_ask_parent kept', () => {
    const fit = fitCompact(served, need);
    expect(toolListSize(fit.tools)).toBeLessThanOrEqual(COMPACT_BUDGET);
    expect(fit.tools.map(t => t.name)).toEqual(expect.arrayContaining([...need]));
    for (const n of fit.dropped) expect(need.has(n)).toBe(false);
    expect(fit.dropped).toEqual(expect.arrayContaining([...COMPACT_LEFT_OUT].filter(n => child.some(t => t.name === n))));
  });
  it('a required tool is never dropped, even over the budget', () => {
    const big = (name: string): McpTool => ({ name, description: 'x', inputSchema: { type: 'object', properties: { a: { type: 'string', enum: Array.from({ length: 4000 }, (_, i) => `v${i}`) } } }, run: () => ({ content: [] }) }) as never;
    const fit = fitCompact([big('agent_report'), big('other')], new Set(['agent_report']));
    expect(fit.tools.map(t => t.name)).toEqual(['agent_report']);
    expect(fit.dropped).toEqual(['other']);
  });
});
