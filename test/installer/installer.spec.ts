// Real main-only proof: install the exact checksummed artifact with no Node/npm on PATH, exercise the VBS launcher,
// inspect isolated Windows links, then inspect the installed product visually in hidden mode. Never touch stable/dev.
import { test, expect, _electron as electron } from '@playwright/test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test.skip(process.platform !== 'win32', 'Windows installer');
const repo = path.resolve(import.meta.dirname, '../..');
let testRoot: string | null = null;
// Armed before Setup starts: cleanup also covers timeouts/failures before ready.json exists.
test.afterEach(async ({ browserName: _browserName }, info) => {
  if (!testRoot) return;
  const system = process.env.SystemRoot ?? 'C:/Windows';
  const cleanup = spawnSync(path.join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'scripts/installer-test-links.ps1'), '-InstallRoot', path.join(testRoot, 'installed'), '-Cleanup'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  expect(cleanup.status, cleanup.stderr).toBe(0);
  if (info.status === info.expectedStatus) fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  else await info.attach('retained-isolated-installation', { body: testRoot, contentType: 'text/plain' });
  testRoot = null;
});
test('offline per-user installer starts and reopens its stable copy without system Node', async () => {
  const latest = JSON.parse(fs.readFileSync(path.join(repo, 'test-results/installer/latest.json'), 'utf8')) as { installer: string; payload: string; manifest: { id: string; version: string; sha256: string } };
  expect(createHash('sha256').update(fs.readFileSync(latest.installer)).digest('hex')).toBe(latest.manifest.sha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-installer space & percent%-'));
  testRoot = root;
  const install = path.join(root, 'installed');
  const userData = path.join(install, 'test-user-data');
  const system = process.env.SystemRoot ?? 'C:/Windows';
  const powershell = path.join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const helper = path.join(repo, 'scripts/installer-test-links.ps1');
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${system};${path.join(system, 'System32')}`, HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'), APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local'), TEMP: root, TMP: root, SB_USER_DATA: userData, SB_MCP_PORT: '0', SB_NO_SYNC: '1', SB_HIDDEN: '1' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'SB_RELEASE', 'SB_RELEASE_ID', 'SB_TEST', 'SB_BRAIN', 'SB_RELEASES_ROOT', 'SB_ENGINE_CLAUDE']) delete env[key];
  fs.mkdirSync(env.HOME!, { recursive: true });
  const diagnostics = path.join(repo, 'test-results/installer-smoke');
  fs.mkdirSync(diagnostics, { recursive: true });
  const outside = path.join(root, 'existing-profile');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'config.json'), 'preserve this profile');
  const rejected = spawnSync(latest.installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/SBTEST=1', `/DIR=${install}`], { env: { ...env, SB_USER_DATA: outside }, windowsHide: true, timeout: 30000 });
  expect(rejected.status).not.toBe(0);
  expect(fs.readFileSync(path.join(outside, 'config.json'), 'utf8')).toBe('preserve this profile');
  expect(fs.existsSync(path.join(install, 'current.json'))).toBe(false);
  // A post-extraction initialization failure must not masquerade as successful Setup (exit 0).
  const lock = path.join(install, '.release-writer-lock');
  const owner = JSON.stringify({ token: 'installer-test-owned-lock', dirty: false });
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'owner.json'), owner);
  const blocked = spawnSync(latest.installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/SBTEST=1', `/DIR=${install}`, `/LOG=${path.join(diagnostics, 'setup-blocked.log')}`], { env, windowsHide: true, encoding: 'utf8', timeout: 120000 });
  expect(blocked.error).toBeUndefined();
  expect(blocked.status).toBe(1);
  expect(fs.existsSync(path.join(userData, 'ready.json'))).toBe(false);
  expect(fs.existsSync(path.join(install, 'current.json'))).toBe(false);
  expect(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8')).toBe(owner);
  expect(fs.readdirSync(lock)).toEqual(['owner.json']);
  // Remove only this test's unchanged sentinel, never an installer-owned lease or recovery journal.
  fs.unlinkSync(path.join(lock, 'owner.json'));
  fs.rmdirSync(lock);
  const setup = spawnSync(latest.installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/SBTEST=1', `/DIR=${install}`, `/LOG=${path.join(diagnostics, 'setup.log')}`], { env, windowsHide: true, encoding: 'utf8', timeout: 120000 });
  expect(setup.error, `${setup.stdout}\n${setup.stderr}`).toBeUndefined();
  expect(setup.status).toBe(0);
  const readyFile = path.join(userData, 'ready.json');
  let pid = 0;
  let executable = '';
  const stop = () => {
    if (!pid) return;
    const stopping = pid;
    // Never mask the first stop failure with a retry in finally; afterEach still cleans failed isolated installs.
    pid = 0;
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-InstallRoot', install, '-ProcessId', String(stopping), '-Executable', executable], { windowsHide: true, encoding: 'utf8', timeout: 45000 });
    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const stopped = JSON.parse(result.stdout) as { pid: number; exitCode: number };
    expect(stopped.pid).toBe(stopping);
    expect(stopped.exitCode).toBe(0);
  };
  try {
    await expect.poll(() => { try { return JSON.parse(fs.readFileSync(readyFile, 'utf8')).release; } catch { return null; } }, { timeout: 60000 }).toBe(latest.manifest.id);
    const ready = JSON.parse(fs.readFileSync(readyFile, 'utf8')) as { pid: number };
    expect(Number.isSafeInteger(ready.pid) && ready.pid > 0).toBe(true);
    pid = ready.pid;
    const rel = JSON.parse(fs.readFileSync(path.join(install, 'releases', latest.manifest.id, 'release.json'), 'utf8')) as { electron: string; claudeEngine: string };
    executable = path.join(install, 'electron', rel.electron, 'electron.exe');
    const links = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-InstallRoot', install], { encoding: 'utf8', windowsHide: true });
    expect(links.status, links.stderr).toBe(0);
    for (const link of JSON.parse(links.stdout) as { target: string; args: string; cwd: string; icon: string }[]) {
      expect(path.basename(link.target).toLowerCase()).toBe('wscript.exe');
      expect(link.args).toBe(`"${path.join(install, 'launch.vbs')}"`);
      expect(link.cwd).toBe(install);
      expect(link.icon).toContain(path.join(install, 'icon.ico'));
    }
    expect(fs.existsSync(path.join(install, 'unins000.exe'))).toBe(false); // no real uninstall registry entry in test mode
    stop();
    fs.unlinkSync(readyFile);
    const reopened = spawnSync(path.join(system, 'System32/cscript.exe'), ['//B', '//Nologo', path.join(install, 'launch.vbs')], { env, windowsHide: true, encoding: 'utf8' });
    expect(reopened.status).toBe(0);
    await expect.poll(() => { try { return JSON.parse(fs.readFileSync(readyFile, 'utf8')).release; } catch { return null; } }, { timeout: 60000 }).toBe(latest.manifest.id);
    pid = JSON.parse(fs.readFileSync(readyFile, 'utf8')).pid;
    stop();
    const app = await electron.launch({ executablePath: executable, args: [path.join(install, 'releases', latest.manifest.id)], env: { ...env, SB_RELEASE: latest.manifest.id, SB_RELEASES_ROOT: install, SB_ENGINE_CLAUDE: path.resolve(install, rel.claudeEngine) } as Record<string, string> });
    try {
      await app.firstWindow();
      await expect.poll(() => app.windows().some(p => !p.url().includes('#overlay'))).toBe(true);
      const page = app.windows().find(p => !p.url().includes('#overlay'))!;
      await expect(page.getByTestId('app')).toBeVisible();
      // Verify the real renderer IPC before the current first-run screen: a rejected sender must fail this smoke.
      const initial = await page.evaluate(async () => ({
        info: await window.sb.invoke('app:info', undefined),
        setup: await window.sb.invoke('setup:get', undefined),
      }));
      expect(initial.info.version).toBe(latest.manifest.version);
      expect(['new', 'draft']).toContain(initial.setup.status);
      if (initial.info.brainRoot) {
        const relative = path.relative(root, initial.info.brainRoot);
        expect(path.isAbsolute(relative)).toBe(false);
        expect(relative.split(path.sep)[0]).not.toBe('..');
      }
      await expect(page.getByTestId('ai-first-modal')).toBeVisible();
      await expect(page.getByTestId('ai-setup-fallback')).toBeVisible();
      await expect.poll(() => page.evaluate(async () => (await window.sb.invoke('app:info', undefined)).health?.jobGuard), { timeout: 60000 }).toBe('ready');
      const shots = path.join(repo, 'test-results/shots');
      fs.mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, 'installer-first-run.png') });
    } finally { await app.close(); }
  } finally { stop(); }
});
