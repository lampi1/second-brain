// Role settings transactions: previews do not mutate, invalid data stays recoverable, and persistence is atomic.
import { afterEach, expect, it, vi } from 'vitest';
import { rolePreview, savedRole } from '../../src/renderer/lib/role-preferences';
import { initialRolePresets } from '../../src/shared/role-preset-catalog';
import { loadPrefs, saveRolePreference, ui } from '../../src/renderer/store/ui';
const refs = { agentIds: ['general', 'researcher', 'writer', 'reviewer', 'day-planner', 'implementer'].map(id => `default-${id}`), pageIds: [...new Set(initialRolePresets().flatMap(p => p.pageIds))] };
afterEach(() => { vi.unstubAllGlobals(); ui.set(s => ({ ...s, prefs: loadPrefs(null, 0) })); });
it('previews first choice, keeps overrides across switches and does not mutate the saved selection', () => {
  const dev = rolePreview(undefined, 'dev', refs).next;
  dev.overrides.addAgentIds = ['default-writer'];
  const before = structuredClone(dev), next = rolePreview(dev, 'qa', refs);
  expect(dev).toEqual(before); expect(next.after.agentIds).toContain('default-writer');
  expect(savedRole(next.previous, refs).selection).toEqual(dev);
});
it('migrates retired explorer references without losing other role customizations or changing the saved object',()=>{
 const raw={schemaVersion:1,presetId:'dev',presetRevision:1,overrides:{addPageIds:['esplora','costi'],removePageIds:['esplora'],addAgentIds:['default-writer']}};
 const before=JSON.stringify(raw),resolved=savedRole(raw,refs).resolved;expect(resolved.pageIds).not.toContain('esplora');expect(resolved.pageIds).toContain('costi');expect(resolved.agentIds).toContain('default-writer');expect(JSON.stringify(raw)).toBe(before);
});
it('preserves malformed preferences for explicit recovery and rejects missing references/revisions', () => {
  const bad = { presetId: 'unknown' };
  expect(loadPrefs(JSON.stringify({ role: bad })).role).toEqual(bad);
  expect(() => rolePreview(bad, 'dev', refs)).toThrow();
  const dev = rolePreview(undefined, 'dev', refs).next;
  expect(() => savedRole({ ...dev, presetRevision: 999 }, refs)).toThrow();
  expect(() => rolePreview(undefined, 'qa', { ...refs, agentIds: ['default-implementer'] })).toThrow();
});
it('commits durable preferences preserving other fields, rejects stale apply and restores the prior choice', () => {
  const setItem = vi.fn(); vi.stubGlobal('localStorage', { setItem });
  ui.set(s => ({ ...s, prefs: { ...s.prefs, theme: 'dark' } }));
  const dev = rolePreview(undefined, 'dev', refs).next;
  saveRolePreference(dev, undefined);
  expect(JSON.parse(setItem.mock.calls[0]![1]).role).toEqual(dev);
  expect(ui.get().prefs.theme).toBe('dark');
  expect(() => saveRolePreference(undefined, undefined)).toThrow();
  saveRolePreference(undefined, JSON.stringify(dev));
  expect(ui.get().prefs.role).toBeUndefined();
});
it('does not publish an unsaved role after storage failure', () => {
  vi.stubGlobal('localStorage', { setItem: () => { throw Error('quota'); } });
  const before = ui.get().prefs;
  expect(() => saveRolePreference(rolePreview(undefined, 'dev', refs).next, undefined)).toThrow('quota');
  expect(ui.get().prefs).toBe(before);
});
it('accepts a preview from valid raw preferences with noncanonical key order', () => {
  vi.stubGlobal('localStorage', { setItem: vi.fn() });
  const raw = { presetId: 'dev', overrides: {}, presetRevision: 1, schemaVersion: 1 };
  ui.set(s => ({ ...s, prefs: loadPrefs(JSON.stringify({ role: raw })) }));
  const preview = { ...rolePreview(raw, 'qa', refs), expected: JSON.stringify(raw) };
  expect(JSON.stringify(preview.previous)).not.toBe(preview.expected);
  saveRolePreference(preview.next, preview.expected);
  expect(ui.get().prefs.role?.presetId).toBe('qa');
});
