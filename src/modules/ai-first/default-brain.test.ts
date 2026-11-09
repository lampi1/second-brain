// Automatic brain tests use ONLY synthetic app-data fixtures: the automatic memory is a fresh, EMPTY brain (ADR 0072),
// nothing of the release template is copied into it; the app's tools are rendered outside it (userData fixture).
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DefaultBrain } from './default-brain';
import { useAssets } from '../../main/rules/delivery';
import { useTemplateRoot, useToolsHome } from '../../main/rules/tools';
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
it('rejects linked input directories', async () => {
  const f = await fixture(), alias = path.join(f.root, 'alias');
  await fs.symlink(f.templateRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const host = { ...f, current: () => null, revision: () => 0, connect: async () => { throw new Error('must not connect'); } };
  await expect(new DefaultBrain({ ...host, templateRoot: alias }).ensure('en', 'none')).rejects.toThrow('AI_SETUP_LOCAL_DIRECTORY');
  await expect(new DefaultBrain({ ...host, userData: alias }).ensure('en', 'none')).rejects.toThrow('AI_SETUP_LOCAL_DIRECTORY');
});
it('preserves a configured unusable folder instead of replacing the person’s choice', async () => {
  const f = await fixture(), existing = path.join(f.root, 'existing'); let connects = 0;
  const creator = new DefaultBrain({ ...f, current: () => existing, usable: () => false, revision: () => 1, connect: async () => { connects++; } });
  expect(await creator.ensure('it', 'none')).toEqual({ root: existing, connected: false }); expect(connects).toBe(0); expect(await fs.readdir(f.userData)).toEqual([]);
});
it('never connects a memory the release cannot serve (no hook runtime); the empty reservation is kept', async () => {
  const f = await fixture(); let connects = 0;
  useAssets(path.join(f.root, 'missing-runtime'));
  const creator = new DefaultBrain({ ...f, current: () => null, revision: () => 0, connect: async () => { connects++; } });
  await expect(creator.ensure('en', 'none')).rejects.toThrow('AI_SETUP_TEMPLATE_INCOMPLETE'); expect(connects).toBe(0);
  const [reserved] = await fs.readdir(f.userData);
  expect(await fs.readdir(path.join(f.userData, reserved!))).toEqual([]);
});
