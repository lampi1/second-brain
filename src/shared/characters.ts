// The cartoon characters the roles are drawn as: one per role (a role ADR 0100 retired is drawn as its
// successor), fixed in code (the art is in
// renderer/lib/character-art.ts, trusted, never user or model content). Pure ids and labels, shared by main (owner
// snapshots, agents/catalog.ts) and the renderer (AgentAvatar, the tree, the role editor).
import { ROLE_IDS, currentRoleId, type RoleId } from './roles';

export const CHARACTER_IDS = ROLE_IDS;
export type CharacterId = RoleId;
export const isCharacterId = (v: unknown): v is CharacterId => typeof v === 'string' && (CHARACTER_IDS as readonly string[]).includes(v);

/** What each character is, for alt text and the approval sheet (scripts/agent-avatar-sheets.mjs). */
export const CHARACTER_LOOKS: Record<CharacterId, string> = {
  orchestrator: 'old wizard with long white hair and beard, half-moon glasses and a midnight robe, raising a wand',
  strategist: 'cold planner with cropped greying hair, glasses and a trimmed beard, holding a chess knight',
  scout: 'weathered tracker in a worn hat with a ginger beard and a spyglass',
  artisan: 'muscular blacksmith with a black beard, a red rag on the head and a cigar, holding a sledge',
  sentinel: 'merciless guard in a dark closed helm with red eye slits and a halberd',
  herald: 'stout town crier in a feathered tricorn with a waxed moustache and a trumpet',
};
/** The character of a catalog entry: its own id when it has one (a retired role: its successor's), else the Scout's
 *  (never empty). */
export const characterOf = (id: string): CharacterId => { const c = currentRoleId(id); return isCharacterId(c) ? c : 'scout'; };
