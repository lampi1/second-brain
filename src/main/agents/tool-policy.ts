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

/** The narrower of two policies (a chat never runs wider than the chat it comes from): classes and MCP names in both,
 *  the lower ceiling; a missing side leaves the other as it is. */
export function narrowest(a: AgentPolicy | null | undefined, b: AgentPolicy | null | undefined): AgentPolicy | null {
  if (!hasPolicy(a)) return hasPolicy(b) ? b : null;
  if (!hasPolicy(b)) return a;
  const ceiling = a.ceiling === null ? b.ceiling : b.ceiling === null ? a.ceiling : RANK[a.ceiling] <= RANK[b.ceiling] ? a.ceiling : b.ceiling;
  if (!a.tools || !b.tools) return { tools: a.tools ?? b.tools, ceiling };
  const bt = b.tools;
  const allow = a.tools.allow.filter(c => bt.allow.includes(c));
  const mcp = !allow.includes('mcp') ? undefined : a.tools.mcp && bt.mcp ? a.tools.mcp.filter(n => bt.mcp!.includes(n)) : a.tools.mcp ?? bt.mcp;
  // two named lists with no server in common leave none, not every one
  if (mcp && !mcp.length) return { tools: { allow: allow.filter(c => c !== 'mcp') }, ceiling };
  return { tools: { allow, ...(mcp ? { mcp } : {}) }, ceiling };
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
};
export function claudeTools(tools: AgentToolPolicy): string[] {
  return [...new Set([...CLAUDE_BASE, ...tools.allow.flatMap(c => CLAUDE_TOOLS[c] ?? [])])];
}

/** Commands only (shell-read without shell): a command request is shown to the user only when it reads, else it is
 *  refused with this reason. */
export const commandsReadOnly = (p: AgentPolicy | null | undefined): boolean => !!p?.tools && p.tools.allow.includes('shell-read') && !p.tools.allow.includes('shell');
const READ_COMMANDS = new Set(['ls', 'dir', 'cat', 'type', 'head', 'tail', 'grep', 'rg', 'findstr', 'wc', 'pwd', 'stat', 'file', 'tree', 'du', 'df', 'which', 'whoami',
  'sort', 'uniq', 'cut', 'get-childitem', 'gci', 'get-content', 'gc', 'select-string', 'sls', 'get-item', 'get-location', 'test-path', 'resolve-path', 'measure-object']);
const READ_GIT = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog', 'grep']);
/** `git branch`, `git tag`, `git remote` only list with these flags; any other argument creates, moves or deletes. */
const GIT_LISTS: Record<string, ReadonlySet<string>> = {
  branch: new Set(['-a', '-r', '-v', '-vv', '--all', '--remotes', '--list', '--show-current', '--verbose']),
  tag: new Set(['-l', '--list']),
  remote: new Set(['-v', '--verbose']),
};
const WRITING_FLAG = /^(?:-o|-O|--output.*|--pre(?:=.*)?|--ext-diff|--open-files-in-pager.*|--exec.*|-exec|-execdir|-ok|-okdir|-delete|-fprint0?|-fprintf|-fls)$/;
/** One read-only command: a known reader, `git` reading or listing, `find` without actions; no chaining, redirection or
 *  substitution, and a pipe only into another reader. Anything else is not read-only (refused under shell-read). */
export function readOnlyCommand(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000) return false;
  if (/[;&<>`\r\n]|\$\(|\$\{/.test(raw)) return false;
  return raw.split('|').every(part => {
    const words = part.trim().split(/\s+/).filter(Boolean);
    const cmd = words[0]?.toLowerCase().replace(/\.exe$/, '');
    if (!cmd || words.some(w => WRITING_FLAG.test(w))) return false;
    if (cmd === 'git') {
      const [sub, ...rest] = words.slice(1);
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
      // approve never reaches it
      const gaps = reachable(c => (c === 'edit' || c === 'brain-write' || c === 'web') && can('shell') ? false : c === 'brain-write' ? !can('edit')
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
