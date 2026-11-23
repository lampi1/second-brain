// A deleted skill always has its Undo (ADR 0340 §5): src/main/skills/library.ts lists the skills deleted lately, Undo puts
// every file back, the user's own page also reaches their home folders while agents keep their refusal; a file removal
// with an old version of the file is refused. Temp folders and a real ChangeLog.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { skillTools } from '../../../src/main/appctl/skills';
import { ChangeLog } from '../../../src/main/brainmodel/changes';
import { brainHandlers } from '../../../src/main/ipc-handlers/brain';
import { packageFiles, SkillLibrary } from '../../../src/main/skills/library';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-undo-'))); dirs.push(d); return d; };
const put = (root: string, rel: string, text: string) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const md = (name: string) => `---\nname: ${name}\ndescription: Use for ${name}.\n---\n# ${name}\n`;
const PAGE = { who: 'tu', page: true };

function setup(o: { brain?: boolean } = {}) {
  const root = tmp(), home = tmp(), app = tmp(), log = new ChangeLog(tmp());
  const lib = new SkillLibrary({ root: () => (o.brain === false ? null : root), home, appSkills: () => app, changes: () => log,
    undo: id => { log.rollback(id, { activeVersion: () => null, restore: () => {} }); }, roles: () => [], link: () => {}, runs: () => [], unify: false, guard: async () => null });
  return { root, home, app, lib, log };
}
/** A package with nested files, CRLF lines, accents, a BOM and an empty file. */
const PACKAGE: Record<string, string> = {
  'SKILL.md': md('mia'), 'scripts/run.mjs': 'console.log(1)\r\nconsole.log(2)\r\n', 'scripts/lib/deep.py': 'print("perché")\n',
  'references/guida.md': '﻿# Guida\n', 'assets/queries/q.sql': 'SELECT 1', 'assets/vuoto.txt': '',
};
const putPackage = (dir: string) => { for (const [rel, text] of Object.entries(PACKAGE)) put(dir, rel, text); };
const bytes = (dir: string) => Object.fromEntries(packageFiles(dir).map(f => [f.path, fs.readFileSync(path.join(dir, f.path)).toString('hex')]));

describe('Undo of a deleted skill', () => {
  for (const [where, base] of [['the brain', 'root'], ['~/.claude/skills', 'home-claude'], ['~/.agents/skills', 'home-agents']] as const) {
    it(`${where}: the deleted skill is listed, Undo restores every file byte by byte, then the list is empty`, async () => {
      const s = setup();
      const dir = base === 'root' ? path.join(s.root, '.agents/skills/mia') : path.join(s.home, base === 'home-claude' ? '.claude' : '.agents', 'skills/mia');
      putPackage(dir);
      const before = bytes(dir);
      expect(Object.keys(before)).toHaveLength(6);
      const r = await s.lib.remove('mia', PAGE);
      expect(r).toMatchObject({ ok: true, changeId: expect.any(String) });
      expect(fs.existsSync(dir)).toBe(false);
      const changeId = (r as { changeId: string }).changeId;
      const deleted = (await s.lib.state()).deleted;
      expect(deleted).toEqual([{ name: 'mia', changeId, at: expect.any(Number), files: 6 }]);
      const h = await s.lib.undo('mia', changeId, { page: true });
      expect(bytes(dir)).toEqual(before);
      expect(h[0]).toMatchObject({ id: changeId, undoneAt: expect.any(Number) });
      const after = await s.lib.state();
      expect(after.deleted).toEqual([]);
      expect(after.skills.map(k => k.name)).toEqual(['mia']);
    });
  }

  it('lists only whole skills that are gone and can come back: not a removed file, a restored app skill, a name taken again', async () => {
    const { root, app, lib } = setup();
    put(root, '.agents/skills/resta/SKILL.md', md('resta'));
    put(root, '.agents/skills/resta/scripts/x.mjs', 'x');
    await lib.write({ skill: 'resta', path: 'scripts/x.mjs', text: null }, PAGE);
    put(app, 'dell-app/SKILL.md', md('dell-app'));
    await lib.write({ skill: 'dell-app', path: 'SKILL.md', text: `${md('dell-app')}mine` }, PAGE);
    await lib.remove('dell-app', PAGE);
    put(root, '.agents/skills/rifatta/SKILL.md', md('rifatta'));
    await lib.remove('rifatta', PAGE);
    expect((await lib.state()).deleted.map(d => d.name)).toEqual(['rifatta']);
    put(root, '.agents/skills/rifatta/SKILL.md', md('rifatta'));
    expect((await lib.state()).deleted).toEqual([]);
    // the app skill's history keeps the Undo of the copy that went away
    expect((await lib.history('dell-app', { page: true }))[0]).toMatchObject({ canUndo: true });
  });

  it('a home copy that replaced an app skill comes back from the app skill\'s history, on the page', async () => {
    const { home, app, lib } = setup();
    put(app, 'dell-app/SKILL.md', md('dell-app'));
    put(home, '.claude/skills/dell-app/SKILL.md', `${md('dell-app')}mine`);
    const r = await lib.remove('dell-app', PAGE) as { changeId: string };
    await lib.undo('dell-app', r.changeId, { page: true });
    expect(fs.readFileSync(path.join(home, '.claude/skills/dell-app/SKILL.md'), 'utf8')).toContain('mine');
  });

  it('the user\'s page sees the history of a deleted home skill, without a brain too', async () => {
    for (const brain of [true, false]) {
      const { home, lib } = setup({ brain });
      putPackage(path.join(home, '.claude/skills/mia'));
      const r = await lib.remove('mia', PAGE) as { changeId: string };
      const h = await lib.history('mia', { page: true });
      expect(h).toHaveLength(1);
      expect(h[0]).toMatchObject({ id: r.changeId, canUndo: true });
      expect(h[0]!.files.map(f => f.path).sort()).toEqual(Object.keys(PACKAGE).sort());
    }
  });

  it('agents keep their refusal: no history and no Undo of a deleted home skill, no Undo inside a home skill', async () => {
    const { home, lib } = setup();
    const dir = path.join(home, '.claude/skills/mia');
    putPackage(dir);
    const edit = await lib.write({ skill: 'mia', path: 'scripts/run.mjs', text: 'mine' }, PAGE) as { changeId: string };
    const undo = skillTools(lib, () => 'Orchestrator').find(t => t.name === 'app_skill_undo')!;
    await expect(Promise.resolve(undo.run({ skill: 'mia', changeId: edit.changeId }))).rejects.toThrow('pagina Skill');
    expect(fs.readFileSync(path.join(dir, 'scripts/run.mjs'), 'utf8')).toBe('mine');
    const r = await lib.remove('mia', PAGE) as { changeId: string };
    expect(await lib.history('mia')).toEqual([]);
    await expect(Promise.resolve(undo.run({ skill: 'mia', changeId: r.changeId }))).rejects.toThrow('non è della skill');
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('a skill Undo could not put back as it was is not deleted: a linked folder, a text that is not UTF-8', async () => {
    const { root, lib } = setup();
    const elsewhere = tmp();
    putPackage(elsewhere);
    fs.mkdirSync(path.join(root, '.agents/skills'), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(root, '.agents/skills/mia'), 'junction');
    expect(await lib.remove('mia', PAGE)).toMatchObject({ ok: false, error: expect.stringContaining('collegamento') });
    expect(Object.keys(bytes(elsewhere))).toHaveLength(6);
    put(root, '.agents/skills/latina/SKILL.md', md('latina'));
    fs.writeFileSync(path.join(root, '.agents/skills/latina/note.txt'), Buffer.from([0x63, 0x69, 0x74, 0x74, 0xe0]));
    expect(await lib.remove('latina', PAGE)).toMatchObject({ ok: false, error: expect.stringContaining('note.txt') });
    expect(fs.existsSync(path.join(root, '.agents/skills/latina/SKILL.md'))).toBe(true);
  });

  it('a name that is not a skill name reads no history', async () => {
    const { root, lib } = setup();
    putPackage(path.join(root, '.agents/skills/mia'));
    await lib.remove('mia', PAGE);
    for (const name of ['..', '.', '../skills', '']) expect(await lib.history(name, { page: true })).toEqual([]);
  });

  it('the page\'s channels ask as the page', async () => {
    const history = vi.fn(() => []), undo = vi.fn(() => []);
    const h = brainHandlers({ s: { skillLibrary: { history, undo } } } as never);
    await h['skills:history']({ skill: 'mia' }, {} as never);
    await h['skills:undo']({ skill: 'mia', changeId: 'c1' }, {} as never);
    expect(history).toHaveBeenCalledWith('mia', { page: true });
    expect(undo).toHaveBeenCalledWith('mia', 'c1', { page: true });
  });
});

describe('removing a file', () => {
  it('is refused when the file changed on disk after the user opened it', async () => {
    const { root, lib } = setup();
    putPackage(path.join(root, '.agents/skills/mia'));
    const file = path.join(root, '.agents/skills/mia/scripts/run.mjs');
    const opened = await lib.read('mia', 'scripts/run.mjs');
    fs.writeFileSync(file, 'newer');
    fs.utimesSync(file, new Date(opened.mtime + 5000), new Date(opened.mtime + 5000));
    expect(await lib.write({ skill: 'mia', path: 'scripts/run.mjs', text: null, mtime: opened.mtime }, PAGE)).toMatchObject({ ok: false, error: expect.stringContaining('cambiato su disco') });
    expect(fs.readFileSync(file, 'utf8')).toBe('newer');
    const again = await lib.read('mia', 'scripts/run.mjs');
    expect((await lib.write({ skill: 'mia', path: 'scripts/run.mjs', text: null, mtime: again.mtime }, PAGE)).ok).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });
});
