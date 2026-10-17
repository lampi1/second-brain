// Per-agent tool policy and permission ceiling (A2, AGENTS-DESIGN §4.1.1): the pure rules in tool-policy.ts and how the
// Claude and Codex launches apply them. Only narrowing is possible; what an engine cannot enforce is listed.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FAIL_CLOSED, aboveCeiling, narrowest, suggestedAbove, browserAllowed, checkedTools, claudeDefaultMode, claudeMcp, claudeTools, clampMode, narrowCodex, readPolicy, unenforced, type AgentPolicy } from '../../src/main/agents/tool-policy';
import { ClaudeSession } from '../../src/main/chats/claude';
import { codexPolicyFor, type CodexExecutionPolicy } from '../../src/main/brain/adapters/codex-policy';
import { recSink } from './chats/helpers';
import type { ToolClass } from '../../src/shared/agents';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tool-policy-'));
const write = (file: string, v: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(v)); };
const policy = (allow: ToolClass[], ceiling: AgentPolicy['ceiling'] = null, mcp?: string[]): AgentPolicy => ({ tools: { allow, ...(mcp ? { mcp } : {}) }, ceiling });

describe('agent tool policy', () => {
  it('clamps a mode to the ceiling and never widens it', () => {
    expect(clampMode('bypassPermissions', 'default')).toBe('default');
    expect(clampMode('auto', 'acceptEdits')).toBe('acceptEdits');
    expect(clampMode('plan', 'acceptEdits')).toBe('plan');
    expect(clampMode('acceptEdits', null)).toBe('acceptEdits');
    expect(aboveCeiling('acceptEdits', 'default')).toBe(true);
    expect(aboveCeiling('default', 'default')).toBe(false);
    expect(aboveCeiling('bypassPermissions', null)).toBe(false);
  });

  it('reads Claude’s default mode from user, project and local settings, the last valid one winning', () => {
    const home = tmp(), cwd = tmp(), env = { CLAUDE_CONFIG_DIR: home };
    expect(claudeDefaultMode(cwd, env)).toBe('default');
    write(path.join(home, 'settings.json'), { permissions: { defaultMode: 'bypassPermissions' } });
    expect(claudeDefaultMode(cwd, env)).toBe('bypassPermissions');
    write(path.join(cwd, '.claude', 'settings.json'), { permissions: { defaultMode: 'acceptEdits' } });
    expect(claudeDefaultMode(cwd, env)).toBe('acceptEdits');
    write(path.join(cwd, '.claude', 'settings.local.json'), { permissions: { defaultMode: 'nonsense' } });
    expect(claudeDefaultMode(cwd, env)).toBe('acceptEdits'); // an invalid layer is skipped, not a reset
    fs.writeFileSync(path.join(cwd, '.claude', 'settings.local.json'), '{broken');
    expect(claudeDefaultMode(cwd, env)).toBe('acceptEdits');
    write(path.join(cwd, '.claude', 'settings.local.json'), { permissions: { defaultMode: 'plan' } });
    expect(claudeDefaultMode(cwd, env)).toBe('plan');
  });

  it('a stored policy that does not validate fails closed, an absent one inherits', () => {
    expect(readPolicy(undefined)).toBeNull();
    expect(readPolicy({ tools: null, ceiling: null })).toBeNull();
    expect(readPolicy({ tools: { allow: ['read', 'edit'] }, ceiling: 'default' })).toEqual(policy(['read', 'edit'], 'default'));
    for (const bad of [{ tools: { allow: ['root'] }, ceiling: null }, { tools: null, ceiling: 'bypassPermissions' }, { tools: { allow: ['read'], mcp: ['x'] }, ceiling: null }, 'garbage', null])
      expect(readPolicy(bad)).toEqual(FAIL_CLOSED);
    // never the shared object: a caller changing its copy cannot widen the next one
    expect(readPolicy('garbage')).not.toBe(FAIL_CLOSED);
    expect(() => checkedTools({ allow: ['read', 'read'] })).toThrow();
  });

  it('maps classes to Claude built-in tools, always keeping planning and questions, never subagents', () => {
    const t = claudeTools({ allow: ['read'] });
    expect(t).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'TodoWrite', 'AskUserQuestion', 'ExitPlanMode']));
    expect(t).not.toEqual(expect.arrayContaining(['Edit']));
    expect(t.some(n => ['Bash', 'PowerShell', 'Write', 'WebFetch', 'Task', 'Agent'].includes(n))).toBe(false);
    expect(claudeTools({ allow: ['read', 'edit', 'shell', 'web'] })).toEqual(expect.arrayContaining(['Edit', 'Write', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch']));
  });

  it('narrows Claude MCP: without the mcp class only the app servers and no connectors, unless mail or calendar need them', () => {
    expect(claudeMcp({ allow: ['read'] })).toEqual({ strict: true, connectors: false });
    expect(claudeMcp({ allow: ['read', 'calendar-read'] })).toEqual({ strict: true, connectors: true });
    expect(claudeMcp({ allow: ['read', 'mcp'] })).toEqual({ strict: false, connectors: true });
  });

  it('lists per engine the restrictions it cannot apply', () => {
    expect(unenforced('claude', policy(['read', 'edit']))).toEqual(['brain-write']); // edits reach the brain folder too
    expect(unenforced('claude', policy(['read']))).toEqual([]);
    // connectors on for mail: calendar and other MCP servers stay reachable; brain-write rides on edit
    expect(unenforced('claude', policy(['read', 'edit', 'mail-draft']))).toEqual(['calendar-read', 'brain-write', 'mcp']);
    expect(unenforced('claude', policy(['read', 'mcp'], null, ['github']))).toEqual(['mail-draft', 'calendar-read', 'mcp']);
    // Codex: read-only sandbox only without edits and commands, or with a ceiling up to default
    expect(unenforced('codex', policy(['read']))).toEqual(['web', 'mail-draft', 'calendar-read', 'mcp']);
    expect(unenforced('codex', policy(['read', 'edit']))).toEqual(['shell', 'web', 'mail-draft', 'calendar-read', 'brain-write', 'mcp']);
    expect(unenforced('codex', policy(['read', 'edit'], 'default'))).toEqual(['web', 'mail-draft', 'calendar-read', 'mcp']);
    // ACP: only plan holds; a higher ceiling is declared, not enforced
    expect(unenforced('acp', policy(['read'], 'plan'))).toEqual(['web', 'mail-draft', 'calendar-read', 'mcp']);
    expect(unenforced('acp', { tools: null, ceiling: 'default' })).toEqual(['ceiling']);
    expect(unenforced('api', policy(['read']))).toEqual([]);
  });

  it('commands reach files and the network on Claude and Cursor: an allowed shell is reported', () => {
    expect(unenforced('claude', policy(['read', 'shell']))).toEqual(['edit', 'web', 'brain-write']);
    // Cursor's read-only mode runs no command: an allowed shell changes nothing there
    expect(unenforced('acp', policy(['read', 'shell'], 'plan'))).toEqual(unenforced('acp', policy(['read'], 'plan')));
  });

  it('takes the narrower of two policies', () => {
    expect(narrowest(null, null)).toBeNull();
    expect(narrowest(policy(['read']), null)).toEqual(policy(['read']));
    expect(narrowest(null, { tools: null, ceiling: 'plan' })).toEqual({ tools: null, ceiling: 'plan' });
    expect(narrowest(policy(['read', 'edit', 'shell'], 'acceptEdits'), policy(['read', 'edit', 'web'], 'default'))).toEqual(policy(['read', 'edit'], 'default'));
    expect(narrowest({ tools: null, ceiling: 'plan' }, policy(['read', 'edit']))).toEqual(policy(['read', 'edit'], 'plan'));
    expect(narrowest(policy(['read', 'mcp'], null, ['a', 'b']), policy(['read', 'mcp'], null, ['b', 'c']))).toEqual(policy(['read', 'mcp'], null, ['b']));
    expect(narrowest(policy(['read', 'mcp']), policy(['read', 'mcp'], null, ['b']))).toEqual(policy(['read', 'mcp'], null, ['b']));
    expect(narrowest(policy(['read', 'mcp'], null, ['a']), policy(['read']))).toEqual(policy(['read']));
    expect(narrowest(policy(['read', 'mcp'], null, ['jira']), policy(['read', 'mcp'], null, ['github']))).toEqual(policy(['read']));
  });

  it('a suggested mode above the ceiling, or an unknown one, is refused', () => {
    expect(suggestedAbove('acceptEdits', 'default')).toBe(true);
    expect(suggestedAbove('plan', 'default')).toBe(false);
    expect(suggestedAbove('godMode', 'acceptEdits')).toBe(true);
    expect(suggestedAbove('bypassPermissions', null)).toBe(false);
  });

  it('hides the browser only for agents whose policy leaves it out', () => {
    expect(browserAllowed(null)).toBe(true);
    expect(browserAllowed({ tools: null, ceiling: 'plan' })).toBe(true);
    expect(browserAllowed(policy(['read']))).toBe(false);
    expect(browserAllowed(policy(['read', 'browser']))).toBe(true);
  });
});

describe('Claude launch with an agent policy', () => {
  const base = { chatId: 'c', cwd: '.', sessionId: 'abc12345', mcpConfig: '{"mcpServers":{}}' };
  const settings = (a: string[]) => (a.includes('--settings') ? JSON.parse(a[a.indexOf('--settings') + 1]!) : {}) as Record<string, unknown>;

  it('passes only the allowed built-in tools in one argument, strict MCP and no connectors', () => {
    const a = new ClaudeSession({ ...base, toolPolicy: { allow: ['read', 'edit'] }, ceiling: 'default', permissionMode: 'default' }, recSink()).args();
    const tools = a.find(x => x.startsWith('--tools='));
    expect(tools).toBeDefined();
    expect(tools!.slice('--tools='.length).split(',')).toEqual(claudeTools({ allow: ['read', 'edit'] }));
    expect(a).toContain('--strict-mcp-config');
    expect(a).toContain('--mcp-config'); // the app's own servers (send_to_chat, browser) still load
    expect(settings(a).disableClaudeAiConnectors).toBe(true);
  });

  it('keeps connectors and every MCP server when the agent may use them', () => {
    const a = new ClaudeSession({ ...base, toolPolicy: { allow: ['read', 'mcp'] } }, recSink()).args();
    expect(a).not.toContain('--strict-mcp-config');
    expect(settings(a).disableClaudeAiConnectors).toBeUndefined();
  });

  it('changes nothing without a policy', () => {
    const a = new ClaudeSession(base, recSink()).args();
    expect(a.some(x => x.startsWith('--tools'))).toBe(false);
    expect(a).not.toContain('--strict-mcp-config');
  });
});

describe('Codex launch with an agent policy', () => {
  const open: CodexExecutionPolicy = { approvalPolicy: 'never', sandbox: 'workspace-write', writableRoots: ['/repo'] };

  it('takes the read-only sandbox without edits and commands, or with a ceiling up to default', () => {
    const ro = { approvalPolicy: 'on-request', sandbox: 'read-only', writableRoots: [] };
    expect(narrowCodex(open, policy(['read', 'web']))).toEqual(ro);
    expect(narrowCodex(open, policy(['read', 'edit', 'shell'], 'default'))).toEqual(ro);
    expect(narrowCodex(open, { tools: null, ceiling: 'plan' })).toEqual(ro);
  });

  it('asks before every command at acceptEdits and keeps the folder policy otherwise', () => {
    expect(narrowCodex(open, policy(['read', 'edit', 'shell'], 'acceptEdits'))).toEqual({ ...open, approvalPolicy: 'on-request' });
    expect(narrowCodex(open, policy(['read', 'edit']))).toEqual(open);
    expect(narrowCodex(open, null)).toEqual(open);
  });

  it('applies through codexPolicyFor', () => {
    expect(codexPolicyFor(tmp(), false, { tools: null, ceiling: 'plan' })).toEqual({ approvalPolicy: 'on-request', sandbox: 'read-only', writableRoots: [] });
    expect(codexPolicyFor(tmp(), false, null).sandbox).toBe('workspace-write');
  });
});
