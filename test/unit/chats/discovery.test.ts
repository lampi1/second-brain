// Filesystem discovery regressions: a running app sees installs and changed environments without starting any CLI.
// Used by the runtime resolver and the standalone doctor; all candidates here are inert temporary files.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findCli, resolveAcp } from '../../../src/main/chats/cli';
import { claudeScriptCommand, codexAppInstall, cursorInstall, discoverClaude, findCli as discover, isClaudePackageScript, newestCursorVersion } from '../../../src/main/chats/discovery.mjs';

const roots: string[] = [];
const temp = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-discovery-')); roots.push(p); return p; };
const file = (p: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); fs.chmodSync(p, 0o755); return p; };
const envFor = (root: string): NodeJS.ProcessEnv => ({ PATH: '', USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, 'local'), APPDATA: path.join(root, 'roaming') });
afterEach(() => { vi.unstubAllEnvs(); for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true }); });

describe('CLI discovery in a running app', () => {
  it('uses the resolver environment instead of the parent PATH', () => {
    const root = temp(), bin = path.join(root, 'bin');
    const name = 'sb-discovery-env';
    const expected = file(path.join(bin, process.platform === 'win32' ? `${name}.exe` : name));
    expect(resolveAcp('custom', name, null, { ...envFor(root), PATH: bin })?.display).toBe(expected);
  });

  it('finds a CLI installed after a miss, and forgets it after removal', () => {
    const root = temp(), name = `sb-discovery-${path.basename(root)}`;
    vi.stubEnv('PATH', root);
    expect(findCli(name)).toBeNull();
    const expected = file(path.join(root, process.platform === 'win32' ? `${name}.exe` : name));
    expect(findCli(name)).toBe(expected);
    fs.unlinkSync(expected);
    expect(findCli(name)).toBeNull();
  });

  it.skipIf(process.platform !== 'win32')('finds npm wrappers with an empty/stale Explorer PATH and prefers cmd to a Unix shim', () => {
    const root = temp(), env = envFor(root);
    file(path.join(env.APPDATA!, 'npm', 'kimi'));
    const expected = file(path.join(env.APPDATA!, 'npm', 'kimi.cmd'));
    expect(resolveAcp('kimi', 'kimi', null, env)).toMatchObject({ kind: 'cmd', display: expected });
  });
});

describe('shared filesystem discovery', () => {
  it('Windows uses Path case-insensitively, quoted directories, and exe/cmd/bat order before extensionless shims', () => {
    const root = temp(), first = path.join(root, 'first'), second = path.join(root, 'second');
    const env = { ...envFor(root), PATH: undefined, Path: `"${first}";${second}` };
    file(path.join(first, 'engine'));
    const bat = file(path.join(first, 'engine.bat'));
    const cmd = file(path.join(second, 'engine.cmd'));
    const exe = file(path.join(second, 'engine.exe'));
    expect(discover('engine', env, 'win32', root)).toBe(exe);
    fs.unlinkSync(exe); expect(discover('engine', env, 'win32', root)).toBe(cmd);
    fs.unlinkSync(cmd); expect(discover('engine', env, 'win32', root)).toBe(bat);
    fs.unlinkSync(bat); expect(discover('engine', env, 'win32', root)).toBe(path.join(first, 'engine'));
  });

  it('preserves PATH order within one executable type and isolates each supplied environment', () => {
    const root = temp(), first = path.join(root, 'first'), second = path.join(root, 'second');
    const a = file(path.join(first, 'engine.exe')), b = file(path.join(second, 'engine.exe'));
    expect(discover('engine', { ...envFor(root), PATH: `${first};${second}` }, 'win32', root)).toBe(a);
    expect(discover('engine', { ...envFor(root), PATH: `${second};${first}` }, 'win32', root)).toBe(b);
    expect(discover('engine', { ...envFor(root), PATH: '' }, 'win32', root)).toBeNull();
  });

  it('keeps a PATH command ahead of known user installs and ignores directories as candidates', () => {
    const root = temp(), env = envFor(root), bin = path.join(root, 'bin');
    const npm = file(path.join(env.APPDATA!, 'npm', 'engine.exe'));
    const wrapper = file(path.join(bin, 'engine.cmd'));
    fs.mkdirSync(path.join(bin, 'engine.exe'));
    expect(discover('engine', { ...env, PATH: bin }, 'win32', root)).toBe(wrapper);
    fs.unlinkSync(wrapper); expect(discover('engine', { ...env, PATH: bin }, 'win32', root)).toBe(npm);
  });

  it('refreshes Codex after installation, update, timestamp ties, incomplete updates and removal', () => {
    const root = temp(), env = envFor(root), bin = path.join(env.LOCALAPPDATA!, 'OpenAI', 'Codex', 'bin');
    expect(codexAppInstall(env, root)).toBeNull();
    const old = file(path.join(bin, 'older', 'codex.exe'));
    fs.utimesSync(old, 1000, 1000);
    expect(discover('codex', env, 'win32', root)).toBe(old);
    fs.mkdirSync(path.join(bin, 'incomplete', 'codex.exe'), { recursive: true });
    const newer = file(path.join(bin, 'newer', 'codex.exe'));
    fs.utimesSync(newer, 2000, 2000);
    expect(discover('codex', env, 'win32', root)).toBe(newer);
    const tie = file(path.join(bin, 'a-tie', 'codex.exe'));
    fs.utimesSync(tie, 2000, 2000);
    expect(codexAppInstall(env, root)).toBe(tie);
    fs.unlinkSync(tie); fs.unlinkSync(newer);
    expect(codexAppInstall(env, root)).toBe(old);
    fs.unlinkSync(old); expect(codexAppInstall(env, root)).toBeNull();
  });

  it('selects complete Cursor installs by date, with a deterministic tie-break', () => {
    const root = temp(), env = envFor(root), versions = path.join(env.LOCALAPPDATA!, 'cursor-agent', 'versions');
    const version = (name: string, complete = true) => {
      const dir = path.join(versions, name); file(path.join(dir, 'index.js')); if (complete) file(path.join(dir, 'node.exe')); return dir;
    };
    version('2026.9.30-abcdef');
    version('2026.10.1-abcdef');
    const winner = version('2026.10.1-00-00-01-aaaaaa');
    version('2026.10.1-00-00-01-bbbbbb');
    version('2026.12.1-abcdef', false);
    expect(newestCursorVersion(versions)).toBe(winner);
    expect(cursorInstall(env, 'win32', root)).toBe(winner);
    fs.unlinkSync(path.join(winner, 'node.exe'));
    expect(cursorInstall(env, 'win32', root)).toBe(path.join(versions, '2026.10.1-00-00-01-bbbbbb'));
  });

  it('uses the Claude override, then the installed Claude Code (PATH, ~/.local/bin), then the app\'s copy marked fallback (ADR 0267)', () => {
    const root = temp(), env = envFor(root), opts = { env, platform: 'win32' as const, arch: 'x64', starts: [root] };
    const onPath = file(path.join(root, 'bin', 'claude.exe'));
    const local = file(path.join(root, '.local', 'bin', 'claude.exe'));
    env.PATH = path.dirname(onPath);
    const embedded = file(path.join(root, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe'));
    const release = file(path.join(root, 'release', 'claude.exe'));
    expect(discoverClaude({ ...opts, release, override: 'explicit.mjs' })).toEqual({ path: 'explicit.mjs', source: 'override' });
    expect(discoverClaude({ ...opts, release })).toEqual({ path: onPath, source: 'path' }); // installed beats the bundled copies
    env.PATH = '';
    expect(discoverClaude({ ...opts, release })).toEqual({ path: local, source: 'path' }); // the native installer's folder
    fs.unlinkSync(local);
    expect(discoverClaude({ ...opts, release })).toEqual({ path: release, source: 'release', fallback: true });
    fs.unlinkSync(release);
    expect(discoverClaude({ ...opts, release })).toEqual({ path: embedded, source: 'embedded', fallback: true });
    fs.unlinkSync(embedded);
    expect(discoverClaude(opts)).toBeNull();
  });

  it('Windows: claude.exe wins over an npm shim; a shim runs its package\'s cli.js (a .cmd cannot be spawned), or else counts as missing', () => {
    const root = temp(), env = envFor(root), opts = { env, platform: 'win32' as const, arch: 'x64', starts: [root] };
    const npm = path.join(root, 'roaming', 'npm'), shim = file(path.join(npm, 'claude.cmd'));
    expect(shim).toBeTruthy();
    const embedded = file(path.join(root, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe'));
    expect(discoverClaude(opts)).toEqual({ path: embedded, source: 'embedded', fallback: true }); // a shim alone: not startable
    const cli = file(path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'));
    expect(discoverClaude(opts)?.source).toBe('embedded'); // no node to run it with: still the app's copy
    const node = file(path.join(root, 'nodejs', 'node.exe'));
    env.PATH = path.dirname(node);
    expect(discoverClaude(opts)).toEqual({ path: cli, source: 'path' });
    // it runs with that node, never Electron as Node (its switch would reach every child of Claude Code)
    expect(claudeScriptCommand(cli, { ...env, ELECTRON_RUN_AS_NODE: '1', A: 'b' }, 'win32')).toEqual({ command: node, args: [cli], env: { ...env, A: 'b' } });
    expect(isClaudePackageScript(cli)).toBe(true);
    expect(isClaudePackageScript(path.join(root, 'fake-claude.mjs'))).toBe(false);
    const exe = file(path.join(root, '.local', 'bin', 'claude.exe'));
    expect(discoverClaude(opts)).toEqual({ path: exe, source: 'path' });
  });

  it('keeps explicit fake overrides and their environment; installed commands remove Electron Node mode', () => {
    const root = temp(), env = { ...envFor(root), ELECTRON_RUN_AS_NODE: '1', SB_CUSTOM_ENGINE_PATH: 'fake.mjs', CUSTOM: 'value' };
    expect(resolveAcp('custom-engine', 'missing', null, env)).toMatchObject({ kind: 'fake', prefix: ['fake.mjs'], env: { CUSTOM: 'value', ELECTRON_RUN_AS_NODE: '1' } });
    const exe = file(path.join(root, process.platform === 'win32' ? 'installed.exe' : 'installed'));
    const installed = resolveAcp('custom-engine', exe, null, { ...env, SB_CUSTOM_ENGINE_PATH: undefined });
    expect(installed?.env.CUSTOM).toBe('value'); expect(installed?.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('retains explicit scripts and missing paths for the caller Node launcher and error diagnostics', () => {
    const root = temp(), script = file(path.join(root, 'fake.mjs'));
    fs.chmodSync(script, 0o644);
    expect(discover(script, envFor(root), 'linux', root)).toBe(script);
    const missing = path.join(root, 'missing.exe');
    expect(discover(missing, envFor(root), 'win32', root)).toBe(missing);
  });

  it.skipIf(process.platform === 'win32')('POSIX requires executable files and finds ~/.local/bin with a stale PATH', () => {
    const root = temp(), env = envFor(root), cli = file(path.join(root, '.local', 'bin', 'sb-local-engine'));
    expect(discover('sb-local-engine', env, 'linux', root)).toBe(cli);
    fs.chmodSync(cli, 0o644); expect(discover('sb-local-engine', env, 'linux', root)).toBeNull();
  });
});
