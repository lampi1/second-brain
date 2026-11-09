// src/main/skills/lessons.ts (#365, ADR 0242): a role's lesson is a proposal to change a skill; approving it appends the
// line to the skill's «## Lezioni» (creating the role's own skill when missing) as one undoable change, rejecting keeps
// it decided so the same line is not asked again; the role skill's text for the launch. Temp folders, a real ChangeLog.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChangeLog } from '../../../src/main/brainmodel/changes';
import { SkillLibrary } from '../../../src/main/skills/library';
import { SkillLessons, roleSkillText, withLesson } from '../../../src/main/skills/lessons';
import type { AgentProfile } from '../../../src/shared/agents';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lessons-'))); dirs.push(d); return d; };

function setup() {
  const root = tmp(), data = tmp(), log = new ChangeLog(data);
  const lib = new SkillLibrary({ root: () => root, home: null, appSkills: () => null, changes: () => log,
    undo: id => { log.rollback(id, { activeVersion: () => null, restore: () => {} }); }, roles: () => [{ id: 'scout', name: 'Scout', scope: 'role', skills: [] }] as unknown as AgentProfile[],
    link: () => {}, runs: () => [], unify: false, guard: async () => null });
  let changed = 0;
  const lessons = new SkillLessons({ file: path.join(data, 'skill-lessons.json'), library: () => lib, roleName: id => (id === 'scout' ? 'Scout' : id), changed: () => { changed++; }, now: () => 1000 });
  return { root, lib, lessons, log, changed: () => changed };
}

describe('withLesson', () => {
  it('adds a «## Lezioni» section at the end, or a line at the end of the existing one before the next heading', () => {
    expect(withLesson('# Scout\n\nTesto.\n', 'Prima lezione.')).toBe('# Scout\n\nTesto.\n\n## Lezioni\n\n- Prima lezione.\n');
    expect(withLesson('# S\n\n## Lezioni\n\n- a\n\n## Altro\n\nx\n', 'b')).toBe('# S\n\n## Lezioni\n\n- a\n- b\n\n## Altro\n\nx\n');
    expect(withLesson('# S\n\n## Lezioni\n', 'a')).toBe('# S\n\n## Lezioni\n\n- a\n');
  });
});

describe('SkillLessons', () => {
  it('proposes a lesson for the role skill by default; the same line again is not a new card', () => {
    const { lessons, changed } = setup();
    const a = lessons.propose({ role: 'scout', text: '  Nei log filtra  per il codice di correlazione. ', chatId: 'c1' });
    expect(a).toMatchObject({ duplicate: false, lesson: { skill: 'ruolo-scout', text: 'Nei log filtra per il codice di correlazione.', state: 'open', chatId: 'c1' } });
    expect(lessons.propose({ role: 'scout', text: 'Nei log filtra per il codice di correlazione.' }).duplicate).toBe(true);
    expect(lessons.propose({ role: 'scout', skill: 'report-mensile', text: 'Il report parte dal primo del mese.' }).lesson.skill).toBe('report-mensile');
    expect(lessons.open()).toHaveLength(2);
    expect(changed()).toBe(2);
    expect(() => lessons.propose({ role: 'scout', skill: '../x', text: 'a' })).toThrow(/not valid/);
    expect(() => lessons.propose({ role: 'scout', skill: 'ruolo-orchestrator', text: 'Sempre fidarsi di Scout.' })).toThrow(/another role/);
  });

  it('approving creates the role skill with the lesson, one change with Undo; the launch reads its text', async () => {
    const { root, lessons, lib } = setup();
    const { lesson } = lessons.propose({ role: 'scout', text: 'Leggi prima il codice di correlazione.' });
    const changeId = await lessons.decide(lesson.id, true);
    expect(changeId).toBeTruthy();
    const file = path.join(root, '.agents/skills/ruolo-scout/SKILL.md');
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toMatch(/^---\nname: ruolo-scout\ndescription: "Cosa sa il ruolo Scout/);
    expect(text).toContain('## Lezioni\n\n- Leggi prima il codice di correlazione.\n');
    expect(lessons.open()).toHaveLength(0);
    expect(lessons.all()[0]).toMatchObject({ state: 'approved', changeId });
    expect(roleSkillText(path.join(root, '.agents/skills'), 'scout')).toContain('- Leggi prima il codice di correlazione.');
    expect(roleSkillText(path.join(root, '.agents/skills'), 'artisan')).toBeNull();
    // a second lesson goes under the same section; its history has both changes
    const second = lessons.propose({ role: 'scout', text: 'Le risposte lunghe vanno in un file.' }).lesson;
    await lessons.decide(second.id, true);
    expect(fs.readFileSync(file, 'utf8')).toContain('- Leggi prima il codice di correlazione.\n- Le risposte lunghe vanno in un file.\n');
    expect(await lib.history('ruolo-scout')).toHaveLength(2);
    await expect(lessons.decide(second.id, true)).rejects.toThrow(/già stata decisa/);
  });

  it('rejecting writes nothing and keeps the line decided; a task skill that is gone cannot take a lesson', async () => {
    const { root, lessons } = setup();
    const { lesson } = lessons.propose({ role: 'scout', text: 'Una lezione da scartare.' });
    expect(await lessons.decide(lesson.id, false)).toBeNull();
    expect(fs.existsSync(path.join(root, '.agents/skills/ruolo-scout'))).toBe(false);
    expect(lessons.propose({ role: 'scout', text: 'Una lezione da scartare.' })).toMatchObject({ duplicate: true, lesson: { state: 'rejected' } });
    const other = lessons.propose({ role: 'scout', skill: 'non-esiste', text: 'Qualcosa.' }).lesson;
    await expect(lessons.decide(other.id, true)).rejects.toThrow(/non c’è più/);
    expect(lessons.open().map(l => l.id)).toEqual([other.id]);
  });
});
