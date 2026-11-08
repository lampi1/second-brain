// OpenCode's permissions for one app chat (ADR 0221): its own config, passed at every start as OPENCODE_CONFIG_CONTENT,
// never a file. Normal work within the role's limits runs without a panel, the way a Claude chat in auto mode does; what
// Claude is denied stays denied (the user's and the brain's Claude deny rules, read here, never written: AGENTS.md rule
// 6); what the app's own gates must judge (destructive, outward or opaque commands, edits of a narrowed role) still
// asks, and its request goes through role-gate.ts and auto-permit.ts as before. Never more than the role: a class the
// role lacks is denied, a narrowed ceiling asks. OpenCode's rules: an ordered list per permission, the last match wins;
// `*` matches any text (slashes too), `?` one character, case-insensitive (names too), backslashes read as slashes, a
// trailing " *" optional. `opencode acp` 1.19.5 merges this config after the user's global and project configs, but its
// merge keeps a key the user already has in the user's place, and an agent's own `permission` comes after the shared
// one: so the app's rules go on every agent the chat can run, under permission names spelled as no config of the chat
// spells them (`bAsH`, checked against the configs OpenCode will load), new keys that land after the user's. Used by
// engines/sessions.ts for the engines whose registry entry says permissionConfig: 'opencode'.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentToolPolicy, PermissionCeiling } from '../../../shared/agents';

type Action = 'allow' | 'ask' | 'deny';
type Rules = Record<string, Action>;
export type OpenCodePermission = Record<string, Action | Rules>;

/** The Claude rules that carry over: what never runs (deny) and what the auto-mode classifier holds back (ask). */
export interface ClaudeRules {
  bash: { deny: string[]; ask: string[] };
  read: { deny: string[]; ask: string[] };
  edit: { deny: string[]; ask: string[] };
  /** folders whose own files a rule protects: a tool pointed at the folder itself asks (a search there could read them) */
  guardedDirs: string[];
  /** whole tools by their OpenCode name: web fetch and search (a domain or query rule asks), MCP tools (`mcp__s__t` is
   *  OpenCode's `s_t`, a whole server `s_*`) */
  tools: Record<string, 'deny' | 'ask'>;
  /** rules OpenCode cannot express (`$defaults`, natural-language classifier rules): nothing stands for them on
   *  OpenCode (ADR 0221, the known limits) */
  unexpressed: string[];
}
export const NO_CLAUDE_RULES: ClaudeRules = { bash: { deny: [], ask: [] }, read: { deny: [], ask: [] }, edit: { deny: [], ask: [] }, guardedDirs: [], tools: {}, unexpressed: [] };

/** Commands the app's own gates judge (auto-permit.ts refuses the destructive ones with a reason, lets plain local work
 *  through, asks the user the rest): ask, never allow. They mirror auto-permit's refusals plus what leaves the machine. */
export const ASK_COMMANDS: readonly string[] = [
  'rm -r*', 'rm -f*', 'rm * -r*', 'rm * -f*', 'rmdir *', 'rd *', 'del *', 'erase *', 'rimraf *', 'Remove-Item *', 'ri *', 'trash *',
  'git push*', 'git * push*', 'git reset --hard*', 'git * reset --hard*', 'git clean *', 'git * clean *', 'git branch -D*', 'git branch * -D*',
  'git branch -d* -f*', 'git stash drop*', 'git stash clear*', 'git reflog *', 'git filter-branch*', 'git filter-repo*', 'git update-ref -d*',
  'git gc --prune*', 'git config *', 'git remote *',
  'mkfs*', 'format *', 'diskpart*', 'fdisk *', 'shutdown*', 'reboot*', 'halt*', 'poweroff*', 'Stop-Computer*', 'Restart-Computer*', 'Clear-Disk*',
  'Format-Volume*', 'dd *',
  '*drop database*', '*drop schema*', '*drop table*', '*truncate table*',
  '* publish*', '* unpublish*',
  'curl *', 'wget *', 'iwr *', 'irm *', 'Invoke-WebRequest*', 'Invoke-RestMethod*', 'scp *', 'sftp *', 'ssh *', 'rsync *', 'ftp *',
  // a shell, or a script it reads from a pipe (`curl … | sh`): what it runs is a string no deny rule sees (`bash -c`,
  // `pwsh -c Remove-Az…`); the app reads the whole command line and asks or refuses
  ...['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd'].flatMap(n => [`${n} *`, `${n}.exe *`, `*/${n} *`, `*/${n}.exe *`]),
  'iex *', 'Invoke-Expression*', 'Invoke-Command*', 'Invoke-Sqlcmd*', 'Start-Process*', '*| sh*', '*| bash*', '*|sh*', '*|bash*', '*| iex*',
  // an interpreter given code on the command line; node -e stays normal work unless it can start a program or hide what
  // it runs
  ...['python', 'python3', 'py', 'perl', 'ruby', 'php'].flatMap(n => [`${n} -*`, `${n}.exe -*`, `*/${n} -*`, `*/${n}.exe -*`]),
  ...['child_process', 'spawn', 'exec', 'fork(', 'process.binding', 'process.dlopen', 'worker_threads', 'fromCharCode', 'base64', 'eval(', 'Function(',
    'import(', '--require', ' -r ', '--import', '--loader'].map(m => `*node* *${m}*`),
  'deno *', 'bun -e*', 'bun --eval*', 'env *', 'xargs *', 'nohup *', 'exec *', 'eval *', 'source *',
  // a shell script runs code the app does not read
  '*.sh', '*.sh *', 'sudo *', 'doas *',
];
/** Files whose change is the user's call (auto-permit.ts PROTECTED_*): settings, hooks, credentials, the repository.
 *  Each in both forms: OpenCode names an edit by its path relative to the worktree (`.git/config`), or absolute. */
const ASK_EDITS: readonly string[] = ['.git/*', '.claude/*', '.cursor/*', '.codex/*', '.githooks/*', '.husky/*', '.vscode/*', '.opencode/*',
  '.env', '.env.*', '.envrc', '.npmrc', '.netrc', '.gitconfig', '.mcp.json', '.gitmodules', '.guardallow', 'opencode.json*']
  .flatMap(p => [p, `*/${p}`]);

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const strs = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const slash = (p: string): string => p.replace(/\\/g, '/');

/** A Claude path pattern (gitignore style: ~/x, //abs, /x from the settings file's folder, ./x or x anywhere) as an
 *  OpenCode one, `**` folded to `*` (OpenCode's `*` already crosses folders). */
function claudePath(p: string, base: string, home: string): string {
  let out: string;
  if (p.startsWith('~/') || p === '~') out = path.join(home, p.slice(1));
  else if (p.startsWith('//')) out = p.slice(1);
  else if (/^[A-Za-z]:[\\/]/.test(p)) out = p;
  else if (p.startsWith('/')) out = path.join(base, p);
  else out = `*/${p.replace(/^\.\//, '')}`;
  return slash(out).replace(/\*\*\/?/g, '*').replace(/\/+$/, '/*');
}
/** A Claude command pattern as an OpenCode one: the legacy `prefix:*` is `prefix*`. */
const claudeCommand = (p: string): string => p.replace(/:\*$/, '*');

/** One Claude rule (`Tool(pattern)` or a bare tool name) onto out, as deny or ask; anything else is unexpressed. */
function addRule(out: ClaudeRules, rule: string, kind: 'deny' | 'ask', base: string, home: string): void {
  // a deny is never weakened by a later ask on the same tool
  const whole = (name: string, k: 'deny' | 'ask'): void => { if (out.tools[name] !== 'deny') out.tools[name] = k; };
  // OpenCode names an MCP tool server_tool, each part with anything but [A-Za-z0-9_-] as `_`
  const mcp = /^mcp__(.+?)(?:__(.+))?$/s.exec(rule.trim());
  if (mcp) {
    const safe = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_');
    whole(`${safe(mcp[1]!)}_${mcp[2] && mcp[2] !== '*' ? safe(mcp[2]) : '*'}`, kind);
    return;
  }
  const m = /^([A-Za-z]+)(?:\((.*)\))?$/s.exec(rule.trim());
  if (!m) { out.unexpressed.push(rule); return; }
  const tool = m[1]!, arg = m[2];
  const every = arg === undefined || arg === '' || arg === '*';
  // a domain or a query cannot be told apart in OpenCode's web rules: the whole tool asks
  if (tool === 'WebFetch') { whole('webfetch', every ? kind : 'ask'); return; }
  if (tool === 'WebSearch') { for (const t of ['websearch', 'codesearch']) whole(t, every ? kind : 'ask'); return; }
  if (tool === 'Bash' || tool === 'PowerShell') { out.bash[kind].push(arg === undefined || arg === '' || arg === '*' ? '*' : claudeCommand(arg)); return; }
  if (tool === 'Read' || tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const list = tool === 'Read' ? out.read : out.edit;
    if (arg === undefined || arg === '' || arg === '*' || arg === '**') { list[kind].push('*'); return; }
    const p = claudePath(arg, base, home);
    const parts = p.split('/'), name = parts.pop() ?? '', dir = parts.join('/'), last = parts[parts.length - 1] ?? '';
    // OpenCode may name the place relative to the worktree (`../../x`): its last folder and name match anywhere too
    list[kind].push(p, ...(last && !/[*?:]/.test(last) ? [`*/${last}/${name}`] : []));
    // a named file (no wildcard): any file of that name, and any command that names it (`cat ~/x`)
    if (name && !/[*?]/.test(name)) {
      list[kind].push(name, `*/${name}`);
      if (tool === 'Read' && name.length >= 4) out.bash[kind].push(`*${name}*`);
      if (tool === 'Read' && dir && !/[*?]/.test(dir)) out.guardedDirs.push(dir);
    }
    return;
  }
  out.unexpressed.push(rule);
}

/** The Claude settings files of a chat, in Claude's own order: the user's (CLAUDE_CONFIG_DIR or ~/.claude), the brain's,
 *  the chat folder's shared and local ones. */
export function claudeSettingsFiles(cwd: string, brainRoot: string | null, env: NodeJS.ProcessEnv = process.env): string[] {
  const user = env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, 'settings.json') : path.join(os.homedir(), '.claude', 'settings.json');
  const files = [user, ...(brainRoot ? [path.join(brainRoot, '.claude', 'settings.json')] : []), path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')];
  return [...new Set(files.map(f => path.resolve(f)))];
}

/** The deny rules and the auto-mode soft-deny rules of those files (read only; a missing or unreadable file adds
 *  nothing: OpenCode's own defaults and ASK_COMMANDS still hold). */
export function readClaudeRules(files: readonly string[], home: string = os.homedir()): ClaudeRules {
  const out: ClaudeRules = { bash: { deny: [], ask: [] }, read: { deny: [], ask: [] }, edit: { deny: [], ask: [] }, guardedDirs: [], tools: {}, unexpressed: [] };
  for (const file of files) {
    let j: Record<string, unknown>;
    try { j = obj(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown); } catch { continue; }
    const base = path.dirname(path.dirname(file));
    for (const r of strs(obj(j.permissions).deny)) addRule(out, r, 'deny', base, home);
    // the classifier's own rules: a `Tool(pattern)` prefix carries over as ask; plain language cannot
    for (const r of strs(obj(j.autoMode).soft_deny)) {
      if (r === '$defaults') { out.unexpressed.push(r); continue; }
      const m = /^([A-Za-z]+\(.*?\))(\s|$)/.exec(r.trim());
      if (m) addRule(out, m[1]!, 'ask', base, home); else out.unexpressed.push(r);
    }
  }
  return out;
}

const rules = (first: Action, ...layers: [readonly string[], Action][]): Rules => {
  const out: Rules = { '*': first };
  // later layers win: an object keeps the first position of a key, so a repeated pattern is moved to the end
  for (const [patterns, action] of layers) for (const p of patterns) { delete out[p]; out[p] = action; }
  return out;
};

const WEB_TOOLS: readonly string[] = ['webfetch', 'websearch', 'codesearch'];

export interface OpenCodeRole {
  /** the role's tool classes (null = every class) */
  tools: AgentToolPolicy | null;
  ceiling: PermissionCeiling | null;
  /** a read-only run (a comparison's side b): reads only */
  readOnly?: boolean;
}

/** The app's rules shared by every agent of one chat (plan keeps its own edit refusal: no edit rule is set here when
 *  edits are allowed, they come from `agentEdit`). */
export function openCodePermission(role: OpenCodeRole, claude: ClaudeRules): OpenCodePermission {
  const allow = role.tools?.allow;
  const has = (c: string): boolean => !allow || (allow as readonly string[]).includes(c);
  const narrowed = role.readOnly || role.ceiling === 'plan' || role.ceiling === 'default' || role.ceiling === 'acceptEdits';
  const shell: Action = role.readOnly ? 'deny' : has('shell') && !narrowed ? 'allow' : has('shell') || has('shell-read') ? 'ask' : 'deny';
  const guarded = claude.guardedDirs.map(d => `${d}/?`);
  const perm: OpenCodePermission = {
    // reads and commands outside the chat's folder (the brain, a sibling repo): what the role may do there is judged
    // by the read, edit and bash rules below; a folder whose own files are protected asks; «Chiede conferma» asks all
    external_directory: rules(role.ceiling === 'default' ? 'ask' : 'allow', [guarded, 'ask']),
    read: rules('allow', [['*.env', '*.env.*'], 'ask'], [['*.env.example'], 'allow'], [claude.read.ask, 'ask'], [claude.read.deny, 'deny']),
    // a search or a listing reads too: the folders a read rule protects ask (external_directory above)
    bash: rules(shell, [shell === 'allow' ? [...ASK_COMMANDS, ...claude.bash.ask] : [], 'ask'], [claude.bash.deny, 'deny']),
    webfetch: has('web') ? claude.tools.webfetch ?? 'allow' : 'deny',
    websearch: has('web') ? claude.tools.websearch ?? 'allow' : 'deny',
    codesearch: has('web') ? claude.tools.codesearch ?? 'allow' : 'deny',
    // MCP tools Claude denies or holds back
    ...Object.fromEntries(Object.entries(claude.tools).filter(([t]) => !WEB_TOOLS.includes(t))),
  };
  // edits: shared here only what never happens (plan mode keeps its own refusal of every edit); what the build agent
  // may do is agentEdit's
  if (role.readOnly || (!has('edit') && !has('brain-write'))) perm.edit = rules('deny');
  else if (claude.edit.deny.length) perm.edit = Object.fromEntries(claude.edit.deny.map(p => [p, 'deny' as const]));
  return perm;
}

/** The build agent's edit rules: a role that may edit, unnarrowed or up to acceptEdits, edits without asking except the protected files
 *  (asked: auto-permit.ts decides); one with brain-write only or a narrowed ceiling asks for each edit (the role gate
 *  allows the brain's, auto-permit.ts the chat folder's with a checkpoint); null = the shared block's deny holds. */
export function agentEdit(role: OpenCodeRole, claude: ClaudeRules): Rules | null {
  const allow = role.tools?.allow;
  if (role.readOnly || (allow && !allow.includes('edit') && !allow.includes('brain-write'))) return null;
  const may = (role.ceiling === null || role.ceiling === 'acceptEdits') && (!allow || allow.includes('edit'));
  return rules(may ? 'allow' : 'ask', [may ? [...ASK_EDITS, ...claude.edit.ask] : [], 'ask'], [claude.edit.deny, 'deny']);
}

/** Plan's own files (OpenCode's plan agent writes its plan there, in the project or in its data folder): the only edit
 *  plan mode makes. */
const PLAN_FILES: readonly string[] = ['.opencode/plans/*.md', '*/.opencode/plans/*.md', '*/opencode/plans/*.md'];

/** Every agent an app chat can run, with the app's whole ruleset: build (work), plan (the plan ceiling, read-only runs),
 *  the subagents its task tool may start (general works like build, explore only reads), the hidden ones (no tools).
 *  The task tool starts no other agent: a user's own agent carries its own permissions, which the app cannot see. */
export function agentPermissions(role: OpenCodeRole, claude: ClaudeRules): Record<string, OpenCodePermission> {
  const shared = openCodePermission(role, claude);
  const { edit: sharedEdit, ...noEdit } = shared;
  const work = agentEdit(role, claude) ?? sharedEdit ?? rules('deny');
  const denied = [claude.edit.deny, 'deny'] as [readonly string[], Action];
  const planEdit = agentEdit(role, claude) ? rules('deny', [PLAN_FILES, 'allow'], denied) : sharedEdit ?? rules('deny');
  const subagents = (...names: string[]): Rules => rules('deny', [names, 'allow']);
  return {
    build: { ...noEdit, edit: work, task: subagents('general', 'explore') },
    general: { ...noEdit, edit: work, task: subagents() },
    plan: { ...noEdit, edit: planEdit, task: subagents('explore') },
    explore: { ...noEdit, edit: rules('deny'), task: subagents() },
    ...Object.fromEntries(['compaction', 'title', 'summary'].map(a => [a, { '*': 'deny' as const }])),
  };
}

/** A permission name as no config spells it (`bAsH`, or `BaSh` for the second place): OpenCode matches names without
 *  case, and its config merge appends a key the user's object lacks after the user's keys. `*` has no case: `**` and
 *  `***` (the same pattern). */
export const spelled = (name: string, second = false): string => /[a-z]/i.test(name)
  ? [...name].map((c, i) => (i % 2 === 1) !== second ? c.toUpperCase() : c.toLowerCase()).join('')
  : '*'.repeat(second ? 3 : 2);

/** The spellings a name may take, the usual two first: its letters in other cases (never all lower, the usual key), or
 *  longer runs of `*`. */
function spellings(name: string): string[] {
  const letters = [...name].flatMap((c, i) => /[a-z]/i.test(c) ? [i] : []);
  if (!letters.length) return Array.from({ length: 39 }, (_, k) => '*'.repeat(k + 2));
  const out = new Set([spelled(name), spelled(name, true)]);
  for (let m = 1; m < 2 ** Math.min(letters.length, 9) && out.size < 256; m++) {
    const cs = [...name.toLowerCase()];
    letters.forEach((at, j) => { if (j < 9 && m & (1 << j)) cs[at] = cs[at]!.toUpperCase(); });
    out.add(cs.join(''));
  }
  return [...out].filter(s => s !== name.toLowerCase());
}

/** For every name the app sets, two spellings no OpenCode config of the chat uses as a key (`taken`): a key the user
 *  has keeps the user's place in the merge, so a config holding the app's spelling with its own rules after it would
 *  outrank the app. None free (a config holding all of them): the chat does not start. */
function spellingsFor(names: Iterable<string>, taken: (key: string) => boolean): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>();
  for (const name of names) {
    if (out.has(name)) continue;
    const free = spellings(name).filter(s => !taken(s));
    if (free.length < 2) throw new Error(`OpenCode: every spelling of the permission "${name}" is already a key in an OpenCode config of this chat`);
    out.set(name, [free[0]!, free[1]!]);
  }
  return out;
}

/** OPENCODE_CONFIG_CONTENT for one chat: the user's own value (an object) kept, the app's rules added after its own on
 *  the shared block and on every agent; the legacy `mode.build` / `mode.plan` (merged into the agent after `agent`) get
 *  them under the second spelling. The chat starts on build, whatever the user's default agent. `taken` says whether
 *  an OpenCode config the chat loads already has a key (openCodeKeyTaken). */
export function openCodeConfigContent(role: OpenCodeRole, claude: ClaudeRules, existing?: string, taken: (key: string) => boolean = () => false): string {
  let base: Record<string, unknown> = {};
  try { if (existing) base = obj(JSON.parse(existing) as unknown); } catch { /* not JSON: the app's own config only */ }
  const perms = agentPermissions(role, claude);
  const shared = openCodePermission(role, claude);
  const ownKeys = existing ?? '';
  const names = spellingsFor([...Object.keys(shared), ...Object.values(perms).flatMap(p => Object.keys(p))], k => taken(k) || keyIn(ownKeys, k));
  const spell = (perm: OpenCodePermission, second = false): OpenCodePermission =>
    Object.fromEntries(Object.entries(perm).map(([k, v]) => [names.get(k)![second ? 1 : 0], v]));
  const add = (own: unknown, perm: OpenCodePermission, second = false): Record<string, unknown> =>
    ({ ...obj(own), permission: { ...obj(obj(own).permission), ...spell(perm, second) } });
  const agent: Record<string, unknown> = { ...obj(base.agent) }, mode: Record<string, unknown> = { ...obj(base.mode) };
  for (const [name, perm] of Object.entries(perms)) agent[name] = add(agent[name], perm);
  for (const name of ['build', 'plan']) mode[name] = add(mode[name], perms[name]!, true);
  return JSON.stringify({
    ...base,
    default_agent: 'build',
    permission: { ...obj(base.permission), ...spell(shared) },
    agent,
    mode,
  });
}

const KEY_CHAR = 'A-Za-z0-9_*?.\\-';
/** Whether a config text holds a key as a whole word (quoted JSON, bare or quoted YAML), its `\u`/`\x` escapes read:
 *  wider than a parse, never narrower. */
export function keyIn(text: string, key: string): boolean {
  if (!text) return false;
  const plain = text.replace(/\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g, (_, u: string | undefined, x: string | undefined) => String.fromCharCode(parseInt(u ?? x ?? '0', 16)));
  return new RegExp(`(^|[^${KEY_CHAR}])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^${KEY_CHAR}])`).test(plain);
}

/** The text of every OpenCode config a chat in `cwd` loads before the app's (1.19.5, read in its binary): the global
 *  folder (XDG config `opencode`), OPENCODE_CONFIG, `opencode.json(c)` and the `.opencode` folders (json, agent and mode
 *  files) from the chat folder up, `~/.opencode`, OPENCODE_CONFIG_DIR, and the files they pull in with `{file:…}`.
 *  More than OpenCode reads (up to the drive root, every json/md under those folders), never less. Read only. */
export function openCodeConfigTexts(cwd: string, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string[] {
  const files = new Set<string>();
  const dir = (d: string, depth = 0): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.size > 2000) return;
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 3 && e.name !== 'node_modules' && e.name !== '.git') dir(p, depth + 1);
      else if (e.isFile() && /\.(jsonc?|md)$/i.test(e.name)) files.add(p);
    }
  };
  const xdg = env.XDG_CONFIG_HOME || path.join(home, '.config');
  dir(path.join(xdg, 'opencode'));
  dir(path.join(home, '.opencode'));
  if (env.OPENCODE_CONFIG) files.add(path.resolve(env.OPENCODE_CONFIG));
  if (env.OPENCODE_CONFIG_DIR) dir(path.resolve(env.OPENCODE_CONFIG_DIR));
  for (let d = path.resolve(cwd), up = ''; d !== up; up = d, d = path.dirname(d)) {
    for (const f of ['opencode.json', 'opencode.jsonc']) files.add(path.join(d, f));
    dir(path.join(d, '.opencode'));
  }
  const texts: string[] = [];
  const queue = [...files], seen = new Set<string>();
  while (queue.length && seen.size < 3000) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    seen.add(f);
    let text: string;
    try { if (fs.statSync(f).size > 2_000_000) continue; text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    texts.push(text);
    for (const m of text.matchAll(/\{file:([^}]+)\}/g)) {
      const ref = m[1]!.trim();
      queue.push(ref.startsWith('~/') ? path.join(home, ref.slice(2)) : path.resolve(path.dirname(f), ref));
    }
  }
  return texts;
}

/** The environment one OpenCode chat starts with: its config, built from its role and the Claude rules of its folders.
 *  OPENCODE_PERMISSION (merged by OpenCode after every config) is dropped from the app's own environment (undefined: the
 *  spawn leaves it out), in any spelling (Windows names have no case). */
export function openCodeEnv(role: OpenCodeRole, cwd: string, brainRoot: string | null, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const claude = readClaudeRules(claudeSettingsFiles(cwd, brainRoot, env));
  const named = (n: string): string[] => Object.keys(env).filter(k => k.toUpperCase() === n);
  const own = named('OPENCODE_CONFIG_CONTENT').map(k => env[k]).find(v => v);
  const texts = openCodeConfigTexts(cwd, env);
  return {
    ...Object.fromEntries([...named('OPENCODE_PERMISSION'), ...named('OPENCODE_CONFIG_CONTENT')].map(k => [k, undefined])),
    OPENCODE_CONFIG_CONTENT: openCodeConfigContent(role, claude, own, key => texts.some(t => keyIn(t, key))),
    OPENCODE_PERMISSION: undefined,
  };
}
