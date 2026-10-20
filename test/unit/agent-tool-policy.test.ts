// Per-agent tool policy and permission ceiling (A2, AGENTS-DESIGN §4.1.1): the pure rules in tool-policy.ts and how the
// Claude and Codex launches apply them. Only narrowing is possible; what an engine cannot enforce is listed.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FAIL_CLOSED, aboveCeiling, narrowest, suggestedAbove, browserAccess, BROWSER_READ_TOOLS, checkedTools, commandsReadOnly, readOnlyCommand, shellWithin, claudeDefaultMode, claudeMcp, claudeTools, clampMode, narrowCodex, readPolicy, unenforced, type AgentPolicy } from '../../src/main/agents/tool-policy';
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

  it('brain-write gives Claude only Edit and Write (the role gate keeps them inside the brain)', () => {
    const t = claudeTools({ allow: ['read', 'brain-write'] });
    expect(t).toEqual(expect.arrayContaining(['Read', 'Edit', 'Write']));
    expect(t.some(n => ['MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'].includes(n))).toBe(false);
    // the user's own Claude allow rules could approve an Edit outside the brain without asking: reported
    expect(unenforced('claude', policy(['read', 'brain-write']))).toEqual(['edit']);
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
    // a read-only sandbox still runs commands that read
    expect(unenforced('codex', policy(['read']))).toEqual(['shell-read', 'web', 'mail-draft', 'calendar-read', 'mcp']);
    expect(unenforced('codex', policy(['read', 'edit']))).toEqual(['shell', 'shell-read', 'web', 'mail-draft', 'calendar-read', 'brain-write', 'mcp']);
    expect(unenforced('codex', policy(['read', 'edit'], 'default'))).toEqual(['shell-read', 'web', 'mail-draft', 'calendar-read', 'mcp']);
    // ACP: only plan holds; a higher ceiling is declared, not enforced
    expect(unenforced('acp', policy(['read'], 'plan'))).toEqual(['shell-read', 'web', 'mail-draft', 'calendar-read', 'mcp']);
    // Claude with read-only commands: the app checks each command it is asked about; the user's own allow rules are not
    expect(unenforced('claude', policy(['read', 'shell-read']))).toEqual(['shell']);
    expect(unenforced('acp', { tools: null, ceiling: 'default' })).toEqual(['ceiling']);
    expect(unenforced('api', policy(['read']))).toEqual([]);
  });

  it('commands reach files and the network on Claude and Cursor: an allowed shell is reported', () => {
    expect(unenforced('claude', policy(['read', 'shell']))).toEqual(['edit', 'shell-read', 'web', 'brain-write']);
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

  it('a wider class keeps the narrower one it includes, from either side, and never widens it', () => {
    const scout = policy(['read', 'web', 'browser-read', 'shell-read']), artisan = policy(['read', 'edit', 'shell', 'web', 'browser']);
    // a Scout under an Artisan keeps its read-only commands and browser
    expect(narrowest(scout, artisan)?.tools?.allow.sort()).toEqual(['browser-read', 'read', 'shell-read', 'web']);
    expect(narrowest(artisan, scout)?.tools?.allow.sort()).toEqual(['browser-read', 'read', 'shell-read', 'web']);
    // a brain-only role under a parent that edits anywhere keeps brain-write; under a read-only one it does not
    expect(narrowest(policy(['read', 'brain-write']), artisan)?.tools?.allow.sort()).toEqual(['brain-write', 'read']);
    expect(narrowest(policy(['read', 'brain-write']), policy(['read', 'web']))?.tools?.allow).toEqual(['read']);
    // the narrow class never stands for the wide one
    expect(narrowest(policy(['shell', 'edit', 'browser']), policy(['shell-read', 'brain-write', 'browser-read']))?.tools?.allow.sort()).toEqual(['brain-write', 'browser-read', 'shell-read']);
  });

  it('a suggested mode above the ceiling, or an unknown one, is refused', () => {
    expect(suggestedAbove('acceptEdits', 'default')).toBe(true);
    expect(suggestedAbove('plan', 'default')).toBe(false);
    expect(suggestedAbove('godMode', 'acceptEdits')).toBe(true);
    expect(suggestedAbove('bypassPermissions', null)).toBe(false);
  });

  it('hides the browser only for agents whose policy leaves it out', () => {
    expect(browserAccess(null)).toBe('all');
    expect(browserAccess({ tools: null, ceiling: 'plan' })).toBe('all');
    expect(browserAccess(policy(['read']))).toBe('none');
    expect(browserAccess(policy(['read', 'browser-read']))).toBe('read');
    expect(browserAccess(policy(['read', 'browser', 'browser-read']))).toBe('all');
    // the reading set never clicks, types, fills forms, answers dialogs or runs JavaScript
    for (const t of ['click', 'type', 'key', 'fill_form', 'select_option', 'handle_dialog', 'javascript', 'drag', 'handoff_to_user']) expect(BROWSER_READ_TOOLS).not.toContain(t);
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

describe('read-only commands (shell-read)', () => {
  it('applies only without shell, and gives Claude the command tools', () => {
    expect(commandsReadOnly({ tools: { allow: ['read', 'shell-read'] }, ceiling: 'default' })).toBe(true);
    expect(commandsReadOnly({ tools: { allow: ['read', 'shell', 'shell-read'] }, ceiling: 'default' })).toBe(false);
    expect(commandsReadOnly({ tools: null, ceiling: 'default' })).toBe(false);
    expect(claudeTools({ allow: ['read', 'shell-read'] })).toEqual(expect.arrayContaining(['Bash', 'Read']));
    expect(claudeTools({ allow: ['shell', 'shell-read'] }).filter(t => t === 'Bash')).toHaveLength(1);
  });
  it.each(['ls -la src', 'git status', 'git log --oneline -5', 'git diff HEAD~1', 'rg -n "TODO" src', 'cat package.json | head -20', 'find . -name "*.ts"', 'git branch -a', 'Get-ChildItem -Recurse', 'git remote -v'])('reads: %s', c => {
    expect(readOnlyCommand(c)).toBe(true);
  });
  it.each(['rm -rf out', 'npm install', 'git commit -m x', 'git branch new-feature', 'git tag v1', 'git push', 'echo x > a.txt', 'ls; rm a', 'cat a && rm a', 'ls $(rm a)', 'find . -delete', 'find . -exec rm {} ;',
    'git diff --output=x', 'rg --pre ./run.sh x', 'sort -o a a', 'cat a | tee b', 'node script.js', 'git -c core.pager=sh log', '', 42])('does not read only: %s', c => {
    expect(readOnlyCommand(c)).toBe(false);
  });
  // review of #89: write and run forms the first classifier took for reads, and their neighbours
  it.each([
    'sort -o/tmp/x a', 'sort -uo /tmp/x a', 'sort --output=/tmp/x a', 'sort --out=/tmp/x a', 'sort a', 'cat a | sort -o x', 'cat a | sort b', 'cat a | sort -k', 'cat a | sort /o x',
    'uniq a out', 'uniq a', 'cat a | uniq b', 'cat a | uniq -c out',
    'git grep -Ovim x', 'git grep -O x', 'git grep -iO x', 'git grep --open-files-in-pager=vim x', 'git grep --open x', 'git log --out=x', 'git diff --output-directory=d', 'git diff --ext-diff', 'git log --ext',
    'Get-Content (Remove-Item x)', 'Get-ChildItem @(Remove-Item x)', 'gc $(rm x)', 'ls | Get-Content -Path { Remove-Item x }', 'gci @{a=Remove-Item x}', '& rm x', 'ls `rm x`', 'cat <(rm x)', 'ls >(rm x)', 'ls ${x}',
    'cat a >> b', 'cat a 2> b', 'cat < a', 'ls\nrm a', 'ls || rm a', 'ls |& rm a',
    'find . "-delete"', "find . -de'let'e", 'find . -de\\lete', 'find . -fprint x', 'find . -execdir rm', 'find . -okdir rm', 'find *', 'git diff *', 'rg x *',
    'rg --pre=./run.sh x', 'rg --hostname-bin=./x y', 'tree -o out', 'tree -ao out', 'tree -R -H .', 'file -C -m magic', 'file --compile x',
    'cat "\\"" | rm -rf x "\\""', "cat \\' | rm x", 'cat "a', 'FOO=1 ls', 'git -C .. log', '| ls', 'ls |',
    // a bare `$`: word splitting ($IFS), variables (bash, PowerShell $env:), $'…' quoting
    'find .$IFS-delete', 'rg x .$IFS--pre=sh', 'git log -1$IFS--output=../OUT', 'tree .$IFS-R', 'ls $HOME', 'cat "$HOME/a"', "find . $'-delete'",
    'Get-Content $env:USERPROFILE/a', 'gci $x', "rg 'foo$' src", 'git show HEAD@{1}$IFS--output=x',
  ])('closes: %s', c => {
    expect(readOnlyCommand(c)).toBe(false);
  });
  it.each(['grep -o foo a.txt', 'cat a | sort -u', 'cat a | sort -rn -k 2,3 -t ,', 'cat a | sort -nk2', 'git log | uniq -c', 'cat a | uniq -f 2', 'grep -E "foo|bar" src/a.ts', "rg 'a b' src",
    'git log --format="%h %s" HEAD^', 'git log @{u}..', 'git show HEAD@{1}', 'git diff --cached --stat', 'git log --pretty=oneline', 'cat *.ts', 'ls src/*', 'find . -name "*.ts" -o -name "*.tsx"',
    'git grep -o foo', 'rg --hidden -n x', 'Select-String -Path a.txt -Pattern x', 'gci -Filter *.ts | Measure-Object', 'git diff --no-ext-diff', 'git.exe status'])('still reads: %s', c => {
    expect(readOnlyCommand(c)).toBe(true);
  });
  it('a policy lets a command through only as far as it goes', () => {
    const scout: AgentPolicy = { tools: { allow: ['read', 'shell-read'] }, ceiling: 'default' };
    expect(shellWithin(scout, 'Bash', { command: 'git status' })).toBe(true);
    expect(shellWithin(scout, 'Shell', { command: 'rm -rf x' })).toBe(false);
    expect(shellWithin(scout, 'BashOutput', {})).toBe(true);
    expect(shellWithin(scout, 'KillShell', {})).toBe(false);
    expect(shellWithin(scout, 'Monitor', { command: 'ls' })).toBe(false);
    expect(shellWithin(scout, 'Bash', null)).toBe(false);
    expect(shellWithin({ tools: { allow: ['read'] }, ceiling: null }, 'Bash', { command: 'ls' })).toBe(false);
    expect(shellWithin({ tools: { allow: ['shell'] }, ceiling: null }, 'Bash', { command: 'rm x' })).toBe(true);
    expect(shellWithin(null, 'Bash', { command: 'rm x' })).toBe(true);
  });
});

describe('the sub-agent tool (Explore searches, token plan 2026-10-20)', () => {
  it('only a policy with every tool class gets Agent/Task; a narrowed one never does', async () => {
    const { claudeTools } = await import('../../src/main/agents/tool-policy');
    const { TOOL_CLASSES } = await import('../../src/shared/agents');
    expect(claudeTools({ allow: [...TOOL_CLASSES] })).toEqual(expect.arrayContaining(['Agent', 'Task']));
    expect(claudeTools({ allow: ['read', 'shell-read'] })).not.toContain('Agent');
  });
});
