// The user's own pictures for the roles (Orchestrator + the eight work roles): one square PNG per role, chosen from
// the role's page (components/AgentImagePicker.tsx), kept by main in userData (main/agents/agent-images.ts) and drawn
// by AgentAvatar in place of the role's cartoon character. A role without one keeps its character; "Predefinita"
// removes the picture. UI only: never sent to an engine, never in the brain or in an agent pack.
import type { RoleId } from './roles';

/** role id → `data:image/png;base64,…` (only the roles with a picture of their own) */
export type AgentImages = Partial<Record<RoleId, string>>;
/** the side of the stored square, in pixels: twice the largest badge (104 px on the role's page) and some margin */
export const AGENT_IMAGE_SIDE = 256;
/** the most the renderer may send for one picture (a 256 px PNG is far below this) */
export const AGENT_IMAGE_BYTES = 600_000;
