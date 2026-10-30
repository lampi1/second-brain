// The work profile (Il mio spazio, src/shared/work-profiles.ts) is navigation only and read tolerantly: it shows only
// the pages this build has, and an unknown saved id means no profile.
import { expect, it } from 'vitest';
import { WORK_PROFILES, workProfile } from '../../src/shared/work-profiles';

it('a work profile shows only the pages this build has, and an unknown saved id means no profile', () => {
  const pages = ['agenti', 'task', 'skill', 'andamento'];
  expect(workProfile('dev', pages)).toMatchObject({ id: 'dev', homePageId: 'agenti', pageIds: ['agenti', 'task', 'skill'] });
  expect(workProfile('qa', pages)?.pageIds).toEqual(['andamento', 'agenti', 'task', 'skill']);
  expect(workProfile('cto', pages)?.pageIds).toEqual(['andamento', 'agenti', 'task']); // Costi and Qualità are Andamento's tabs (ADR 0202)
  expect(workProfile('po', pages)).toBeNull(); // its reference page (idee) is missing
  for (const saved of ['missing', undefined, 3, { id: 'dev' }]) expect(workProfile(saved, pages)).toBeNull();
  expect(new Set(WORK_PROFILES.map(p => p.id)).size).toBe(WORK_PROFILES.length);
});
