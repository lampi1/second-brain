// The Skill page's order (owner 2026-11-10: «facile capire quali vengono usate di più»): most used, recently used or
// changed first, ties and the default by name. Pins renderer/lib/skill-sort.ts.
import { describe, expect, it } from 'vitest';
import { sortSkills } from '../../../src/renderer/lib/skill-sort';
import type { LibSkill } from '../../../src/shared/skill-library';

const skill = (name: string, totalUses: number, lastUse: number | null, changedAt: number | null) => ({ name, totalUses, lastUse, changedAt }) as LibSkill;
const list = [skill('beta', 3, 10, 100), skill('alfa', 3, 30, null), skill('gamma', 9, 20, 50), skill('delta', 0, null, 200)];

describe('sortSkills', () => {
  it('orders by name, uses, last use or last change, ties by name', () => {
    expect(sortSkills(list, 'name').map(s => s.name)).toEqual(['alfa', 'beta', 'delta', 'gamma']);
    expect(sortSkills(list, 'uses').map(s => s.name)).toEqual(['gamma', 'alfa', 'beta', 'delta']);
    expect(sortSkills(list, 'recent').map(s => s.name)).toEqual(['alfa', 'gamma', 'beta', 'delta']);
    expect(sortSkills(list, 'changed').map(s => s.name)).toEqual(['delta', 'beta', 'gamma', 'alfa']);
    expect(list.map(s => s.name)).toEqual(['beta', 'alfa', 'gamma', 'delta']);
  });
});
