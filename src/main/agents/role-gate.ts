// The gate every permission request of a role chat passes before it reaches the user (ChatManager's sink.pending):
// a Skill call is allowed at once when the launch gave that skill (the user's standing grant through the role) and
// refused otherwise; an engine sub-agent (Claude's Agent/Task) is allowed only for a quick read-only search (Explore),
// any other type is refused because delegated work runs in a visible chat (agent_delegate); and a request of a
// delegated chat whose tool class goes beyond its parent's permissions is refused. Everything else passes to the user
// as before (a request beyond the role but within the parent is the user's call). A role that may write only in the
// brain (brain-write without edit, e.g. the Scribe) gets Claude's Edit/Write (tool-policy.ts CLAUDE_TOOLS), and every
// edit it asks is refused unless its file's real path is inside the brain folder (no "..", no link out, no hard link).
// Refusals are visible in the chat. No state; reads the file system only to resolve links. Used by chats/manager.ts;
// pinned by test/unit/agents/role-gate.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { SysCode, SysParams } from '../../shared/sys';
import { allowsClass, toolClassOf, type AgentPolicy } from './tool-policy';

export interface GateRequest { type: string; tool: string; input?: unknown }
export interface GateChat {
  /** the role it runs (name for the messages); absent = a plain chat: nothing is gated */
  role?: { id: string; name: string };
  /** the skills its launch gave it (role defaults ∪ the delegation's) */
  skills: readonly string[];
  /** the delegating chat's policy and title (absent = a root chat) */
  parent?: { policy: AgentPolicy | null; title: string };
  /** its own tool policy (absent/null = none): brain-write without edit limits its edits to the brain folder */
  policy?: AgentPolicy | null;
  /** the brain folder (absent/null = no brain: a brain-only edit is refused) */
  brainRoot?: string | null;
}
export type GateVerdict =
  | { kind: 'pass' }
  | { kind: 'allow' }
  | { kind: 'deny'; code: SysCode; params: SysParams; message: string };

const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);
/** The one engine sub-agent a role may use: a read-only search inside its own chat. */
export const SEARCH_SUBAGENT = 'Explore';

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
/** True when `target` is a file inside the brain folder: absolute, no ".." segment, its real path (links resolved)
 *  inside the brain's real path, and not a hard link to a file elsewhere. */
export function insideBrain(brainRoot: string | null | undefined, target: string): boolean {
  if (!brainRoot || !target || !path.isAbsolute(brainRoot) || !path.isAbsolute(target) || target.includes('\0')) return false;
  if (target.split(/[\\/]+/).includes('..')) return false;
  const root = realOf(path.resolve(brainRoot)), real = realOf(path.resolve(target));
  if (!root || !real) return false;
  const rel = path.relative(norm(root), norm(real));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  try { const st = fs.lstatSync(real); if (!st.isFile() || st.nlink > 1) return false; } catch { /* a new file: nothing to link */ }
  return true;
}

export function gateRequest(req: GateRequest, chat: GateChat): GateVerdict {
  if (!chat.role || req.type !== 'permission') return { kind: 'pass' };
  if (req.tool === 'Skill') {
    // a plugin skill may come as "<plugin>:<name>": the name decides
    const raw = field(req.input, 'skill', 'command', 'name'), name = raw.split(':').pop() ?? '';
    if (name && chat.skills.includes(name)) return { kind: 'allow' };
    return { kind: 'deny', code: 'skillRefused', params: { skill: raw || '?', role: chat.role.name },
      message: `The skill «${raw || '?'}» is not assigned to your role (${chat.role.name}): use only the skills you were given, or tell your parent which one you need.` };
  }
  if (SUBAGENT_TOOLS.has(req.tool)) {
    const type = field(req.input, 'subagent_type', 'agent_type', 'type') || 'general-purpose';
    if (type === SEARCH_SUBAGENT) return { kind: 'pass' };
    return { kind: 'deny', code: 'subagentRefused', params: { type },
      message: `Sub-agent «${type}» refused: hand delegated work to another role with agent_delegate (a visible chat). Engine sub-agents are only for a quick read-only search (${SEARCH_SUBAGENT}).` };
  }
  const tool = toolClassOf(req.tool);
  // an edit of a file inside the brain folder is a brain-write
  const target = field(req.input, 'file_path', 'path', 'notebook_path');
  const brainEdit = tool === 'edit' && BRAIN_WRITE_TOOLS.has(req.tool) && insideBrain(chat.brainRoot, target);
  if (tool === 'edit' && !brainEdit && allowsClass(chat.policy, 'brain-write') && !allowsClass(chat.policy, 'edit')) {
    const shown = target.slice(0, 200) || '?';
    return { kind: 'deny', code: 'brainOnly', params: { tool: req.tool, path: shown, role: chat.role.name },
      message: `${req.tool} on «${shown}» was refused: your role (${chat.role.name}) may write only files inside the brain folder${chat.brainRoot ? ` (${chat.brainRoot})` : ' and no brain is set'}, with Edit or Write, by their absolute path.` };
  }
  const cls = brainEdit && !allowsClass(chat.parent?.policy, 'edit') ? 'brain-write' : tool;
  if (chat.parent && cls && !allowsClass(chat.parent.policy, cls)) {
    return { kind: 'deny', code: 'aboveParent', params: { tool: req.tool, parent: chat.parent.title },
      message: `${req.tool} goes beyond the permissions of the chat that delegated you («${chat.parent.title}»): it was refused. Do it within your permissions, or report to your parent with agent_report what you need.` };
  }
  return { kind: 'pass' };
}
