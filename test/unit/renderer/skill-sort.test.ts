// The Skill page's order (owner 2026-11-10: «facile capire quali vengono usate di più»; 2026-11-23: least used and source
// too): ties by name, the input list untouched. Pins renderer/lib/skill-sort.ts.
import { describe, expect, it } from 'vitest';
import { SORTS, sortSkills } from '../../../src/renderer/lib/skill-sort';
import type { LibSkill, SkillOrigin } from '../../../src/shared/skill-library';

const skill = (name: string, totalUses: number, lastUse: number | null, changedAt: number | null, origin: SkillOrigin = 'brain') => ({ name, totalUses, lastUse, changedAt, origin }) as LibSkill;
const list = [skill('beta', 3, 10, 100), skill('alfa', 3, 30, null, 'app'), skill('gamma', 9, 20, 50, 'app'), skill('delta', 0, null, 200)];
const names = (by: (typeof SORTS)[number]) => sortSkills(list, by).map(s => s.name);

describe('sortSkills', () => {
  it('orders by name, uses, last use or last change, ties by name', () => {
    expect(names('name')).toEqual(['alfa', 'beta', 'delta', 'gamma']);
    expect(names('uses')).toEqual(['gamma', 'alfa', 'beta', 'delta']);
    expect(names('recent')).toEqual(['alfa', 'gamma', 'beta', 'delta']);
    expect(names('changed')).toEqual(['delta', 'beta', 'gamma', 'alfa']);
    expect(list.map(s => s.name)).toEqual(['beta', 'alfa', 'gamma', 'delta']);
  });
  it('least used first (a tie: the one unused for longer), and by source: Brain, then App', () => {
    expect(names('least')).toEqual(['delta', 'beta', 'alfa', 'gamma']);
    expect(names('origin')).toEqual(['beta', 'delta', 'gamma', 'alfa']);
  });
});
