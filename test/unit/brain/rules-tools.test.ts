// App-owned template utilities, launch activation, reference migration and crash recovery (ADR 0062), all in temp
// folders: the release template is the repo's brain-template; no real brain, global settings, app or model is used.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useAssets } from '../../../src/main/rules/delivery';

const fakeAssets = { dir: '' };
const { useTemplateRoot, useToolsHome, ensureTools, topicSkillName, codeReferences } = await import('../../../src/main/rules/tools');
const { ideaTool } = await import('../../../src/main/brain/save-idea');
const { appSkillsIn } = await import('../../../src/main/agents/pack/shared-skills');
const { toolReferences } = await import('../../../src/main/rules/new-brain');
const { journalOf, migrate, recoverMigration } = await import('../../../src/main/rules/migration');
const {  } = await import('../../../src/main/brain/adapters/claude-plugin');
const { runHook } = await import('../../../src/main/rules/runtime');
const {  } = await import('../../../src/main/brain/detect');

const TEMPLATE = path.resolve(import.meta.dirname, '../../../brain-template');
const roots: string[] = [];
let base = '';
function brain(name = 'brain', product = true): string {
  const root = path.join(base, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Personal brain\n');
  if (product) fs.writeFileSync(path.join(root, 'brain.json'), JSON.stringify({ machinery: 'product-v1', template: { OWNER: "Anna D'Amico" }, rules: { topicFiles: [] } }));
  return root;
}
beforeEach(() => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tools-'))); roots.push(base);
  useToolsHome(path.join(base, 'userData')); useTemplateRoot(TEMPLATE);
  fakeAssets.dir = path.join(base, 'assets');
  fs.mkdirSync(path.join(fakeAssets.dir, 'hooks'), { recursive: true });
  for (const f of ['runtime.mjs', 'cli.mjs', 'hooks/runner.mjs', 'hooks/cli.mjs']) fs.writeFileSync(path.join(fakeAssets.dir, f), '// fixture\n');
  useAssets(fakeAssets.dir);
});
afterEach(() => { useToolsHome(null); useTemplateRoot(null); useAssets(null); for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

describe('product brain activation for Claude', () => {
  it('injects no topic text (#366: topics are skills) and leaves the correction reminder to the template hook when it runs', () => {
    const root = brain(), state = path.join(base, 'state');
    fs.writeFileSync(path.join(root, 'code.md'), '---\nwhen: {"prompt":["code"]}\n---\nRun `{tools}/ops/tools/brain-lint.mjs`.\n');
    fs.writeFileSync(path.join(root, 'brain.json'), JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: ['code.md'] } }));
    const input = { hook_event_name: 'UserPromptSubmit' as const, session_id: 's1', prompt: 'code: this is wrong' };
    const withHook = runHook(root, state, input, { tools: 'C:/app/tools', correctionHook: true });
    expect(withHook.context).toBeUndefined();
    expect(runHook(root, state, { ...input, session_id: 's2' }).context).toContain('correction');
  });
});

describe('product topic rules as app skills (#366, ADR 0243)', () => {
  it('renders each topic rule of the copy as an app skill, rendered for this brain, with no when: frontmatter', () => {
    const tools = ensureTools(brain());
    const topics = (JSON.parse(fs.readFileSync(path.join(tools, '.sb-tools.json'), 'utf8')) as { topics: string[] }).topics;
    expect(topics).toContain('rules/qa.md');
    expect(topicSkillName('rules/qa.md')).toBe('regole-qa');
    const md = fs.readFileSync(path.join(appSkillsIn(tools), 'regole-qa', 'SKILL.md'), 'utf8');
    expect(md).toMatch(/^---\nname: regole-qa\ndescription: "QA rules: product rules, read when a QA chat, a test case, verifying a fix\. Words that call it: qa, test case/);
    expect(md).not.toContain('when: {');
    expect(md).toContain("Anna D'Amico's rules for testing");
    expect(md).not.toContain('{{OWNER}}');
  });
  it('an adapter without the app skills (ACP) is told where each topic skill is; a brain without app rules is not', async () => {
    const { productInstructions } = await import('../../../src/main/rules/instructions');
    const root = brain();
    fs.writeFileSync(path.join(root, 'brain.json'), JSON.stringify({ machinery: 'product-v1', template: { OWNER: 'Anna' }, rules: { topicFiles: [], appRules: true } }));
    const tools = ensureTools(root);
    const text = productInstructions(root, true, tools)!;
    expect(text).toContain('- regole-qa: QA rules');
    expect(text).toContain(`${appSkillsIn(tools).replace(/\\/g, '/')}/regole-qa/SKILL.md`);
    expect(productInstructions(root, true, tools, false)).not.toContain('regole-qa'); // Codex: it has the folders
    // the brain's own copy, edited on the Skill page, wins
    fs.mkdirSync(path.join(root, '.agents/skills/regole-qa'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agents/skills/regole-qa/SKILL.md'), '---\nname: regole-qa\ndescription: My QA rules.\n---\nMine.\n');
    expect(productInstructions(root, true, tools)).toContain(`- regole-qa: My QA rules. Read ${root.replace(/\\/g, '/')}/.agents/skills/regole-qa/SKILL.md`);
    fs.writeFileSync(path.join(root, 'brain.json'), JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: [] } }));
    expect(productInstructions(root, true, tools)).not.toContain('regole-qa');
  });
});

describe('template reference migration', () => {
  it('the copy\'s own code names its commands in the copy, never in the brain folder that holds no tools', () => {
    const root = brain(), tools = ensureTools(root), B = root.replace(/\\/g, '/'), T = tools.replace(/\\/g, '/');
    for (const rel of ['.claude/hooks/compact-now.mjs', 'ops/tools/chat-prompt.mjs', 'harness/cursor/correction-log.mjs']) {
      const text = fs.readFileSync(path.join(tools, rel), 'utf8');
      expect(text, rel).toContain(`${T}/ops/tools/mem.mjs`);
      expect(text, rel).not.toContain(`${B}/ops/tools/mem.mjs`);
    }
    // the brain's own files stay brain paths, and a personal script is not the app's
    expect(codeReferences(`node "${B}/ops/tools/devops-me.mjs"; read ${B}/now.md`, root, tools)).toBe(`node "${B}/ops/tools/devops-me.mjs"; read ${B}/now.md`);
    // the hook installer's paths are data it writes and looks for: left as they were
    expect(fs.readFileSync(path.join(tools, 'ops/tools/install-inbox-hooks.mjs'), 'utf8')).toContain(`${B}/ops/tools/inbox.mjs`);
    // inside JavaScript the paths carry render's escaping, on both sides
    const esc = (v: string) => v.replace(/['"`$]/g, '\\$&');
    expect(codeReferences("x = 'node \"C:/o\\'brien (x86)+\\$1/ops/tools/mem.mjs\"'", "C:/o'brien (x86)+$1", "C:/app data/$&/t'ools", esc)).toBe("x = 'node \"C:/app data/\\$&/t\\'ools/ops/tools/mem.mjs\"'");
    // the AI's ideas are written with the copy's tool (a product brain has none of its own)
    expect(ideaTool(root)).toBe(path.join(tools, 'ops', 'tools', 'mem.mjs'));
    expect(ideaTool(brain('legacy', false))).toBeNull();
  });

  it('rewrites template code references only, absolute (both separators) or brain-relative', () => {
    const root = 'C:/Users/me/my brain';
    const text = [
      'node "C:/Users/me/my brain/ops/tools/mem.mjs" now me',
      'C:\\Users\\me\\my brain\\ops\\tools\\day.mjs',
      'run `node ops/tools/brain-lint.mjs` or `.claude/hooks/compact-now.mjs`',
      'personal: C:/Users/me/my brain/ops/tools/devops-me.mjs and ops/tools/qa-status.mjs',
      'already {tools}/ops/tools/mem.mjs; data C:/Users/me/my brain/now.md',
    ].join('\n');
    expect(toolReferences(text, root)).toBe([
      'node "{tools}/ops/tools/mem.mjs" now me',
      '{tools}/ops/tools/day.mjs',
      'run `node {tools}/ops/tools/brain-lint.mjs` or `{tools}/.claude/hooks/compact-now.mjs`',
      'personal: C:/Users/me/my brain/ops/tools/devops-me.mjs and ops/tools/qa-status.mjs',
      'already {tools}/ops/tools/mem.mjs; data C:/Users/me/my brain/now.md',
    ].join('\n'));
  });
});

describe('migration crash recovery', () => {
  function crashed(phase: 'before' | 'between' | 'after') {
    const root = brain('crash', false);
    const id = '00000000-0000-4000-8000-0000000000ab', tag = `brain-before-product-${id}`;
    const backup = `${root}.before-product-${id}`, stage = path.join(base, '.brain-product-x');
    fs.mkdirSync(stage); fs.writeFileSync(path.join(stage, 'brain.json'), '{"machinery":"product-v1"}');
    fs.writeFileSync(journalOf(root), JSON.stringify({ root, backup, tag, stage }));
    if (phase !== 'before') fs.renameSync(root, backup);
    if (phase === 'after') fs.renameSync(stage, root);
    return { root, backup, stage, tag };
  }
  it('refuses a new migration while a journal is pending', () => {
    const c = crashed('before');
    expect(() => migrate(c.root, [])).toThrow('recover');
  });
  it('before the renames: nothing changed, the stage is kept for inspection', () => {
    const c = crashed('before');
    expect(recoverMigration(c.root)).toEqual({ state: 'not-applied', root: c.root, stage: c.stage });
    expect(fs.readFileSync(path.join(c.root, 'AGENTS.md'), 'utf8')).toContain('Personal');
    expect(fs.existsSync(c.stage)).toBe(true);
    expect(fs.existsSync(journalOf(c.root))).toBe(false);
  });
  it('between the renames: the original brain is moved back', () => {
    const c = crashed('between');
    expect(fs.existsSync(c.root)).toBe(false);
    expect(recoverMigration(c.root).state).toBe('restored');
    expect(fs.readFileSync(path.join(c.root, 'AGENTS.md'), 'utf8')).toContain('Personal');
    expect(fs.existsSync(c.stage)).toBe(true);
  });
  it('after both renames: the migration stands and its receipt is returned', () => {
    const c = crashed('after');
    expect(recoverMigration(c.root)).toEqual({ state: 'applied', root: c.root, receipt: { root: c.root, backup: c.backup, tag: c.tag } });
    expect(fs.existsSync(path.join(c.backup, 'AGENTS.md'))).toBe(true);
  });
  it('refuses a journal naming paths migrate would not derive', () => {
    const c = crashed('between');
    fs.writeFileSync(journalOf(c.root), JSON.stringify({ root: c.root, backup: path.join(base, 'elsewhere'), tag: c.tag, stage: c.stage }));
    expect(() => recoverMigration(c.root)).toThrow('Invalid migration journal');
    expect(fs.existsSync(c.backup)).toBe(true);
  });
});
