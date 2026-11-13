// Which tool classes a brain skill needs, and the skills a launch passes whose needs its role lacks (issue #93): a
// Herald given an "open an issue" skill that writes a draft file and runs a node script cannot do it without edit and
// shell, and the Orchestrator should see that before it delegates. A skill's needs come from what the brain model reads
// in it (brainmodel/model.ts skillTools: its allowed-tools, the commands its text names, the scripts in its folder):
// commands and scripts need shell, Claude tool names map to their class (tool-policy.ts toolClassOf), other MCP tools
// need mcp. Advisory only: a warning in app_create_chat, agent_delegate and agent_catalog, never a refusal or a grant.
import type { ToolClass } from '../../shared/agents';
import { allowsClass, commandsReadOnly, toolClassOf, type AgentPolicy } from './tool-policy';

const COMMAND = /^(?:node|npx|npm|pwsh|powershell|az|git|gh|sqlcmd|python3?|bash|dotnet|docker|kubectl|curl)\s/;

/** The classes a skill's tools need, in a stable order. */
export function skillClasses(tools: readonly string[]): ToolClass[] {
  const out = new Set<ToolClass>();
  for (const raw of tools) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith('scripts/') || COMMAND.test(t)) { out.add('shell'); continue; }
    // allowed-tools may scope a tool: Bash(git:*), Write(docs/**)
    const c = toolClassOf(t.replace(/\(.*$/, ''));
    if (c) out.add(c);
  }
  return [...out].sort();
}

export interface SkillGap { skill: string; needs: ToolClass[]; readOnlyCommands?: true }
/** The skills among `names` whose needs `policy` does not cover (null policy = no limit: none). A role limited to
 *  read-only commands is flagged for a skill that runs commands: only reading ones (and the brain's declared read-only
 *  tools) will run. */
export function skillGaps(names: readonly string[], toolsOf: (name: string) => readonly string[] | undefined, policy: AgentPolicy | null | undefined): SkillGap[] {
  if (!policy?.tools) return [];
  const gaps: SkillGap[] = [];
  for (const skill of names) {
    const tools = toolsOf(skill);
    if (!tools) continue;
    const classes = skillClasses(tools);
    const needs = classes.filter(c => !allowsClass(policy, c));
    const readOnly = classes.includes('shell') && allowsClass(policy, 'shell') && commandsReadOnly(policy);
    if (needs.length || readOnly) gaps.push({ skill, needs, ...(readOnly ? { readOnlyCommands: true as const } : {}) });
  }
  return gaps;
}

/** One English line per gap, for the agent that launches (it decides: another role, or ask the user to widen it). */
export function gapLines(role: string, gaps: readonly SkillGap[]): string[] {
  return gaps.map(g => `skill «${g.skill}» needs ${[...g.needs, ...(g.readOnlyCommands ? ['shell (only read-only commands allowed)'] : [])].join(', ')}, which ${role} lacks: pick a role that has it, or ask the user to widen ${role}'s permissions (its card in Agenti).`);
}
