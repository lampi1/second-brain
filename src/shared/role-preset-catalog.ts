// Four packaged starting compositions. IDs refer to baseline agents/pages, without copying profiles or permissions.
import { validatePreset, type RolePreset, type RoleReferences } from './role-presets';

const preset = (id: string, title: string, agentIds: string[], pageIds: string[], homePageId: string): RolePreset => ({
  schemaVersion: 1, id, revision: 1, title, agentIds, pageIds,
  defaults: { homePageId, primaryAgentId: agentIds[0]! },
});
const PRESETS: RolePreset[] = [
  {...preset('dev', 'Dev', ['default-development', 'default-research', 'default-planning'], ['agenti', 'devops', 'procedure', 'fatto'], 'agenti'),revision:2},
  preset('qa', 'QA', ['default-analysis', 'default-development', 'default-research'], ['qualita', 'agenti', 'devops', 'procedure', 'fatto'], 'qualita'),
  {...preset('po', 'PO', ['default-planning', 'default-writing', 'default-research'], ['idee', 'agenti', 'devops', 'fatto'], 'idee'),revision:2},
  preset('cto', 'CTO', ['default-analysis', 'default-planning', 'default-development'], ['costi', 'agenti', 'qualita', 'confronto', 'devops', 'fatto'], 'costi'),
];
/** Return independent copies; validation is per preset, so one deleted profile need not hide unrelated roles. */
export function initialRolePresets(): RolePreset[] { return structuredClone(PRESETS); }
/** Retire only the removed explorer references. Other customizations and invalid values remain recoverable. */
export function migrateExplorerRole(raw:unknown):unknown{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return raw;
 const selection=raw as Record<string,unknown>,preset=PRESETS.find(p=>p.id===selection.presetId);
 if(!preset||selection.schemaVersion!==1||selection.presetRevision!==1&&selection.presetRevision!==preset.revision)return raw;
 const overrides=selection.overrides;if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))return raw;
 const next={...overrides}as Record<string,unknown>;
 for(const key of['addPageIds','removePageIds'])if(Array.isArray(next[key]))next[key]=(next[key]as unknown[]).filter(id=>id!=='esplora');
 if(next.defaults&&typeof next.defaults==='object'&&!Array.isArray(next.defaults)&&(next.defaults as Record<string,unknown>).homePageId==='esplora')next.defaults={...next.defaults,homePageId:preset.defaults.homePageId};
 return{...selection,presetRevision:preset.revision,overrides:next};
}
export function initialRolePreset(id: string, refs: RoleReferences): RolePreset {
  const p = PRESETS.find(p => p.id === id);
  if (!p) throw new Error(`Unknown role preset "${id}"`);
  return validatePreset(p, refs);
}
