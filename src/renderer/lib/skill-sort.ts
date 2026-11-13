// The Skill page's order (owner 2026-11-10: «facile capire quali vengono usate di più e da chi, quante volte»): most
// used, most recently used or changed first, ties and the default by name. Used by components/SkillsPage.tsx; pinned
// by test/unit/renderer/skill-sort.test.ts.
import type { LibSkill } from '@shared/skill-library';

export type SortBy = 'name' | 'uses' | 'recent' | 'changed';
export const SORTS: readonly SortBy[] = ['name', 'uses', 'recent', 'changed'];

export function sortSkills(list: readonly LibSkill[], by: SortBy): LibSkill[] {
  const key = (s: LibSkill): number => (by === 'uses' ? s.totalUses : by === 'recent' ? s.lastUse ?? 0 : by === 'changed' ? s.changedAt ?? 0 : 0);
  return [...list].sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));
}
