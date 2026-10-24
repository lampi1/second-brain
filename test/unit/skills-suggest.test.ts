// Skill suggestions keep only real fits (#159): an off-topic request gets none (no five weak matches in name order),
// an on-topic one still gets the right skill first; generated skill names stay short.
import { describe, expect, it } from 'vitest';
import { SkillSuggester } from '../../src/main/skills/suggest';
import { skillName } from '../../src/main/brainmodel/jobs';

const skills = [
  { name: 'example-app-qa', description: 'Run the QA checklist of the ExampleApp app before a release.' },
  { name: 'apri-issue-app', description: 'Apri una issue GitHub per un bug della app second-brain.' },
  { name: 'brief-mattutino', description: 'Il brief del mattino: calendario, mail, task del giorno.' },
  { name: 'caveman-review', description: 'Review a pull request in plain words, short sentences.' },
  { name: 'deploy-backend', description: 'Deploy the backend service to staging with the pipeline.' },
];

describe('skill suggestions (#159)', () => {
  it('an off-topic request gets no suggestion', async () => {
    const r = await new SkillSuggester().suggest('Indaga come vengono valutati gli agenti e i loro punteggi di successo', skills);
    expect(r.candidates).toEqual([]);
  });

  it('an on-topic request gets the right skill first, without weak followers', async () => {
    const r = await new SkillSuggester().suggest('apri una issue per questo bug della app', skills);
    expect(r.candidates[0]?.name).toBe('apri-issue-app');
    expect(r.candidates.every(c => c.score >= r.candidates[0]!.score / 2)).toBe(true);
  });

  it('equal low scores give an empty list, not the first names in alphabetical order', async () => {
    const same = ['a-one', 'b-two', 'c-three', 'd-four'].map(name => ({ name, description: 'Notes about the release checklist and other things to remember later on.' }));
    const r = await new SkillSuggester().suggest('release planning meeting agenda budget', same);
    expect(r.candidates).toEqual([]);
  });

  it('a generated name keeps the key words, at most 40 characters', () => {
    const name = skillName('Brain maintenance: fai manutenzione solo quando Alex lo chiede esplicitamente in chat', new Set());
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name.startsWith('brain-maintenance-fai-manutenzione')).toBe(true);
    expect(skillName('Brief', new Set(['brief']))).toBe('brief-2');
  });
});
