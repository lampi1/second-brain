// Automatic brain tests use ONLY synthetic app-data fixtures: the automatic memory is a fresh, EMPTY brain (ADR 0072),
// nothing of the release template is copied into it; the app's tools are rendered outside it (userData fixture).
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DefaultBrain } from './default-brain';
import { pathToFileURL } from 'node:url';
import { useAssets } from '../../main/rules/delivery';
import { FRESH_FILES } from '../../main/rules/new-brain';
import { ensureTools, useTemplateRoot, useToolsHome } from '../../main/rules/tools';
const TEMPLATE = path.join(import.meta.dirname, '..', '..', '..', 'brain-template');
const temporary: string[] = [];
beforeEach(async () => {
  const runtime = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ai-first-rt-'))); temporary.push(runtime);
  mkdirSync(path.join(runtime, 'assets', 'hooks'), { recursive: true });
  for (const f of ['runtime.mjs', 'cli.mjs', 'hooks/runner.mjs', 'hooks/cli.mjs']) writeFileSync(path.join(runtime, 'assets', f), '// fixture\n');
  useAssets(path.join(runtime, 'assets')); useTemplateRoot(TEMPLATE); useToolsHome(path.join(runtime, 'tools-home'));
});
afterEach(async () => { useAssets(null); useTemplateRoot(null); useToolsHome(null); for (const root of temporary.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  // macOS /var and Windows short temp names can alias a different physical path.
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ai-first-'))); temporary.push(root);
  const userData = path.join(root, 'app'), templateRoot = path.join(root, 'template');
  await fs.mkdir(userData); await fs.mkdir(path.join(templateRoot, 'ops', 'tools'), { recursive: true });
  await fs.writeFile(path.join(templateRoot, 'AGENTS.md'), '# Memory {{BRAIN}}');
  await fs.writeFile(path.join(templateRoot, 'routines.md'), '# Routines shipped by the app');
  await fs.mkdir(path.join(templateRoot, '.claude')); await fs.writeFile(path.join(templateRoot, '.claude', 'settings.json'), '{"hooks":{"Stop":["never execute"]}}');
  await fs.writeFile(path.join(templateRoot, '.mcp.json'), '{}'); await fs.writeFile(path.join(templateRoot, 'install.mjs'), 'throw Error("never execute installer")');
  return { root, userData, templateRoot };
}
const files = async (dir: string, rel = ''): Promise<string[]> => (await Promise.all((await fs.readdir(path.join(dir, rel), { withFileTypes: true }))
  .filter(e => !(rel === '' && e.name === '.git')).map(async e => e.isDirectory() ? [`${rel}${e.name}/`, ...await files(dir, `${rel}${e.name}/`)] : [`${rel}${e.name}`]))).flat().sort();
it('uses a physical fixture root when the OS temp directory is an alias', async () => {
  const base = await fixture(), alias = path.join(base.root, 'temp-alias');
  await fs.symlink(base.userData, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const temp = vi.spyOn(os, 'tmpdir').mockReturnValue(alias);
  let f;
  try { f = await fixture(); } finally { temp.mockRestore(); }
  const creator = new DefaultBrain({ ...f, current: () => null, revision: () => 0, connect: async () => {} });
  expect((await creator.ensure('en', 'none')).connected).toBe(true);
});
it('rejects linked input directories', async () => {
  const f = await fixture(), alias = path.join(f.root, 'alias');
  await fs.symlink(f.templateRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const host = { ...f, current: () => null, revision: () => 0, connect: async () => { throw new Error('must not connect'); } };
  await expect(new DefaultBrain({ ...host, templateRoot: alias }).ensure('en', 'none')).rejects.toThrow('AI_SETUP_LOCAL_DIRECTORY');
  await expect(new DefaultBrain({ ...host, userData: alias }).ensure('en', 'none')).rejects.toThrow('AI_SETUP_LOCAL_DIRECTORY');
});
it('allocates one fresh, empty memory for concurrent requests: no template file, project hooks or MCP', async () => {
  const f = await fixture(); let current: string | null = null;
  const creator = new DefaultBrain({ ...f, current: () => current, revision: () => 0, connect: async root => { current = root; } });
  const [a, b] = await Promise.all([creator.ensure('it', 'none'), creator.ensure('it', 'none')]);
  expect(a).toEqual(b); expect(a.connected).toBe(true); expect(a.root.startsWith(f.userData + path.sep)).toBe(true);
  expect(await files(a.root)).toEqual([...FRESH_FILES, 'projects/'].sort());
  expect(await fs.readFile(path.join(a.root, 'me.md'), 'utf8')).toMatch(/^# Tu\n/);
  expect(JSON.parse(await fs.readFile(path.join(a.root, 'brain.json'), 'utf8'))).toMatchObject({ machinery: 'product-v1', template: { HARNESSES: 'Da collegare' }, rules: { appRules: true } });
  expect(await creator.ensure('en', 'codex')).toEqual(a); expect((await fs.readdir(f.userData)).length).toBe(1);
});
it('preserves a configured unusable folder instead of replacing the person’s choice', async () => {
  const f = await fixture(), existing = path.join(f.root, 'existing'); let connects = 0;
  const creator = new DefaultBrain({ ...f, current: () => existing, usable: () => false, revision: () => 1, connect: async () => { connects++; } });
  expect(await creator.ensure('it', 'none')).toEqual({ root: existing, connected: false }); expect(connects).toBe(0); expect(await fs.readdir(f.userData)).toEqual([]);
});
it('retains a prepared memory without overriding a concurrent explicit folder selection', async () => {
  const f = await fixture(); let reads = 0, connects = 0;
  const creator = new DefaultBrain({ ...f, current: () => null, revision: () => reads++ ? 2 : 1, connect: async () => { connects++; } });
  const created = await creator.ensure('en', 'none'); expect(created.connected).toBe(false); expect(connects).toBe(0);
  expect(await fs.readFile(path.join(created.root, 'me.md'), 'utf8')).toMatch(/^# You\n/);
});
it('never connects a memory the release cannot serve (no hook runtime); the empty reservation is kept', async () => {
  const f = await fixture(); let connects = 0;
  useAssets(path.join(f.root, 'missing-runtime'));
  const creator = new DefaultBrain({ ...f, current: () => null, revision: () => 0, connect: async () => { connects++; } });
  await expect(creator.ensure('en', 'none')).rejects.toThrow('AI_SETUP_TEMPLATE_INCOMPLETE'); expect(connects).toBe(0);
  const [reserved] = await fs.readdir(f.userData);
  expect(await fs.readdir(path.join(f.userData, reserved!))).toEqual([]);
});
it('the app-owned tools serve the empty memory: the brain map reads it without warnings', async () => {
  const f = await fixture(); let current: string | null = null;
  const created = await new DefaultBrain({ ...f, current: () => current, revision: () => 0, connect: async root => { current = root; } }).ensure('en', 'none');
  const tools = ensureTools(created.root);
  const mapModule = await import(/* @vite-ignore */ pathToFileURL(path.join(tools, 'ops', 'tools', 'brain-map.mjs')).href);
  const map = mapModule.collect({ root: created.root, home: f.userData });
  expect(map.warnings).toEqual([]);
  expect(mapModule.check(map, { root: created.root, home: f.userData })).toEqual([]);
  expect(await files(created.root)).toEqual([...FRESH_FILES, 'projects/'].sort()); // nothing written into the brain
});
