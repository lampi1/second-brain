// ADR 0085: every role has every permission by default, and the owner's roles still on ADR 0083's restrictive defaults
// move to the full ones once, only when the user never edited them (agents/role-migrate.ts through agents/catalog.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { ADR0083_DEFAULTS, PRE_ADR0100_INSTRUCTIONS, SHIPPED_BEFORE, fiveRolesTextFor, fullDefaultsFor, shippedTextFor } from '../../../src/main/agents/role-migrate';
import { TOOL_CLASSES, type AgentModelChoice, type AgentProfile } from '../../../src/shared/agents';
import { ROLE_DEFAULTS, ROLE_IDS, defaultPermissions, launchGap, isRoleId } from '../../../src/shared/roles';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
const models = (): AgentModelChoice[] => [{ engine: 'claude', label: 'Claude', enabled: true, trusted: true, effort: true, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: true, authenticated: true }];
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-migrate-')); roots.push(dir);
  return { dir, make: () => new AgentCatalogService({ userData: dir, models }) };
}
/** Rewrites roles.json as a build of ADR 0083 left it, then lets `patch` change single roles. */
function asBefore(dir: string, patch: (p: Record<string, unknown>) => void = () => {}) {
  const file = path.join(dir, 'roles.json'), raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { roles: Record<string, unknown>[] };
  for (const p of raw.roles) {
    if (!isRoleId(p.id)) continue;
    const old = ADR0083_DEFAULTS[p.id];
    Object.assign(p, { tools: { allow: [...old.tools] }, permissionCeiling: old.ceiling, launches: [...old.launches], ...(old.instructions ? { instructions: old.instructions } : {}) });
    patch(p);
  }
  fs.writeFileSync(file, JSON.stringify(raw));
}

describe('full default permissions (ADR 0085)', () => {
  it('a fresh install: every role has every tool class and no ceiling, and every default launch fits', () => {
    const { make } = setup(), list = make().list().profiles.filter(p => p.scope === 'role');
    for (const p of list) {
      expect([p.id, [...p.tools!.allow].sort()]).toEqual([p.id, [...TOOL_CLASSES].sort()]);
      expect(p.permissionCeiling).toBeNull();
      expect(defaultPermissions(p.id as never, p.tools, p.permissionCeiling)).toBe(true);
      for (const kid of p.launches) expect(launchGap(ROLE_DEFAULTS[kid as never as 'scout'].tools, p.tools!.allow)).toEqual([]);
    }
    expect(list.find(p => p.id === 'strategist')!.launches).toEqual(expect.arrayContaining(['artisan', 'sentinel', 'herald']));
    expect(defaultPermissions('scout', { allow: ['read'] }, null)).toBe(false);
    expect(defaultPermissions('scout', { allow: [...TOOL_CLASSES] }, 'plan')).toBe(false);
  });

  it('moves the roles the user never edited, keeps the edited ones and a maintenance lesson, once', () => {
    const { dir, make } = setup();
    make();
    asBefore(dir, p => {
      if (p.id === 'scout') Object.assign(p, { userLocked: true, lastEditedBy: 'user', tools: { allow: ['read', 'web'] } });
      if (p.id === 'sentinel') Object.assign(p, { lastEditedBy: 'maintenance', instructions: 'Sentinel with a learned lesson.' });
    });
    const after = make().list().profiles;
    const get = (id: string) => after.find(p => p.id === id)!;
    for (const id of ROLE_IDS.filter(r => r !== 'scout')) {
      expect([id, [...get(id).tools!.allow].sort(), get(id).permissionCeiling]).toEqual([id, [...TOOL_CLASSES].sort(), null]);
      expect(get(id)).toMatchObject({ version: 1, activeVersion: 1, lastEditedBy: 'default', userLocked: false, launches: ROLE_DEFAULTS[id].launches });
    }
    expect(get('strategist').instructions).toBe(ROLE_DEFAULTS.strategist.instructions);
    expect(get('orchestrator').instructions).toBe(ROLE_DEFAULTS.orchestrator.instructions);
    expect(get('sentinel').instructions).toBe('Sentinel with a learned lesson.');
    expect(get('scout')).toMatchObject({ version: 1, tools: { allow: ['read', 'web'] }, permissionCeiling: 'default', userLocked: true });
    const history = make().history('artisan');
    // in place (ADR 0186): the migration is a note on version 1, not a version of its own
    expect(history).toHaveLength(1);
    expect(history[0]!.amended).toEqual([expect.objectContaining({ by: 'default', reason: 'Permessi completi predefiniti (ADR 0085)' })]);
    // a second start changes nothing
    expect(make().list().profiles.map(p => p.version)).toEqual(after.map(p => p.version));
  });

  it('leaves a role alone when its policy is not exactly the old default, or it is on trial', () => {
    const base = { id: 'sentinel', userLocked: false, lastEditedBy: 'default' as const, tools: { allow: [...ADR0083_DEFAULTS.sentinel.tools] }, permissionCeiling: ADR0083_DEFAULTS.sentinel.ceiling, launches: [...ADR0083_DEFAULTS.sentinel.launches], instructions: 'x' } satisfies Partial<AgentProfile>;
    expect(fullDefaultsFor(base)).toMatchObject({ permissionCeiling: null, launches: ROLE_DEFAULTS.sentinel.launches, instructions: 'x' });
    expect(fullDefaultsFor({ ...base, tools: { allow: ['read'] } })).toBeNull();
    expect(fullDefaultsFor({ ...base, permissionCeiling: 'plan' })).toBeNull();
    expect(fullDefaultsFor({ ...base, tools: { allow: ['read', 'shell', 'mcp'], mcp: ['devops'] } })).toBeNull();
    expect(fullDefaultsFor({ ...base, trial: { version: 2, baseline: 1, startedAt: 1 } })).toBeNull();
    expect(fullDefaultsFor({ ...base, lastEditedBy: 'user' })).toBeNull();
    expect(fullDefaultsFor({ ...base, id: 'pulse' })).toBeNull();
  });

  it('ADR 0100: an untouched pre-0100 role text (it named Router or Judge, or lacked the merged jobs) moves to today\'s; an edited one stays', () => {
    const base = { id: 'strategist', userLocked: false, lastEditedBy: 'default' as const, instructions: PRE_ADR0100_INSTRUCTIONS.strategist! };
    expect(fiveRolesTextFor(base)).toEqual({ instructions: ROLE_DEFAULTS.strategist.instructions });
    expect(fiveRolesTextFor({ ...base, id: 'sentinel', instructions: PRE_ADR0100_INSTRUCTIONS.sentinel! })).toEqual({ instructions: ROLE_DEFAULTS.sentinel.instructions });
    expect(fiveRolesTextFor({ ...base, instructions: 'My plan text.' })).toBeNull();
    expect(fiveRolesTextFor({ ...base, lastEditedBy: 'user' })).toBeNull();
    expect(fiveRolesTextFor({ ...base, userLocked: true })).toBeNull();
    expect(fiveRolesTextFor({ ...base, id: 'judge' })).toBeNull();
    for (const [id, text] of Object.entries(PRE_ADR0100_INSTRUCTIONS)) expect(text).not.toBe(ROLE_DEFAULTS[id as 'scout'].instructions);
    expect(PRE_ADR0100_INSTRUCTIONS.strategist).toMatch(/Judge/); expect(PRE_ADR0100_INSTRUCTIONS.orchestrator).toMatch(/Router/);
    for (const id of ['orchestrator', 'strategist', 'artisan', 'sentinel'] as const) expect(ROLE_DEFAULTS[id].instructions).not.toMatch(/Router|Judge|Scribe/);
  });

  it('#145: an untouched Herald on the older shipped text gets the one that asks the user when a send is denied; an edited one stays', () => {
    const base = { id: 'herald', userLocked: false, lastEditedBy: 'default' as const, instructions: SHIPPED_BEFORE.herald![0]! };
    expect(shippedTextFor(base)).toEqual({ instructions: ROLE_DEFAULTS.herald.instructions });
    expect(ROLE_DEFAULTS.herald.instructions).toMatch(/denied.*ask the user here, in this chat.*exact command.*Esegui/);
    expect(shippedTextFor({ ...base, instructions: ROLE_DEFAULTS.herald.instructions })).toBeNull();
    expect(shippedTextFor({ ...base, instructions: 'My herald.' })).toBeNull();
    expect(shippedTextFor({ ...base, lastEditedBy: 'user' })).toBeNull();
    expect(shippedTextFor({ ...base, userLocked: true })).toBeNull();
    for (const [id, texts] of Object.entries(SHIPPED_BEFORE)) expect(texts).not.toContain(ROLE_DEFAULTS[id as 'herald'].instructions);
  });
});
