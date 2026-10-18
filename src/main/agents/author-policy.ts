// Main-owned checks for automatic agent definitions and launch folders; used by catalog and MCP authoring.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentDraft, AgentProfile } from '../../shared/agents';
import type { ChatItem } from '../../shared/contract';
import { engineOf } from '../engines/registry';
import { checkedTools, unenforced } from './tool-policy';

export function checkAuthorPolicy(draft: AgentDraft, enabledMcp: readonly string[]): void {
  const tools = checkedTools(draft.tools);
  if (!tools || !['plan', 'default'].includes(draft.permissionCeiling ?? '')) throw new Error('Automatic definitions require explicit tools and a ceiling at most default. Use a proposal.');
  checkPermissionInstructions(draft);
  if (tools.allow.includes('mcp') && (!tools.mcp?.length || tools.mcp.some(name => !enabledMcp.includes(name)))) throw new Error('Only explicitly enabled MCP servers may be selected.');
  const engine = engineOf(draft.engine);
  if (!engine || unenforced(engine.kind, { tools, ceiling: draft.permissionCeiling! }).length || engine.kind === 'api' && tools.allow.some(c => c !== 'read')) throw new Error('This engine cannot enforce the requested policy.');
}

export function checkPermissionInstructions(draft: AgentDraft): void {
  const text = `${draft.instructions}\n${JSON.stringify(draft.manifest ?? {})}`.normalize('NFKC');
  if (/auto[\s-]*approv|bypass\s*permissions|skip\s+(?:all\s+)?permissions|you\s+(?:may|can|are allowed to)\s+(?:deploy|approve)|(?:permesso|autorizzat[oa])\s+(?:di|a)\s+(?:deploy|distribuire|approvare)|approv[ae]\s+(?:automaticamente|tutto)/i.test(text)) throw new Error('Instructions cannot grant permissions.');
}

export function protectedAgent(p: AgentProfile): boolean {
  return p.userLocked || p.permissionCeiling === 'acceptEdits' || /(?:^|[-_])reviewer(?:$|[-_])/.test(p.id) || p.origin.kind === 'preset' && /reviewer/i.test(p.origin.presetId);
}

export function checkCreationRequest(items: readonly ChatItem[], id: string, used: readonly string[], now: number): void {
  const item = items.find(i => i.id === id);
  if (!item || item.kind !== 'user' || item.from !== undefined || !item.text.trim() || /non vale come suo ok|not written by the user/i.test(item.text) || !Number.isFinite(item.at) || item.at > now || now - item.at > 30 * 60_000 || used.includes(id)) throw new Error('Creation requires a fresh unused human task message. Suggest it instead.');
}

/** Canonical paths, component boundaries and no links: neither a sibling prefix nor a junction widens approval. */
export function checkAgentCwd(cwd: string, roots: readonly string[]): void {
  const canonical = (raw: string): string => {
    if (!path.isAbsolute(raw) || raw.startsWith('\\\\')) throw new Error('Local absolute folder required.');
    let cursor = path.parse(raw).root;
    for (const part of path.relative(cursor, raw).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Linked folders are not approved roots.');
    }
    if (!fs.statSync(raw).isDirectory()) throw new Error('Folder required.');
    return fs.realpathSync.native(raw);
  };
  const current = canonical(cwd);
  if (!roots.some(raw => {
    try {
      const root = canonical(raw), relative = path.relative(root, current);
      return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    } catch { return false; }
  })) throw new Error('Folder outside user-approved agent roots.');
}
