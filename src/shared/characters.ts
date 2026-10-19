// The cartoon characters the roles are drawn as: one per role plus Pulse's, fixed in code (the art is in
// renderer/lib/character-art.ts, trusted, never user or model content). Pure ids and labels, shared by main (owner
// snapshots, agents/catalog.ts) and the renderer (AgentAvatar, the tree, the role editor).
import { ROLE_IDS, PULSE_ID, type RoleId } from './roles';

export const CHARACTER_IDS = [...ROLE_IDS, PULSE_ID] as const;
export type CharacterId = RoleId | typeof PULSE_ID;
export const isCharacterId = (v: unknown): v is CharacterId => typeof v === 'string' && (CHARACTER_IDS as readonly string[]).includes(v);

/** What each character is, for alt text and the approval sheet (scripts/agent-avatar-sheets.mjs). */
export const CHARACTER_LOOKS: Record<CharacterId, string> = {
  orchestrator: 'conductor with swept silver hair, tailcoat and bow tie, raising a baton',
  strategist: 'planner with short neat hair and glasses, holding a chess knight',
  scout: 'explorer in a wide-brim hat with a magnifying glass',
  artisan: 'maker in a bandana and apron with a wrench',
  sentinel: 'guard in a visored helmet with a shield',
  herald: 'town crier in a feathered tricorn with a horn',
  router: 'switchboard operator with a headset and a signpost arrow',
  judge: 'judge in a white curled wig with a gavel',
  scribe: 'writer with a hair bun and round glasses, holding a quill',
  pulse: 'lighthouse keeper with a knit cap and a lantern',
};
/** The character of a catalog entry: its own id when it has one, else the Scout's (never empty). */
export const characterOf = (id: string): CharacterId => (isCharacterId(id) ? id : 'scout');
