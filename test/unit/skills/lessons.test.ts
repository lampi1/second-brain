// src/main/skills/lessons.ts (#365, ADR 0242, 0257): a role's lesson is noted for the next Maintenance, never a card;
// the same line again counts once more; Maintenance marks what it read; a card from before ADR 0257 waits like the
// others; the role skill's text for the launch. Temp folders.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillLessons, roleSkillText } from '../../../src/main/skills/lessons';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lessons-'))); dirs.push(d); return d; };

function setup() {
  const data = tmp(), file = path.join(data, 'skill-lessons.json');
  let changed = 0, t = 1000;
  const lessons = new SkillLessons({ file, changed: () => { changed++; }, now: () => t++ });
  return { file, lessons, changed: () => changed };
}

describe('SkillLessons', () => {
  it('notes a lesson for the role skill by default; the same line again counts once more, never a new entry', () => {
    const { lessons, changed } = setup();
    const a = lessons.propose({ role: 'scout', text: '  Nei log filtra  per il codice di correlazione. ', chatId: 'c1' });
    expect(a).toMatchObject({ duplicate: false, lesson: { skill: 'ruolo-scout', text: 'Nei log filtra per il codice di correlazione.', state: 'noted', chatId: 'c1' } });
    expect(lessons.propose({ role: 'scout', text: 'Nei log filtra per il codice di correlazione.' })).toMatchObject({ duplicate: true, lesson: { seen: 2 } });
    expect(lessons.propose({ role: 'scout', skill: 'report-mensile', text: 'Il report parte dal primo del mese.' }).lesson.skill).toBe('report-mensile');
    expect(lessons.noted().map(l => [l.skill, l.seen ?? 1])).toEqual([['ruolo-scout', 2], ['report-mensile', 1]]);
    expect(changed()).toBe(2);
    expect(() => lessons.propose({ role: 'scout', skill: '../x', text: 'a' })).toThrow(/not valid/);
    expect(() => lessons.propose({ role: 'scout', skill: 'ruolo-orchestrator', text: 'Sempre fidarsi di Scout.' })).toThrow(/another role/);
  });

  it('Maintenance marks what it read: those leave the noted list; the same line noted later waits again', () => {
    const { lessons } = setup();
    const a = lessons.propose({ role: 'scout', text: 'Leggi prima il codice di correlazione.' }).lesson;
    const b = lessons.propose({ role: 'artisan', text: 'Le risposte lunghe vanno in un file.' }).lesson;
    lessons.reviewed([a]);
    expect(lessons.noted().map(l => l.id)).toEqual([b.id]);
    expect(lessons.all().find(l => l.id === a.id)).toMatchObject({ state: 'reviewed' });
    lessons.reviewed([]);
    expect(lessons.noted()).toHaveLength(1);
    // it came back in another chat: it waits again, points to that chat and is the most recently noted
    expect(lessons.propose({ role: 'scout', text: 'Leggi prima il codice di correlazione.', chatId: 'c9' })).toMatchObject({ duplicate: true, lesson: { id: a.id, state: 'noted', seen: 1, chatId: 'c9' } });
    expect(lessons.noted().map(l => l.id)).toEqual([b.id, a.id]);
    // noted once more after the research took its copy: it came back meanwhile and keeps waiting
    const shown = lessons.noted().map(l => ({ id: l.id, seen: l.seen }));
    lessons.propose({ role: 'artisan', text: 'Le risposte lunghe vanno in un file.' });
    lessons.reviewed(shown);
    expect(lessons.noted().map(l => [l.id, l.seen])).toEqual([[b.id, 2]]);
  });

  it('a card from before ADR 0257 waits for Maintenance; beyond 200 waiting lines the oldest leave', () => {
    const { file, lessons } = setup();
    fs.writeFileSync(file, JSON.stringify({ schema: 1, lessons: [{ id: 'old', at: 1, role: 'scout', skill: 'ruolo-scout', text: 'Una vecchia carta.', state: 'open' },
      { id: 'yes', at: 1, role: 'scout', skill: 'ruolo-scout', text: 'Una lezione approvata.', state: 'approved' }] }));
    expect(lessons.noted().map(l => [l.id, l.state])).toEqual([['old', 'noted']]);
    // one the user decided then stays decided
    expect(lessons.propose({ role: 'scout', text: 'Una lezione approvata.' })).toMatchObject({ duplicate: true, lesson: { id: 'yes', state: 'approved' } });
    for (let i = 0; i < 205; i++) lessons.propose({ role: 'scout', skill: `skill-${i}`, text: `Lezione numero ${i} sul passo ${i * 7}.` });
    const left = lessons.noted();
    expect(left).toHaveLength(200);
    expect(left.some(l => l.id === 'old')).toBe(false);
    expect(left.at(-1)!.skill).toBe('skill-204');
  });

  it('the launch reads the role skill\'s text without its frontmatter', () => {
    const root = tmp(), dir = path.join(root, 'ruolo-scout');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: ruolo-scout\ndescription: x\n---\n\n# Scout\n\n- Leggi prima il codice di correlazione.\n');
    expect(roleSkillText(root, 'scout')).toBe('# Scout\n\n- Leggi prima il codice di correlazione.');
    expect(roleSkillText(root, 'artisan')).toBeNull();
    expect(roleSkillText(null, 'scout')).toBeNull();
  });
});
