// A clean install starts from an EMPTY brain (the owner, 2026-10-18; ADR 0072): a brain created the way setup does
// (the automatic memory, BrainCreator's staged installer output) holds only the owner's profile and brain.json, the
// brain pages find no rules, skills or memory in it, and the app still delivers its machinery (boot rules, topic
// rules, agents, skills, hooks, the model table) from its own copy outside the folder. Temp folders only: the release
// template is the repo's brain-template; no real brain, global settings, app or model is used.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { useAssets } from '../../../src/main/rules/delivery';
import { FRESH_FILES, prepareNewBrain, writeFreshBrain } from '../../../src/main/rules/new-brain';
import { brainFile, ensureTools, useTemplateRoot, useToolsHome } from '../../../src/main/rules/tools';
import { claudeLaunch } from '../../../src/main/brain/adapters/claude-plugin';
import { productInstructions } from '../../../src/main/rules/instructions';
import { runHook } from '../../../src/main/rules/runtime';
import { isBrainFolder } from '../../../src/main/brain/detect';
import { procedureSections } from '../../../src/main/brainmodel/procedure-sources';
import { readMemory, readRules, readSkills } from '../../../src/main/brainmodel/model';
import { SkillsService } from '../../../src/main/skills/service';
import { parseProfile } from '../../../src/main/brain/profile';
import { Routing } from '../../../src/main/brain/routing';
import { DefaultBrain } from '../../../src/modules/ai-first/default-brain';

const TEMPLATE = path.resolve(import.meta.dirname, '../../../brain-template');
const fwd = (p: string) => p.replace(/\\/g, '/');
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

  it('BrainCreator\'s staged installer output becomes the same empty brain (the template copy is removed whole)', () => {
    const stage = path.join(base, 'stage'); fs.mkdirSync(stage);
    const destination = path.join(base, 'Personal brain');
    const home = path.join(base, 'home'); fs.mkdirSync(home);
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k))), PATH: '', HOME: home, USERPROFILE: home };
    const r = spawnSync(process.execPath, [path.join(TEMPLATE, 'install.mjs'), '--yes', '--home', home, '--name', 'Mario', '--harness', 'claude', '--dir', destination, '--output-dir', stage], { env, encoding: 'utf8', timeout: 30000, windowsHide: true });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(stage, 'hub.md'))).toBe(true); // the installer copied the whole template
    prepareNewBrain(stage, destination, { OWNER: 'Mario', ROLE: 'consultant', LANG: 'italiano' });
    expect(tree(stage)).toEqual([...FRESH_FILES].sort());
    expect(fs.readdirSync(home)).toEqual([]);
  }, 60_000);

  it('never writes into a folder that already has files (a legacy brain keeps all of them)', () => {
    const legacy = path.join(base, 'legacy'); fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'AGENTS.md'), '# My brain\n');
    fs.writeFileSync(path.join(legacy, 'routines.md'), '# Routines\n');
    expect(() => writeFreshBrain(legacy)).toThrow();
    expect(tree(legacy)).toEqual(['AGENTS.md', 'routines.md']);
  });
});

describe('the app still delivers its machinery to a fresh brain', () => {
  it('boot rules, topic rules, agents, skills and hooks come from the app copy; the brain is not touched', () => {
    const root = fresh();
    const before = tree(root);
    const userData = path.join(base, 'userData');
    const launch = claudeLaunch(userData, { domains: [{ name: 'brain', root }] });
    const tools = fwd(ensureTools(root));
    expect(tools.startsWith(fwd(path.join(userData, 'brain-tools')))).toBe(true);
    // the plugin: the product's agents, skills and output styles, the product hooks, the boot rules
    expect(launch.args).toContain('--plugin-dir');
    for (const f of ['skills/code-review/SKILL.md', 'skills/code-investigation/SKILL.md', 'skills/brain-edit/SKILL.md', 'skills/flow-review/SKILL.md', 'skills/create-agent/SKILL.md', 'skills/explain/SKILL.md', 'output-styles/orchestrator.md']) {
      expect(fs.existsSync(path.join(launch.pluginDir!, f)), f).toBe(true);
    }
    const hooks = fs.readFileSync(path.join(launch.pluginDir!, 'hooks/hooks.json'), 'utf8');
    expect(hooks).toContain('product-rules/hooks/runner.mjs');
    expect(hooks).toContain('correction-catch.mjs');
    const rules = fs.readFileSync(launch.rulesFile!, 'utf8');
    expect(rules).toContain(`# Personal brain: ${fwd(root)}`);
    expect(rules).toContain('Safety: production and shared systems');
    expect(rules).toContain('# Mario Rossi'); // the owner's own profile follows the product's text
    // topic rules: the template's, rendered in the copy, injected by the hook runtime from there
    const topics = JSON.parse(fs.readFileSync(path.join(tools, '.sb-tools.json'), 'utf8')).topics as string[];
    for (const t of ['hub.md', 'code.md', 'brain-rules.md', 'map.md', 'routines.md']) expect(topics).toContain(t);
    const hub = fs.readFileSync(path.join(tools, 'hub.md'), 'utf8');
    expect(hub).toContain(`node ${tools}/ops/tools/chat-prompt.mjs`);
    expect(hub).not.toMatch(/\{\{[A-Z_]+\}\}|\{tools\}/);
    const injected = runHook(root, path.join(base, 'state'), { hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'coordina le altre chat come orchestrator' }, { tools });
    expect(injected.context).toContain(`Topic ${tools}/hub.md`);
    // the Codex / Cursor text gets the boot rules and topic text too
    expect(productInstructions(root, true, tools)).toContain('Topic ');
    // the model and price table: the app's until the owner adds one
    expect(fwd(brainFile(root, 'harness/models.json')!)).toBe(`${tools}/harness/models.json`);
    expect(new Routing(() => root).registry()?.models.length).toBeGreaterThan(0);
    // nothing of this landed in the brain
    expect(tree(root)).toEqual(before);
  }, 60_000);

  it('a brain file the owner writes wins over the app copy', () => {
    const root = fresh();
    fs.mkdirSync(path.join(root, 'harness'));
    fs.writeFileSync(path.join(root, 'harness/models.json'), JSON.stringify({ models: [] }));
    expect(brainFile(root, 'harness/models.json')).toBe(path.join(root, 'harness/models.json'));
    fs.mkdirSync(path.join(root, '.claude/skills/code-review'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude/skills/code-review/SKILL.md'), '---\nname: code-review\ndescription: mine\n---\nMy review.\n');
    const launch = claudeLaunch(path.join(base, 'userData'), { domains: [{ name: 'brain', root }] });
    expect(fs.readFileSync(path.join(launch.pluginDir!, 'skills/code-review/SKILL.md'), 'utf8')).toContain('My review.');
    expect(fs.existsSync(path.join(launch.pluginDir!, 'agents'))).toBe(false); // the product ships no sub-agents
  }, 60_000);
});
