// The gate every permission request of a role chat passes before it reaches the user (ChatManager's sink.pending):
// a Skill call is allowed at once when the launch gave that skill (the user's standing grant through the role) and
// it is named through the launch's own runtime plugin (`agent-<hash16>:<name>`, agents/pack/flows.ts runtime()), and
// refused otherwise: a bare name or another prefix could be a user, project or plugin skill of the same name; an engine sub-agent (Claude's Agent/Task) is allowed only for a quick read-only search (Explore),
// any other type is refused because delegated work runs in a visible chat (agent_delegate); and a request of a
// delegated chat whose tool class goes beyond its parent's permissions is refused. Everything else passes to the user
// as before (a request beyond the role but within the parent is the user's call). Refusals are visible in the chat.
// Pure: used by chats/manager.ts; pinned by test/unit/agents/role-gate.test.ts.
import type { SysCode, SysParams } from '../../shared/sys';
import path from 'node:path';
import { allowsClass, toolClassOf, type AgentPolicy } from './tool-policy';

export interface GateRequest { type: string; tool: string; input?: unknown }
export interface GateChat {
  /** the role it runs (name for the messages); absent = a plain chat: nothing is gated */
  role?: { id: string; name: string };
  /** the skills its launch gave it (role defaults ∪ the delegation's) */
  skills: readonly string[];
  /** the launch's runtime plugin name (runtimePluginName); absent = no plugin: every skill is refused */
  plugin?: string;
  /** the delegating chat's policy and title (absent = a root chat) */
  parent?: { policy: AgentPolicy | null; title: string };
}
export type GateVerdict =
  | { kind: 'pass' }
  | { kind: 'allow' }
  | { kind: 'deny'; code: SysCode; params: SysParams; message: string };

const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);
/** The one engine sub-agent a role may use: a read-only search inside its own chat. */
export const SEARCH_SUBAGENT = 'Explore';

/** The name of a launch's runtime plugin, from its folder (named by the content hash, agents/pack/flows.ts runtime()). */
export const runtimePluginName = (pluginDirOrHash: string): string => `agent-${path.basename(pluginDirOrHash).slice(0, 16)}`;

const field = (input: unknown, ...keys: string[]): string => {
  const o = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  for (const k of keys) if (typeof o[k] === 'string' && o[k]) return (o[k] as string).trim();
  return '';
};

export function gateRequest(req: GateRequest, chat: GateChat): GateVerdict {
  if (!chat.role || req.type !== 'permission') return { kind: 'pass' };
  if (req.tool === 'Skill') {
    // only "<launch plugin>:<name>" is the skill the launch gave: a bare name or another prefix may resolve to a user,
    // project or other plugin skill that merely shares the name
    const raw = field(req.input, 'skill', 'command', 'name'), cut = raw.indexOf(':');
    const prefix = cut < 0 ? '' : raw.slice(0, cut), name = cut < 0 ? raw : raw.slice(cut + 1);
    if (chat.plugin && prefix === chat.plugin && name && chat.skills.includes(name)) return { kind: 'allow' };
    const hint = chat.plugin && name && chat.skills.includes(name) ? ` Call it as «${chat.plugin}:${name}».` : '';
    return { kind: 'deny', code: 'skillRefused', params: { skill: raw || '?', role: chat.role.name },
      message: `The skill «${raw || '?'}» is not assigned to your role (${chat.role.name}): use only the skills you were given, or tell your parent which one you need.${hint}` };
  }
  if (SUBAGENT_TOOLS.has(req.tool)) {
    const type = field(req.input, 'subagent_type', 'agent_type', 'type') || 'general-purpose';
    if (type === SEARCH_SUBAGENT) return { kind: 'pass' };
    return { kind: 'deny', code: 'subagentRefused', params: { type },
      message: `Sub-agent «${type}» refused: hand delegated work to another role with agent_delegate (a visible chat). Engine sub-agents are only for a quick read-only search (${SEARCH_SUBAGENT}).` };
  }
  const cls = toolClassOf(req.tool);
  if (chat.parent && cls && !allowsClass(chat.parent.policy, cls)) {
    return { kind: 'deny', code: 'aboveParent', params: { tool: req.tool, parent: chat.parent.title },
      message: `${req.tool} goes beyond the permissions of the chat that delegated you («${chat.parent.title}»): it was refused. Do it within your permissions, or report to your parent with agent_report what you need.` };
  }
  return { kind: 'pass' };
}
