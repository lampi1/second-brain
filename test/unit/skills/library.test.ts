// src/main/skills/library.ts: every skill as a package (brain, user, app), writes as undoable changes with a per-skill
// history (#361-#364), an app skill edited as a brain copy. Temp folders and a real ChangeLog in a temp userData.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChangeLog } from '../../../src/main/brainmodel/changes';
import { SkillLibrary, areaOf } from '../../../src/main/skills/library';
import type { AgentProfile, AgentRun } from '../../../src/shared/agents';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lib-'))); dirs.push(d); return d; };
const put = (root: string, rel: string, text: string | Buffer) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const md = (name: string, description = `Use for ${name}.`, extra = '') => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n# ${name}\n`;

function setup(o: { roles?: Partial<AgentProfile>[]; runs?: Partial<AgentRun>[] } = {}) {
  const root = tmp(), app = tmp(), data = tmp();
  const log = new ChangeLog(data);
  const links: [string, string, boolean][] = [];
  const roles = (o.roles ?? [{ id: 'scout', name: 'Scout', skills: ['code-investigation'] }]).map(r => ({ scope: 'role', skills: [], ...r })) as AgentProfile[];
  const lib = new SkillLibrary({ root: () => root, home: null, appSkills: () => app, changes: () => log,
    undo: id => { log.rollback(id, { activeVersion: () => null, restore: () => {} }); }, roles: () => roles,
    link: (s, r, on) => { links.push([s, r, on]); }, runs: () => (o.runs ?? []) as AgentRun[], unify: false, guard: async () => null });
  return { root, app, lib, links, log };
}

describe('SkillLibrary', () => {
  it('lists the brain, then the app: a brain skill of an app name replaces it; files of the whole package, binary marked', async () => {
    const { root, app, lib } = setup({ runs: [{ agentId: 'scout', startedAt: 5, tags: { skills: ['code-investigation'] } } as never] });
    put(app, 'code-investigation/SKILL.md', md('code-investigation', 'Investigate code.', 'metadata:\n  area: codice\n'));
    put(app, 'code-review/SKILL.md', md('code-review'));
    put(root, '.agents/skills/code-review/SKILL.md', md('code-review', 'Mine.'));
    put(root, '.agents/skills/code-review/assets/logo.png', Buffer.from([0x89, 0x50, 0, 1, 2]));
    put(root, '.agents/skills/code-review/scripts/run.mjs', 'console.log(1)');
    const s = await lib.state();
    const inv = s.skills.find(k => k.name === 'code-investigation')!, rev = s.skills.find(k => k.name === 'code-review')!;
    expect(inv).toMatchObject({ origin: 'app', area: 'codice', roles: ['scout'], totalUses: 1, uses: [{ role: 'scout', uses: 1, lastAt: 5 }] });
    expect(rev).toMatchObject({ origin: 'brain', overridesApp: true, description: 'Mine.' });
    expect(rev.files.map(f => `${f.path}:${f.text}`)).toEqual(['SKILL.md:true', 'assets/logo.png:false', 'scripts/run.mjs:true']);
    expect((await lib.read('code-review', 'assets/logo.png')).text).toBeNull();
  });

  it('creates a skill in .agents/skills, edits a script, and each change is in its history with Undo', async () => {
    const { root, lib } = setup();
    const created = await lib.write({ skill: 'report-mensile', path: 'SKILL.md', text: md('report-mensile') }, { who: 'Orchestrator' });
    expect(created).toMatchObject({ ok: true, skill: { origin: 'brain' } });
    expect(fs.existsSync(path.join(root, '.agents/skills/report-mensile/SKILL.md'))).toBe(true);
    const edited = await lib.write({ skill: 'report-mensile', path: 'scripts/build.mjs', text: 'export {}' }, { who: 'tu' });
    expect(edited.ok).toBe(true);
    const h = await lib.history('report-mensile');
    expect(h.map(v => v.files.map(f => f.path))).toEqual([['scripts/build.mjs'], ['SKILL.md']]);
    expect(h[0]).toMatchObject({ canUndo: true, files: [{ before: null, after: 'export {}' }] });
    // the list names the latest live change of each skill, a file deep in the package included (one pass over the history)
    const latest = (await lib.state()).skills.find(k => k.name === 'report-mensile')!;
    expect(latest).toMatchObject({ changedAt: h[0]!.at, madeBy: h[0]!.job });
    // the older one cannot be undone before the newer: here they touch different files, so both can
    await lib.undo('report-mensile', h[0]!.id);
    expect(fs.existsSync(path.join(root, '.agents/skills/report-mensile/scripts/build.mjs'))).toBe(false);
    expect((await lib.history('report-mensile'))[0]!.undoneAt).not.toBeNull();
    expect((await lib.state()).skills.find(k => k.name === 'report-mensile')!.madeBy).toBe(h[1]!.job);
  });

  it('a skill folder that is a link keeps its latest change in the list (the log records the link\'s target)', async () => {
    const { root, lib } = setup();
    const target = tmp();
    put(target, 'SKILL.md', md('collegata'));
    fs.mkdirSync(path.join(root, '.agents/skills'), { recursive: true });
    fs.symlinkSync(target, path.join(root, '.agents/skills/collegata'), 'junction');
    const w = await lib.write({ skill: 'collegata', path: 'SKILL.md', text: md('collegata', 'Linked.') }, { who: 'tu' });
    expect(w.ok).toBe(true);
    const [v] = await lib.history('collegata');
    expect((await lib.state()).skills.find(k => k.name === 'collegata')).toMatchObject({ changedAt: v!.at, madeBy: v!.job });
  });

  it('edits an app skill as a brain copy of its whole package; removing the copy restores the original', async () => {
    const { root, app, lib } = setup();
    put(app, 'explain/SKILL.md', md('explain'));
    put(app, 'explain/references/style.md', 'tone');
    const r = await lib.write({ skill: 'explain', path: 'SKILL.md', text: md('explain', 'Better.') }, { who: 'tu' });
    expect(r).toMatchObject({ ok: true, skill: { origin: 'brain', overridesApp: true, description: 'Better.' } });
    expect(fs.readFileSync(path.join(root, '.agents/skills/explain/references/style.md'), 'utf8')).toBe('tone');
    expect(fs.readFileSync(path.join(app, 'explain/SKILL.md'), 'utf8')).toBe(md('explain'));
    expect((await lib.remove('explain', { who: 'tu' })).ok).toBe(true);
    expect((await lib.skill('explain')).origin).toBe('app');
    expect((await lib.remove('explain', { who: 'tu' })).ok).toBe(false);
  });

  it('refuses paths outside the package, a SKILL.md with errors or another name, and unknown skills without a SKILL.md', async () => {
    const { root, lib } = setup();
    put(root, '.agents/skills/a/SKILL.md', md('a'));
    for (const p of ['../b/SKILL.md', '/etc/passwd', 'scripts/../../x', '.hidden']) expect((await lib.write({ skill: 'a', path: p, text: 'x' }, { who: 't' })).ok).toBe(false);
    expect(await lib.write({ skill: 'a', path: 'SKILL.md', text: md('b') }, { who: 't' })).toMatchObject({ ok: false, error: expect.stringContaining('name') });
    expect(await lib.write({ skill: 'a', path: 'SKILL.md', text: 'no frontmatter' }, { who: 't' })).toMatchObject({ ok: false });
    expect(await lib.write({ skill: 'nuova', path: 'scripts/x.sh', text: 'x' }, { who: 't' })).toMatchObject({ ok: false, error: expect.stringContaining('SKILL.md') });
    expect(await lib.write({ skill: 'Bad Name', path: 'SKILL.md', text: md('x') }, { who: 't' })).toMatchObject({ ok: false });
  });

  it('gives a skill to roles from its page, and refuses to take a role\'s default skill away', async () => {
    const { root, lib, links } = setup({ roles: [{ id: 'scout', name: 'Scout', skills: ['a'] }, { id: 'sentinel', name: 'Sentinel', skills: [], knowhow: { linked: [] } as never }, { id: 'builder', name: 'Builder', skills: [], knowhow: { linked: ['b'] } as never }] });
    put(root, '.agents/skills/a/SKILL.md', md('a'));
    put(root, '.agents/skills/b/SKILL.md', md('b'));
    await lib.setRoles('b', ['sentinel']);
    expect(links).toEqual([['b', 'sentinel', true], ['b', 'builder', false]]);
    await expect(lib.setRoles('a', [])).rejects.toThrow('predefinita');
  });

  it('review notes: home skills only from the page, binaries and other SKILL.md spellings refused, a delete that would lose files refused, roles checked before any change', async () => {
    const home = tmp();
    const { root, lib, links } = setup({ roles: [{ id: 'scout', name: 'Scout', skills: ['a'] }, { id: 'sentinel', name: 'Sentinel', skills: [], knowhow: { linked: [] } as never }] });
    const withHome = new SkillLibrary({ root: () => null, home, appSkills: () => null, changes: () => new ChangeLog(tmp()), undo: () => {}, roles: () => [], link: () => {}, runs: () => [], unify: false, guard: async () => null });
    expect(await withHome.write({ skill: 'mia', path: 'SKILL.md', text: md('mia') }, { who: 'Orchestrator' })).toMatchObject({ ok: false });
    expect(await withHome.write({ skill: 'mia', path: 'SKILL.md', text: md('mia') }, { who: 'tu', page: true })).toMatchObject({ ok: true, skill: { origin: 'home' } });
    expect(fs.existsSync(path.join(home, '.claude/skills/mia/SKILL.md'))).toBe(true);
    expect(await withHome.write({ skill: 'mia', path: 'scripts/x.mjs', text: 'x' }, { who: 'Orchestrator' })).toMatchObject({ ok: false, error: expect.stringContaining('pagina Skill') });
    expect((await withHome.remove('mia', { who: 'Orchestrator' })).ok).toBe(false);

    put(root, '.agents/skills/a/SKILL.md', md('a'));
    put(root, '.agents/skills/a/assets/logo.png', Buffer.from([0x89, 0x50, 0, 1, 2]));
    expect(await lib.write({ skill: 'a', path: 'assets/logo.png', text: null }, { who: 't' })).toMatchObject({ ok: false, error: expect.stringContaining('binario') });
    expect(await lib.write({ skill: 'a', path: 'assets/logo.png', text: 'x' }, { who: 't' })).toMatchObject({ ok: false, error: expect.stringContaining('binario') });
    for (const p of ['skill.md', 'SKILL.md.', 'Skill.MD', 'scripts/x.']) expect((await lib.write({ skill: 'a', path: p, text: 'x' }, { who: 't' })).ok).toBe(false);
    expect(await lib.remove('a', { who: 't' })).toMatchObject({ ok: false, error: expect.stringContaining('assets/logo.png') });
    put(root, '.agents/skills/b/SKILL.md', md('b'));
    put(root, '.agents/skills/b/.env', 'SECRET=1');
    expect(await lib.remove('b', { who: 't' })).toMatchObject({ ok: false, error: expect.stringContaining('.env') });
    expect(fs.existsSync(path.join(root, '.agents/skills/b/.env'))).toBe(true);

    // the same text again: ok, nothing in the history
    expect(await lib.write({ skill: 'a', path: 'SKILL.md', text: md('a') }, { who: 't' })).toMatchObject({ ok: true, changeId: null });
    await expect(lib.setRoles('a', ['sentinel'])).rejects.toThrow('predefinita');
    expect(links).toEqual([]);
  });

  it('lists the package warnings of a skill (#373)', async () => {
    const { lib } = setup();
    await lib.write({ skill: 'vago', path: 'SKILL.md', text: '---\nname: vago\ndescription: Helps with things.\n---\nRun scripts/x.sh.\n' }, { who: 'Orchestrator' });
    const k = (await lib.state()).skills.find(x => x.name === 'vago')!;
    expect(k.warnings.map(w => w.code)).toEqual(['no-when', 'missing-file']);
  });

  it('reads the area from the frontmatter', () => {
    expect(areaOf('---\nname: x\narea: dati\n---\n')).toBe('dati');
    expect(areaOf('---\nname: x\nmetadata:\n  area: "rilasci"\n---\n')).toBe('rilasci');
    expect(areaOf('# no front')).toBeNull();
  });
});
