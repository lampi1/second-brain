// Pins agents/orchestrator-budget.ts (ADR 0090, issue #98): the Orchestrator's workspace calls count per turn, a few run,
// the next ones are refused with a message to delegate; the app's own tools and a sub-agent's calls never count.
import { describe, expect, it } from 'vitest';
import { budgetMessage, budgetedTool, ORCHESTRATOR_TOOL_BUDGET, TurnToolBudget } from '../../../src/main/agents/orchestrator-budget';

describe('orchestrator turn budget', () => {
  it('counts workspace tools and external MCP servers, not the app\'s own tools', () => {
    for (const t of ['Bash', 'PowerShell', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'WebFetch', 'mcp__sample-devops__wit_create', 'mcp__github__issue_write'])
      expect(budgetedTool(t), t).toBe(true);
    for (const t of ['mcp__second-brain-app__app_create_chat', 'mcp__second-brain-app__task_estimate', 'mcp__second-brain__agent_delegate', 'AskUserQuestion', 'TodoWrite', 'Skill'])
      expect(budgetedTool(t), t).toBe(false);
  });
  it('counts a general-purpose sub-agent (Task or Agent), never the Explore search', () => {
    for (const t of ['Agent', 'Task']) {
      expect(budgetedTool(t, { subagent_type: 'Explore', prompt: 'find x' }), t).toBe(false);
      expect(budgetedTool(t, { subagent_type: 'general-purpose', prompt: 'do x' }), t).toBe(true);
      expect(budgetedTool(t, { prompt: 'do x' }), t).toBe(true);
    }
    const b = new TurnToolBudget(1);
    expect(b.decide({ tool: 'Agent', input: { subagent_type: 'Explore' } })).toBeNull();
    expect(b.decide({ tool: 'Agent', input: { description: 'fix', prompt: 'p' } })).toBeNull();
    expect(b.decide({ tool: 'Task', input: { subagent_type: 'general-purpose' } })?.deny).toBe(budgetMessage('Task', 1));
  });
  it('lets a small budget through, then refuses with a message to delegate', () => {
    expect(ORCHESTRATOR_TOOL_BUDGET).toBeGreaterThan(0);
    const b = new TurnToolBudget();
    for (let i = 0; i < ORCHESTRATOR_TOOL_BUDGET; i++) expect(b.decide({ tool: i ? 'Grep' : 'Read', input: {} })).toBeNull();
    const v = b.decide({ tool: 'Bash', input: { command: 'node gh-issue.mjs' } });
    expect(v?.deny).toContain('app_create_chat');
    expect(v?.deny).toBe(budgetMessage('Bash'));
    expect(b.decide({ tool: 'mcp__sample-devops__wit_create', input: {} })).not.toBeNull();
  });
  it('never refuses the app\'s tools, nor a sub-agent\'s calls, even with the budget used', () => {
    const b = new TurnToolBudget(1);
    expect(b.decide({ tool: 'Read', input: {} })).toBeNull();
    expect(b.decide({ tool: 'mcp__second-brain-app__app_create_chat', input: {} })).toBeNull();
    expect(b.decide({ tool: 'Grep', input: {}, agentId: 'a1' })).toBeNull();
    expect(b.count).toBe(1);
    expect(b.decide({ tool: 'Grep', input: {} })).not.toBeNull();
  });
  it('starts again at each turn', () => {
    const b = new TurnToolBudget(1);
    b.decide({ tool: 'Read', input: {} });
    expect(b.decide({ tool: 'Read', input: {} })).not.toBeNull();
    b.turnEnded();
    expect(b.decide({ tool: 'Read', input: {} })).toBeNull();
  });
});
