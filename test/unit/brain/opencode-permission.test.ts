// OpenCode's permissions for an app chat (brain/adapters/opencode-permission.ts, ADR 0232): the config passed at every
// start, judged with OpenCode's own merge and matching (a user's keys keep their place, ordered rules, last match wins)
// on every agent, so a role's normal work runs without a panel, what Claude denies stays denied whatever the user's
// OpenCode config says, and no role gets more than it has.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { agentEdit, claudeSettingsFiles, keyIn, NO_CLAUDE_RULES, openCodeConfigContent, openCodeConfigKeys, openCodeEnv, openCodePermission, readClaudeRules, type ClaudeRules, type OpenCodeRole } from '../../../src/main/brain/adapters/opencode-permission';

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
type Perm = Record<string, Action | Record<string, Action>>;
type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
/** OpenCode's config merge (remeda mergeDeep): objects key by key, a key already there keeps its place, new ones last. */
function mergeDeep(a: unknown, b: unknown): unknown {
  if (!isObj(a) || !isObj(b)) return b;
  const out: Json = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? mergeDeep(out[k], v) : v;
  return out;
}
/** An agent's `tools` (true/false) become permissions placed before its own `permission` (AgentConfig decode). */
const agentPerm = (a: unknown): Perm => {
  const o = isObj(a) ? a : {};
  const perm = typeof o.permission === 'string' ? { '*': o.permission as Action } : (o.permission ?? {}) as Perm;
  const out: Perm = {};
  for (const [t, on] of Object.entries((o.tools ?? {}) as Record<string, boolean>)) out[t === 'write' || t === 'patch' ? 'edit' : t] = on ? 'allow' : 'deny';
  return Object.assign(out, perm);
};
const ruleset = (p: Perm): Rule[] => Object.entries(p).flatMap(([perm, v]) =>
  typeof v === 'string' ? [{ permission: perm, pattern: '*', action: v }] : Object.entries(v).map(([pattern, action]) => ({ permission: perm, pattern, action })));
/** OpenCode 1.19.5's native agents: its defaults, then each agent's own (agent/agent.ts). */
const DEFAULTS: Perm = { '*': 'allow', doom_loop: 'ask', external_directory: { '*': 'ask' }, question: 'deny', plan_enter: 'deny', plan_exit: 'deny', read: { '*': 'allow', '*.env': 'ask', '*.env.*': 'ask', '*.env.example': 'allow' } };
const NATIVE: Record<string, Perm> = {
  build: { question: 'allow', plan_enter: 'allow' },
  plan: { question: 'allow', plan_exit: 'allow', task: { general: 'deny' }, edit: { '*': 'deny', '.opencode/plans/*.md': 'allow' } },
  general: { todowrite: 'deny' },
  explore: { '*': 'deny', grep: 'allow', glob: 'allow', list: 'allow', bash: 'allow', webfetch: 'allow', websearch: 'allow', read: 'allow', external_directory: { '*': 'ask' } },
};
/** One agent's ruleset as OpenCode builds it from the user's configs then the app's (merged last): defaults, the agent's
 *  own native rules, the shared `permission`, the agent's configured `permission` (the legacy `mode` merged into it);
 *  then the last matching rule decides (no rule: ask). */
function judge(role: OpenCodeRole, permission: string, pattern: string, o: { rules?: ClaudeRules; agent?: string; user?: Json } = {}): Action {
  // the app reads the user's configs first (openCodeConfigTexts) and spells its names as they do not
  const userText = JSON.stringify(o.user ?? {});
  const s = mergeDeep(o.user ?? {}, JSON.parse(openCodeConfigContent(role, o.rules ?? claude, undefined, k => keyIn(userText, k))) as unknown) as Json;
  let agents = (s.agent ?? {}) as Json;
  for (const [k, v] of Object.entries((s.mode ?? {}) as Json)) agents = mergeDeep(agents, { [k]: { ...(v as Json), mode: 'primary' } }) as Json;
  const name = o.agent ?? 'build';
  const flat = [...ruleset(DEFAULTS), ...ruleset(NATIVE[name] ?? {}), ...ruleset(agentPerm({ permission: s.permission })), ...ruleset(agentPerm(agents[name]))];
  let out: Action = 'ask';
  for (const r of flat) if (match(permission, r.permission) && match(pattern, r.pattern)) out = r.action;
  return out;
}
/** A user's OpenCode config that tries to open everything: shared, per agent, legacy mode and tools. */
const OPEN: Json = {
  permission: { '*': 'ask', bash: { '*': 'ask', 'git *': 'allow' }, edit: 'allow', task: 'allow' },
  agent: Object.fromEntries(['build', 'plan', 'general', 'explore'].map(a => [a, { tools: { bash: true, write: true }, permission: { bash: 'allow', edit: 'allow', read: 'allow', task: 'allow', external_directory: 'allow' } }])),
  mode: { build: { permission: { bash: 'allow', read: 'allow' } }, plan: { permission: { edit: 'allow' } } },
};

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

  it('lists what it cannot express: the classifier\'s defaults, plain-language rules', () => {
    expect(claude.unexpressed).toEqual(['$defaults', 'Writes to the production database lists']);
  });

  it('holds Claude\'s rules on whole tools: MCP tools by OpenCode\'s name, web fetch and search', () => {
    expect(claude.tools).toEqual({ prod_run: 'deny' });
    expect(judge(artisan, 'prod_run', '*')).toBe('deny');
    expect(judge(artisan, 'prod_other', '*')).toBe('allow');
    const file = settings(path.join(tmp, 'web'), ['WebFetch(domain:example.com)', 'WebSearch', 'mcp__crm', 'mcp__db__*', 'mcp__my.srv__drop']);
    const web = readClaudeRules([file], home);
    expect(web.tools).toEqual({ webfetch: 'ask', websearch: 'deny', codesearch: 'deny', 'crm_*': 'deny', 'db_*': 'deny', my_srv_drop: 'deny' });
    for (const agent of ['build', 'explore']) {
      expect(judge(artisan, 'webfetch', 'https://example.com', { rules: web, agent })).toBe('ask');
      expect(judge(artisan, 'websearch', 'x', { rules: web, agent })).toBe('deny');
      expect(judge(artisan, 'crm_list', '*', { rules: web, agent })).toBe('deny');
      expect(judge(artisan, 'my_srv_drop', '*', { rules: web, agent })).toBe('deny');
    }
    // a later ask never weakens a deny on the same tool
    const both = readClaudeRules([settings(path.join(tmp, 'web2'), ['WebSearch', 'WebSearch(x)'])], home);
    expect(both.tools.websearch).toBe('deny');
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

  it('keeps the user\'s own OpenCode config, the app\'s rules after its own; the chat starts on build', () => {
    const own = JSON.stringify({ model: 'openrouter/x', default_agent: 'mine', permission: { bash: 'allow' }, agent: { build: { temperature: 0.2, permission: { bash: 'ask' } } } });
    const cfg = JSON.parse(openCodeConfigContent(artisan, NO_CLAUDE_RULES, own)) as {
      model: string; default_agent: string; permission: Record<string, unknown>;
      agent: { build: { temperature: number; permission: Record<string, unknown> } };
    };
    expect(cfg.model).toBe('openrouter/x');
    expect(cfg.default_agent).toBe('build');
    expect(cfg.agent.build.temperature).toBe(0.2);
    expect(Object.keys(cfg.permission)[0]).toBe('bash');
    expect(Object.keys(cfg.agent.build.permission)[0]).toBe('bash');
    expect(cfg.agent.build.permission.bash).toBe('ask');
    expect((cfg.agent.build.permission.bAsH as Record<string, string>)['git push*']).toBe('ask');
    expect(cfg.agent.build.permission.eDiT).toEqual(expect.objectContaining({ '*': 'allow' }));
    expect(() => JSON.parse(openCodeConfigContent(artisan, NO_CLAUDE_RULES, 'not json'))).not.toThrow();
  });

  it('keeps its rules last over a user\'s OpenCode config that opens everything: shared, per agent, mode, tools', () => {
    const modeOnly: Json = { mode: { build: { permission: { bash: 'allow', read: 'allow' } }, plan: { permission: { edit: 'allow' } } } };
    for (const user of [OPEN, modeOnly]) {
      for (const agent of ['build', 'general', 'explore', 'plan']) {
        const o = { user, agent };
        for (const c of [`bash ops/${SCRIPT} status`, `sqlcmd -S srv.${AZURE_SQL} -Q "select 1"`, 'git push --force', `cat ~/${SECRET}`]) expect(judge(artisan, 'bash', c, o), `${agent} ${c}`).toBe('deny');
        expect(judge(artisan, 'read', `${home}/${SECRET}`, o), agent).toBe('deny');
        expect(judge(scout, 'bash', 'git status', o), agent).toBe('ask');
        expect(judge(scout, 'edit', 'src/x.ts', o), agent).toBe('deny');
        expect(judge(artisan, 'bash', 'git push origin feat', o), agent).toBe('ask');
      }
      expect(judge(artisan, 'edit', 'src/x.ts', { user, agent: 'plan' })).toBe('deny');
      expect(judge(artisan, 'edit', '.opencode/plans/p.md', { user, agent: 'plan' })).toBe('allow');
      expect(judge(artisan, 'edit', 'src/x.ts', { user, agent: 'explore' })).toBe('deny');
      expect(judge(artisan, 'edit', 'src/x.ts', { user, agent: 'general' })).toBe('allow');
      // the task tool starts only the native subagents: a user's own agent carries permissions the app cannot see
      expect(judge(artisan, 'task', 'mine', { user })).toBe('deny');
      expect(judge(artisan, 'task', 'general', { user })).toBe('allow');
      expect(judge(artisan, 'task', 'general', { user, agent: 'plan' })).toBe('deny');
    }
    // a user's deny on what the app allows is kept only where the app has no rule of its own: Claude's list is what holds
    expect(judge(artisan, 'bash', 'git status', { user: { permission: { bash: { 'git status': 'deny' } } } })).toBe('allow');
  });

  it('keeps its rules last over a config that holds the app\'s own spellings with its rules after them', () => {
    // the app's patterns copied under its usual spellings, then the user's allow last: a key the user has keeps its place
    const ours = (role: OpenCodeRole): Json => JSON.parse(openCodeConfigContent(role, claude)) as Json;
    const hostile = (role: OpenCodeRole): Json => {
      const a = ours(role) as { agent: Record<string, { permission: Record<string, unknown> }>; mode: Record<string, { permission: Record<string, unknown> }> };
      const open = (p: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(p).map(([k, v]) =>
        [k, typeof v === 'object' ? { ...(v as Json), [`*sqlcmd*`]: 'allow', 'src/*': 'allow', 'rm *': 'allow' } : 'allow']));
      return { agent: { build: { permission: open(a.agent.build!.permission) } }, mode: { build: { permission: open(a.mode.build!.permission) } } };
    };
    expect(judge(artisan, 'bash', `sqlcmd -S srv.${AZURE_SQL} -Q "select 1"`, { user: hostile(artisan) })).toBe('deny');
    expect(judge(scout, 'edit', 'src/x.ts', { user: hostile(scout) })).toBe('deny');
    expect(judge(scout, 'bash', 'rm -rf dist', { user: hostile(scout) })).toBe('ask');
    // no spelling free: the chat does not start
    expect(() => openCodeConfigContent(artisan, claude, undefined, () => true)).toThrow(/every spelling/);
  });

  it('reads the OpenCode configs a chat loads, the files they include too, and spells around them', () => {
    const root = path.join(tmp, 'oc');
    const cwd = path.join(root, 'repo', 'sub');
    const xdg = path.join(root, 'xdg');
    fs.mkdirSync(path.join(cwd, '.opencode', 'agent'), { recursive: true });
    fs.mkdirSync(path.join(xdg, 'opencode', 'node_modules', 'p'), { recursive: true });
    fs.writeFileSync(path.join(root, 'repo', 'opencode.jsonc'), '// c\n{ "agent": { "build": { "permission": {file:./perm.json} } } }');
    fs.writeFileSync(path.join(root, 'repo', 'perm.json'), '{ "b\\u0041sH": { "*": "allow" } }');
    fs.writeFileSync(path.join(cwd, '.opencode', 'agent', 'build.md'), '---\npermission:\n  BaSh: allow\n---\nx');
    fs.writeFileSync(path.join(xdg, 'opencode', 'opencode.json'), '{ "permission": { "eDiT": "allow" } }');
    fs.writeFileSync(path.join(xdg, 'opencode', 'node_modules', 'p', 'x.json'), '"rEaD"');
    const ocHome = path.join(root, 'home');
    const taken = openCodeConfigKeys(cwd, { XDG_CONFIG_HOME: xdg }, ocHome);
    expect(['bAsH', 'BaSh', 'eDiT'].map(taken)).toEqual([true, true, true]);
    expect(taken('rEaD')).toBe(false); // node_modules is not config
    expect(keyIn('"bAsH *": 1', 'bAsH')).toBe(true); // wider, never narrower
    expect(keyIn('"bAsHx": 1', 'bAsH')).toBe(false);
    const cfg = JSON.parse(openCodeEnv(artisan, cwd, null, { XDG_CONFIG_HOME: xdg, CLAUDE_CONFIG_DIR: path.join(root, 'none'), USERPROFILE: ocHome, HOME: ocHome }).OPENCODE_CONFIG_CONTENT ?? '{}') as { permission: Json; agent: { build: { permission: Json } } };
    expect(Object.keys(cfg.agent.build.permission).filter(k => k.toLowerCase() === 'bash')).toEqual([expect.not.stringMatching(/^(bAsH|BaSh)$/)]);
    expect(Object.keys(cfg.agent.build.permission)).toContain('EdIt');
    expect(Object.keys(cfg.agent.build.permission)).not.toContain('eDiT');
  });

  it('reads a config as OpenCode reads it: placeholders, escapes, big files, links; what it cannot read stops the chat', () => {
    const root = path.join(tmp, 'oc2');
    const cwd = path.join(root, 'repo');
    const oc = path.join(cwd, '.opencode');
    const keys = (env: NodeJS.ProcessEnv = {}): ((k: string) => boolean) => openCodeConfigKeys(cwd, { XDG_CONFIG_HOME: path.join(root, 'xdg'), ...env }, path.join(root, 'home'));
    fs.mkdirSync(path.join(oc, 'agent', 'a', 'b', 'c'), { recursive: true });
    fs.mkdirSync(path.join(root, 'linked'), { recursive: true });
    // a key built around a placeholder: an unset variable reads as '', a set one as its value, a file as its text
    fs.writeFileSync(path.join(cwd, 'opencode.json'), '{ "agent": { "build": { "permission": { "bA{env:SB_NONE}sH": "allow", "{env:SB_KEY}": "allow", "Ex{file:./k.txt}": "allow" } } } }');
    fs.writeFileSync(path.join(cwd, 'k.txt'), 'TeRnAl_DiReCtOrY\n');
    let taken = keys({ SB_KEY: 'BaSh' });
    expect(['bAsH', 'BaSh', 'bA', 'ExTeRnAl_DiReCtOrY'].map(taken)).toEqual([true, true, true, true]);
    expect(taken('bAsh')).toBe(false);
    // YAML front matter escapes, deep agent folders, a 3 MB file, a linked agent folder
    fs.writeFileSync(path.join(oc, 'agent', 'a', 'b', 'c', 'build.md'), '---\npermission:\n  "r\\U00000045aD": allow\n  "eD\\\n    iT": allow\n---\nx');
    fs.writeFileSync(path.join(oc, 'opencode.json'), `{ "permission": { "tAsK": "allow" } }${' '.repeat(3_000_000)}`);
    fs.writeFileSync(path.join(root, 'linked', 'plan.md'), '---\npermission:\n  wEbFeTcH: allow\n---\n');
    fs.symlinkSync(path.join(root, 'linked'), path.join(oc, 'agents'), 'junction');
    taken = keys();
    expect(['rEaD', 'eDiT', 'tAsK', 'wEbFeTcH'].map(taken)).toEqual([true, true, true, true]);
    // an escaped line break of a lone CR, or followed by blank lines, joins the key too
    expect(['? "bA\\\rsH"', '? "bA\\\n\n  \r\n sH"', '? "bA\\\r\n\tsH"'].map(t => keyIn(t, 'bAsH'))).toEqual([true, true, true]);
    // JavaScript front matter (OpenCode runs it) or a config that reads the app's own config: the chat does not start
    fs.writeFileSync(path.join(oc, 'agent', 'js.md'), '---js\n{ permission: { ["b" + "AsH"]: "allow" } }\n---\n');
    expect(() => keys()).toThrow(/front matter/);
    fs.rmSync(path.join(oc, 'agent', 'js.md'));
    // a YAML tag that builds a key the text does not show (`!!binary YkFzSA==` is `bAsH`), or one a directive renames
    for (const [file, body] of [['bin.md', '---\npermission:\n  ? !!binary YkFzSA==\n  : allow\n---\n'], ['tag.md', '---\n%TAG !b! tag:yaml.org,2002:bin\nx: 1\n---\n'],
      ['verbatim.md', '---\n? !<tag:yaml.org,2002:binary> YkFzSA==\n: allow\n---\n']]) {
      fs.writeFileSync(path.join(oc, 'agents', file!), body!);
      expect(() => keys(), file).toThrow(/YAML tag/);
      fs.rmSync(path.join(oc, 'agents', file!));
    }
    // the prompt below the front matter is not YAML: its `!` words do not stop the chat
    fs.writeFileSync(path.join(oc, 'agents', 'prose.md'), '---\ndescription: x\n---\ntype !<history>\n!%d is printf\nNever commit !binary files.\n%TAG\n');
    expect(() => keys()).not.toThrow();
    fs.rmSync(path.join(oc, 'agents', 'prose.md'));
    // nor does a local `!binary` (an unknown tag, never the binary type) named in the front matter's text
    fs.writeFileSync(path.join(oc, 'agents', 'note.md'), '---\ndescription: "Avoid !binary files" # !binary\nprompt: |\n  skip !binary and !%d\n---\n');
    expect(() => keys()).not.toThrow();
    fs.rmSync(path.join(oc, 'agents', 'note.md'));
    expect(keyIn('[permission.bAsH]\npermission.eDiT = "allow"', 'bAsH') && keyIn('permission.eDiT = 1', 'eDiT')).toBe(true); // TOML dotted keys
    fs.writeFileSync(path.join(oc, 'opencode.jsonc'), '{ "x": {env:OPENCODE_CONFIG_CONTENT} }');
    expect(() => keys()).toThrow(/OPENCODE_CONFIG_CONTENT/);
  });

  it('asks, never allows, an interpreter given code on the command line: a deny rule cannot see inside it', () => {
    for (const c of ['bash -c "x"', 'sh -c x', 'pwsh -c Remove-AzResource -Id x', 'powershell -Command "Invoke-Sqlcmd x"', 'powershell.exe -c x', 'cmd /c x',
      'C:\\Windows\\System32\\cmd.exe /c x', 'python -c "import os"', 'python3 -c x', 'py -c x', `node -e "require('child_process').execSync('x')"`,
      'node -e "eval(atob(\'eA==\'))"', 'node -p "require(\'child_process\')"', 'node --require ./x.js app.js', 'env X=1 bash', 'xargs rm', 'bash script.sh']) {
      expect(judge(artisan, 'bash', c), c).toBe('ask');
    }
    for (const c of ['node -e "console.log(1)"', 'node scripts/build.mjs', 'python scripts/x.py']) expect(judge(artisan, 'bash', c), c).toBe('allow');
  });

  it('reads the user\'s, the brain\'s and the folder\'s Claude settings, in that order, into the environment', () => {
    const cwd = path.join(tmp, 'repo');
    const files = claudeSettingsFiles(cwd, brain, { CLAUDE_CONFIG_DIR: path.join(home, '.claude') });
    expect(files).toEqual([userFile, brainFile, path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')].map(f => path.resolve(f)));
    const env = openCodeEnv(artisan, cwd, brain, { CLAUDE_CONFIG_DIR: path.join(home, '.claude'), USERPROFILE: home, HOME: home, OPENCODE_TEST_MANAGED_CONFIG_DIR: 'x', OPENCODE_TEST_HOME: 'y', OPENCODE_PERMISSION: '{"bash":"allow"}', opencode_permission: '{}', OPENCODE_CONFIG_CONTENT: '{"model":"m"}' });
    const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}') as { model: string; permission: { bAsH: Record<string, string> } };
    expect(cfg.permission.bAsH['*brain-wipe*']).toBe('deny');
    expect(cfg.permission.bAsH[`*${SCRIPT}*`]).toBe('deny');
    expect(cfg.model).toBe('m');
    // OpenCode merges OPENCODE_PERMISSION after every config: the spawn leaves it out (undefined), in any spelling
    expect(env).toHaveProperty('OPENCODE_PERMISSION', undefined);
    expect(env).toHaveProperty('opencode_permission', undefined);
    expect(env).toHaveProperty('OPENCODE_TEST_MANAGED_CONFIG_DIR', undefined); // it moves the folder read after the app's
    expect(env).toHaveProperty('OPENCODE_TEST_HOME', undefined);
  });
});
