// Render the shipped template in a fake home without Node/Git on PATH or global integrations. This catches missing
// static modules and accidental consent flags before an installer can advertise first-run memory creation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const template = path.resolve(import.meta.dirname, '../../brain-template');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(useGit = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-template-'))); roots.push(root);
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  const brain = path.join(root, 'Personal brain');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))), PATH: useGit ? process.env.PATH : '', HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'), GIT_CONFIG_GLOBAL: path.join(home, 'empty-gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  const run = (file: string, args: string[]) => spawnSync(process.execPath, [file, ...args], { env, encoding: 'utf8', timeout: 30000, windowsHide: true });
  return { root, home, brain, run };
}

describe('distributed first-run template', () => {
  it('installs a Codex brain without Node on PATH, then runs its public memory/context/prompt tools', () => {
    const f = fixture();
    const installed = f.run(path.join(template, 'install.mjs'), ['--yes', '--home', f.home, '--name', 'Mario Rossi', '--role', 'consultant', '--harness', 'codex', '--dir', f.brain, '--repos', f.root]);
    expect(installed.stderr).toBe('');
    expect(installed.status).toBe(0);
    expect(fs.readFileSync(path.join(f.brain, 'me.md'), 'utf8')).toContain('Mario Rossi');
    expect(fs.existsSync(path.join(f.home, '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(f.home, '.cursor'))).toBe(false);
    const tool = (name: string, args: string[]) => f.run(path.join(f.brain, 'ops/tools', name), args);
    const memory = tool('mem.mjs', ['now', 'me', '--root', f.brain, '--label', 'OS · Setup', '--text', 'setup ready']);
    expect(memory.stderr).toBe(''); expect(memory.status).toBe(0);
    const context = tool('ctx.mjs', ['--match', 'OS Setup']);
    expect(context.status).toBe(0); expect(context.stdout).toContain('setup ready');
    const prompt = tool('chat-prompt.mjs', ['--title', 'OS · Review', '--kind', 'code', '--job', 'Review this repository', '--thread', 'OS Setup', '--app']);
    expect(prompt.stderr).toBe(''); expect(prompt.status).toBe(0);
    expect(prompt.stdout).toContain('Review this repository');
  });

  it('rejects a consent flag used as a field value before creating any folder or global configuration', () => {
    const f = fixture();
    const result = f.run(path.join(template, 'install.mjs'), ['--yes', '--home', f.home, '--name', '--user-config', '--dir', f.brain]);
    expect(result.status).toBe(1);
    expect(fs.existsSync(f.brain)).toBe(false);
    expect(fs.readdirSync(f.home)).toEqual([]);
  });

  it('renders final paths while writing only a separate staging folder', () => {
    const f = fixture();
    const stage = path.join(f.root, 'staging'); fs.mkdirSync(stage);
    const result = f.run(path.join(template, 'install.mjs'), ['--yes', '--home', f.home, '--name', 'Mario', '--harness', 'codex', '--dir', f.brain, '--output-dir', stage]);
    expect(result.status).toBe(0);
    expect(fs.existsSync(f.brain)).toBe(false);
    expect(fs.readFileSync(path.join(stage, 'map.md'), 'utf8')).toContain(f.brain.replaceAll('\\', '/'));
    expect(fs.readdirSync(f.home)).toEqual([]);
  });

  it.skipIf(spawnSync('git', ['--version'], { windowsHide: true }).status !== 0)('creates main even when inherited Git configuration requests master and another worktree', () => {
    const f = fixture(true);
    const redirect = path.join(f.root, 'redirect'); fs.mkdirSync(redirect);
    // A malicious/unrelated inherited Git configuration is data to ignore, never a source of installer authority.
    const hostile = path.join(f.home, 'empty-gitconfig');
    fs.writeFileSync(hostile, `[init]\n defaultBranch = master\n[core]\n hooksPath = ${f.home.replaceAll('\\', '/')}/hooks\n`);
    fs.mkdirSync(path.join(f.home, 'hooks'));
    fs.writeFileSync(path.join(f.home, 'hooks', 'pre-commit'), '#!/bin/sh\nexit 17\n');
    const installed = spawnSync(process.execPath, [path.join(template, 'install.mjs'), '--yes', '--home', f.home, '--name', 'Mario', '--harness', 'codex', '--dir', f.brain], { encoding: 'utf8', timeout: 30000, windowsHide: true,
      env: { ...process.env, HOME: f.home, USERPROFILE: f.home, GIT_DIR: path.join(redirect, '.git'), GIT_WORK_TREE: redirect, GIT_CONFIG_GLOBAL: hostile, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'init.defaultBranch', GIT_CONFIG_VALUE_0: 'master' } });
    expect(installed.status).toBe(0);
    expect(installed.stderr).toBe('');
    expect(installed.stdout).not.toContain('git non inizializzato');
    expect(fs.readFileSync(path.join(f.brain, '.git/HEAD'), 'utf8').trim()).toBe('ref: refs/heads/main');
    expect(fs.readdirSync(redirect)).toEqual([]);
    expect(fs.readFileSync(path.join(f.brain, '.git/refs/heads/main'), 'utf8')).toMatch(/^[a-f0-9]{40}\s*$/);
    expect(fs.readFileSync(hostile, 'utf8')).toContain('defaultBranch = master');
  });
});
