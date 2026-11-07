// OpenCode's permissions for one app chat (ADR 0221): its own config, passed at every start as OPENCODE_CONFIG_CONTENT
// (read by `opencode acp` 1.19.5 after the user's global and project configs, so its rules come last and win), never a
// file. Normal work within the role's limits runs without a panel, the way a Claude chat in auto mode does; what Claude
// is denied stays denied (the user's and the brain's Claude deny rules, read here, never written: AGENTS.md rule 6);
// what the app's own gates must judge (destructive or outward commands, edits of a narrowed role) still asks, and its
// request goes through role-gate.ts and auto-permit.ts as before. Never more than the role: a class the role lacks is
// denied, a narrowed ceiling asks. OpenCode's rules: an ordered list per permission, the last match wins; `*` matches
// any text (slashes too), `?` one character, case-insensitive, backslashes read as slashes, a trailing " *" optional.
// Used by engines/sessions.ts for the engines whose registry entry says permissionConfig: 'opencode'.
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
  /** rules OpenCode cannot express (natural-language classifier rules, MCP, web domains): their tools keep asking */
  unexpressed: string[];
}
export const NO_CLAUDE_RULES: ClaudeRules = { bash: { deny: [], ask: [] }, read: { deny: [], ask: [] }, edit: { deny: [], ask: [] }, guardedDirs: [], unexpressed: [] };

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
  // a shell that reads its script from a pipe (`curl … | sh`): the app reads the whole command line and refuses it
  'sh', 'bash', 'zsh', 'pwsh', 'powershell', 'iex', 'Invoke-Expression*', 'sh -s*', 'bash -s*', '*| sh*', '*| bash*', '*|sh*', '*|bash*', '*| iex*',
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
  const m = /^([A-Za-z]+)(?:\((.*)\))?$/s.exec(rule.trim());
  if (!m) { out.unexpressed.push(rule); return; }
  const tool = m[1]!, arg = m[2];
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
  const out: ClaudeRules = { bash: { deny: [], ask: [] }, read: { deny: [], ask: [] }, edit: { deny: [], ask: [] }, guardedDirs: [], unexpressed: [] };
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

export interface OpenCodeRole {
  /** the role's tool classes (null = every class) */
  tools: AgentToolPolicy | null;
  ceiling: PermissionCeiling | null;
  /** a read-only run (a comparison's side b): reads only */
  readOnly?: boolean;
}

/** The `permission` block of OpenCode's config for one chat: shared by its build and plan agents (plan keeps its own
 *  edit refusal: no edit rule is set here when edits are allowed, they come from `agentEdit`). */
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
    webfetch: has('web') ? 'allow' : 'deny',
    websearch: has('web') ? 'allow' : 'deny',
    codesearch: has('web') ? 'allow' : 'deny',
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

/** OPENCODE_CONFIG_CONTENT for one chat: the user's own value (an object) kept, its permission and build agent's
 *  permission replaced by the app's. */
export function openCodeConfigContent(role: OpenCodeRole, claude: ClaudeRules, existing?: string): string {
  let base: Record<string, unknown> = {};
  try { if (existing) base = obj(JSON.parse(existing) as unknown); } catch { /* not JSON: the app's own config only */ }
  const edit = agentEdit(role, claude);
  const agent = obj(base.agent), build = obj(agent.build);
  return JSON.stringify({
    ...base,
    permission: openCodePermission(role, claude),
    ...(edit ? { agent: { ...agent, build: { ...build, permission: { ...obj(build.permission), edit } } } } : {}),
  });
}

/** The environment one OpenCode chat starts with: its config, built from its role and the Claude rules of its folders. */
export function openCodeEnv(role: OpenCodeRole, cwd: string, brainRoot: string | null, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const claude = readClaudeRules(claudeSettingsFiles(cwd, brainRoot, env));
  return { OPENCODE_CONFIG_CONTENT: openCodeConfigContent(role, claude, env.OPENCODE_CONFIG_CONTENT) };
}
