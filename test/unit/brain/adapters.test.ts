// The per-launch adapters of the brain's rules (src/main/brain/adapters, ADR 0060): placeholders, the domains'
// instructions, the Claude plugin folder (layout, placeholders resolved, rebuilt only on change, off by default, never
// throwing) and the Codex launch (-c overrides, MCP urls plain only and none for a read-only run, instructions and
// skill folders only with the brain switched on). Temp folders only: no real brain, no ~/.claude, no CLI.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeLaunch, PLUGIN_NAME } from '../../../src/main/brain/adapters/claude-plugin';
import { codexLaunch } from '../../../src/main/brain/adapters/codex';
import { acpRules } from '../../../src/main/brain/adapters/acp-rules';
import { log } from '../../../src/main/log';
import { instructionsOf, launchRules, resolvePlaceholders, setLaunchRules, skillDirs } from '../../../src/main/brain/adapters/domains';

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), `sb-${p}-`));
const write = (root: string, rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const fwd = (p: string): string => p.replace(/\\/g, '/');

function brain(): { personal: string; work: string; domains: { name: string; root: string }[] } {
  const personal = tmp('personal'), work = tmp('work');
  write(personal, 'AGENTS.md', '# Regole\nLeggi {brain}/me.md e {domain:work}/x.md');
  write(personal, '.claude/skills/rivedi/SKILL.md', '---\nname: rivedi\ndescription: Rivede.\n---\nApri {brain}/a.md');
  write(personal, '.claude/agents/scout.md', '---\nname: scout\n---\nCerca.');
  write(personal, '.claude/output-styles/breve.md', '---\nname: breve\n---\nCorto.');
  write(personal, '.claude/hooks/hooks.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node {brain}/hook.mjs' }] }] } }));
  write(personal, '.agents/skills/solo-codex/SKILL.md', '---\nname: solo-codex\n---\nx');
  write(work, 'AGENTS.md', 'Regole del lavoro');
  write(work, '.claude/skills/rivedi/SKILL.md', 'the work copy: never overwrites the personal one');
  write(work, '.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\nd');
  return { personal, work, domains: [{ name: 'personal', root: personal }, { name: 'work', root: work }] };
}

afterEach(() => { setLaunchRules(() => ({ domains: [], claude: false, codex: true })); vi.restoreAllMocks(); });

describe('domains', () => {
  it('resolves {brain} and {domain:<name>} with forward slashes; unknown stays', () => {
    const d = [{ name: 'personal', root: 'C:\\b\\p' }, { name: 'work', root: 'C:\\b\\w' }];
    expect(resolvePlaceholders('{brain}/a {domain:work}/b {domain:nope}/c', d)).toBe('C:/b/p/a C:/b/w/b {domain:nope}/c');
    expect(resolvePlaceholders('{brain}', [])).toBe('{brain}');
  });

  it('joins the domains\' AGENTS.md under their names, capped; none = null', () => {
    const b = brain();
    const text = instructionsOf(b.domains)!;
    expect(text).toContain('<!-- brain domain: personal -->');
    expect(text).toContain(`Leggi ${fwd(b.personal)}/me.md e ${fwd(b.work)}/x.md`);
    expect(text).toContain('Regole del lavoro');
    expect(instructionsOf(b.domains, 20)).toContain('troncato');
    expect(instructionsOf([{ name: 'x', root: tmp('empty') }])).toBeNull();
    expect(skillDirs(b.domains, ['.agents/skills', '.claude/skills'])).toEqual([path.join(b.personal, '.agents/skills'), path.join(b.personal, '.claude/skills'), path.join(b.work, '.claude/skills')]);
  });

  it('launchRules: defaults Claude off, Codex on; missing folders left out; a throwing source = no brain', () => {
    expect(launchRules()).toEqual({ domains: [], claude: false, codex: true });
    const b = brain();
    setLaunchRules(() => ({ domains: [...b.domains, { name: 'gone', root: path.join(b.personal, 'nope') }], claude: true, codex: false }));
    expect(launchRules()).toEqual({ domains: b.domains, claude: true, codex: false });
    setLaunchRules(() => { throw new Error('x'); });
    expect(launchRules()).toEqual({ domains: [], claude: false, codex: true });
  });
});

describe('claude plugin', () => {
  it('ships hook scripts and their local imports and rebuilds when a script changes', () => {
    const b = brain(), userData = tmp('ud');
    write(b.personal, '.claude/hooks/check.mjs', 'import "./lib/helper.mjs";');
    write(b.personal, '.claude/hooks/lib/helper.mjs', 'export const version = 1;');
    const input = { domains: b.domains, on: true };
    const dir = claudeLaunch(userData, input).pluginDir!;
    expect(fs.readFileSync(path.join(dir, 'hooks/check.mjs'), 'utf8')).toBe('import "./lib/helper.mjs";');
    write(b.personal, '.claude/hooks/lib/helper.mjs', 'export const version = 200;');
    claudeLaunch(userData, input);
    expect(fs.readFileSync(path.join(dir, 'hooks/lib/helper.mjs'), 'utf8')).toBe('export const version = 200;');
  });
  it('off by default: no arguments, nothing written', () => {
    const userData = tmp('ud');
    setLaunchRules(() => ({ domains: brain().domains, claude: false, codex: true }));
    expect(claudeLaunch(userData)).toEqual({ args: [], pluginDir: null, rulesFile: null });
    expect(fs.readdirSync(userData)).toEqual([]);
  });

  it('on: a plugin folder in userData with the domains\' parts, placeholders resolved, and the rules file', () => {
    const userData = tmp('ud');
    const b = brain();
    setLaunchRules(() => ({ domains: b.domains, claude: true, codex: true }));
    const r = claudeLaunch(userData);
    const dir = path.join(userData, 'claude-plugin', PLUGIN_NAME);
    expect(r.args).toEqual(['--plugin-dir', dir, '--append-system-prompt-file', path.join(userData, 'claude-plugin', 'rules.md')]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))).toMatchObject({ name: 'second-brain' });
    expect(fs.readFileSync(path.join(dir, 'skills', 'rivedi', 'SKILL.md'), 'utf8')).toContain(`Apri ${fwd(b.personal)}/a.md`);
    expect(fs.existsSync(path.join(dir, 'skills', 'deploy', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'agents', 'scout.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'output-styles', 'breve.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'skills', 'solo-codex'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'hooks', 'hooks.json'), 'utf8')).hooks.Stop[0].hooks[0].command).toBe(`node ${fwd(b.personal)}/hook.mjs`);
    expect(fs.readFileSync(r.rulesFile!, 'utf8')).toContain('Regole del lavoro');
  });

  it('rebuilt only when the brain changed', () => {
    const userData = tmp('ud');
    const b = brain();
    const input = { domains: b.domains, on: true };
    const dir = claudeLaunch(userData, input).pluginDir!;
    const marker = path.join(dir, 'marker');
    fs.writeFileSync(marker, 'x');
    claudeLaunch(userData, input);
    expect(fs.existsSync(marker)).toBe(true);
    write(b.personal, '.claude/agents/nuovo.md', 'nuovo');
    claudeLaunch(userData, input);
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'agents', 'nuovo.md'))).toBe(true);
  });

  it('a brain with no rules: no arguments; a userData it cannot write: no arguments, no throw', () => {
    expect(claudeLaunch(tmp('ud'), { domains: [{ name: 'x', root: tmp('empty') }], on: true }).args).toEqual([]);
    const file = path.join(tmp('ud'), 'a-file');
    fs.writeFileSync(file, '');
    expect(claudeLaunch(file, { domains: brain().domains, on: true }).args).toEqual([]);
  });
});

describe('codex launch', () => {
  it('approval, sandbox and both MCP servers as -c overrides; the brain\'s instructions and skills', () => {
    const b = brain();
    const r = codexLaunch({ mcpUrl: 'http://127.0.0.1:4329/mcp/c/abc', appMcpUrl: 'http://127.0.0.1:4329/mcp/app/o/x/t', domains: b.domains, brain: true });
    expect(r.configArgs).toEqual(['-c', 'approval_policy=on-request', '-c', 'sandbox_mode=workspace-write',
      '-c', 'mcp_servers.second-brain.url=http://127.0.0.1:4329/mcp/c/abc',
      '-c', 'mcp_servers.second-brain.default_tools_approval_mode=prompt',
      ...['send_to_chat', 'list_chats', 'agent_delegate', 'agent_report', 'agent_children', 'agent_ask_parent', 'agent_answer_child', 'plan_propose', 'plan_update'].flatMap(tool => ['-c', `mcp_servers.second-brain.tools.${tool}.approval_mode=approve`]),
      '-c', 'mcp_servers.second-brain-app.url=http://127.0.0.1:4329/mcp/app/o/x/t',
      '-c', 'mcp_servers.second-brain-app.default_tools_approval_mode=approve',
    ]);
    expect(r.developerInstructions).toContain('Regole del lavoro');
    expect(r.skillRoots).toHaveLength(3);
  });

  it('legacy brains: the joined AGENTS.md of every domain, placeholders across domains; a broken brain.json is not product', () => {
    const b = brain();
    write(b.work, 'brain.json', '{ not json');
    const r = codexLaunch({ mcpUrl: null, appMcpUrl: null, domains: b.domains, brain: true });
    expect(r.developerInstructions).toBe(instructionsOf(b.domains));
    expect(r.developerInstructions).toContain(`Leggi ${fwd(b.personal)}/me.md e ${fwd(b.work)}/x.md`);
    expect(codexLaunch({ mcpUrl: null, appMcpUrl: null, readOnly: true, domains: b.domains, brain: true }).developerInstructions).toBe(instructionsOf(b.domains));
  });

  it('ACP launch text: none for legacy brains, a broken brain.json included (never throws)', () => {
    const b = brain();
    write(b.work, 'brain.json', '{ not json');
    setLaunchRules(() => ({ domains: b.domains, claude: false, codex: true }));
    expect(acpRules()).toBeNull();
    expect(acpRules(true)).toBeNull();
  });

  it('brain off: only the app\'s part; read-only: read-only sandbox, no MCP, no skills; an unsafe url is left out', () => {
    const b = brain();
    expect(codexLaunch({ mcpUrl: null, appMcpUrl: null, domains: b.domains, brain: false })).toEqual({ configArgs: ['-c', 'approval_policy=on-request', '-c', 'sandbox_mode=workspace-write'], developerInstructions: null, skillRoots: [], approvalPolicy: 'on-request', sandbox: 'workspace-write' });
    const ro = codexLaunch({ mcpUrl: 'http://127.0.0.1:1/mcp', appMcpUrl: null, readOnly: true, domains: b.domains, brain: true });
    expect(ro.configArgs).toEqual(['-c', 'approval_policy=on-request', '-c', 'sandbox_mode=read-only']);
    expect(ro.skillRoots).toEqual([]);
    expect(codexLaunch({ mcpUrl: 'http://x/a b"&', appMcpUrl: null, domains: [], brain: true }).configArgs).toHaveLength(4);
  });

  it('reads launchRules when not given: Codex on by default', () => {
    const b = brain();
    setLaunchRules(() => ({ domains: b.domains, claude: false, codex: true }));
    expect(codexLaunch({ mcpUrl: null, appMcpUrl: null }).developerInstructions).toContain('Regole');
    setLaunchRules(() => ({ domains: b.domains, claude: false, codex: false }));
    expect(codexLaunch({ mcpUrl: null, appMcpUrl: null }).developerInstructions).toBeNull();
  });

  it('brain on but no domain: one info line naming the chat; brain off or with domains: none', () => {
    const info = vi.spyOn(log, 'info');
    codexLaunch({ mcpUrl: null, appMcpUrl: null, chatId: 'c_1' });
    expect(info).toHaveBeenCalledWith('brain', expect.stringContaining('without the brain'), expect.objectContaining({ chat: 'c_1' }));
    info.mockClear();
    codexLaunch({ mcpUrl: null, appMcpUrl: null, domains: [], brain: false });
    codexLaunch({ mcpUrl: null, appMcpUrl: null, domains: brain().domains, brain: true });
    expect(info).not.toHaveBeenCalled();
  });
});
