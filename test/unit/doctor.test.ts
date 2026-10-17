// Doctor and runtime must describe the same selected instance and CLI. Login output is tri-state, and a normal
// doctor invocation never starts executable candidates. Temporary metadata only; no user credentials or model calls.
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeLogin, doctorContext } from '../../scripts/doctor-lib.mjs';

const roots: string[] = [];
const temp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-doctor-')); roots.push(p); return p; };
const json = (p: string, value: unknown) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(value)); };
const envFor = (root: string) => ({ APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local') });
afterEach(() => { for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });

describe('doctor selected configuration', () => {
  it('resolves portable engine metadata against releasesRoot, never the current working directory', () => {
    const root = temp(), env = { ...envFor(root), SB_RELEASES_ROOT: path.join(root, 'installed') };
    json(path.join(env.SB_RELEASES_ROOT, 'current.json'), { current: 'v1' });
    const file = path.join(env.SB_RELEASES_ROOT, 'releases', 'v1', 'release.json');
    json(file, { claudeEngine: 'engines/claude/v1/claude.exe' });
    expect(doctorContext({ root, env, platform: 'win32' }).releaseEngine).toBe(path.join(env.SB_RELEASES_ROOT, 'engines', 'claude', 'v1', 'claude.exe'));
    json(file, { claudeEngine: '../outside.exe' });
    expect(doctorContext({ root, env, platform: 'win32' }).releaseEngine).toBeNull();
  });
  it('selects stable and dev config independently and ignores inherited release engines in dev', () => {
    const root = temp(), env = { ...envFor(root), SB_ENGINE_CLAUDE: 'stable-only.exe' };
    json(path.join(env.APPDATA!, 'second-brain', 'config.json'), { brainRoot: path.join(root, 'stable-brain'), mcpPort: 4444 });
    json(path.join(env.APPDATA!, 'second-brain-dev', 'config.json'), { brainRoot: path.join(root, 'dev-brain'), mcpPort: 4444 });
    expect(doctorContext({ root, env, platform: 'win32' })).toMatchObject({ mode: 'stable', brain: path.join(root, 'stable-brain'), port: 4319, savedPort: 4444, portSource: 'default', releaseEngine: 'stable-only.exe', configState: 'loaded' });
    expect(doctorContext({ root, env, platform: 'win32', dev: true })).toMatchObject({ mode: 'dev', brain: path.join(root, 'dev-brain'), port: 4329, portSource: 'dev default', releaseEngine: null });
  });

  it('reports explicit userData, brain and port sources and the exact config path', () => {
    const root = temp(), userData = path.join(root, 'custom'), configPath = path.join(userData, 'config.json');
    json(configPath, { brainRoot: path.join(root, 'saved-brain'), mcpPort: 4444 });
    const env = { ...envFor(root), SB_USER_DATA: userData, SB_BRAIN: path.join(root, 'override-brain'), SB_MCP_PORT: '4999' };
    expect(doctorContext({ root, env, dev: true, platform: 'win32' })).toMatchObject({ userData, userDataSource: 'SB_USER_DATA', configPath, brain: env.SB_BRAIN, brainSource: 'SB_BRAIN', port: 4999, portSource: 'SB_MCP_PORT' });
    expect(doctorContext({ root, env: { ...env, SB_BRAIN: '', SB_MCP_PORT: 'invalid' }, dev: true, platform: 'win32' })).toMatchObject({ brain: path.join(root, 'saved-brain'), brainSource: 'config.json', port: 4319, portSource: 'default (invalid SB_MCP_PORT)' });
  });

  it('distinguishes missing/invalid config from an unconfigured brain', () => {
    const root = temp(), env = envFor(root);
    const opts = { root, env, platform: 'win32' as const, dev: true };
    const missing = doctorContext(opts);
    expect(missing).toMatchObject({ brain: null, brainSource: 'unset', configState: 'missing' });
    json(missing.configPath, []);
    expect(doctorContext(opts).configState).toBe('invalid');
    fs.writeFileSync(missing.configPath, '{');
    expect(doctorContext(opts).configState).toBe('unreadable');
  });

  it('reads the selected frozen release metadata and rejects path traversal in current.json', () => {
    const root = temp(), env = { ...envFor(root), SB_RELEASES_ROOT: path.join(root, 'releases-root') };
    const appRoot = path.join(env.SB_RELEASES_ROOT, 'releases', '0.1.0-abcdef');
    json(path.join(env.SB_RELEASES_ROOT, 'current.json'), { current: '0.1.0-abcdef' });
    json(path.join(appRoot, 'release.json'), { claudeEngine: 'frozen-claude.exe', electron: '44.4.5' });
    expect(doctorContext({ root, env, platform: 'win32' })).toMatchObject({ appRoot, release: '0.1.0-abcdef', releaseEngine: path.join(env.SB_RELEASES_ROOT, 'frozen-claude.exe'), electron: path.join(env.SB_RELEASES_ROOT, 'electron', '44.4.5', 'electron.exe') });
    expect(doctorContext({ root, env, platform: 'win32', dev: true })).toMatchObject({ appRoot: root, release: null, releaseEngine: null });
    json(path.join(env.SB_RELEASES_ROOT, 'current.json'), { current: '../outside' });
    expect(doctorContext({ root, env, platform: 'win32' })).toMatchObject({ appRoot: root, release: null });
  });

  it('follows launcher fallback and metadata precedence instead of a bad current release or inherited engine', () => {
    const root = temp(), env = { ...envFor(root), SB_RELEASES_ROOT: path.join(root, 'releases-root'), SB_ENGINE_CLAUDE: 'inherited.exe' };
    const oldRoot = path.join(env.SB_RELEASES_ROOT, 'releases', 'previous');
    json(path.join(env.SB_RELEASES_ROOT, 'current.json'), { current: 'broken', previous: 'previous', bad: ['broken'] });
    json(path.join(oldRoot, 'release.json'), { claudeEngine: 'previous-claude.exe', electron: '44.4.4' });
    expect(doctorContext({ root, env, platform: 'win32' })).toMatchObject({ release: 'previous', appRoot: oldRoot, releaseEngine: path.join(env.SB_RELEASES_ROOT, 'previous-claude.exe'), electron: path.join(env.SB_RELEASES_ROOT, 'electron', '44.4.4', 'electron.exe') });
    json(path.join(env.SB_RELEASES_ROOT, 'current.json'), { current: 'broken', previous: 'previous', bad: ['broken', 'previous'] });
    expect(doctorContext({ root, env, platform: 'win32' }).release).toBeNull();
  });

  it.each(['invalid', '70000', '-1', '1.5'])('uses the actual listener fallback for invalid SB_MCP_PORT=%s', port => {
    const root = temp(), env = { ...envFor(root), SB_MCP_PORT: port };
    expect(doctorContext({ root, env, platform: 'win32', dev: true }).port).toBe(4319);
  });
});

describe('doctor login state', () => {
  it.each(['', 'not json', '{}', 'null', '{"loggedIn":"false"}', '{"loggedIn":0}'])('keeps unverified output informational: %s', stdout => {
    expect(claudeLogin(stdout)).toMatchObject({ ok: true, level: 'info' });
    expect(claudeLogin(stdout).detail).toContain('not verified');
  });
  it('reports not authenticated only for an explicit false, and login for true', () => {
    expect(claudeLogin('{"loggedIn":false}')).toMatchObject({ ok: false, level: 'warn' });
    expect(claudeLogin('{"loggedIn":true}')).toMatchObject({ ok: true, level: 'ok' });
  });
});

it('a default doctor run reports config and paths without starting any candidate', () => {
  const root = temp(), marker = path.join(root, 'started');
  const candidate = path.join(root, process.platform === 'win32' ? 'candidate.cmd' : 'candidate');
  fs.writeFileSync(candidate, process.platform === 'win32' ? `@echo started>"${marker}"` : `#!/bin/sh\ntouch '${marker}'\n`);
  fs.chmodSync(candidate, 0o755);
  const result = spawnSync(process.execPath, ['scripts/doctor.mjs', '--dev', '--json'], {
    cwd: path.resolve(import.meta.dirname, '..', '..'), encoding: 'utf8', timeout: 15000,
    env: { ...process.env, SB_USER_DATA: root, SB_RELEASES_ROOT: root, SB_MCP_PORT: '0', SB_CLAUDE_PATH: candidate, SB_CURSOR_PATH: candidate, SB_CODEX_PATH: candidate, SB_KIMI_PATH: candidate },
  });
  expect(result.error).toBeUndefined();
  const checks = JSON.parse(result.stdout) as { id: string; detail: string; level: string }[];
  expect(checks.find(c => c.id === 'context')?.detail).toContain(path.join(root, 'config.json'));
  expect(checks.find(c => c.id === 'claude-cli')?.detail).toContain(candidate);
  expect(checks.find(c => c.id === 'claude-login')).toMatchObject({ level: 'info' });
  expect(fs.existsSync(marker)).toBe(false);
});
