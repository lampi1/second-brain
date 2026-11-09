// src/main/skills/layout.ts: the brain keeps one copy of its skills in .agents/skills and .claude/skills links to it
// (#361). Temp folders only; git is a fake (rules.md §7).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { unifySkillFolders } from '../../../src/main/skills/layout';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-layout-'))); dirs.push(d); return d; };
const put = (root: string, rel: string, text: string) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

describe('unifySkillFolders', () => {
  it('moves .claude/skills into .agents/skills, drops identical duplicates, links back and keeps the link out of git', async () => {
    const root = tmp(), rm: string[] = [];
    put(root, '.claude/skills/report/SKILL.md', 'a');
    put(root, '.claude/skills/report/scripts/run.mjs', 'x');
    put(root, '.claude/skills/same/SKILL.md', 's');
    put(root, '.agents/skills/same/SKILL.md', 's');
    const r = await unifySkillFolders(root, { gitRm: async d => { rm.push(d); } });
    expect(r.state).toBe('linked');
    expect(r.moved.sort()).toEqual(['report', 'same']);
    expect(fs.lstatSync(path.join(root, '.claude/skills')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(root, '.claude/skills/report/scripts/run.mjs'), 'utf8')).toBe('x');
    expect(fs.readFileSync(path.join(root, '.agents/skills/report/SKILL.md'), 'utf8')).toBe('a');
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toContain('/.claude/skills');
    expect(rm).toEqual([root]);
    expect((await unifySkillFolders(root)).state).toBe('already');
  });

  it('stops before overwriting: a name with different files in both folders keeps both', async () => {
    const root = tmp();
    put(root, '.claude/skills/x/SKILL.md', 'mine');
    put(root, '.agents/skills/x/SKILL.md', 'other');
    const r = await unifySkillFolders(root, { gitRm: async () => {} });
    expect(r).toMatchObject({ state: 'kept', conflicts: ['x'] });
    expect(fs.readFileSync(path.join(root, '.claude/skills/x/SKILL.md'), 'utf8')).toBe('mine');
    expect(fs.readFileSync(path.join(root, '.agents/skills/x/SKILL.md'), 'utf8')).toBe('other');
  });

  it('links a brain with no .claude/skills yet; a link that cannot be made leaves the skills in .agents/skills', async () => {
    const root = tmp();
    expect((await unifySkillFolders(root)).state).toBe('linked');
    const other = tmp();
    put(other, '.claude/skills/y/SKILL.md', 'y');
    const r = await unifySkillFolders(other, { gitRm: async () => {}, link: () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); } });
    expect(r.state).toBe('kept');
    expect(fs.readFileSync(path.join(other, '.agents/skills/y/SKILL.md'), 'utf8')).toBe('y');
  });
  it('makes its own dangling link again (the brain folder moved), relative outside Windows; a user\'s link stays', async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, '.agents/skills/x'), { recursive: true });
    fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
    // a link of the user's own to somewhere offline stays as it is
    fs.symlinkSync(path.join(root, 'offline-drive'), path.join(root, '.claude/skills'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await unifySkillFolders(root, { gitRm: async () => {} })).state).toBe('already');
    expect(fs.readlinkSync(path.join(root, '.claude/skills')).replace(/[\\/]+$/, '')).toBe(path.join(root, 'offline-drive'));
    fs.unlinkSync(path.join(root, '.claude/skills'));
    // the app's own link from where the brain was before
    fs.symlinkSync(path.join(root, 'moved-away', '.agents', 'skills'), path.join(root, '.claude/skills'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await unifySkillFolders(root, { gitRm: async () => {} })).state).toBe('linked');
    expect(fs.existsSync(path.join(root, '.claude/skills/x'))).toBe(true);
    if (process.platform !== 'win32') expect(fs.readlinkSync(path.join(root, '.claude/skills'))).toBe(path.join('..', '.agents', 'skills'));
    expect((await unifySkillFolders(root, { gitRm: async () => {} })).state).toBe('already');
  });
});
