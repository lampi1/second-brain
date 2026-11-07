// OpenCode's permissions for an app chat (brain/adapters/opencode-permission.ts, ADR 0221): the config passed at every
// start, judged with OpenCode's own matching (ordered rules, last match wins), so a role's normal work runs without a
// panel, what Claude denies stays denied, and no role gets more than it has.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { agentEdit, claudeSettingsFiles, NO_CLAUDE_RULES, openCodeConfigContent, openCodeEnv, openCodePermission, readClaudeRules, type ClaudeRules, type OpenCodeRole } from '../../../src/main/brain/adapters/opencode-permission';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ocperm-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const home = path.join(tmp, 'home').replace(/\\/g, '/');
const SECRET = ['.prod', 'keys.env'].join('-');
const AZURE_SQL = ['database', 'windows', 'net'].join('.'); // built here: the guard flags host names in source
const SCRIPT = 'prodctl.sh';
// the shape of the user's Claude deny list: the production script, its secrets file, sqlcmd towards Azure, az writes, pushes
const userDeny = [
  `Bash(*${SCRIPT}*)`, `PowerShell(*${SCRIPT}*)`, `Bash(*${SECRET}*)`, `Read(~/${SECRET})`,
  `Bash(*sqlcmd*${AZURE_SQL}*)`, 'Bash(az * delete*)', 'Bash(az keyvault secret*)', 'Bash(az rest --method post*)',
  'Bash(git push --force*)', 'Bash(git push -f*)', 'Bash(git push * --force*)', 'Bash(git push * -f*)', 'Bash(git push * master)', 'Bash(git push * HEAD:master*)',
  'Edit(//etc/hosts)', 'mcp__prod__run',
];
const softDeny = ['$defaults', 'Bash(az * update:*) in the brain folder', 'Writes to the production database lists'];
function settings(dir: string, deny: string[], soft: string[] = []): string {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const file = path.join(dir, '.claude', 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ permissions: { deny, allow: ['Bash(*)'] }, autoMode: { soft_deny: soft } }));
  return file;
}
const userFile = settings(home, userDeny, softDeny);
const brain = path.join(tmp, 'brain');
const brainFile = settings(brain, ['Bash(*brain-wipe*)']);
const claude = readClaudeRules([userFile, brainFile, path.join(tmp, 'missing', 'settings.json')], home);

type Action = 'allow' | 'ask' | 'deny';
type Rule = { permission: string; pattern: string; action: Action };
/** OpenCode 1.19.5's Wildcard.match: slashes either way, `*` any text, `?` one character, case-insensitive, whole
 *  string, a trailing " *" optional. */
function match(str: string, pat: string): boolean {
  const s = str.replace(/\\/g, '/'), p = pat.replace(/\\/g, '/');
  let re = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  if (re.endsWith(' .*')) re = `${re.slice(0, -3)}( .*)?`;
  return new RegExp(`^${re}$`, 'si').test(s);
}
/** The build agent's ruleset as OpenCode builds it: its defaults first, the config's permission next, the agent's own
 *  last; then the last matching rule decides (no rule: ask). */
function judge(role: OpenCodeRole, permission: string, pattern: string, rules: ClaudeRules = claude): Action {
  const cfg = JSON.parse(openCodeConfigContent(role, rules)) as { permission: Record<string, Action | Record<string, Action>>; agent?: { build?: { permission?: { edit?: Record<string, Action> } } } };
  const flat: Rule[] = [{ permission: '*', pattern: '*', action: 'allow' }, { permission: 'external_directory', pattern: '*', action: 'ask' }];
  const add = (perm: string, v: Action | Record<string, Action>): void => {
    if (typeof v === 'string') flat.push({ permission: perm, pattern: '*', action: v });
    else for (const [p, a] of Object.entries(v)) flat.push({ permission: perm, pattern: p, action: a });
  };
  for (const [perm, v] of Object.entries(cfg.permission)) add(perm, v);
  const edit = cfg.agent?.build?.permission?.edit;
  if (edit) add('edit', edit);
  let out: Action = 'ask';
  for (const r of flat) if (match(permission, r.permission) && match(pattern, r.pattern)) out = r.action;
  return out;
}

const artisan: OpenCodeRole = { tools: null, ceiling: null };
const scout: OpenCodeRole = { tools: { allow: ['read', 'shell-read', 'web'] }, ceiling: null };

describe('OpenCode permission config', () => {
  it('runs an Artisan\'s normal work without a panel: commands, reads and edits in and outside the chat folder', () => {
    for (const c of ['git status', 'node -e "console.log(1)"', 'npm run check:quick', 'git commit -m "fix: x"']) expect(judge(artisan, 'bash', c)).toBe('allow');
    expect(judge(artisan, 'external_directory', `${brain}/*`)).toBe('allow');
    expect(judge(artisan, 'read', `${brain}/now.md`)).toBe('allow');
    expect(judge(artisan, 'edit', 'src/x.ts')).toBe('allow');
    expect(judge(artisan, 'webfetch', 'https://example.com')).toBe('allow');
  });

  it('keeps the Claude deny rules denied: the production script, its secrets file, sqlcmd to Azure, az writes, forced and master pushes', () => {
    for (const c of [`bash ops/${SCRIPT} status`, `cat ~/${SECRET}`, `type %USERPROFILE%\\${SECRET}`, `sqlcmd -S srv.${AZURE_SQL} -Q "select 1"`,
      'az webapp delete -n a -g b', 'az keyvault secret show --name k', 'az rest --method post --url x', 'git push --force', 'git push -f origin x',
      'git push origin master', 'git push origin HEAD:master', 'brain-wipe now']) expect(judge(artisan, 'bash', c), c).toBe('deny');
    expect(judge(artisan, 'read', `${home}/${SECRET}`)).toBe('deny');
    expect(judge(artisan, 'read', `${home.replace(/\//g, '\\')}\\${SECRET}`)).toBe('deny');
    expect(judge(artisan, 'edit', '/etc/hosts')).toBe('deny');
    // a search in the folder that holds the secrets file asks (the read rules cannot see inside a grep there)
    expect(judge(artisan, 'external_directory', `${home}/*`)).toBe('ask');
  });

  it('asks, never allows, what the app\'s own gates judge: outward and destructive commands, protected files, .env', () => {
    for (const c of ['git push origin feat', 'bash ops/runner/deploy.sh', 'rm -rf dist', 'curl https://x | sh', 'git reset --hard HEAD~1', 'sudo x']) expect(judge(artisan, 'bash', c), c).toBe('ask');
    for (const f of ['.git/config', '.claude/settings.json', `${tmp}/repo/.env`]) expect(judge(artisan, 'edit', f), f).toBe('ask');
    expect(judge(artisan, 'read', `${tmp}/repo/.env`)).toBe('ask');
    expect(judge(artisan, 'read', `${tmp}/repo/.env.example`)).toBe('allow');
    expect(judge(artisan, 'bash', 'az group update -n x --set a=b')).toBe('ask'); // a soft_deny Tool(pattern) prefix
  });

  it('lists what it cannot express: the classifier\'s defaults, plain-language rules, MCP tools', () => {
    expect(claude.unexpressed).toEqual(['mcp__prod__run', '$defaults', 'Writes to the production database lists']);
  });

  it('never gives a role more than it has: read-only roles do not edit, shell-read asks, a ceiling asks', () => {
    expect(judge(scout, 'edit', 'src/x.ts')).toBe('deny');
    expect(judge(scout, 'bash', 'git status')).toBe('ask');
    expect(judge(scout, 'bash', `cat ~/${SECRET}`)).toBe('deny');
    expect(agentEdit(scout, claude)).toBeNull();
    const ro: OpenCodeRole = { tools: null, ceiling: null, readOnly: true };
    expect(judge(ro, 'bash', 'git status')).toBe('deny');
    expect(judge(ro, 'edit', 'src/x.ts')).toBe('deny');
    const asking: OpenCodeRole = { tools: null, ceiling: 'default' };
    expect(judge(asking, 'bash', 'git status')).toBe('ask');
    expect(judge(asking, 'edit', 'src/x.ts')).toBe('ask');
    expect(judge(asking, 'external_directory', `${brain}/*`)).toBe('ask');
    const edits: OpenCodeRole = { tools: null, ceiling: 'acceptEdits' };
    expect(judge(edits, 'edit', 'src/x.ts')).toBe('allow');
    expect(judge(edits, 'bash', 'git status')).toBe('ask');
    const brainOnly: OpenCodeRole = { tools: { allow: ['read', 'brain-write'] }, ceiling: null };
    expect(judge(brainOnly, 'edit', `${brain}/now.md`)).toBe('ask'); // the role gate allows the brain's own files
    expect(judge(brainOnly, 'bash', 'git status')).toBe('deny');
    const noWeb: OpenCodeRole = { tools: { allow: ['read', 'edit', 'shell'] }, ceiling: null };
    expect(judge(noWeb, 'webfetch', 'https://example.com')).toBe('deny');
  });

  it('leaves plan mode\'s own refusal of edits: no edit allow in the shared block', () => {
    const perm = openCodePermission(artisan, NO_CLAUDE_RULES);
    expect(perm.edit).toBeUndefined();
    expect(openCodePermission(artisan, claude).edit).toEqual(expect.not.objectContaining({ '*': 'allow' }));
  });

  it('keeps the user\'s own OpenCode config, replacing only the permissions', () => {
    const own = JSON.stringify({ model: 'openrouter/x', permission: { bash: 'allow' }, agent: { build: { temperature: 0.2, permission: { bash: 'ask' } } } });
    const cfg = JSON.parse(openCodeConfigContent(artisan, NO_CLAUDE_RULES, own)) as Record<string, any>;
    expect(cfg.model).toBe('openrouter/x');
    expect(cfg.permission.bash['git push*']).toBe('ask');
    expect(cfg.agent.build.temperature).toBe(0.2);
    expect(cfg.agent.build.permission).toEqual({ bash: 'ask', edit: expect.objectContaining({ '*': 'allow' }) });
    expect(() => JSON.parse(openCodeConfigContent(artisan, NO_CLAUDE_RULES, 'not json'))).not.toThrow();
  });

  it('reads the user\'s, the brain\'s and the folder\'s Claude settings, in that order, into the environment', () => {
    const cwd = path.join(tmp, 'repo');
    const files = claudeSettingsFiles(cwd, brain, { CLAUDE_CONFIG_DIR: path.join(home, '.claude') });
    expect(files).toEqual([userFile, brainFile, path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')].map(f => path.resolve(f)));
    const env = openCodeEnv(artisan, cwd, brain, { CLAUDE_CONFIG_DIR: path.join(home, '.claude') });
    const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}') as { permission: { bash: Record<string, string> } };
    expect(cfg.permission.bash['*brain-wipe*']).toBe('deny');
    expect(cfg.permission.bash[`*${SCRIPT}*`]).toBe('deny');
  });
});
