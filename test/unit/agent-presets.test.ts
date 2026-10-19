// Packaged role regression tests: pinned routing, conservative migration, upgrades and recoverable customized diffs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { AgentCatalogService } from '../../src/main/agents/catalog';
import { presetDraft, presetHash } from '../../src/main/agents/preset-support';
import { PRESET_PREAMBLE, roleAgentPresets } from '../../src/shared/agent-presets';
import { migrateExplorerRole } from '../../src/shared/role-preset-catalog';
import type { AgentModelChoice, AgentProfile } from '../../src/shared/agents';
import { emptySetup, recommendedAgents } from '../../src/renderer/lib/agent-setup';
import { isRoleGlyph } from '../../src/shared/agent-glyphs';

const dirs: string[] = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-presets-')); dirs.push(dir); return dir; };
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'registry', installed: null, authenticated: null, models: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }] }];
const open = (userData: string, model = 'two') => new AgentCatalogService({ userData, models, legacyRoutes: () => [{ kind: 'review', harness: 'claude', model, effort: null, why: '', since: '', evidence: '' }] });
function rewrite(dir: string, change: (profiles: AgentProfile[]) => void) {
  const file = path.join(dir, 'agents.v2.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as { profiles: AgentProfile[] };
  change(value.profiles); fs.writeFileSync(file, JSON.stringify(value));
}
it('gives every preset its own designed glyph and tone', () => {
  const presets = roleAgentPresets();
  expect(presets.every(p => p.avatar.kind === 'symbol' && isRoleGlyph(p.avatar.value))).toBe(true);
  expect(new Set(presets.map(p => p.avatar.kind === 'symbol' ? p.avatar.value : '')).size).toBe(presets.length);
  expect(new Set(presets.map(p => p.avatar.kind === 'symbol' ? p.avatar.tone : '')).size).toBe(presets.length);
});
it('installs ten full policies with the shared report contract and pins routing across reloads', () => {
  const dir = tmp(), catalog = open(dir).list();
  expect(catalog.problem).toBeNull();
  for (const preset of roleAgentPresets()) {
    const installed = catalog.profiles.find(p => p.id === preset.id)!;
    expect(installed.instructions).toContain(PRESET_PREAMBLE);
    expect(installed.instructions).toContain('Additional run-report fields:');
    expect(installed.manifest?.whenNotToUse).toBeTruthy();
    expect(installed.tools).toEqual(preset.tools);
    expect(installed.permissionCeiling).toBe(preset.permissionCeiling);
    expect(installed.presetHash).toBe(presetHash(installed));
  }
  expect(catalog.profiles.find(p => p.id === 'default-reviewer')?.model).toBe('two');
  expect(open(dir, 'one').list().profiles.find(p => p.id === 'default-reviewer')?.model).toBe('two');
  expect(catalog.archived).toHaveLength(5);
  expect(catalog.profiles.some(p => p.id === 'default-general')).toBe(true);
  expect(recommendedAgents({ ...emptySetup(), goals: 'sviluppo software' }, catalog.profiles)).toContain('default-implementer');
});
it('retires the seeds of a brand-new catalog silently, and announces a retirement in an existing one', () => {
  const dir = tmp(), events: string[] = [], legacyRoutes = () => [];
  expect(new AgentCatalogService({ userData: dir, models, legacyRoutes, presetEvent: e => events.push(e) }).list().archived).toHaveLength(5);
  expect(events).toEqual([]);
  rewrite(dir, profiles => { const p = profiles.find(p => p.id === 'default-research')!; p.status = 'active'; delete p.archivedAt; });
  new AgentCatalogService({ userData: dir, models, legacyRoutes, presetEvent: e => events.push(e) });
  expect(events).toEqual(['Ricerca: sostituito dai nuovi preset']);
});
it('waits for a ready engine: presets arrive at login and follow a re-login like the starters, unless customized', () => {
  const dir = tmp(), events: string[] = [], legacyRoutes = () => [];
  const ready = (engine: string, authenticated: boolean | null = true) => ({ ...models()[0]!, engine, installed: true, authenticated });
  let choices: AgentModelChoice[] = [{ ...models()[0]!, authenticated: false }];
  const catalog = new AgentCatalogService({ userData: dir, models: () => choices, legacyRoutes, presetEvent: e => events.push(e) });
  expect(catalog.list().profiles).toEqual([]);
  choices = [ready('claude')];
  const seeded = catalog.list();
  expect(roleAgentPresets().every(p => seeded.profiles.some(x => x.id === p.id && x.engine === 'claude' && x.model === 'one'))).toBe(true);
  expect(seeded.archived).toHaveLength(5);
  expect(events).toEqual([]);
  catalog.save({ ...seeded.profiles.find(p => p.id === 'default-writer')!, instructions: 'Mine' }, 'default-writer');
  choices = [ready('claude', false), ready('codex')];
  const rebound = catalog.list().profiles;
  expect(rebound.find(p => p.id === 'default-reviewer')).toMatchObject({ engine: 'codex', model: 'one', version: 2 });
  expect(rebound.find(p => p.id === 'default-reviewer')?.presetHash).toBe(presetHash(rebound.find(p => p.id === 'default-reviewer')!));
  expect(rebound.find(p => p.id === 'default-writer')).toMatchObject({ engine: 'claude', instructions: 'Mine' });
});
it('does not replace an unavailable explicit route with an arbitrary available model', () => {
  const reviewer = roleAgentPresets().find(p => p.id === 'default-reviewer')!;
  expect(presetDraft(reviewer, models(), [{ kind: 'review', harness: 'claude', model: 'missing', effort: null, why: '', since: '', evidence: '' }])).toBeNull();
});
it('upgrades pristine behaviour with history, while customized definitions retain an explicit diff', () => {
  const dir = tmp(); open(dir);
  rewrite(dir, profiles => {
    for (const id of ['default-reviewer', 'default-writer']) {
      const p = profiles.find(p => p.id === id)!;
      p.origin = { kind: 'preset', presetId: id, presetRevision: 0 };
      p.instructions = 'Previous packaged instructions';
      p.presetHash = presetHash(p);
      if (id === 'default-writer') { p.instructions = 'My custom instructions'; p.userLocked = true; }
    }
  });
  const catalog = open(dir).list();
  expect(catalog.problem).toBeNull();
  expect(catalog.profiles.find(p => p.id === 'default-reviewer')).toMatchObject({ version: 2, activeVersion: 2, model: 'two' });
  expect(catalog.profiles.find(p => p.id === 'default-writer')).toMatchObject({ instructions: 'My custom instructions', version: 1 });
  expect(catalog.presetUpdates).toHaveLength(1);
  expect(catalog.presetUpdates![0]!.differences.some(d => d.field === 'instructions' && d.before === 'My custom instructions')).toBe(true);
  expect(open(dir).list().profiles.find(p => p.id === 'default-reviewer')?.version).toBe(2);
});
it('keeps legacy seeds with usage or customized metadata and refuses retirement on corrupt usage', () => {
  const dir = tmp(); open(dir);
  rewrite(dir, profiles => {
    for (const p of profiles.filter(p => p.status === 'archived')) { p.status = 'active'; delete p.archivedAt; }
    profiles.find(p => p.id === 'default-writing')!.manifest = { output: 'My template' };
  });
  fs.writeFileSync(path.join(dir, 'chats.json'), JSON.stringify({ version: 2, chats: [{ agent: { id: 'default-development' } }] }));
  const catalog = open(dir).list();
  expect(catalog.profiles.some(p => p.id === 'default-development')).toBe(true);
  expect(catalog.profiles.some(p => p.id === 'default-writing')).toBe(true);
  fs.writeFileSync(path.join(dir, 'agent-runs.json'), 'corrupt');
  fs.writeFileSync(path.join(dir, 'chats.json'), JSON.stringify({ version: 2, chats: [] }));
  expect(open(dir).list().profiles.some(p => p.id === 'default-development')).toBe(true);
});
it('remaps old composition deltas and primary agent once, preserving unrelated preferences', () => {
  const selection = { schemaVersion: 1, presetId: 'dev', presetRevision: 2, overrides: { addAgentIds: ['default-writing', 'agent-mine'], removeAgentIds: ['default-development'], defaults: { primaryAgentId: 'default-writing' } } };
  const migrated = migrateExplorerRole(selection);
  expect(migrated).toMatchObject({ presetRevision: 3, overrides: { addAgentIds: ['default-writer', 'agent-mine'], removeAgentIds: ['default-implementer'], defaults: { primaryAgentId: 'default-writer' } } });
  expect(migrateExplorerRole(migrated)).toEqual(migrated);
  expect(selection.overrides.addAgentIds).toEqual(['default-writing', 'agent-mine']);
});
it('a saved role that names the old DevOps page follows its rename to Task (ADR 0079)', () => {
  const selection = { schemaVersion: 1, presetId: 'po', presetRevision: 3, overrides: { addPageIds: ['devops', 'costi', 'task'], removePageIds: ['devops'], defaults: { homePageId: 'devops' } } };
  const migrated = migrateExplorerRole(selection);
  expect(migrated).toMatchObject({ overrides: { addPageIds: ['task', 'costi'], removePageIds: ['task'], defaults: { homePageId: 'task' } } });
  expect(migrateExplorerRole(migrated)).toEqual(migrated);
});
it('a saved role that names the old Regole imparate page lands on Regole, where those rules live now (ADR 0082)', () => {
  const selection = { schemaVersion: 1, presetId: 'cto', presetRevision: 2, overrides: { addPageIds: ['miglioramento', 'regole'], defaults: { homePageId: 'miglioramento' } } };
  const migrated = migrateExplorerRole(selection);
  expect(migrated).toMatchObject({ overrides: { addPageIds: ['regole'], defaults: { homePageId: 'regole' } } });
  expect(migrateExplorerRole(migrated)).toEqual(migrated);
});
