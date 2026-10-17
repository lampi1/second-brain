// Isolated fixture tests: all config writes target disposable directories, never a real harness profile.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { OnboardingService } from './service';
import type { Host } from './service';
import { LocalFiles } from './local';
import { discoverLocal, remoteHost } from './discovery';
import { configAfter } from './config';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { OnboardingScreen, RegiaConnectAction } from './Screen';
import { message } from './i18n';
import { locations, projectConfigs } from './locations';
import { connectionIntent, discoveryView } from './presentation';
import { DiscoveryBoard } from './Board';
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
afterEach(async () => { await Promise.all(temporary.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
async function fixture(local = new LocalFiles(async () => 0)) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-onboarding-')); temporary.push(root);
  const project = path.join(root, 'project'); await fs.mkdir(project);
  const host: Host = { home: root, backupRoot: path.join(root, 'private-backups'), allow: async () => true,
    // Fake vault for synthetic nonsecret fixtures ONLY. Production host must use OS-protected storage.
    protect: text => Buffer.from('fake-vault:' + text), unprotect: b => b.toString().slice(11) };
  return { root, project, host, service: new OnboardingService(host, local) };
}
describe('project connector transaction', () => {
  it('previews all three exact formats, waits for confirmation, persists a private journal and undoes exact existence/bytes', async () => {
    const { project, service, host } = await fixture();
    const existing = '{"other":{"visible":true}}\n';
    await fs.writeFile(path.join(project, '.mcp.json'), existing);
    const plan = await service.prepare({ project, provider: 'jira', harnesses: ['claude', 'codex', 'cursor'] });
    expect(plan.changes.map(c => c.diff)).toEqual([
      '+ mcpServers.jira = {"type":"http","url":"https://mcp.atlassian.com/v1/mcp"}',
      '+ [mcp_servers.jira]\n+ url = "https://mcp.atlassian.com/v1/mcp"',
      '+ mcpServers.jira = {"url":"https://mcp.atlassian.com/v1/mcp"}',
    ]);
    expect(await fs.readFile(path.join(project, '.mcp.json'), 'utf8')).toBe(existing);
    // Mutating a renderer plan must not change what its confirmation authorizes.
    plan.changes[0]!.path = path.join(project, 'evil');
    const applied = await service.apply(plan.id);
    expect(applied.connections.every(c => c.status === 'pending')).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(project, '.mcp.json'), 'utf8')).other).toEqual({ visible: true });
    const journal = JSON.parse(await fs.readFile(path.join(host.backupRoot, plan.id, 'manifest.json'), 'utf8'));
    expect(journal.status).toBe('applied'); expect(journal.published).toBe(3);
    expect(await fs.readFile(path.join(host.backupRoot, plan.id, '0.snapshot'), 'utf8')).toMatch(/^fake-vault:/);
    await service.undo(plan.id);
    expect(await fs.readFile(path.join(project, '.mcp.json'), 'utf8')).toBe(existing);
    await expect(fs.stat(path.join(project, '.codex/config.toml'))).rejects.toThrow();
    await expect(fs.stat(path.join(project, '.cursor/mcp.json'))).rejects.toThrow();
    await expect(service.apply(plan.id)).rejects.toThrow('already used');
  });
  it('does not overwrite an edit made after preview or undo', async () => {
    const { project, service } = await fixture();
    const request = { project, provider: 'github' as const, harnesses: ['claude' as const] };
    const plan = await service.prepare(request);
    await fs.writeFile(path.join(project, '.mcp.json'), '{}');
    await expect(service.apply(plan.id)).rejects.toThrow('changed');
    expect(await fs.readFile(path.join(project, '.mcp.json'), 'utf8')).toBe('{}');
    const second = await service.prepare(request); await service.apply(second.id);
    await fs.writeFile(path.join(project, '.mcp.json'), '{"userEdit":true}');
    await expect(service.undo(second.id)).rejects.toThrow('Concurrent');
    expect(await fs.readFile(path.join(project, '.mcp.json'), 'utf8')).toBe('{"userEdit":true}');
  });
  it('rolls the first file back when publication of the second fails', async () => {
    let first = '', failOnce = false;
    class Interrupt extends LocalFiles {
      override async check(file: string, missing = false) {
        await super.check(file, missing);
        if (first && file.endsWith(path.join('.cursor', 'mcp.json')) && !failOnce) {
          try { await fs.stat(first); } catch { return; }
          failOnce = true; throw new Error('simulated publication interruption');
        }
      }
    }
    const { project, service } = await fixture(new Interrupt(async () => 0));
    const plan = await service.prepare({ project, provider: 'github', harnesses: ['claude', 'cursor'] }); first = path.join(project, '.mcp.json');
    await expect(service.apply(plan.id)).rejects.toThrow('interruption');
    await expect(fs.stat(first)).rejects.toThrow();
    await expect(fs.stat(path.join(project, '.cursor/mcp.json'))).rejects.toThrow();
  });
  it('stops on conflicting names, malformed files, plaintext auth and unsupported syntax', () => {
    expect(() => configAfter('claude', 'jira', 'https://example.com', '{"mcpServers":{"jira":{}}}')).toThrow('already exists');
    expect(() => configAfter('cursor', 'jira', 'https://example.com', '{broken')).toThrow();
    expect(() => configAfter('claude', 'jira', 'https://example.com', '{"password":"fixture"}')).toThrow('migration');
    expect(() => configAfter('codex', 'jira', 'https://example.com', 'model = "fixture"')).toThrow('preserving TOML');
    expect(() => configAfter('claude', 'jira', 'https://example.com', '// comment\n{}')).toThrow();
  });
  it('keeps Azure unsupported compatibility pending, and enforces policy again at apply', async () => {
    const { project, service, host } = await fixture();
    const azure = await service.prepare({ project, provider: 'azure', organization: 'test-org', harnesses: ['claude', 'codex', 'cursor'] });
    expect(azure.changes).toEqual([]); expect(azure.pending).toHaveLength(3);
    await expect(service.apply(azure.id)).rejects.toThrow('No compatible');
    const github = await service.prepare({ project, provider: 'github', harnesses: ['claude'] });
    host.allow = async () => false;
    await expect(service.apply(github.id)).rejects.toThrow('policy changed');
    await expect(fs.stat(path.join(project, '.mcp.json'))).rejects.toThrow();
  });
  it('performs no probe before confirmation and never equates saved config with a connection', async () => {
    const { project, service, host } = await fixture(); let probes = 0;
    host.probe = async (harness, provider, endpoint) => { probes++; expect(provider).toBe('github'); expect(endpoint).toContain('/readonly'); return { harness, status: 'verified', checkedAt: new Date().toISOString(), detail: 'fixture initialize and tools/list identity verified' }; };
    const plan = await service.prepare({ project, provider: 'github', harnesses: ['claude'] }); expect(probes).toBe(0);
    expect((await service.apply(plan.id)).connections[0]!.status).toBe('verified'); expect(probes).toBe(1);
  });
  it('does not write any config if secure backup fails', async () => {
    const { project, service, host } = await fixture();
    host.protect = () => { throw new Error('secure storage unavailable'); };
    const plan = await service.prepare({ project, provider: 'jira', harnesses: ['claude'] });
    await expect(service.apply(plan.id)).rejects.toThrow('secure storage');
    await expect(fs.stat(path.join(project, '.mcp.json'))).rejects.toThrow();
  });
  it('returns the committed operation and undo even when config verification reads fail', async () => {
    let blocked = false;
    class Unreadable extends LocalFiles {
      override async read(file: string) {
        if (blocked && file.endsWith('.mcp.json')) throw new Error('fixture permission failure');
        return super.read(file);
      }
    }
    const { project, service, host } = await fixture(new Unreadable(async () => 0));
    host.probe = async harness => { blocked = true; return { harness, status: 'failed', checkedAt: new Date().toISOString(), detail: 'fixture' }; };
    const plan = await service.prepare({ project, provider: 'github', harnesses: ['claude'] });
    expect((await service.apply(plan.id)).id).toBe(plan.id);
    expect(await service.current()).toMatchObject({ id: plan.id, project, provider: 'github' });
    expect((await service.test(plan.id))[0]!.status).toBe('failed');
    expect((await service.current())!.id).toBe(plan.id);
    blocked = false; await service.undo(plan.id); expect(await service.current()).toBeNull();
  });
  it('resumes undo after a later target temporarily fails', async () => {
    let armed = false, failed = false;
    class UndoInterruption extends LocalFiles {
      override async check(file: string, missing = false) {
        await super.check(file, missing);
        if (armed && !failed && file.endsWith('.mcp.json')) {
          // Wait until Cursor has actually been restored, so failure happens after one restore.
          try { await fs.stat(path.join(path.dirname(file), '.cursor/mcp.json')); }
          catch { failed = true; throw new Error('fixture undo interruption'); }
        }
      }
    }
    const { project, service } = await fixture(new UndoInterruption(async () => 0));
    const plan = await service.prepare({ project, provider: 'jira', harnesses: ['claude', 'cursor'] });
    await service.apply(plan.id); armed = true;
    await expect(service.undo(plan.id)).rejects.toThrow('undo interruption');
    expect((await service.current())!.id).toBe(plan.id);
    await service.undo(plan.id); expect(await service.current()).toBeNull();
    await expect(fs.stat(path.join(project, '.mcp.json'))).rejects.toThrow();
  });
  it('rechecks content after preparing the temporary publication file', async () => {
    let armed = false, changed = false;
    class ConcurrentEdit extends LocalFiles {
      override async check(file: string, missing = false) {
        await super.check(file, missing);
        if (armed && !changed && file.endsWith('.mcp.json')) {
          const files = await fs.readdir(path.dirname(file));
          if (files.some(f => f.endsWith('.tmp'))) { changed = true; await fs.writeFile(file, '{"external":true}'); }
        }
      }
    }
    const { project, service } = await fixture(new ConcurrentEdit(async () => 0));
    const plan = await service.prepare({ project, provider: 'github', harnesses: ['claude'] }); armed = true;
    await expect(service.apply(plan.id)).rejects.toThrow('Concurrent edit');
    expect(await fs.readFile(path.join(project, '.mcp.json'), 'utf8')).toBe('{"external":true}');
  });
});
describe('metadata-only discovery', () => {
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
it('renders both surfaces in Italian and English with labelled controls', async () => {
  const { service } = await fixture();
  for (const language of ['it', 'en'] as const) {
    const screen = renderToStaticMarkup(createElement(OnboardingScreen, { port: service, language }));
    expect(screen).toContain('aria-labelledby'); expect(screen).toContain('for='); expect(screen).not.toContain('undefined');
    const action = renderToStaticMarkup(createElement(RegiaConnectAction, { port: service, language }));
    expect(action).toContain('aria-expanded="false"');
    expect(action).toContain('onboarding-connectors'); // remains mounted even when Regia action is collapsed
  }
});
const boardFixture: Discovery = { evidence: [
  { kind: 'repo', path: '/example/portal', source: 'git/config metadata', remoteHosts: ['github.com'], checkedAt: '2026-10-17', login: 'unknown' },
  { kind: 'repo', path: '/example/mobile', source: 'git/config metadata', remoteHosts: ['dev.azure.com'], checkedAt: '2026-10-17', login: 'unknown' },
  { kind: 'cli', path: '/example/bin/claude', source: 'claude', checkedAt: '2026-10-17', login: 'unknown' },
  { kind: 'cli', path: '/example/bin/codex', source: 'codex', checkedAt: '2026-10-17', login: 'unknown' },
], limited: false, skipped: 0 };
it('shows discovery evidence as GenUI cards and board without inferring Jira or login', () => {
  const view = discoveryView(boardFixture);
  expect(view.repos).toHaveLength(2); expect(view.installed).toEqual(['claude', 'codex']); expect(view.services).toEqual(['github', 'azure']);
  expect(discoveryView(null).installed).toEqual([]);
  for (const language of ['it', 'en'] as const) {
    const html = renderToStaticMarkup(createElement(DiscoveryBoard, { found: boardFixture, language, project: '/example/portal', harnesses: ['claude', 'codex'], disabled: false, onProject: () => {}, onHarness: () => {}, onConnect: () => {} }));
    expect(html).toContain('gu-board'); expect(html).toContain('gu-card'); expect(html).toContain('Claude Code'); expect(html).toContain('Codex'); expect(html).toContain('Cursor'); expect(html).toContain('aria-pressed="true"');
    expect(html).toContain(language === 'it' ? 'Accesso da verificare' : 'Sign-in not verified');
    expect(html).not.toContain('<select'); expect(html).not.toContain('type="checkbox"');
  }
});
it.each([['collega Jira', 'jira'], ['CONNECT GitHub', 'github'], ['collega Azure DevOps', 'azure'], ['connect ADO.', 'azure'], ['collega Jira Cloud', 'jira'], ['delete everything', null], ['collega https://example.com', null]])('resolves only catalog connection intent: %s', (text, expected) => {
  expect(connectionIntent(text!)).toBe(expected);
});
it('localizes actionable connection status and hides unexpected provider/config exceptions', () => {
  expect(message('Saved. Official harness login and provider verification are still required', 'it')).toContain('Completa l’accesso');
  expect(message('codex: Azure remote authentication is unsupported by Codex; configuration is not changed.', 'it')).toContain('Codex non supporta');
  expect(message('unexpected fixture provider response', 'it')).not.toContain('fixture');
});
