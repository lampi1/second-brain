// Unsaved role edits (Brain → Agenti, AgentStudio.tsx) survive navigation in a bounded memory cache, one per role, and an
// app update (update-checkpoint.ts copies them into localStorage before the restart and restores them after). A copy is
// checked field by field before it is trusted: a role draft holds only the editable behaviour, never a name or avatar.
// agentDraftOf builds a draft from a role's profile.
import { EFFORTS } from './format';
import { PERMISSION_CEILINGS, TOOL_CLASSES, type AgentDraft, type AgentProfile } from '@shared/agents';
import { MODEL_TIERS, isWorkRole } from '@shared/roles';
import { isCharacterId } from '@shared/characters';
import { t } from '../i18n';

export interface AgentEditorDraft { id: string; baseRevision?: number; draft: AgentDraft }
/** The editable behaviour of a role, from its profile: the editor's starting draft (AgentStudio.tsx) and the base of a
 *  permissions-only save (RolePermissions.tsx). */
export const agentDraftOf = (p: AgentProfile): AgentDraft => ({
  name: p.name, purpose: p.purpose, avatar: p.avatar, instructions: p.instructions, engine: p.engine, model: p.model,
  ...(p.effort ? { effort: p.effort } : {}), tools: p.tools, permissionCeiling: p.permissionCeiling,
  ...(p.knowhow ? { knowhow: p.knowhow } : {}), ...(p.pack ? { pack: p.pack } : {}),
  maxContext: p.maxContext ?? null, tier: p.tier, tierMax: p.tierMax, launches: [...p.launches], skills: [...p.skills],
});
const drafts = new Map<string, AgentEditorDraft>();
let active: string | null = null;
export function rememberAgentEditor(state: AgentEditorDraft): void {
  drafts.delete(state.id); drafts.set(state.id, structuredClone(state)); active = state.id;
  while (drafts.size > 20) drafts.delete(drafts.keys().next().value!);
  persistAgentRecovery();
}
export function readAgentEditor(id: string): AgentEditorDraft | null {
  const value = drafts.get(id); return value ? structuredClone(value) : null;
}
export function forgetAgentEditor(id: string): void { drafts.delete(id); if (active === id) active = null; persistAgentRecovery(); }

const AGENT_RECOVERY_KEY = 'sb.update.agent-drafts.v1';
let recoveredAgents = false, agentStorageProblem = false;
export function agentDraftCheckpointProblem(): string | null { return agentStorageProblem ? t('appText.agentDrafts.notSaved') : null; }
export function agentDraftCheckpoint() { return { version: 1, active, entries: [...drafts.entries()] }; }

const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const list = (v: unknown, ok: (x: unknown) => boolean, max: number) => Array.isArray(v) && v.length <= max && v.every(ok);
const SKILL = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
function validDraft(value: unknown): value is AgentDraft {
  const d = value as AgentDraft | null;
  if (!d || typeof d !== 'object' || !text(d.name, 80) || !text(d.purpose, 400) || !text(d.instructions, 8000) || !text(d.engine, 160)) return false;
  if (d.model !== null && !text(d.model, 300) || d.effort !== undefined && !EFFORTS.includes(d.effort)) return false;
  if (d.avatar?.kind !== 'character' || !isCharacterId(d.avatar.value)) return false;
  if (d.tools !== null && (!d.tools || !list(d.tools.allow, c => TOOL_CLASSES.includes(c as never), TOOL_CLASSES.length))) return false;
  if (d.permissionCeiling !== null && !PERMISSION_CEILINGS.includes(d.permissionCeiling)) return false;
  if (d.maxContext !== undefined && d.maxContext !== null && !Number.isSafeInteger(d.maxContext)) return false;
  return MODEL_TIERS.includes(d.tier) && MODEL_TIERS.includes(d.tierMax)
    && list(d.launches, isWorkRole, 8) && list(d.skills, s => typeof s === 'string' && SKILL.test(s), 40);
}
export function validateAgentDraftCopy(value: unknown): ReturnType<typeof agentDraftCheckpoint> {
  const copy = value as ReturnType<typeof agentDraftCheckpoint>;
  const bad = () => Error(t('appText.agentDrafts.invalid'));
  if (!copy || copy.version !== 1 || !Array.isArray(copy.entries) || copy.entries.length > 20 || copy.active !== null && typeof copy.active !== 'string') throw bad();
  const keys = new Set<string>();
  for (const entry of copy.entries) {
    if (!Array.isArray(entry) || entry.length !== 2) throw bad();
    const [id, state] = entry;
    if (typeof id !== 'string' || id.length > 80 || keys.has(id) || !state || state.id !== id || !validDraft(state.draft)) throw bad();
    if (state.baseRevision !== undefined && (!Number.isFinite(state.baseRevision) || state.baseRevision < 0)) throw bad();
    keys.add(id);
  }
  if (copy.active !== null && !keys.has(copy.active)) throw bad();
  return copy;
}
export function restoreAgentDraftCopy(value: unknown): void {
  const copy = validateAgentDraftCopy(value);
  drafts.clear();
  for (const [id, state] of copy.entries) drafts.set(id, { id, ...(state.baseRevision !== undefined ? { baseRevision: state.baseRevision } : {}), draft: structuredClone(state.draft) });
  active = copy.active; recoveredAgents = true; persistAgentRecovery();
}
function persistAgentRecovery(): void {
  if (!recoveredAgents) return;
  try { localStorage.setItem(AGENT_RECOVERY_KEY, JSON.stringify(agentDraftCheckpoint())); agentStorageProblem = false; } catch { agentStorageProblem = true; }
}
export function enableAgentDraftRecovery(): void { recoveredAgents = true; persistAgentRecovery(); }
