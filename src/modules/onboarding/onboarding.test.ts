// Isolated fixture tests: all config writes target disposable directories, never a real harness profile.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { OnboardingService } from './service';
import type { Host } from './service';
import { LocalFiles } from './local';
import { discoverLocal, remoteHost } from './discovery';
import { locations, projectConfigs } from './locations';
import { connectionIntent, discoveryView } from './presentation';
import type { Discovery } from './contract';
const temporary: string[] = [];
describe('platform location fixtures', () => {
  it.each([
    { platform: 'win32' as const, home: path.win32.join('C:', 'Users', 'Example'), p: path.win32 },
    { platform: 'darwin' as const, home: path.posix.join('/', 'Users', 'example'), p: path.posix },
    { platform: 'linux' as const, home: path.posix.join('/', 'home', 'example'), p: path.posix },
  ])('resolves home, workspace, CLI and each harness config on $platform', ({ platform, home, p }) => {
    const found = locations(home, platform), project = p.join(home, 'projects', 'demo');
    expect(found.configs).toEqual([p.join(home, '.claude.json'), p.join(home, '.codex', 'config.toml'), p.join(home, '.cursor', 'mcp.json')]);
    expect(found.roots).toContain(p.join(home, 'source', 'repos')); expect(found.roots).toContain(p.join(home, 'projects'));
    expect(Object.keys(found.cli)).toEqual(['claude', 'codex', 'cursor']);
    for (const paths of Object.values(found.cli)) for (const file of paths) expect(p.isAbsolute(file)).toBe(true);
    expect(projectConfigs(project, platform)).toEqual({ claude: p.join(project, '.mcp.json'), codex: p.join(project, '.codex', 'config.toml'), cursor: p.join(project, '.cursor', 'mcp.json') });
    expect(JSON.stringify(found)).not.toContain('david');
  });
});
// One at a time, newest first: a fixture can live inside an earlier one (the temp-alias case), and two concurrent
// removals of one tree fail with EPERM on Windows; maxRetries rides out an antivirus handle on a just-written file.
afterEach(async () => { for (const p of temporary.splice(0).reverse()) await fs.rm(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
async function fixture(local = new LocalFiles(async () => 0)) {
  // Resolve the fixture boundary only; LocalFiles still rejects every link beneath it.
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sb-onboarding-'))); temporary.push(root);
  const project = path.join(root, 'project'); await fs.mkdir(project);
  const host: Host = { home: root, backupRoot: path.join(root, 'private-backups'), allow: async () => true,
    // Fake vault for synthetic nonsecret fixtures ONLY. Production host must use OS-protected storage.
    protect: text => Buffer.from('fake-vault:' + text), unprotect: b => b.toString().slice(11) };
  return { root, project, host, service: new OnboardingService(host, local) };
}
describe('metadata-only discovery', () => {
  it('uses a physical fixture root when the OS temp directory is an alias', async () => {
    const base = await fixture(), alias = path.join(base.root, 'temp-alias');
    await fs.symlink(base.project, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const temp = vi.spyOn(os, 'tmpdir').mockReturnValue(alias);
    let f;
    try { f = await fixture(); } finally { temp.mockRestore(); }
    const plan = await f.service.prepare({ project: f.project, provider: 'github', harnesses: ['claude'] });
    expect(plan.changes).toHaveLength(1);
  });
  it('accepts a canonical starting root while rejecting linked descendants', async () => {
    const { root, project } = await fixture(), alias = path.join(root, 'alias');
    await fs.mkdir(path.join(project, '.git'));
    await fs.writeFile(path.join(project, '.git', 'config'), '[core]\n');
    await fs.symlink(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const local = new LocalFiles(async () => 0);
    // Models /var -> /private/var (and Windows temp aliases) before fixture use.
    const canonical = await fs.realpath(alias);
    expect((await discoverLocal({ home: root, roots: [canonical], cliPaths: {} }, local)).evidence.some(e => e.kind === 'repo' && e.path === project)).toBe(true);
    await expect(local.check(alias)).rejects.toThrow('linked path');
    await expect(local.read(path.join(alias, '.git', 'config'))).rejects.toThrow('linked path');
  });
  it('fails closed without a native cloud metadata adapter on any operating system', async () => {
    await expect(discoverLocal({ home: os.tmpdir() })).rejects.toThrow('Native cloud');
  });
  it('rejects network and device roots before checking attributes', async () => {
    let checked = 0; const local = new LocalFiles(async () => { checked++; return 0; });
    await expect(local.check('//server/share/project')).rejects.toThrow('local folder');
    await expect(local.check('\\\\server\\share\\project')).rejects.toThrow('local folder');
    expect(checked).toBe(0);
  });
  it('skips cloud/reparse ancestors before content reads and never searches home recursively', async () => {
    const { root } = await fixture(); const work = path.join(root, 'source', 'repos');
    const cloud = path.join(work, 'cloud'); const repo = path.join(work, 'local');
    await fs.mkdir(path.join(cloud, '.git'), { recursive: true }); await fs.mkdir(path.join(repo, '.git'), { recursive: true });
    const syntheticRemote = 'https://' + ['fixture:fixture', 'github.com/company/repo?credential=fixture'].join('@');
    await fs.writeFile(path.join(repo, '.git', 'config'), '[remote "origin"]\nurl = ' + syntheticRemote + '\n');
    await fs.mkdir(path.join(root, 'unrelated', '.git'), { recursive: true });
    const local = new LocalFiles(async file => file === cloud ? 0x400000 : 0);
    const found = await discoverLocal({ home: root }, local);
    expect(found.evidence.filter(e => e.kind === 'repo').map(e => e.path)).toEqual([repo]);
    expect(found.evidence.find(e => e.kind === 'repo')!.remoteHosts).toEqual(['github.com']);
    expect(JSON.stringify(found)).not.toContain('credential'); expect(JSON.stringify(found)).not.toContain('unrelated');
    expect(remoteHost(['git', 'ssh.dev.azure.com:v3/company/project/repo'].join('@'))).toBe('dev.azure.com');
    expect(remoteHost('https://github.com.evil.test/repo')).toBeNull();
  });
});
it('rejects a generated config that would exceed the bounded reader', async () => {
  const { project, service } = await fixture();
  const file = path.join(project, '.mcp.json');
  const original = JSON.stringify({ unrelated: Array(30000).fill('x') });
  expect(Buffer.byteLength(original)).toBeLessThan(256 * 1024); await fs.writeFile(file, original);
  await expect(service.prepare({ project, provider: 'github', harnesses: ['claude'] })).rejects.toThrow('too large');
  expect(await fs.readFile(file, 'utf8')).toBe(original);
});
const boardFixture: Discovery = { evidence: [
  { kind: 'repo', path: '/example/portal', source: 'git/config metadata', remoteHosts: ['github.com'], checkedAt: '2026-10-17', login: 'unknown' },
  { kind: 'repo', path: '/example/mobile', source: 'git/config metadata', remoteHosts: ['dev.azure.com'], checkedAt: '2026-10-17', login: 'unknown' },
  { kind: 'cli', path: '/example/bin/claude', source: 'claude', checkedAt: '2026-10-17', login: 'unknown' },
  { kind: 'cli', path: '/example/bin/codex', source: 'codex', checkedAt: '2026-10-17', login: 'unknown' },
], limited: false, skipped: 0 };
it('reads discovery evidence without inferring Jira or login', () => {
  const view = discoveryView(boardFixture);
  expect(view.repos).toHaveLength(2); expect(view.installed).toEqual(['claude', 'codex']); expect(view.services).toEqual(['github', 'azure']);
  expect(discoveryView(null).installed).toEqual([]);
});
it.each([['collega Jira', 'jira'], ['CONNECT GitHub', 'github'], ['collega Azure DevOps', 'azure'], ['connect ADO.', 'azure'], ['collega Jira Cloud', 'jira'], ['delete everything', null], ['collega https://example.com', null]])('resolves only catalog connection intent: %s', (text, expected) => {
  expect(connectionIntent(text!)).toBe(expected);
});
