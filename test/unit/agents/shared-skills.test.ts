// The skills a role may load at start (agents/pack/shared-skills.ts, #146): the brain's and the user's first, the
// app's rendered copy of its shipped skills last, so a Scout's code-investigation loads also in a brain with
// rules.appRules false, and a brain skill of the same name stays the brain's.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appSkillsIn, skillFolders, skillsIn } from '../../../src/main/agents/pack/shared-skills';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-shared-skills-')); dirs.push(d); return d; };
const skill = (folder: string, name: string, text = name) => { fs.mkdirSync(path.join(folder, name), { recursive: true }); fs.writeFileSync(path.join(folder, name, 'SKILL.md'), text); };

describe('shared skills', () => {
  it('finds the app-shipped skills in the tools copy when the brain has none (appRules false)', () => {
    const brain = tmp(), tools = tmp();
    skill(appSkillsIn(tools), 'code-investigation');
    fs.mkdirSync(path.join(appSkillsIn(tools), '{{BRAIN_NAME}}'), { recursive: true });
    const found = skillsIn(skillFolders({ root: brain, home: null, appTools: tools }));
    expect(found.map(s => s.name)).toEqual(['code-investigation']);
    expect(found[0]!.folder).toBe(path.join(appSkillsIn(tools), 'code-investigation'));
  });
  it('a brain skill of the same name wins over the app copy', () => {
    const brain = tmp(), tools = tmp();
    skill(path.join(brain, '.claude/skills'), 'code-review', 'mine');
    skill(appSkillsIn(tools), 'code-review', 'app');
    const found = skillsIn(skillFolders({ root: brain, home: null, appTools: tools }));
    expect(found).toEqual([{ name: 'code-review', folder: path.join(brain, '.claude/skills', 'code-review') }]);
  });
  it('the app copy is the last place looked in', () => {
    expect(skillFolders({ root: '/b', home: '/h', appTools: '/t' }).at(-1)).toBe(appSkillsIn('/t'));
    expect(skillFolders({ root: '/b', home: null, appTools: null })).toHaveLength(2);
  });
});

it('ignores a regular non-skill file beside skill directories', () => {
  const root = tmp(); skill(root, 'usable');
  fs.writeFileSync(path.join(root, 'notes'), 'not a skill folder');
  expect(skillsIn([root]).map(s => s.name)).toEqual(['usable']);
});
