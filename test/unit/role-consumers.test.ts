// The start dialog and the catalog page offer the eight work roles in their fixed order (never the Orchestrator, never
// Pulse, never an id the catalog does not have), and a role starts only when its engine and model can run now. The work
// profile (Il mio spazio) is navigation only and read tolerantly.
import { expect, it } from 'vitest';
import type { AgentCatalog, AgentModelChoice, AgentProfile } from '../../src/shared/agents';
import { WORK_ROLE_IDS } from '../../src/shared/roles';
import { WORK_PROFILES, workProfile } from '../../src/shared/work-profiles';
import { profileCanStart, workRoles } from '../../src/renderer/lib/role-consumers';

const role = (id: string) => ({ id, name: id, engine: 'claude', model: null }) as AgentProfile;
const catalog = (ids: string[]) => ({ profiles: ids.map(role), models: [], problem: null }) as AgentCatalog;

it('lists the work roles in the catalog order, never the Orchestrator or Pulse', () => {
  expect(workRoles(catalog(['orchestrator', ...[...WORK_ROLE_IDS].reverse(), 'pulse'])).map(p => p.id)).toEqual([...WORK_ROLE_IDS]);
  expect(workRoles(catalog(['orchestrator', 'scout', 'unknown'])).map(p => p.id)).toEqual(['scout']);
  expect(workRoles(null)).toEqual([]);
});
it('matches known start capabilities without turning unknown installation into a false denial', () => {
  const profile = role('scout'), choice = { enabled: true, trusted: true, installed: null, authenticated: null, defaultModel: true, modelSelectable: true, models: [{ id: 'known', name: 'Known' }], effort: true } as AgentModelChoice;
  expect(profileCanStart(profile, choice)).toBe(true);
  expect(profileCanStart({ ...profile, model: 'removed' }, choice)).toBe(false);
  expect(profileCanStart({ ...profile, model: 'known' }, choice)).toBe(true);
  expect(profileCanStart(profile, { ...choice, defaultModel: false })).toBe(false);
  expect(profileCanStart({ ...profile, effort: 'medium' }, { ...choice, effort: false })).toBe(false);
  expect(profileCanStart(profile, { ...choice, enabled: false })).toBe(false);
  expect(profileCanStart(undefined, choice)).toBe(false);
});
it('a work profile shows only the pages this build has, and an unknown saved id means no profile', () => {
  const pages = ['agenti', 'task', 'skill', 'fatto', 'qualita'];
  expect(workProfile('dev', pages)).toMatchObject({ id: 'dev', homePageId: 'agenti', pageIds: ['agenti', 'task', 'skill', 'fatto'] });
  expect(workProfile('qa', pages)?.pageIds).toEqual(['qualita', 'agenti', 'task', 'skill', 'fatto']);
  expect(workProfile('cto', pages)).toBeNull(); // its reference page (costi) is missing
  for (const saved of ['missing', undefined, 3, { id: 'dev' }]) expect(workProfile(saved, pages)).toBeNull();
  expect(new Set(WORK_PROFILES.map(p => p.id)).size).toBe(WORK_PROFILES.length);
});
