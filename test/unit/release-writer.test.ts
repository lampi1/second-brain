// Release writer protocol exercises real child CLIs against inert filesystem fixtures only: no app/network/build.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { acquireReleaseLock, withReleaseLock, stageUpdate, manifestPayload, hashFile } from '../../scripts/update.mjs';

const home = path.resolve(import.meta.dirname, '../../test-results/writer-fixtures');
const scripts = path.resolve(import.meta.dirname, '../../scripts');
const put = (root: string, name: string, text: string | Buffer) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const make = () => { fs.mkdirSync(home, { recursive: true }); return fs.mkdtempSync(path.join(home, 'case-')); };
const target = '2.0.0-abcdef0';
const runtime = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
function state(root: string, current = 'running', previous: string | null = null, protocol = 1) {
  put(root, 'current.json', JSON.stringify({ current, previous, writerProtocol: protocol, bad: [], history: [] }));
}
function payload(bootstrapSuffix = '') {
  const root = make();
  const rel = { id: target, version: '2.0.0', writerProtocol: 1, electron: '2.0.0', claudeEngine: 'engines/claude/2.0.0/claude.exe' };
  for (const f of ['release.mjs', 'update.mjs']) put(root, f, fs.readFileSync(path.join(scripts, f), 'utf8') + bootstrapSuffix);
  for (const f of ['icon.ico', 'LICENSE', `releases/${target}/out/main/index.js`, `releases/${target}/out/icon.ico`, 'electron/2.0.0/electron.exe', rel.claudeEngine]) put(root, f, 'inert fixture: never executed');
  // The Windows update manifest and the host's activation runtime are both verified, inert assets.
  put(root, `electron/2.0.0/${runtime}`, 'inert fixture: never executed');
  put(root, `releases/${target}/release.json`, JSON.stringify(rel));
  put(root, `releases/${target}/package.json`, '{"name":"fixture"}');
  const { sha256 } = manifestPayload(root, rel, 'a'.repeat(40), true);
  return { root, sha256 };
}
function setup(bootstrapSuffix = '') {
  const base = make(), p = payload(bootstrapSuffix);
  state(base);
  put(base, 'release.mjs', 'original bootstrap');
  stageUpdate(base, p.root, p.sha256);
  return { base, ...p };
}
function cli(base: string, ...args: string[]) {
  return spawnSync(process.execPath, [path.join(scripts, 'release.mjs'), ...args], { encoding: 'utf8', windowsHide: true, env: { ...process.env, SB_RELEASES_ROOT: base, SB_NO_SYNC: '1', ELECTRON_RUN_AS_NODE: '1' } });
}
afterEach(() => vi.restoreAllMocks());

it('refuses another native process while a lease is owned, then releases normally', () => {
  const base = make(), lease = acquireReleaseLock(base, 'test-holder');
  try {
    const module = pathToFileURL(path.join(scripts, 'update.mjs')).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {withReleaseLock} from ${JSON.stringify(module)}; withReleaseLock(process.env.SB_TEST_ROOT,'contender',()=>{});`], { encoding: 'utf8', env: { ...process.env, SB_TEST_ROOT: base } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('release writer lock held');
  } finally { lease.release(); }
  expect(fs.existsSync(path.join(base, '.release-writer-lock'))).toBe(false);
});

it('preserves a native process crash journal and refuses any subsequent writer without TTL stealing', () => {
  const base = make(); state(base);
  const before = hashFile(path.join(base, 'current.json'));
  const module = pathToFileURL(path.join(scripts, 'update.mjs')).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {acquireReleaseLock} from ${JSON.stringify(module)};const lease=acquireReleaseLock(process.env.SB_TEST_ROOT,'crash-fixture');lease.begin();process.exit(23);`], { encoding: 'utf8', env: { ...process.env, SB_TEST_ROOT: base } });
  expect(result.status).toBe(23);
  const journal = JSON.parse(fs.readFileSync(path.join(base, '.release-writer-lock/owner.json'), 'utf8'));
  expect(journal.dirty).toBe(true);
  expect(journal.before['current.json']).toBe(before);
  expect(hashFile(path.join(base, '.release-writer-lock/before/current.json'))).toBe(before);
  expect(() => acquireReleaseLock(base, 'next')).toThrow('lock held');
});

it('retains dirty evidence if commit persistence fails', () => {
  const base = make(); state(base);
  const lease = acquireReleaseLock(base, 'commit-failure'); lease.begin();
  const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('injected rename failure'); });
  expect(() => lease.commit()).toThrow('injected rename failure');
  rename.mockRestore();
  expect(() => lease.release()).toThrow('journal preserved');
  expect(JSON.parse(fs.readFileSync(path.join(base, '.release-writer-lock/owner.json'), 'utf8')).dirty).toBe(true);
  expect(fs.existsSync(path.join(base, '.release-writer-lock/before/current.json'))).toBe(true);
});

it('refuses a changed owner token before mutation or cleanup', () => {
  const base = make(), lease = acquireReleaseLock(base, 'owner-check');
  const owner = path.join(base, '.release-writer-lock/owner.json');
  const record = JSON.parse(fs.readFileSync(owner, 'utf8'));
  fs.writeFileSync(owner, JSON.stringify({ ...record, token: 'different-owner' }));
  expect(() => lease.begin()).toThrow('ownership changed');
  expect(() => lease.release()).toThrow('ownership changed');
  expect(fs.existsSync(owner)).toBe(true);
});

it('ordinary rejected preconditions leave no dirty lock', () => {
  const base = make();
  expect(() => withReleaseLock(base, 'precondition', () => { throw new Error('precondition failed'); })).toThrow('precondition failed');
  expect(fs.existsSync(path.join(base, '.release-writer-lock'))).toBe(false);
});

it('rejects the wrong consent digest without changing bootstrap or current', () => {
  const { base } = setup(), before = fs.readFileSync(path.join(base, 'current.json'), 'utf8');
  const result = cli(base, 'apply-update', target, '0'.repeat(64), 'running');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('does not match consent');
  expect(fs.readFileSync(path.join(base, 'release.mjs'), 'utf8')).toBe('original bootstrap');
  expect(fs.readFileSync(path.join(base, 'current.json'), 'utf8')).toBe(before);
  expect(fs.existsSync(path.join(base, '.release-writer-lock'))).toBe(false);
});

it('refuses an external selection made after consent instead of overwriting it', () => {
  const { base, sha256 } = setup(); state(base, 'external');
  const result = cli(base, 'apply-update', target, sha256, 'running');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('changed since consent');
  expect(JSON.parse(fs.readFileSync(path.join(base, 'current.json'), 'utf8')).current).toBe('external');
  expect(fs.readFileSync(path.join(base, 'release.mjs'), 'utf8')).toBe('original bootstrap');
});

it('never overwrites the consented bootstrap with a different caller checkout during apply or conditional rollback', () => {
  const suffix = '\n// Distinct consented bootstrap fixture.\n';
  const { base, sha256 } = setup(suffix);
  put(base, 'releases/running/release.json', JSON.stringify({ id: 'running', writerProtocol: 1, electron: '2.0.0' }));
  put(base, 'releases/running/out/icon.ico', 'old icon');
  expect(cli(base, 'apply-update', target, sha256, 'running').status).toBe(0);
  for (const f of ['release.mjs', 'update.mjs']) expect(fs.readFileSync(path.join(base, f), 'utf8')).toBe(fs.readFileSync(path.join(scripts, f), 'utf8') + suffix);
  expect(cli(base, 'rollback-if', target, 'running').status).toBe(0);
  for (const f of ['release.mjs', 'update.mjs']) expect(fs.readFileSync(path.join(base, f), 'utf8')).toBe(fs.readFileSync(path.join(scripts, f), 'utf8') + suffix);
});

it('applies the exact selection and permits only the matching conditional rollback', () => {
  const { base, sha256 } = setup();
  // Supply a retained old release for rollback without ever running either inert runtime.
  put(base, 'releases/running/release.json', JSON.stringify({ id: 'running', writerProtocol: 1, electron: '2.0.0' }));
  put(base, 'releases/running/out/icon.ico', 'old icon');
  expect(cli(base, 'apply-update', target, sha256, 'running').status).toBe(0);
  expect(JSON.parse(fs.readFileSync(path.join(base, 'current.json'), 'utf8'))).toMatchObject({ current: target, previous: 'running', writerProtocol: 1 });
  expect(cli(base, 'rollback-if', target, 'wrong-old').status).toBe(1);
  expect(cli(base, 'rollback-if', 'other', 'running').status).toBe(1);
  expect(cli(base, 'rollback-if').status).toBe(1);
  expect(cli(base, 'rollback-if', target).status).toBe(1);
  expect(cli(base, 'rollback-if', target, 'running').status).toBe(0);
  expect(JSON.parse(fs.readFileSync(path.join(base, 'current.json'), 'utf8'))).toMatchObject({ current: 'running', previous: target });
});

it('refuses automatic apply on legacy state and reports a distinct state protocol', () => {
  const { base, sha256 } = setup();
  put(base, 'current.json', '{"current":"running","previous":null,"bad":[],"history":[]}');
  expect(cli(base, 'apply-update', target, sha256, 'running').status).toBe(1);
  expect(JSON.parse(cli(base, 'status', '--json').stdout)).toMatchObject({ writerProtocol: 1, stateProtocol: 0, lock: null });
});

it('does not silently adopt an existing legacy root for any writer', () => {
  const base = make();
  put(base, 'current.json', '{"current":"legacy","previous":null,"bad":[],"history":[]}');
  expect(() => acquireReleaseLock(base, 'install')).toThrow('offline migration');
  expect(fs.existsSync(path.join(base, '.release-writer-lock'))).toBe(false);
});

it.skipIf(process.platform !== 'win32')('uninstall preflight requires the parent owner token and refuses a live readiness PID', () => {
  const base = make(); state(base);
  const token = 'native-uninstaller-fixture';
  put(base, '.release-writer-lock/owner.json', JSON.stringify({ protocol: 1, operation: 'uninstall', token, pid: process.pid, dirty: false }));
  const appData = make();
  const run = (value: string) => spawnSync(process.execPath, [path.join(scripts, 'release.mjs'), 'uninstall-check', value], { encoding: 'utf8', windowsHide: true, env: { ...process.env, SB_RELEASES_ROOT: base, APPDATA: appData } });
  expect(run('wrong-token').status).toBe(1);
  put(appData, 'second-brain/ready.json', JSON.stringify({ pid: process.pid }));
  const busy = run(token);
  expect(busy.status).toBe(1);
  expect(busy.stderr).toContain('close second-brain');
  put(base, 'current.json', '{"current":"legacy","previous":null,"bad":[],"history":[]}');
  expect(run(token).stderr).toContain('offline migration');
  expect(fs.existsSync(path.join(base, '.release-writer-lock/owner.json'))).toBe(true);
});

it('installs from a private verified payload under the common writer lock', () => {
  const base = make(), p = payload();
  const staged = path.join(base, '.installer', target, 'a'.repeat(64));
  fs.cpSync(p.root, staged, { recursive: true });
  const result = spawnSync(process.execPath, [path.join(staged, 'release.mjs'), 'install-payload', target, p.sha256], { encoding: 'utf8', windowsHide: true, env: { ...process.env, SB_RELEASES_ROOT: base } });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(fs.readFileSync(path.join(base, 'current.json'), 'utf8'))).toMatchObject({ current: target, writerProtocol: 1 });
  const launcher = process.platform === 'win32' ? 'launch.vbs' : 'launch.sh';
  expect(fs.readFileSync(path.join(base, launcher), 'utf8')).toContain('second-brain stable launcher');
});
