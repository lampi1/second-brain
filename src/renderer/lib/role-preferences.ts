// Settings-only role preview/restore boundary; consumes loaded references without starting or editing agents.
import { initialRolePresets,migrateExplorerRole } from '../../shared/role-preset-catalog';
import { previewRoleChange, resolveRole, selectRole, validateSelection, type RoleReferences } from '../../shared/role-presets';

export function savedRole(raw: unknown, refs: RoleReferences) {
  const selection = validateSelection(migrateExplorerRole(raw), refs);
  const preset = initialRolePresets().find(p => p.id === selection.presetId && p.revision === selection.presetRevision);
  if (!preset) throw new Error('Saved role revision unavailable');
  return { selection, preset, resolved: resolveRole(preset, selection, refs) };
}
export function rolePreview(raw: unknown, target: string, refs: RoleReferences) {
  const preset = initialRolePresets().find(p => p.id === target);
  if (!preset) throw new Error('Unknown role');
  if (raw === undefined) {
    const next = selectRole(preset, {}, refs);
    return { previous: undefined, next, before: null, after: resolveRole(preset, next, refs) };
  }
  const current = savedRole(raw, refs);
  return previewRoleChange(current.preset, current.selection, preset, current.selection.overrides, refs);
}
