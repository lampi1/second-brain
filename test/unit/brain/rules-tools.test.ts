// App-owned template utilities, launch activation, reference migration and crash recovery (ADR 0062), all in temp
// folders: the release template is the repo's brain-template; no real brain, global settings, app or model is used.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { useAssets } from '../../../src/main/rules/delivery';

const fakeAssets = { dir: '' };
const { brainScript, ensureTools, templateHooks, toolsDir, useTemplateRoot, useToolsHome, REPLACED_HOOKS } = await import('../../../src/main/rules/tools');
const { toolReferences } = await import('../../../src/main/rules/new-brain');
const { journalOf, migrate, planMigration, recoverMigration } = await import('../../../src/main/rules/migration');
const { claudeLaunch } = await import('../../../src/main/brain/adapters/claude-plugin');
const { runHook } = await import('../../../src/main/rules/runtime');
const { isBrainFolder } = await import('../../../src/main/brain/detect');

const TEMPLATE = path.resolve(import.meta.dirname, '../../../brain-template');
const roots: string[] = [];
let base = '';
const fwd = (p: string) => p.replace(/\\/g, '/');
function brain(name = 'brain', product = true): string {
  const root = path.join(base, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Personal brain\n');
  if (product) fs.writeFileSync(path.join(root, 'brain.json'), JSON.stringify({ machinery: 'product-v1', template: { OWNER: "Anna D'Amico" }, rules: { topicFiles: [] } }));
  return root;
}
function git(root: string, ...args: string[]): void {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k))), GIT_CONFIG_GLOBAL: path.join(base, 'no-config'), GIT_CONFIG_NOSYSTEM: '1' };
  const r = spawnSync('git', ['-C', root, '-c', 'core.hooksPath=' + path.join(base, 'no-hooks'), '-c', 'commit.gpgSign=false', ...args], { windowsHide: true, encoding: 'utf8', env });
  expect(r.status, r.stderr).toBe(0);
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

describe('app-owned template utilities', () => {
  it('renders the release utilities per brain outside it, reused until the release or values change', () => {
    const root = brain();
    const dir = ensureTools(root);
    expect(dir.startsWith(path.join(base, 'userData', 'brain-tools'))).toBe(true);
    expect(fs.readdirSync(root).sort()).toEqual(['AGENTS.md', 'brain.json']); // nothing written into the brain
    const mem = fs.readFileSync(path.join(dir, 'ops/tools/mem.mjs'), 'utf8');
    expect(mem).toContain(`'${fwd(root)}'`);
    expect(mem).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(fs.readFileSync(path.join(dir, 'ops/tools/day.mjs'), 'utf8')).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(fs.existsSync(path.join(dir, 'ops/tools/brain-site/index.html'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'ops/tools/inbox.test.mjs'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.sb-tools.json'), 'utf8')).root).toBe(fs.realpathSync(root));
    const stamp = fs.statSync(path.join(dir, 'ops/tools/mem.mjs')).mtimeMs;
    expect(ensureTools(root)).toBe(dir);
    expect(fs.statSync(path.join(dir, 'ops/tools/mem.mjs')).mtimeMs).toBe(stamp);
    fs.writeFileSync(path.join(root, 'brain.json'), JSON.stringify({ machinery: 'product-v1', template: { OWNER: 'Other' }, rules: { topicFiles: [] } }));
    expect(ensureTools(root)).toBe(dir);
    expect(fs.readFileSync(path.join(dir, 'ops/tools/mem.mjs'), 'utf8')).toContain('Other');
    expect(fs.readdirSync(path.dirname(dir)).filter(n => n.includes('.new-') || n.includes('.old-'))).toEqual([]);
  }, 60_000); // renders the whole release template three times: slow on a loaded machine (check:branch runs 200 files)
  it('a rendered tool serves the brain, not its own folder (brain-root.mjs)', () => {
    const root = brain();
    fs.writeFileSync(path.join(root, 'now.md'), '# Now\n\n## Agenti e sessioni attive\n\n');
    const dir = ensureTools(root);
    const r = spawnSync(process.execPath, [path.join(dir, 'ops/tools/mem.mjs'), 'now', 'me', '--label', 'Fixture chat', '--text', 'tools test · rendered copy · check'], { encoding: 'utf8', windowsHide: true, cwd: base });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(fs.readFileSync(path.join(root, 'now.md'), 'utf8')).toContain('Fixture chat');
    expect(fs.existsSync(path.join(dir, 'now.md'))).toBe(false);
  }, 60_000);
  it('resolves app scripts: product template code → copy; personal scripts and legacy brains → the brain', () => {
    const product = brain('product'), legacy = brain('legacy', false);
    fs.mkdirSync(path.join(product, 'ops/tools'), { recursive: true });
    fs.writeFileSync(path.join(product, 'ops/tools/devops-me.mjs'), '// personal');
    fs.writeFileSync(path.join(product, 'ops/tools/cost.mjs'), '// stale copy the brain must not run');
    fs.mkdirSync(path.join(legacy, 'ops/tools'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'ops/tools/cost.mjs'), '// legacy');
    expect(brainScript(product, 'ops/tools/cost.mjs')).toBe(path.join(toolsDir(product), 'ops/tools/cost.mjs'));
    expect(brainScript(product, 'ops/tools/devops-me.mjs')).toBe(path.join(product, 'ops/tools/devops-me.mjs'));
    expect(brainScript(legacy, 'ops/tools/cost.mjs')).toBe(path.join(legacy, 'ops/tools/cost.mjs'));
    expect(brainScript(legacy, 'ops/tools/brain-site.mjs')).toBeNull();
    expect(isBrainFolder(product)).toBe(true);
    expect(isBrainFolder(legacy)).toBe(false);
    // a product brain never falls back to code in its folder when the release cannot render its utilities
    const broken = brain('broken');
    fs.mkdirSync(path.join(broken, 'ops/tools'), { recursive: true }); fs.writeFileSync(path.join(broken, 'ops/tools/cost.mjs'), '// stale');
    useTemplateRoot(path.join(base, 'missing-template'));
    expect(brainScript(broken, 'ops/tools/cost.mjs')).toBeNull();
  }, 60_000);
  it('keeps the template hooks the product does not replace, pointed at the copy', () => {
    const root = brain();
    const tools = fwd(ensureTools(root));
    const hooks = templateHooks(root, tools);
    const commands = Object.values(hooks).flat().flatMap(g => g.hooks.map(h => h.command));
    for (const n of ['panel-dismissed.mjs', 'compact-now.mjs', 'correction-catch.mjs', 'runbook-reminder.mjs', 'inbox.mjs" hook claude']) expect(commands.some(c => c.includes(n)), n).toBe(true);
    for (const n of REPLACED_HOOKS) expect(commands.some(c => c.includes(n)), n).toBe(false);
    for (const c of commands) { expect(c).toContain(tools); expect(c).not.toContain(fwd(root) + '/'); expect(c).not.toContain('$CLAUDE_PROJECT_DIR'); }
    expect(hooks.PostToolUse![0]!.matcher).toBe('AskUserQuestion');
    expect(hooks.SessionStart![0]!.matcher).toBe('compact');
  }, 60_000);
});

describe('product brain activation for Claude', () => {
  it('delivers product and template hooks with the launch switch off, unless the brain opted out', () => {
    const root = brain();
    fs.writeFileSync(path.join(root, 'code.md'), '---\nwhen: {"prompt":["code"]}\n---\nRun `{tools}/ops/tools/brain-lint.mjs`.\n');
    fs.writeFileSync(path.join(root, 'brain.json'), JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: ['code.md'] } }));
    const userData = path.join(base, 'userData');
    const launch = claudeLaunch(userData, { domains: [{ name: 'brain', root }] });
    expect(launch.args).toContain('--plugin-dir');
    const hooks = JSON.parse(fs.readFileSync(path.join(launch.pluginDir!, 'hooks/hooks.json'), 'utf8')).hooks;
    expect(hooks.UserPromptSubmit[0].hooks[0].command).toContain('product-rules/hooks/runner.mjs');
    expect(JSON.stringify(hooks.UserPromptSubmit)).toContain('correction-catch.mjs');
    expect(JSON.stringify(hooks)).not.toContain('brain-limits.mjs');
    const facts = JSON.parse(fs.readFileSync(path.join(launch.pluginDir!, 'product-rules/launch.json'), 'utf8'));
    expect(facts).toMatchObject({ root, tools: fwd(toolsDir(root)), correctionHook: true });
    const rules = fs.readFileSync(launch.rulesFile!, 'utf8');
    expect(rules).toContain(`{tools} = ${fwd(toolsDir(root))}`);
    fs.writeFileSync(path.join(root, 'brain.json'), JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: ['code.md'], claudeLaunch: false } }));
    expect(claudeLaunch(userData, { domains: [{ name: 'brain', root }] }).args).toEqual([]);
    const legacy = brain('legacy', false);
    expect(claudeLaunch(userData, { domains: [{ name: 'brain', root: legacy }] }).args).toEqual([]);
  }, 60_000);
  it('expands {tools} in injected topics and leaves the correction reminder to the template hook when it runs', () => {
    const root = brain(), state = path.join(base, 'state');
    fs.writeFileSync(path.join(root, 'code.md'), '---\nwhen: {"prompt":["code"]}\n---\nRun `{tools}/ops/tools/brain-lint.mjs`.\n');
    fs.writeFileSync(path.join(root, 'brain.json'), JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: ['code.md'] } }));
    const input = { hook_event_name: 'UserPromptSubmit' as const, session_id: 's1', prompt: 'code: this is wrong' };
    const withHook = runHook(root, state, input, { tools: 'C:/app/tools', correctionHook: true });
    expect(withHook.context).toContain('C:/app/tools/ops/tools/brain-lint.mjs');
    expect(withHook.context).not.toContain('correction');
    expect(runHook(root, state, { ...input, session_id: 's2' }).context).toContain('correction');
  });
});

describe('template reference migration', () => {
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
  it('plans a reviewable legacy migration: frontmatter, references, code removal, activation; hooks kept by default', () => {
    const root = brain('legacy', false);
    fs.mkdirSync(path.join(root, 'ops/tools'), { recursive: true }); fs.mkdirSync(path.join(root, '.claude/hooks'), { recursive: true });
    fs.writeFileSync(path.join(root, 'ops/tools/mem.mjs'), '// template copy');
    fs.writeFileSync(path.join(root, 'ops/tools/devops-me.mjs'), '// personal');
    fs.writeFileSync(path.join(root, '.claude/hooks/brain-limits.mjs'), '// global wiring may still run it');
    fs.writeFileSync(path.join(root, 'code.md'), `# Code work\n\nUse node ${fwd(root)}/ops/tools/mem.mjs.\n`);
    const plan = planMigration(root);
    const by = Object.fromEntries(plan.map(e => [e.file, e]));
    expect(by['ops/tools/mem.mjs']!.after).toBeNull();
    expect(by['ops/tools/devops-me.mjs']).toBeUndefined();
    expect(by['.claude/hooks/brain-limits.mjs']).toBeUndefined();
    expect(by['code.md']!.after).toMatch(/^---\nwhen: \{.*\}\n---\n# Code work\n\nUse node \{tools\}\/ops\/tools\/mem\.mjs\.\n$/);
    expect(by['code.md']!.beforeSha256).toBe(createHash('sha256').update(fs.readFileSync(path.join(root, 'code.md'))).digest('hex'));
    const json = JSON.parse(by['brain.json']!.after!);
    expect(json).toMatchObject({ machinery: 'product-v1', rules: { topicFiles: ['code.md'] } });
    expect(planMigration(root, { withHooks: true }).some(e => e.file === '.claude/hooks/brain-limits.mjs' && e.after === null)).toBe(true);
    expect(fs.readFileSync(path.join(root, 'code.md'), 'utf8')).toContain(`${fwd(root)}/ops/tools/mem.mjs`); // read-only
    git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, '-c', 'user.name=F', '-c', 'user.email=f@example.com', 'commit', '-q', '-m', 'f');
    migrate(root, plan);
    expect(fs.existsSync(path.join(root, 'ops/tools/mem.mjs'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ops/tools/devops-me.mjs'))).toBe(true);
    expect(fs.existsSync(journalOf(root))).toBe(false);
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
