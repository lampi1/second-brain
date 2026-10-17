// Pure role composition for the integrator: references only, with validated preferences and reversible previews.
// No catalog writes, session launch, model selection, permission configuration or persistence occurs here.
export interface RoleDefaults { homePageId: string; primaryAgentId: string }
export interface RolePreset {
  schemaVersion: 1;
  id: string;
  revision: number;
  title: string;
  agentIds: string[];
  pageIds: string[];
  defaults: RoleDefaults;
}
export interface RoleOverrides {
  addAgentIds?: string[];
  removeAgentIds?: string[];
  addPageIds?: string[];
  removePageIds?: string[];
  defaults?: Partial<RoleDefaults>;
}
export interface RoleSelection {
  schemaVersion: 1;
  presetId: string;
  presetRevision: number;
  overrides: RoleOverrides;
}
/** Supply actual catalog IDs and registered navigation IDs, never names or capability claims. */
export interface RoleReferences { agentIds: readonly string[]; pageIds: readonly string[] }
export interface ResolvedRole {
  presetId: string;
  presetRevision: number;
  agentIds: string[];
  pageIds: string[];
  defaults: RoleDefaults;
}
export class RoleValidationError extends Error {
  constructor(public readonly path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = 'RoleValidationError';
  }
}
function fail(path: string, detail: string): never { throw new RoleValidationError(path, detail); }
function object(value: unknown, path: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) if (!keys.includes(key)) fail(`${path}.${key}`, 'unsupported field');
  return v;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) fail(path, 'expected 1–120 printable characters without outer whitespace');
  return value;
}
function revision(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail(path, 'expected a positive safe integer');
  return value;
}
function ids(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 128) fail(path, 'expected at most 128 reference IDs');
  const result = Array.from(value, (id, i) => text(id, `${path}[${i}]`));
  if (new Set(result).size !== result.length) fail(path, 'duplicate reference ID');
  return result;
}
function defaults(value: unknown, path: string, partial: boolean): Partial<RoleDefaults> {
  const v = object(value, path, ['homePageId', 'primaryAgentId']);
  const result: Partial<RoleDefaults> = {};
  for (const key of ['homePageId', 'primaryAgentId'] as const) {
    if (!partial || Object.hasOwn(v, key)) result[key] = text(v[key], `${path}.${key}`);
  }
  return result;
}
function references(values: string[], known: readonly string[], path: string): void {
  values.forEach((id, i) => { if (!known.includes(id)) fail(`${path}[${i}]`, `reference "${id}" does not exist`); });
}
function members(role: Pick<ResolvedRole, 'agentIds' | 'pageIds' | 'defaults'>, path: string): void {
  if (!role.pageIds.includes(role.defaults.homePageId)) fail(`${path}.defaults.homePageId`, `"${role.defaults.homePageId}" is not in pageIds`);
  if (!role.agentIds.includes(role.defaults.primaryAgentId)) fail(`${path}.defaults.primaryAgentId`, `"${role.defaults.primaryAgentId}" is not in agentIds`);
}
export function validatePreset(value: unknown, refs: RoleReferences): RolePreset {
  const v = object(value, 'preset', ['schemaVersion', 'id', 'revision', 'title', 'agentIds', 'pageIds', 'defaults']);
  if (v.schemaVersion !== 1) fail('preset.schemaVersion', 'unsupported version');
  const id = text(v.id, 'preset.id');
  const path = `preset[${id}]`;
  const p: RolePreset = {
    schemaVersion: 1, id, revision: revision(v.revision, `${path}.revision`), title: text(v.title, `${path}.title`),
    agentIds: ids(v.agentIds, `${path}.agentIds`), pageIds: ids(v.pageIds, `${path}.pageIds`),
    defaults: defaults(v.defaults, `${path}.defaults`, false) as RoleDefaults,
  };
  references(p.agentIds, refs.agentIds, `${path}.agentIds`);
  references(p.pageIds, refs.pageIds, `${path}.pageIds`);
  members(p, path);
  return p;
}
export function validateOverrides(value: unknown, refs: RoleReferences): RoleOverrides {
  const v = object(value, 'overrides', ['addAgentIds', 'removeAgentIds', 'addPageIds', 'removePageIds', 'defaults']);
  const result: RoleOverrides = {};
  for (const key of ['addAgentIds', 'removeAgentIds', 'addPageIds', 'removePageIds'] as const) {
    if (!Object.hasOwn(v, key)) continue;
    result[key] = ids(v[key], `overrides.${key}`);
    references(result[key], key.endsWith('AgentIds') ? refs.agentIds : refs.pageIds, `overrides.${key}`);
  }
  for (const [add, remove] of [['addAgentIds', 'removeAgentIds'], ['addPageIds', 'removePageIds']] as const) {
    for (const id of result[add] ?? []) if (result[remove]?.includes(id)) fail(`overrides.${remove}`, `"${id}" is also added`);
  }
  if (Object.hasOwn(v, 'defaults')) result.defaults = defaults(v.defaults, 'overrides.defaults', true);
  return result;
}
export function validateSelection(value: unknown, refs: RoleReferences): RoleSelection {
  const v = object(value, 'selection', ['schemaVersion', 'presetId', 'presetRevision', 'overrides']);
  if (v.schemaVersion !== 1) fail('selection.schemaVersion', 'unsupported version');
  return {
    schemaVersion: 1, presetId: text(v.presetId, 'selection.presetId'),
    presetRevision: revision(v.presetRevision, 'selection.presetRevision'), overrides: validateOverrides(v.overrides, refs),
  };
}
export function selectRole(preset: unknown, overrides: unknown, refs: RoleReferences): RoleSelection {
  const p = validatePreset(preset, refs);
  const s: RoleSelection = { schemaVersion: 1, presetId: p.id, presetRevision: p.revision, overrides: validateOverrides(overrides, refs) };
  resolveRole(p, s, refs);
  return s;
}
/** Add/remove deltas retain personal intent even when the next preset revision changes its own membership. */
export function resolveRole(preset: unknown, selection: unknown, refs: RoleReferences): ResolvedRole {
  const p = validatePreset(preset, refs), s = validateSelection(selection, refs);
  if (s.presetId !== p.id) fail('selection.presetId', `expected "${p.id}", got "${s.presetId}"`);
  if (s.presetRevision > p.revision) fail('selection.presetRevision', 'preset downgrade requires the matching retained revision');
  const o = s.overrides;
  const compose = (base: string[], add: string[] = [], remove: string[] = []) => [...new Set([...base, ...add])].filter(id => !remove.includes(id));
  const role: ResolvedRole = {
    presetId: p.id, presetRevision: p.revision,
    agentIds: compose(p.agentIds, o.addAgentIds, o.removeAgentIds),
    pageIds: compose(p.pageIds, o.addPageIds, o.removePageIds), defaults: { ...p.defaults, ...o.defaults },
  };
  members(role, `role[${p.id}]`);
  return role;
}
export interface RoleDifference {
  field: 'presetId' | 'presetRevision' | 'agentIds' | 'pageIds' | 'homePageId' | 'primaryAgentId';
  before: string | number | string[];
  after: string | number | string[];
}
export interface RolePreview {
  previous: RoleSelection;
  next: RoleSelection;
  before: ResolvedRole;
  after: ResolvedRole;
  differences: RoleDifference[];
  /** Persistent personal intent can change even when today's resolved composition is identical. */
  overrideDifferences: { field: keyof RoleOverrides; before: string[] | Partial<RoleDefaults> | null; after: string[] | Partial<RoleDefaults> | null }[];
}
/** Explicit candidate overrides: pass previous.overrides to keep them, or {} to reset them. Does not apply anything. */
export function previewRoleChange(currentPreset: unknown, currentSelection: unknown, targetPreset: unknown, overrides: unknown, refs: RoleReferences): RolePreview {
  const previous = validateSelection(currentSelection, refs);
  const before = resolveRole(currentPreset, previous, refs);
  // A revision upgrade must compare against its old preset, never reconstruct a previous view from the new one.
  if (previous.presetRevision !== before.presetRevision) fail('selection.presetRevision', 'preview requires the previously selected preset revision');
  const next = selectRole(targetPreset, overrides, refs), after = resolveRole(targetPreset, next, refs);
  const differences: RoleDifference[] = [];
  const record = (field: RoleDifference['field'], a: RoleDifference['before'], b: RoleDifference['after']) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) differences.push({ field, before: structuredClone(a), after: structuredClone(b) });
  };
  for (const key of ['presetId', 'presetRevision', 'agentIds', 'pageIds'] as const) record(key, before[key], after[key]);
  for (const key of ['homePageId', 'primaryAgentId'] as const) record(key, before.defaults[key], after.defaults[key]);
  const overrideDifferences: RolePreview['overrideDifferences'] = [];
  for (const field of ['addAgentIds', 'removeAgentIds', 'addPageIds', 'removePageIds', 'defaults'] as const) {
    const a = previous.overrides[field] ?? null, b = next.overrides[field] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) overrideDifferences.push({ field, before: structuredClone(a), after: structuredClone(b) });
  }
  return { previous, next, before, after, differences, overrideDifferences };
}
/** Undo requires the retained matching preset; a removed reference is an error, never an automatic replacement. */
export function restoreRole(snapshot: unknown, retainedPreset: unknown, refs: RoleReferences): RoleSelection {
  const s = validateSelection(snapshot, refs), p = validatePreset(retainedPreset, refs);
  if (s.presetRevision !== p.revision) fail('selection.presetRevision', 'restore requires the exact retained preset revision');
  resolveRole(p, s, refs);
  return s;
}
