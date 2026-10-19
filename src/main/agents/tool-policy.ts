// Per-agent tool policy and permission ceiling, enforced in main (AGENTS-DESIGN §4.1.1). Both only narrow: a run never
// gets more than Brother's own mode and the engine's existing gates. What an engine cannot enforce is reported, never
// silently claimed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EngineKind, PermissionMode } from '../../shared/contract';
import type { CodexExecutionPolicy } from '../brain/adapters/codex-policy';
import { PERMISSION_CEILINGS, TOOL_CLASSES, type AgentToolPolicy, type PermissionCeiling, type ToolClass } from '../../shared/agents';

export interface AgentPolicy { tools: AgentToolPolicy | null; ceiling: PermissionCeiling | null }
/** Used when a stored policy is unreadable: the narrowest run, never an unrestricted one. */
export const FAIL_CLOSED: AgentPolicy = { tools: { allow: ['read'] }, ceiling: 'plan' };

const MCP_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const has = <T>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** null/omitted inherits the engine defaults. A policy can only list known classes; MCP servers need the 'mcp' class. */
export function checkedTools(value: unknown): AgentToolPolicy | null {
  if (value === undefined || value === null) return null;
  const t = obj(value);
  if (!Array.isArray(t.allow) || t.allow.length > TOOL_CLASSES.length || !t.allow.every(c => has(TOOL_CLASSES, c)) || new Set(t.allow).size !== t.allow.length) throw new Error('Strumenti dell’Agente non validi.');
  if (t.mcp === undefined) return { allow: [...t.allow] as ToolClass[] };
  if (!Array.isArray(t.mcp) || t.mcp.length > 32 || !t.mcp.every(n => typeof n === 'string' && MCP_NAME.test(n)) || new Set(t.mcp).size !== t.mcp.length || !t.allow.includes('mcp')) throw new Error('Server MCP dell’Agente non validi.');
  return { allow: [...t.allow] as ToolClass[], mcp: [...t.mcp] as string[] };
}
export const hasPolicy = (p: AgentPolicy | null | undefined): p is AgentPolicy => !!p && (p.tools !== null || p.ceiling !== null);

/** Stored copy on a chat (chats.json): present but invalid → FAIL_CLOSED, so a damaged file never widens a run. */
export function readPolicy(v: unknown): AgentPolicy | null {
  if (v === undefined) return null;
  try {
    const p = obj(v);
    if (!(p.ceiling === null || has(PERMISSION_CEILINGS, p.ceiling))) throw new Error('ceiling');
    const policy: AgentPolicy = { tools: checkedTools(p.tools), ceiling: p.ceiling as PermissionCeiling | null };
    return hasPolicy(policy) ? policy : null;
  } catch { return structuredClone(FAIL_CLOSED); }
}

const RANK: Record<PermissionMode, number> = { plan: 0, default: 1, acceptEdits: 2, auto: 3, bypassPermissions: 4 };
export const aboveCeiling = (mode: PermissionMode, ceiling: PermissionCeiling | null): boolean => ceiling !== null && RANK[mode] > RANK[ceiling];
/** A mode the CLI suggests ("Sempre" → setMode): unknown modes count as above any ceiling. */
export const suggestedAbove = (mode: unknown, ceiling: PermissionCeiling | null): boolean => ceiling !== null && (typeof mode !== 'string' || !(mode in RANK) || aboveCeiling(mode as PermissionMode, ceiling));

/** The wider class that includes a narrower one: a parent with `shell` may give `shell-read`, `browser` gives
 *  `browser-read`, `edit` (anywhere) gives `brain-write`. */
const INCLUDED_BY: Partial<Record<ToolClass, ToolClass>> = { 'shell-read': 'shell', 'browser-read': 'browser', 'brain-write': 'edit' };
const covers = (allow: readonly ToolClass[], c: ToolClass): boolean => allow.includes(c) || (INCLUDED_BY[c] !== undefined && allow.includes(INCLUDED_BY[c]!));

/** The narrower of two policies (a chat never runs wider than the chat it comes from): the classes both sides allow (a
 *  narrower class kept when the other side has its wider one: Scout's shell-read under an Artisan's shell), the MCP
 *  names in both, the lower ceiling; a missing side leaves the other as it is. */
export function narrowest(a: AgentPolicy | null | undefined, b: AgentPolicy | null | undefined): AgentPolicy | null {
  if (!hasPolicy(a)) return hasPolicy(b) ? b : null;
  if (!hasPolicy(b)) return a;
  const ceiling = a.ceiling === null ? b.ceiling : b.ceiling === null ? a.ceiling : RANK[a.ceiling] <= RANK[b.ceiling] ? a.ceiling : b.ceiling;
  if (!a.tools || !b.tools) return { tools: a.tools ?? b.tools, ceiling };
  const bt = b.tools;
  const allow = [...new Set([...a.tools.allow.filter(c => covers(bt.allow, c)), ...bt.allow.filter(c => covers(a.tools!.allow, c))])];
  const mcp = !allow.includes('mcp') ? undefined : a.tools.mcp && bt.mcp ? a.tools.mcp.filter(n => bt.mcp!.includes(n)) : a.tools.mcp ?? bt.mcp;
  // two named lists with no server in common leave none, not every one
  if (mcp && !mcp.length) return { tools: { allow: allow.filter(c => c !== 'mcp') }, ceiling };
  return { tools: { allow, ...(mcp ? { mcp } : {}) }, ceiling };
}
/** A delegated chat's policy (agent_delegate): its role's, narrowed by its parent's tools and ceiling and by the mode the
 *  parent runs in now (a parent in plan mode delegates in plan mode). Permissions only go down the tree. */
export function belowParent(role: AgentPolicy | null | undefined, parent: AgentPolicy | null | undefined, parentMode: PermissionMode | null): AgentPolicy | null {
  const p = narrowest(role, parent);
  if (!parentMode || !(PERMISSION_CEILINGS as readonly string[]).includes(parentMode)) return p;
  const mode = parentMode as PermissionCeiling;
  if (!p) return { tools: null, ceiling: mode };
  return p.ceiling === null || RANK[mode] < RANK[p.ceiling] ? { ...p, ceiling: mode } : p;
}
/** The tool class a permission request belongs to, from the tool's name as the engines report it (Claude's tools, Cursor's
 *  ACP kinds, Codex's command and file-change approvals, other MCP servers); null = not a class the policy names. */
export function toolClassOf(tool: string): ToolClass | null {
  // the app's own servers already serve each chat only what its policy allows (browser/service.ts, appctl)
  if (/^mcp__second-brain(?:-app)?__/.test(tool)) return null;
  if (/^mcp__/.test(tool)) return 'mcp';
  if (['Read', 'Grep', 'Glob', 'Search', 'LS'].includes(tool)) return 'read';
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Delete', 'Move', 'FileChange', 'ApplyPatch'].includes(tool)) return 'edit';
  if (['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'Shell', 'Command', 'TaskOutput', 'TaskStop', 'Monitor'].includes(tool)) return 'shell';
  if (['WebFetch', 'WebSearch', 'Fetch'].includes(tool)) return 'web';
  return null;
}
/** True when the policy allows that class (shell-read stands for shell here: its commands are checked one by one). */
export function allowsClass(p: AgentPolicy | null | undefined, c: ToolClass): boolean {
  if (!p?.tools) return true;
  const allow = p.tools.allow;
  if (allow.includes(c)) return true;
  if (c === 'shell') return allow.includes('shell-read');
  if (c === 'browser') return allow.includes('browser-read');
  return false;
}
/** True when `child` is `parent` or a folder inside it, links resolved (a delegated chat never leaves its parent's folder). */
export function within(parent: string, child: string): boolean {
  if (!child || !path.isAbsolute(child) || !path.isAbsolute(parent)) return false;
  // a link inside the parent's folder that points outside it is outside
  const real = (p: string): string => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const rel = path.relative(real(parent), real(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/** min(ceiling, Brother's mode). `brother` = the chat's explicit choice, else his settings' default (never a guess). */
export function clampMode(brother: PermissionMode, ceiling: PermissionCeiling | null): PermissionMode {
  return aboveCeiling(brother, ceiling) ? ceiling! : brother;
}

/**
 * Claude's own default mode for a folder: the last valid `permissions.defaultMode` of user, project and local settings
 * (the CLI's precedence, managed settings aside), else 'default'. Needed because `--permission-mode` replaces it.
 */
export function claudeDefaultMode(cwd: string, env: NodeJS.ProcessEnv = process.env): PermissionMode {
  const user = env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, 'settings.json') : path.join(os.homedir(), '.claude', 'settings.json');
  let mode: PermissionMode = 'default';
  for (const file of [user, path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')]) {
    try {
      const m = obj(obj(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown).permissions).defaultMode;
      if (typeof m === 'string' && m in RANK) mode = m as PermissionMode;
    } catch { /* missing or unreadable: the next layer or the CLI default */ }
  }
  return mode;
}

/** Claude built-in tools per class. Always kept: planning and asking Brother. Subagents (Task) are left out: their tools
 *  are not bounded by `--tools`. Names checked against the embedded CLI (2026-10-17). */
const CLAUDE_BASE = ['TodoWrite', 'AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode', 'ToolSearch'];
const CLAUDE_TOOLS: Partial<Record<ToolClass, readonly string[]>> = {
  read: ['Read', 'Grep', 'Glob'],
  edit: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  shell: ['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'TaskOutput', 'TaskStop', 'Monitor'],
  // the same command tools; every command the engine asks to run is checked by readOnlyCommand (manager.ts)
  'shell-read': ['Bash', 'PowerShell', 'BashOutput'],
  web: ['WebFetch', 'WebSearch'],
  // edits limited to the brain folder: every Edit/Write request of a role without 'edit' is checked by the role gate
  // (agents/role-gate.ts insideBrain: real path inside the brain, no "..", no link out)
  'brain-write': ['Edit', 'Write'],
};
export function claudeTools(tools: AgentToolPolicy): string[] {
  return [...new Set([...CLAUDE_BASE, ...tools.allow.flatMap(c => CLAUDE_TOOLS[c] ?? [])])];
}

/** Commands only (shell-read without shell): a command request is shown to the user only when it reads, else it is
 *  refused with this reason. */
export const commandsReadOnly = (p: AgentPolicy | null | undefined): boolean => !!p?.tools && p.tools.allow.includes('shell-read') && !p.tools.allow.includes('shell');
/** The engines' tools that run a command (input.command); BashOutput/TaskOutput only read a running command's output. */
export const COMMAND_TOOLS: readonly string[] = ['Bash', 'PowerShell', 'Shell', 'Command'];
const OUTPUT_TOOLS: readonly string[] = ['BashOutput', 'TaskOutput'];
/** True when the policy lets this command-class request through: any with 'shell'; with shell-read only, a command that
 *  only reads (readOnlyCommand) or reading a command's output; nothing else (killing, monitoring, an unreadable input). */
export function shellWithin(p: AgentPolicy | null | undefined, tool: string, input: unknown, scripts?: ReadScripts): boolean {
  if (!allowsClass(p, 'shell')) return false;
  if (!commandsReadOnly(p)) return true;
  if (OUTPUT_TOOLS.includes(tool)) return true;
  return COMMAND_TOOLS.includes(tool) && readOnlyCommand((input as { command?: unknown } | null)?.command, scripts);
}

/** The brain's declared read-only tools (agents/read-tools.ts, issue #93): `node <script> [args]` reads when <script>,
 *  resolved from `cwd` with its links, is exactly one of `paths` (real paths). Anything else run by node stays refused. */
export interface ReadScripts { cwd: string; paths: readonly string[] }
const samePath = (a: string, b: string): boolean => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
/** `node <declared script> [args]`: no node option before the script (`-e`, `--require`, `--import` run other code), a
 *  plain path (no glob), and its real path one of the declared ones. */
function declaredScript(words: Word[], scripts: ReadScripts | undefined): boolean {
  const script = words[1];
  if (!scripts || !script || script.glob || !script.text || script.text.startsWith('-') || !path.isAbsolute(scripts.cwd)) return false;
  let real: string;
  try { real = fs.realpathSync.native(path.resolve(scripts.cwd, script.text)); } catch { return false; }
  return scripts.paths.some(p => samePath(p, real));
}

// sort and uniq are not here: they read stdin only (STDIN_ONLY), their operands are files they may write
const READ_COMMANDS = new Set(['ls', 'dir', 'cat', 'type', 'head', 'tail', 'grep', 'rg', 'findstr', 'wc', 'pwd', 'stat', 'file', 'tree', 'du', 'df', 'which', 'whoami',
  'cut', 'get-childitem', 'gci', 'get-content', 'gc', 'select-string', 'sls', 'get-item', 'get-location', 'test-path', 'resolve-path', 'measure-object']);
const READ_GIT = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog', 'grep']);
/** `git branch`, `git tag`, `git remote` only list with these flags; any other argument creates, moves or deletes. */
const GIT_LISTS: Record<string, ReadonlySet<string>> = {
  branch: new Set(['-a', '-r', '-v', '-vv', '--all', '--remotes', '--list', '--show-current', '--verbose']),
  tag: new Set(['-l', '--list']),
  remote: new Set(['-v', '--verbose']),
};
/** Long options that write a file or run a program (git, rg, file); refused also abbreviated (`--out=x`: git and GNU
 *  tools take any unambiguous prefix) and `--output-*`. */
const WRITING_LONG = ['output', 'open-files-in-pager', 'ext-diff', 'pre', 'hostname-bin', 'exec', 'execdir', 'compile'];
/** find's actions that write, delete or run (single dash, never abbreviated). */
const FIND_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls']);
/** Short options that write or run, per command, also inside a cluster (`-iO`, `-ao`): git grep -O<pager>, sort -o,
 *  tree -o <file> and -R (writes 00Tree.html in every folder), file -C (compiles a magic file). */
const WRITING_SHORT: Record<string, string> = { git: 'O', tree: 'oR', file: 'C' };
/** Readers whose options a file name could inject through an unquoted glob (`find *` with a file named -delete). */
const NO_GLOB = new Set(['find', 'git', 'rg', 'tree', 'file', 'sort', 'uniq']);
/** sort and uniq: only as a later pipe stage (stdin), with options that neither write nor name a file. */
interface StdinRule { flags: RegExp; withArg: RegExp; long: ReadonlySet<string> }
const STDIN_ONLY: Record<string, StdinRule> = {
  sort: { flags: /^-[bdfghinMrRsuVz]+$/, withArg: /^-[bdfghinMrRsuVz]*[kt]/,
    long: new Set(['--reverse', '--numeric-sort', '--unique', '--ignore-case', '--human-numeric-sort', '--version-sort', '--general-numeric-sort', '--month-sort', '--stable', '--ignore-leading-blanks', '--dictionary-order', '--zero-terminated']) },
  uniq: { flags: /^-[cdiuzD]+$/, withArg: /^-[cdiuzD]*[fsw]/,
    long: new Set(['--count', '--repeated', '--unique', '--ignore-case', '--zero-terminated', '--all-repeated']) },
};

interface Word { text: string; glob: boolean }
/** Splits a command line into pipe stages of words, quotes removed (a quoted `|` or space stays in its word; a
 *  backslash is dropped, so `-e\xec` reads as `-exec`). null = an unterminated quote. */
function stages(raw: string): Word[][] | null {
  let stage: Word[] = [];
  const out: Word[][] = [stage];
  let word: Word | null = null, quote: '"' | "'" | null = null;
  const end = () => { if (word) stage.push(word); word = null; };
  for (const ch of raw) {
    if (quote) { if (ch === quote) quote = null; else if (ch !== '\\') word!.text += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; word ??= { text: '', glob: false }; continue; }
    if (/\s/.test(ch)) { end(); continue; }
    if (ch === '|') { end(); stage = []; out.push(stage); continue; }
    if (ch === '\\') { word ??= { text: '', glob: false }; continue; }
    word ??= { text: '', glob: false };
    word.text += ch;
    if (ch === '*' || ch === '?' || ch === '[') word.glob = true;
  }
  if (quote) return null;
  end();
  return out;
}
const writingLong = (w: string): boolean => {
  if (!w.startsWith('--') || w === '--') return false;
  const name = (w.slice(2).split('=')[0] ?? '').toLowerCase();
  return WRITING_LONG.some(d => d.startsWith(name) || name.startsWith(`${d}-`));
};
const writingShort = (cmd: string, w: string): boolean => {
  const letters = WRITING_SHORT[cmd];
  return !!letters && /^-[^-]/.test(w) && [...letters].some(l => w.includes(l));
};
/** sort/uniq after another stage: known options only, no operand (an operand is a file to read or to write). */
function stdinOnly(rule: StdinRule, args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const w = args[i] ?? '';
    if (rule.long.has(w) || rule.flags.test(w)) continue;
    const m = rule.withArg.exec(w);
    if (!m) return false;
    // the option's value: the rest of the word, or the next word (a field list, a separator, a count)
    if (w.length === m[0].length) { if (++i >= args.length) return false; }
  }
  return true;
}

/** One read-only command: a known reader, `git` reading or listing, `find` without actions, `sort`/`uniq` on stdin,
 *  `node` running one of the brain's declared read-only tools (`scripts`, issue #93);
 *  no chaining, redirection, substitution, subexpression or script block, and a pipe only into another reader. Anything
 *  else is not read-only (refused under shell-read). Both shells count: bash and PowerShell (`(`, `@(`, `{`, `&`). */
export function readOnlyCommand(raw: unknown, scripts?: ReadScripts): boolean {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000) return false;
  // chaining, redirection, substitution (bash $( ${ backtick <( >(, PowerShell $( @( ( { and its ` escape), quoted or
  // not; a reflog ref (HEAD@{1}, @{u}) is the only brace kept: PowerShell cannot run anything in it. Any other `$` is
  // refused too: an unquoted $IFS splits `find .$IFS-delete` into a writing option after this check, and a variable
  // ($HOME, PowerShell's $env:x) or bash's $'…' quoting would make the words differ from what is checked here
  const plain = raw.replace(/@\{[A-Za-z0-9_.:/-]*\}/g, '');
  if (/[;&<>`(){}$\r\n]/.test(plain)) return false;
  // an escaped quote: bash keeps \" inside a double-quoted word, PowerShell ends it there; the two would split the line
  // differently, so neither reading is trusted
  if (/\\["']/.test(raw)) return false;
  const parts = stages(raw);
  if (!parts) return false;
  return parts.every((words, stage) => {
    const cmd = words[0]?.text.toLowerCase().replace(/\.exe$/, '');
    if (!cmd) return false;
    const args = words.slice(1);
    if (NO_GLOB.has(cmd) && args.some(w => w.glob)) return false;
    const texts = args.map(w => w.text);
    if (texts.some(w => writingLong(w) || writingShort(cmd, w) || FIND_ACTIONS.has(w.toLowerCase()))) return false;
    if (cmd === 'node') return declaredScript(words, scripts);
    const stdin = STDIN_ONLY[cmd];
    if (stdin) return stage > 0 && stdinOnly(stdin, texts);
    if (cmd === 'git') {
      const [sub, ...rest] = texts;
      if (!sub) return false;
      const lists = GIT_LISTS[sub];
      return lists ? rest.every(w => lists.has(w)) : READ_GIT.has(sub);
    }
    return cmd === 'find' || READ_COMMANDS.has(cmd);
  });
}

/** The app's own browser tools (second-brain MCP) are served per chat, on every engine: 'browser' = all of them,
 *  'browser-read' = only the ones that look (tabs, navigate, read, screenshot, scroll: never click, type, forms,
 *  dialogs or JavaScript), neither = none. send_to_chat/list_chats stay (the chat must reach its parent). */
export type BrowserAccess = 'all' | 'read' | 'none';
export const browserAccess = (p: AgentPolicy | null | undefined): BrowserAccess =>
  !p?.tools || p.tools.allow.includes('browser') ? 'all' : p.tools.allow.includes('browser-read') ? 'read' : 'none';
export const BROWSER_READ_TOOLS: readonly string[] = ['tabs_list', 'tabs_create', 'environments', 'tabs_select', 'tabs_close', 'navigate', 'screenshot', 'read_page', 'find', 'get_page_text',
  'scroll', 'wait_for', 'network_requests', 'console_messages'];

/** Claude MCP narrowing for a run with a tool policy. Without 'mcp': only the app's own servers (strict config) and no
 *  claude.ai connectors, unless mail/calendar need them. 'mcp' with or without names: not narrowed here (named servers
 *  would need their configs, secrets included, on the command line), reported by `unenforced`. */
export function claudeMcp(tools: AgentToolPolicy): { strict: boolean; connectors: boolean } {
  if (tools.allow.includes('mcp')) return { strict: false, connectors: true };
  return { strict: true, connectors: tools.allow.includes('mail-draft') || tools.allow.includes('calendar-read') };
}

/** Codex narrowing (matches `unenforced`): no edits and no commands, or a ceiling up to 'default', -> read-only sandbox;
 *  'acceptEdits' -> every command asks first (approval 'never' is autonomy). Higher ceilings keep the base policy. */
export function narrowCodex(base: CodexExecutionPolicy, p: AgentPolicy | null | undefined): CodexExecutionPolicy {
  if (!hasPolicy(p)) return base;
  const allow = p.tools?.allow;
  if (allow && !allow.includes('edit') && !allow.includes('shell') || p.ceiling === 'plan' || p.ceiling === 'default') return { approvalPolicy: 'on-request', sandbox: 'read-only', writableRoots: [] };
  return p.ceiling === 'acceptEdits' ? { ...base, approvalPolicy: 'on-request' } : base;
}

/** Restrictions an engine cannot apply: classes left out of the allow-list that stay reachable, and the ceiling (shown
 *  "declared, not enforced"; A7 refuses these for Orchestrator-authored agents). Empty = fully enforced. */
export function unenforced(kind: EngineKind, p: AgentPolicy): (ToolClass | 'ceiling')[] {
  const allow = p.tools?.allow;
  const reachable = (blocked: (c: ToolClass) => boolean): ToolClass[] => allow ? TOOL_CLASSES.filter(c => !allow.includes(c) && !blocked(c)) : [];
  const can = (c: ToolClass) => !!allow?.includes(c);
  switch (kind) {
    case 'claude': {
      const connectors = !!p.tools && claudeMcp(p.tools).connectors;
      // brain-write is an edit: allowed edits reach the brain folder too; commands reach files and the network. A named
      // MCP list is not narrowed (claudeMcp).
      // read-only commands: the app refuses a writing command it is asked about, but one the user's own allow rules
      // approve never reaches it; the same for brain-write's Edit/Write outside the brain (role-gate.ts)
      const gaps = reachable(c => (c === 'edit' || c === 'brain-write' || c === 'web') && can('shell') ? false : c === 'brain-write' ? !can('edit')
        : c === 'edit' ? !can('brain-write')
        : c === 'shell' ? !can('shell-read') : c === 'shell-read' ? !can('shell') : (c === 'mail-draft' || c === 'calendar-read' || c === 'mcp') ? !connectors : true);
      return p.tools?.mcp?.length ? [...gaps, 'mcp'] : gaps;
    }
    case 'codex': {
      // the sandbox is read-only only when neither edits nor commands are allowed (one reaches the other)
      const sandboxed = !can('edit') && !can('shell') || p.ceiling === 'plan' || p.ceiling === 'default';
      // a read-only sandbox still runs commands that read: shell-read is reachable unless allowed
      return reachable(c => c === 'browser' || c === 'browser-read' || c === 'read' || ((c === 'edit' || c === 'shell' || c === 'brain-write') && sandboxed));
    }
    // Cursor's own allow rules can approve tools without a request reaching the app: only 'plan' (read-only) holds
    case 'acp': return [...reachable(c => c === 'browser' || c === 'browser-read' || c === 'read' || (p.ceiling === 'plan' && (c === 'edit' || c === 'shell' || c === 'brain-write'))), ...(p.ceiling !== null && p.ceiling !== 'plan' ? ['ceiling' as const] : [])];
    case 'api': return [];
  }
}

/** Free text that ends up in a role's instructions, a skill or a rule (a lesson, pack/learning.ts and the maintenance
 *  jobs) never grants a permission: such a text is refused. */
export function checkPermissionText(raw: string): void {
  const text = raw.normalize('NFKC');
  if (/auto[\s-]*approv|bypass\s*permissions|skip\s+(?:all\s+)?permissions|you\s+(?:may|can|are allowed to)\s+(?:deploy|approve)|(?:permesso|autorizzat[oa])\s+(?:di|a)\s+(?:deploy|distribuire|approvare)|approv[ae]\s+(?:automaticamente|tutto)/i.test(text)) throw new Error('Instructions cannot grant permissions.');
}
