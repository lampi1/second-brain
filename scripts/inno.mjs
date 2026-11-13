// Pinned, portable Inno Setup compiler for Windows packaging. Used by package-windows.mjs, never on target PCs.
// The vendor release predates this change by >14 days. Hash: official immutable GitHub release asset digest.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const INNO = Object.freeze({
  version: '6.5.4',
  url: 'https://github.com/jrsoftware/issrc/releases/download/is-6_5_4/innosetup-6.5.4.exe',
  sha256: 'fa73bf47a4da250d185d07561c2bfda387e5e20db77e4570004cf6a133cc10b1',
});

export function run(exe, args, options = {}) {
  const r = spawnSync(exe, args, { stdio: 'inherit', windowsHide: true, ...options });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(exe)} failed (${r.status})`);
  return r;
}

// Inno 6.5.4's /? prints only the major version and exits 1. A tiny no-output compile loads the engine and
// reports its full version. Require a successful compile and an exact banner line, never a help substring.
export function verifyCompiler(exe, expected = INNO.version) {
  const input = '[Setup]\nAppName=Compiler version probe\nAppVersion=1\nCreateAppDir=no\nUninstallable=no\nOutput=no\n';
  const result = spawnSync(exe, ['/O-', '-'], { input, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const version = result.stdout?.split(/\r?\n/).find(line => line.startsWith('Compiler engine version: '));
  if (result.error || result.status !== 0 || version !== `Compiler engine version: Inno Setup ${expected}`) {
    throw new Error(`expected Inno Setup ${expected}; compiler version probe failed`, { cause: result.error });
  }
}

export async function compiler(repo) {
  if (process.platform !== 'win32') throw new Error('Windows packaging requires a Windows x64 build host');
  const root = path.join(repo, 'test-results', 'toolchain', `inno-${INNO.version}`);
  const exe = path.join(root, 'compiler', 'ISCC.exe');
  if (!fs.existsSync(exe)) {
    fs.mkdirSync(root, { recursive: true });
    const setup = path.join(root, 'setup.exe');
    const response = await fetch(INNO.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Inno download failed: HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(data).digest('hex') !== INNO.sha256) throw new Error('Inno compiler download SHA-256 mismatch');
    fs.writeFileSync(setup, data);
    run(setup, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/PORTABLE=1', '/CURRENTUSER', '/NOICONS', `/DIR=${path.dirname(exe)}`, `/LOG=${path.join(root, 'setup.log')}`]);
  }
  verifyCompiler(exe);
  return exe;
}
