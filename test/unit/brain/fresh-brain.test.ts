// A clean install starts from an EMPTY brain (the owner, 2026-10-18; ADR 0072): a brain created the way setup does
// (the automatic memory) holds only the owner's profile and brain.json, the
// brain pages find no rules, skills or memory in it, and the app still delivers its machinery (boot rules, topic
// rules, agents, skills, hooks, the model table) from its own copy outside the folder. Temp folders only: the release
// template is the repo's brain-template; no real brain, global settings, app or model is used.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useAssets } from '../../../src/main/rules/delivery';
import { FRESH_FILES, writeFreshBrain } from '../../../src/main/rules/new-brain';
import { useTemplateRoot, useToolsHome } from '../../../src/main/rules/tools';
import { isBrainFolder } from '../../../src/main/brain/detect';
import { procedureSections } from '../../../src/main/brainmodel/procedure-sources';
import { readMemory, readRules, readSkills } from '../../../src/main/brainmodel/model';
import { SkillsService } from '../../../src/main/skills/service';
import { parseProfile } from '../../../src/main/brain/profile';
import { DefaultBrain } from '../../../src/modules/ai-first/default-brain';

const TEMPLATE = path.resolve(import.meta.dirname, '../../../brain-template');
let base = '';
const roots: string[] = [];
/** every file under `dir` (forward slashes), the brain's own .git left out */
function tree(dir: string, rel = ''): string[] {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(e => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (r === '.git') return [];
    return e.isDirectory() ? tree(dir, r) : [r];
  }).sort();
}
beforeEach(() => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-fresh-'))); roots.push(base);
  useToolsHome(path.join(base, 'userData')); useTemplateRoot(TEMPLATE);
  const assets = path.join(base, 'assets');
  fs.mkdirSync(path.join(assets, 'hooks'), { recursive: true });
  for (const f of ['runtime.mjs', 'cli.mjs', 'hooks/runner.mjs', 'hooks/cli.mjs']) fs.writeFileSync(path.join(assets, f), '// fixture\n');
  useAssets(assets);
});
afterEach(() => { useToolsHome(null); useTemplateRoot(null); useAssets(null); for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

function fresh(name = 'brain'): string {
  const root = path.join(base, name);
  fs.mkdirSync(root);
  writeFreshBrain(root, { OWNER: 'Mario Rossi', ROLE: 'consultant', LANG: 'italiano', HARNESSES: 'Claude Code', TODAY: '2026-10-18' });
  return root;
}

describe('a fresh brain is empty of app content', () => {
  it('holds only the profile, brain.json and the credentials .gitignore', () => {
    const root = fresh();
    expect(tree(root)).toEqual([...FRESH_FILES].sort());
    const json = JSON.parse(fs.readFileSync(path.join(root, 'brain.json'), 'utf8'));
    expect(json).toMatchObject({ machinery: 'product-v1', template: { OWNER: 'Mario Rossi', ROLE: 'consultant' }, rules: { topicFiles: [], appRules: true } });
    const me = fs.readFileSync(path.join(root, 'me.md'), 'utf8');
    // the owner's typed facts, no preset rules: no working style, safety table or app instructions
    const profile = parseProfile(me);
    expect(profile).toMatchObject({ name: 'Mario Rossi', role: 'consultant', language: 'italiano', mainWork: [], rules: [] });
    expect(me).not.toMatch(/Safety|Reply style|Regole delle azioni|\{\{|brain-rules|AGENTS\.md/);
    expect(isBrainFolder(root)).toBe(true);
  });

  it('shows no skills, rules, memory or former runbooks on the brain pages', () => {
    const root = fresh();
    expect(procedureSections(root)).toEqual([]); // nothing for the one-time migration
    expect(readSkills([{ dir: path.join(root, '.claude', 'skills'), home: 'brain' }], root, [])).toEqual([]);
    expect(readRules(root)).toEqual([]);
    expect(readMemory(root, [])).toEqual([]);
    const home = path.join(base, 'home'); fs.mkdirSync(home);
    const skills = new SkillsService({ home, roots: () => [root], guard: async () => null, trash: async () => {} });
    expect(skills.list().entries).toEqual([]);
  });

  it('the setup automatic memory is a fresh brain too, with an empty projects folder', async () => {
    const userData = path.join(base, 'app'); fs.mkdirSync(userData);
    let current: string | null = null;
    const created = await new DefaultBrain({ userData, templateRoot: TEMPLATE, current: () => current, revision: () => 0, connect: async r => { current = r; } }).ensure('it', 'none');
    expect(created.connected).toBe(true);
    expect(tree(created.root)).toEqual([...FRESH_FILES].sort());
    expect(fs.readdirSync(path.join(created.root, 'projects'))).toEqual([]);
    expect(parseProfile(fs.readFileSync(path.join(created.root, 'me.md'), 'utf8'))).toMatchObject({ name: 'Tu', language: 'italiano', rules: [] });
  });

  it('the automatic memory points REPOS at the owner\'s projects folder when the setup knows it', async () => {
    const userData = path.join(base, 'app2'), projects = path.join(base, 'my-projects'); fs.mkdirSync(userData); fs.mkdirSync(projects);
    let current: string | null = null;
    const created = await new DefaultBrain({ userData, templateRoot: TEMPLATE, current: () => current, revision: () => 0, connect: async r => { current = r; }, projects: () => projects }).ensure('it', 'none');
    expect(fs.existsSync(path.join(created.root, 'projects'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(created.root, 'brain.json'), 'utf8')).template.REPOS).toBe(projects.split(path.sep).join('/'));
  });

  it('never writes into a folder that already has files (a legacy brain keeps all of them)', () => {
    const legacy = path.join(base, 'legacy'); fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'AGENTS.md'), '# My brain\n');
    fs.writeFileSync(path.join(legacy, 'routines.md'), '# Routines\n');
    expect(() => writeFreshBrain(legacy)).toThrow();
    expect(tree(legacy)).toEqual(['AGENTS.md', 'routines.md']);
  });
});
