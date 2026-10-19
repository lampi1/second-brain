// Behavioral coverage of pure composition, untrusted preferences, revision upgrades and undo for the integrator.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initialRolePreset, initialRolePresets } from '../../src/shared/role-preset-catalog';
import { previewRoleChange, resolveRole, restoreRole, RoleValidationError, selectRole, validateOverrides, validatePreset, validateSelection } from '../../src/shared/role-presets';

const refs = {
  agentIds: ['general', 'researcher', 'writer', 'reviewer', 'day-planner', 'implementer'].map(id => `default-${id}`),
  pageIds: ['agenti', 'task', 'fatto', 'idee', 'costi', 'qualita', 'confronto', 'miglioramento', 'skill', 'impostazioni'],
};
const dev = () => initialRolePreset('dev', refs);
const selection = () => selectRole(dev(), {}, refs);

describe('packaged references and schema', () => {
  it('ships four distinct compositions validated against existing references', () => {
    const all = initialRolePresets();
    expect(all.map(p => p.title)).toEqual(['Dev', 'QA', 'PO', 'CTO']);
    for (const p of all) expect(validatePreset(p, refs)).toEqual(p);
    expect(new Set(all.map(p => p.defaults.homePageId)).size).toBe(4);
  });
  it('pins the reference fixture to the read-only baseline declarations', () => {
    const base = '../../src/';
    const agents = readFileSync(new URL(`${base}shared/agent-presets.ts`, import.meta.url), 'utf8');
    const pages = readFileSync(new URL(`${base}renderer/brain/index.tsx`, import.meta.url), 'utf8');
    expect(agents).toContain('id: `default-${id}`');
    for (const id of refs.agentIds.filter(id => id !== 'default-general')) expect(agents).toContain(`role('${id.slice(8)}',`);
    for (const id of refs.pageIds) expect(pages).toContain(`page('${id}',`);
  });
  it('does not leak mutable catalog arrays', () => {
    initialRolePresets()[0]!.agentIds.length = 0;
    expect(dev().agentIds).toHaveLength(3);
  });
  it('reports the missing profile with role and index', () => {
    expect(() => validatePreset(dev(), { ...refs, agentIds: [] })).toThrow('preset[dev].agentIds[0]: reference "default-implementer" does not exist');
  });
  it('reports an absent page without silently dropping it', () => {
    expect(() => validatePreset({ ...dev(), pageIds: ['absent'] }, refs)).toThrow('preset[dev].pageIds[0]');
  });
  it.each(['homePageId', 'primaryAgentId'] as const)('requires default %s to belong to its declared set', key => {
    expect(() => validatePreset({ ...dev(), defaults: { ...dev().defaults, [key]: key === 'homePageId' ? 'idee' : 'default-general' } }, refs)).toThrow(`preset[dev].defaults.${key}`);
  });
  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid revision %s', revision => {
    expect(() => validatePreset({ ...dev(), revision }, refs)).toThrow('revision');
  });
  it.each([null, [], {}, { ...dev(), schemaVersion: 2 }, { ...dev(), agentIds: ['default-implementer', 'default-implementer'] }])('rejects malformed preset %#', value => {
    expect(() => validatePreset(value, refs)).toThrow(RoleValidationError);
  });
  it('rejects sparse arrays, oversized lists and blank IDs', () => {
    for (const agentIds of [Array(2), Array(129).fill('a'), [' ']]) expect(() => validatePreset({ ...dev(), agentIds }, refs)).toThrow();
  });
  it('unknown role lookup fails explicitly', () => {
    expect(() => initialRolePreset('other', refs)).toThrow('Unknown role preset');
  });
});

describe('personal overrides and preferences', () => {
  it('composes stable deltas and partial defaults without modifying its inputs', () => {
    const p = dev();
    const o = { addAgentIds: ['default-writer'], removeAgentIds: ['default-researcher'], addPageIds: ['idee'], removePageIds: ['task'], defaults: { homePageId: 'idee' } };
    const original = structuredClone({ p, o });
    const result = resolveRole(p, selectRole(p, o, refs), refs);
    expect(result.agentIds).toEqual(['default-implementer', 'default-day-planner', 'default-writer']);
    expect(result.pageIds).toEqual(['agenti', 'skill', 'fatto', 'idee']);
    expect(result.defaults).toEqual({ homePageId: 'idee', primaryAgentId: 'default-implementer' });
    expect({ p, o }).toEqual(original);
  });
  it('rejects conflicting add/remove instructions', () => {
    expect(() => validateOverrides({ addPageIds: ['idee'], removePageIds: ['idee'] }, refs)).toThrow('also added');
  });
  it('rejects removal of the default until a replacement is supplied', () => {
    expect(() => selectRole(dev(), { removeAgentIds: ['default-implementer'] }, refs)).toThrow('role[dev].defaults.primaryAgentId');
    expect(selectRole(dev(), { removeAgentIds: ['default-implementer'], defaults: { primaryAgentId: 'default-day-planner' } }, refs).overrides.defaults?.primaryAgentId).toBe('default-day-planner');
  });
  it('validates all added, removed and default references', () => {
    for (const key of ['addAgentIds', 'removeAgentIds', 'addPageIds', 'removePageIds']) {
      expect(() => validateOverrides({ [key]: ['absent'] }, refs)).toThrow(`overrides.${key}[0]`);
    }
    expect(() => selectRole(dev(), { defaults: { homePageId: 'absent' } }, refs)).toThrow('homePageId');
  });
  it.each(['permissions', 'model', 'engine', 'session', 'instructions'])('rejects unsupported %s at every untrusted entry', key => {
    expect(() => validatePreset({ ...dev(), [key]: true }, refs)).toThrow('unsupported field');
    expect(() => validateOverrides({ [key]: true }, refs)).toThrow('unsupported field');
    expect(() => validateSelection({ ...selection(), [key]: true }, refs)).toThrow('unsupported field');
    expect(() => validateOverrides({ defaults: { [key]: true } }, refs)).toThrow('unsupported field');
  });
  it('validates a serialized preferences roundtrip and returns independent objects', () => {
    const s = selectRole(dev(), { addPageIds: ['idee'] }, refs);
    const restored = validateSelection(JSON.parse(JSON.stringify(s)), refs);
    expect(restored).toEqual(s);
    restored.overrides.addPageIds!.push('costi');
    expect(s.overrides.addPageIds).toEqual(['idee']);
  });
  it('rejects identity mismatch and future selection revision', () => {
    expect(() => resolveRole(dev(), { ...selection(), presetId: 'qa' }, refs)).toThrow('selection.presetId');
    expect(() => resolveRole(dev(), { ...selection(), presetRevision: dev().revision+1 }, refs)).toThrow('downgrade');
  });
});

describe('preview, upgrade, reset and restore', () => {
  it('previews a preset switch, leaving preferences untouched and reversible', () => {
    const s = selectRole(dev(), { addPageIds: ['impostazioni'] }, refs), old = structuredClone(s);
    const preview = previewRoleChange(dev(), s, initialRolePreset('qa', refs), s.overrides, refs);
    expect(s).toEqual(old);
    expect(preview.after.pageIds).toContain('impostazioni');
    expect(preview.differences.find(d => d.field === 'homePageId')).toEqual({ field: 'homePageId', before: 'agenti', after: 'qualita' });
    expect(restoreRole(preview.previous, dev(), refs)).toEqual(old);
  });
  it('retains personal additions and removals across preset updates', () => {
    const p = dev(), s = selectRole(p, { addPageIds: ['idee'], removePageIds: ['task'] }, refs);
    const updated = { ...p, revision: p.revision+1, pageIds: [...p.pageIds, 'costi'] };
    const preview = previewRoleChange(p, s, updated, s.overrides, refs);
    expect(preview.next.presetRevision).toBe(p.revision+1);
    expect(preview.next.overrides).toEqual(s.overrides);
    expect(preview.after.pageIds).toEqual(['agenti', 'skill', 'fatto', 'costi', 'idee']);
    expect(restoreRole(preview.previous, p, refs)).toEqual(s);
    expect(() => restoreRole(preview.previous, updated, refs)).toThrow('exact retained preset revision');
  });
  it('keeps redundant overrides as intent for later revisions', () => {
    const p = dev(), s = selectRole(p, { addPageIds: ['task'], removePageIds: ['idee'] }, refs);
    const updated = { ...p, revision: p.revision+1, pageIds: [...p.pageIds.filter(id => id !== 'task'), 'idee'] };
    const resolved = resolveRole(updated, s, refs);
    expect(resolved.pageIds).toContain('task');
    expect(resolved.pageIds).not.toContain('idee');
  });
  it('shows a reset of dormant personal intent even when the resolved view is identical', () => {
    const p = dev(), s = selectRole(p, { removePageIds: ['idee'] }, refs);
    const preview = previewRoleChange(p, s, p, {}, refs);
    expect(preview.differences).toEqual([]);
    expect(preview.overrideDifferences).toEqual([{ field: 'removePageIds', before: ['idee'], after: null }]);
    const updated = { ...p, revision: p.revision+1, pageIds: [...p.pageIds, 'idee'] };
    expect(resolveRole(updated, preview.previous, refs).pageIds).not.toContain('idee');
    expect(resolveRole(updated, preview.next, refs).pageIds).toContain('idee');
  });
  it('requires the old revision for an honest before/after preview', () => {
    const p = dev();
    // Dev now ships revision2 after removing Explore; use a genuinely different revision, retaining the same guard.
    expect(() => previewRoleChange({ ...p, revision: p.revision+1 }, selection(), p, {}, refs)).toThrow('previously selected preset revision');
  });
  it('previews resetting overrides and can undo the reset', () => {
    const p = dev(), s = selectRole(p, { addPageIds: ['idee'], defaults: { homePageId: 'idee' } }, refs);
    const preview = previewRoleChange(p, s, p, {}, refs);
    expect(preview.after).toEqual(resolveRole(p, selection(), refs));
    expect(preview.differences.find(d => d.field === 'homePageId')?.after).toBe('agenti');
    expect(restoreRole(preview.previous, p, refs)).toEqual(s);
  });
  it('reports ordering differences as well as set membership', () => {
    const p = dev(), s = selection();
    const preview = previewRoleChange(p, s, { ...p, revision: p.revision+1, pageIds: [...p.pageIds].reverse() }, {}, refs);
    expect(preview.differences.some(d => d.field === 'pageIds')).toBe(true);
  });
  it('returns no differences for identical state and no shared preview references', () => {
    const p = dev(), s = selection(), preview = previewRoleChange(p, s, p, {}, refs);
    expect(preview.differences).toEqual([]);
    expect(preview.overrideDifferences).toEqual([]);
    preview.next.overrides.addPageIds = ['idee'];
    preview.after.pageIds.length = 0;
    expect(preview.previous).toEqual(s);
    expect(preview.before.pageIds).toEqual(p.pageIds);
  });
  it('fails restore after a reference has been deleted', () => {
    expect(() => restoreRole(selection(), dev(), { ...refs, agentIds: [] })).toThrow('does not exist');
  });
  it('has no launch, token or authorization input/output on repeated switches', () => {
    const before = JSON.stringify(refs);
    const p = dev();
    for (const target of initialRolePresets()) {
      const result = previewRoleChange(p, selection(), target, {}, refs);
      expect(Object.keys(result.next).sort()).toEqual(['overrides', 'presetId', 'presetRevision', 'schemaVersion']);
      expect(Object.keys(result.after).sort()).toEqual(['agentIds', 'defaults', 'pageIds', 'presetId', 'presetRevision']);
    }
    expect(JSON.stringify(refs)).toBe(before);
  });
});
