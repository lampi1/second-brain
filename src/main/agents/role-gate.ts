// The gate every permission request of a role chat passes before it reaches the user (ChatManager's sink.pending):
// a Skill call is allowed at once when the launch gave that skill (the user's standing grant through the role) and
// it is named through the launch's own runtime plugin (`agent-<hash16>:<name>`, agents/pack/flows.ts runtime()), and
// refused otherwise: another prefix could be a user, project or plugin skill of the same name. A bare name of a skill the
// launch gave is allowed with its input rewritten to the qualified name (rewrite: an engine that runs a changed input,
// Claude; issue #101), so it always loads the launch's own copy; any other bare name is refused. An engine sub-agent (Claude's Agent/Task) is allowed only for a quick read-only search (Explore),
// any other type is refused because delegated work runs in a visible chat (agent_delegate); and a request of a
// delegated chat whose tool class goes beyond its parent's permissions is refused (under a parent that may only read
// commands, a command that does not only read goes beyond it too). Everything else passes to the user
// as before (a request beyond the role but within the parent is the user's call). A role that may write only in the
// brain (brain-write without edit, as the user may narrow one) gets Claude's Edit/Write (tool-policy.ts CLAUDE_TOOLS), and every
// edit it asks is refused unless its file's real path is inside the brain folder (no "..", no link out, no hard link,
// a normalized path short enough that trimInput never cut it). The brain's list of read-only tools
// (read-only-tools.md, agents/read-tools.ts) is the user's: an edit of it by any role is refused. Under a parent that
// may only read commands, `node` of one of those declared tools counts as reading (issue #93).
// Refusals are visible in the chat. No state; reads the file system only to resolve links. Used by chats/manager.ts;
// pinned by test/unit/agents/role-gate.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { SysCode, SysParams } from '../../shared/sys';
import type { PreToolCall, PreToolHook } from '../chats/session';
import { allowsClass, shellWithin, toolClassOf, type AgentPolicy, type ReadScripts } from './tool-policy';
import { READ_TOOLS_FILE } from './read-tools';

export interface GateRequest { type: string; tool: string; input?: unknown }
export interface GateChat {
  /** the role it runs (name for the messages); absent = a plain chat: nothing is gated */
  role?: { id: string; name: string };
  /** the skills its launch gave it (role defaults ∪ the delegation's) */
  skills: readonly string[];
  /** the launch's runtime plugin name (runtimePluginName); absent = no plugin: every skill is refused */
  plugin?: string;
  /** its engine runs an allowed call with a changed input (Claude's updatedInput): a granted bare skill name is
   *  allowed as "<plugin>:<name>" instead of refused */
  rewrite?: boolean;
  /** the delegating chat's policy and title (absent = a root chat) */
  parent?: { policy: AgentPolicy | null; title: string };
  /** its own tool policy (absent/null = none): brain-write without edit limits its edits to the brain folder */
  policy?: AgentPolicy | null;
  /** the brain folder (absent/null = no brain: a brain-only edit is refused) */
  brainRoot?: string | null;
  /** the brain's declared read-only tools, from the chat's folder (agents/read-tools.ts) */
  readScripts?: ReadScripts;
}
export type GateVerdict =
  | { kind: 'pass' }
  /** patch = input fields the call runs with instead of its own (the qualified skill name) */
  | { kind: 'allow'; patch?: Readonly<Record<string, string>> }
  | { kind: 'deny'; code: SysCode; params: SysParams; message: string };

const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);
/** The Skill tool's input fields that may name the skill, in the order they are read. */
const SKILL_KEYS = ['skill', 'command', 'name'];
/** The one engine sub-agent a role may use: a read-only search inside its own chat. */
export const SEARCH_SUBAGENT = 'Explore';

/** The verdict on an engine sub-agent call (Agent/Task): null for the read-only Explore search, else the refusal. */
export function subagentRefusal(input: unknown): { type: string; message: string } | null {
  const type = field(input, 'subagent_type', 'agent_type', 'type') || 'general-purpose';
  if (type === SEARCH_SUBAGENT) return null;
  return { type, message: `Sub-agent «${type}» refused: hand delegated work to another role with agent_delegate (a visible chat). Engine sub-agents are only for a quick read-only search (${SEARCH_SUBAGENT}).` };
}

/** The same rule as a PreToolUse hook (chats/claude.ts): Claude starts a sub-agent without a permission request, so
 *  gateRequest never sees it; a role chat whose launch has the sub-agent tool (tool-policy.ts claudeTools) gets this. */
export class SubagentGate implements PreToolHook {
  decide(call: PreToolCall): { deny: string } | null {
    if (!SUBAGENT_TOOLS.has(call.tool)) return null;
    const refused = subagentRefusal(call.input);
    return refused ? { deny: refused.message } : null;
  }
  turnEnded(): void { /* no state */ }
}

/** The name of a launch's runtime plugin, from its folder (named by the content hash, agents/pack/flows.ts runtime()). */
export const runtimePluginName = (pluginDirOrHash: string): string => `agent-${path.basename(pluginDirOrHash).slice(0, 16)}`;

/** The launch's skills by the names the Skill tool takes (issue #101), one line for the role's instructions; '' when none. */
export function qualifiedSkillsLine(plugin: string, skills: readonly string[]): string {
  return skills.length ? `Your skills: call them with the Skill tool by their qualified name: ${skills.map(n => `${plugin}:${n}`).join(', ')}.` : '';
}

const field = (input: unknown, ...keys: string[]): string => {
  const o = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  for (const k of keys) if (typeof o[k] === 'string' && o[k]) return (o[k] as string).trim();
  return '';
};

/** The tools brain-write gives on Claude, and the input field naming their file. */
export const BRAIN_WRITE_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write']);

const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
/** A path with its links resolved, also when the file does not exist yet: the nearest existing folder is resolved and
 *  the missing rest appended. null = it cannot be resolved. */
function realOf(p: string): string | null {
  const rest: string[] = [];
  let at = p;
  for (;;) {
    try { return path.join(fs.realpathSync.native(at), ...rest.reverse()); } catch { /* missing: its parent */ }
    const up = path.dirname(at);
    if (up === at) return null;
    rest.push(path.basename(at));
    at = up;
  }
}
/** The longest file path a brain-only edit may name. The gate sees the request's input after trimInput (chats/session.ts)
 *  cut each string to 4000 characters, so a longer path could hide its escaping tail (`./` x 2000 + `../x`). */
export const BRAIN_PATH_MAX = 1024;
/** True when `target` is a file inside the brain folder: absolute, already normalized (no "." or ".." segment, no
 *  doubled separator), at most BRAIN_PATH_MAX characters and never cut by trimInput, its real path (links resolved)
 *  inside the brain's real path, and not a hard link to a file elsewhere. */
export function insideBrain(brainRoot: string | null | undefined, target: string): boolean {
  if (!brainRoot || !target || !path.isAbsolute(brainRoot) || !path.isAbsolute(target) || target.includes('\0')) return false;
  if (target.length > BRAIN_PATH_MAX || /… \(\+\d+\)$/.test(target)) return false;
  if (target.split(/[\\/]+/).includes('..')) return false;
  // the path as written must be the path it resolves to (Windows: either separator)
  const written = process.platform === 'win32' ? target.replace(/\//g, '\\') : target;
  if (path.resolve(target) !== written) return false;
  const root = realOf(path.resolve(brainRoot)), real = realOf(path.resolve(target));
  if (!root || !real) return false;
  const rel = path.relative(norm(root), norm(real));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  try { const st = fs.lstatSync(real); if (!st.isFile() || st.nlink > 1) return false; } catch { /* a new file: nothing to link */ }
  return true;
}

/** True when `target` (links resolved, also a file not there yet) is the brain's read-only-tools.md. */
export function isReadToolsList(brainRoot: string, target: string): boolean {
  if (!path.isAbsolute(target) || !path.isAbsolute(brainRoot)) return false;
  const a = realOf(path.resolve(target)), b = realOf(path.join(brainRoot, READ_TOOLS_FILE));
  return !!a && !!b && norm(a) === norm(b);
}

export function gateRequest(req: GateRequest, chat: GateChat): GateVerdict {
  if (!chat.role || req.type !== 'permission') return { kind: 'pass' };
  if (req.tool === 'Skill') {
    // only "<launch plugin>:<name>" is the skill the launch gave: a bare name or another prefix may resolve to a user,
    // project or other plugin skill that merely shares the name
    const key = SKILL_KEYS.find(k => field(req.input, k)) ?? 'skill';
    const raw = field(req.input, ...SKILL_KEYS), cut = raw.indexOf(':');
    const prefix = cut < 0 ? '' : raw.slice(0, cut), name = cut < 0 ? raw : raw.slice(cut + 1);
    if (chat.plugin && prefix === chat.plugin && name && chat.skills.includes(name)) return { kind: 'allow' };
    // a granted skill by its bare name: run as the launch's own copy, never a user or project skill of that name
    if (chat.plugin && chat.rewrite && cut < 0 && name && chat.skills.includes(name)) return { kind: 'allow', patch: { [key]: `${chat.plugin}:${name}` } };
    const hint = chat.plugin && name && chat.skills.includes(name) ? ` Call it as «${chat.plugin}:${name}».` : '';
    return { kind: 'deny', code: 'skillRefused', params: { skill: raw || '?', role: chat.role.name },
      message: `The skill «${raw || '?'}» is not assigned to your role (${chat.role.name}): use only the skills you were given, or tell your parent which one you need.${hint}` };
  }
  if (SUBAGENT_TOOLS.has(req.tool)) {
    const refused = subagentRefusal(req.input);
    if (!refused) return { kind: 'pass' };
    return { kind: 'deny', code: 'subagentRefused', params: { type: refused.type }, message: refused.message };
  }
  const tool = toolClassOf(req.tool);
  // an edit of a file inside the brain folder is a brain-write
  const target = field(req.input, 'file_path', 'path', 'notebook_path');
  if (tool === 'edit' && chat.brainRoot && target && isReadToolsList(chat.brainRoot, target)) {
    return { kind: 'deny', code: 'readToolsList', params: { tool: req.tool, role: chat.role.name },
      message: `${req.tool} on ${READ_TOOLS_FILE} was refused: the list of read-only tools is the user's. Ask the user to add the script there.` };
  }
  const brainEdit = tool === 'edit' && BRAIN_WRITE_TOOLS.has(req.tool) && insideBrain(chat.brainRoot, target);
  if (tool === 'edit' && !brainEdit && allowsClass(chat.policy, 'brain-write') && !allowsClass(chat.policy, 'edit')) {
    const shown = target.slice(0, 200) || '?';
    return { kind: 'deny', code: 'brainOnly', params: { tool: req.tool, path: shown, role: chat.role.name },
      message: `${req.tool} on «${shown}» was refused: your role (${chat.role.name}) may write only files inside the brain folder${chat.brainRoot ? ` (${chat.brainRoot})` : ' and no brain is set'}, with Edit or Write, by their absolute path.` };
  }
  const cls = brainEdit && !allowsClass(chat.parent?.policy, 'edit') ? 'brain-write' : tool;
  if (chat.parent && cls && (cls === 'shell' ? !shellWithin(chat.parent.policy, req.tool, req.input, chat.readScripts) : !allowsClass(chat.parent.policy, cls))) {
    return { kind: 'deny', code: 'aboveParent', params: { tool: req.tool, parent: chat.parent.title },
      message: `${req.tool} goes beyond the permissions of the chat that delegated you («${chat.parent.title}»): it was refused. Do it within your permissions, or report to your parent with agent_report what you need.` };
  }
  return { kind: 'pass' };
}
