// The Skill page's order (owner 2026-11-10: «facile capire quali vengono usate di più e da chi, quante volte»; 2026-11-23:
// «navigabile ordinabile e vedere chiaramente quelle più usate e meno usate»): most used, least used, most recently used,
// last changed, by source (Brain first, then App), or by name; ties by name. Used by components/SkillsPage.tsx; pinned
// by test/unit/renderer/skill-sort.test.ts.
import type { LibSkill } from '@shared/skill-library';

export type SortBy = 'uses' | 'least' | 'recent' | 'changed' | 'origin' | 'name';
export const SORTS: readonly SortBy[] = ['uses', 'least', 'recent', 'changed', 'origin', 'name'];

const ORIGIN_RANK = { brain: 0, app: 1 } as const;

export function sortSkills(list: readonly LibSkill[], by: SortBy): LibSkill[] {
  const byName = (a: LibSkill, b: LibSkill) => a.name.localeCompare(b.name);
  if (by === 'least') return [...list].sort((a, b) => a.totalUses - b.totalUses || (a.lastUse ?? 0) - (b.lastUse ?? 0) || byName(a, b));
  if (by === 'origin') return [...list].sort((a, b) => ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin] || b.totalUses - a.totalUses || byName(a, b));
  const key = (s: LibSkill): number => (by === 'uses' ? s.totalUses : by === 'recent' ? s.lastUse ?? 0 : by === 'changed' ? s.changedAt ?? 0 : 0);
  return [...list].sort((a, b) => key(b) - key(a) || byName(a, b));
}
