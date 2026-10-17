// Automatic brain tests use ONLY synthetic templates and disposable app-data fixtures.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { DefaultBrain } from './default-brain';
const temporary: string[] = [];
afterEach(async () => { for (const root of temporary.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-first-')); temporary.push(root);
  const userData = path.join(root, 'app'), templateRoot = path.join(root, 'template');
  await fs.mkdir(userData); await fs.mkdir(path.join(templateRoot, 'ops', 'tools'), { recursive: true });
  await fs.writeFile(path.join(templateRoot, 'AGENTS.md'), '# Memory {{BRAIN}}');
  await fs.writeFile(path.join(templateRoot, 'me.template.md'), '# {{OWNER}}\n{{ROLE}}\n{{HARNESSES}}');
  await fs.writeFile(path.join(templateRoot, 'ops', 'tools', 'brain-site.mjs'), '// fixture only');
  await fs.mkdir(path.join(templateRoot, '.claude')); await fs.writeFile(path.join(templateRoot, '.claude', 'settings.json'), '{"hooks":{"Stop":["never execute"]}}');
  await fs.mkdir(path.join(templateRoot, '.cursor')); await fs.writeFile(path.join(templateRoot, '.cursor', 'hooks.json'), '{}');
  await fs.writeFile(path.join(templateRoot, '.mcp.json'), '{}'); await fs.writeFile(path.join(templateRoot, 'install.mjs'), 'throw Error("never execute installer")');
  return { root, userData, templateRoot };
}
it('allocates one fresh local memory for concurrent requests without activating project hooks or MCP', async () => {
  const f = await fixture(); let current: string | null = null;
  const creator = new DefaultBrain({ ...f, current: () => current, revision: () => 0, connect: async root => { current = root; } });
  const [a, b] = await Promise.all([creator.ensure('it', 'none'), creator.ensure('it', 'none')]);
  expect(a).toEqual(b); expect(a.connected).toBe(true); expect(a.root.startsWith(f.userData + path.sep)).toBe(true);
  expect(await fs.readFile(path.join(a.root, 'me.md'), 'utf8')).toContain('Da collegare');
  for (const name of ['.claude', '.cursor', '.mcp.json', 'install.mjs']) await expect(fs.stat(path.join(a.root, name))).rejects.toThrow();
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
  expect(await fs.readFile(path.join(created.root, 'me.md'), 'utf8')).toContain('Not connected yet');
});
it('rejects unknown template placeholders and never connects incomplete content', async () => {
  const f = await fixture(); let connects = 0;
  await fs.writeFile(path.join(f.templateRoot, 'AGENTS.md'), '{{UNSUPPORTED}}');
  const creator = new DefaultBrain({ ...f, current: () => null, revision: () => 0, connect: async () => { connects++; } });
  await expect(creator.ensure('en', 'none')).rejects.toThrow('PLACEHOLDER'); expect(connects).toBe(0);
});
it('renders the actual bundled template without enabling hidden project integration directories', async () => {
  const f = await fixture(); let current: string | null = null;
  const creator = new DefaultBrain({ ...f, templateRoot: path.join(import.meta.dirname, '..', '..', '..', 'brain-template'), current: () => current, revision: () => 0, connect: async root => { current = root; } });
  const created = await creator.ensure('en', 'none'); expect(created.connected).toBe(true);
  const me = await fs.readFile(path.join(created.root, 'me.md'), 'utf8'); expect(me).toContain('Not connected yet'); expect(me).not.toMatch(/\{\{[A-Z_]+\}\}/);
  expect((await fs.stat(path.join(created.root, 'projects'))).isDirectory()).toBe(true);
  await expect(fs.stat(path.join(created.root, '.claude'))).rejects.toThrow();
});
