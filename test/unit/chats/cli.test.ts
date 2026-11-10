// Engine resolution (src/main/chats/cli.ts): the installed Claude Code by default (ADR 0267), the embedded binary or a
// release's copy from SB_ENGINE_CLAUDE as the fallback, SB_CLAUDE_PATH for tests; scripts run with this runtime as Node; the quit kill lands even when
// taskkill is too slow.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { claudeFailedToStart, commandFor, resolveClaude } from '../../../src/main/chats/cli';
import { log } from '../../../src/main/log';
import { bundledClaude } from '../../../src/main/chats/discovery.mjs';
import { tmp } from './helpers';

const saved = { SB_CLAUDE_PATH: process.env.SB_CLAUDE_PATH, SB_ENGINE_CLAUDE: process.env.SB_ENGINE_CLAUDE, PATH: process.env.PATH, Path: process.env.Path };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('Claude engine resolution', () => {
  it('uses the Claude Code installed on PATH by default', () => {
    delete process.env.SB_CLAUDE_PATH; delete process.env.SB_ENGINE_CLAUDE;
    const bin = tmp('installed'), exe = path.join(bin, process.platform === 'win32' ? 'claude.exe' : 'claude');
    fs.writeFileSync(exe, ''); fs.chmodSync(exe, 0o755);
    delete process.env.Path; process.env.PATH = bin;
    expect(resolveClaude()).toEqual({ path: exe, source: 'path' });
    // a release's copy is only the fallback now: an installed Claude Code still wins
    const rel = path.join(tmp('engines'), 'claude.exe');
    fs.writeFileSync(rel, '');
    process.env.SB_ENGINE_CLAUDE = rel;
    expect(resolveClaude()).toEqual({ path: exe, source: 'path' });
    process.env.SB_CLAUDE_PATH = 'C:\\fake\\claude.mjs'; // SB_CLAUDE_PATH (tests) wins over everything
    expect(resolveClaude()).toEqual({ path: 'C:\\fake\\claude.mjs', source: 'override' });
    expect(resolveClaude('D:\\x.exe')).toEqual({ path: 'D:\\x.exe', source: 'override' });
  });

  it('an installed Claude Code that failed to start gives way to the app\'s copy, marked fallback and logged once', () => {
    delete process.env.SB_CLAUDE_PATH; delete process.env.SB_ENGINE_CLAUDE;
    const bin = tmp('broken'), exe = path.join(bin, process.platform === 'win32' ? 'claude.exe' : 'claude');
    fs.writeFileSync(exe, ''); fs.chmodSync(exe, 0o755);
    delete process.env.Path; process.env.PATH = bin;
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      expect(claudeFailedToStart(path.join(bin, 'other'))).toBe(false); // not the installed one: nothing changes
      expect(resolveClaude()).toEqual({ path: exe, source: 'path' });
      expect(claudeFailedToStart(exe)).toBe(true);
      const r = resolveClaude();
      expect(r).toMatchObject({ source: 'embedded', fallback: true });
      resolveClaude();
      expect(warn.mock.calls.filter(c => /did not start: the app runs its own copy/.test(String(c[1])))).toHaveLength(1);
    } finally { warn.mockRestore(); }
  });

  it('the embedded official binary of the dependency is there for the fallback', () => {
    const r = bundledClaude({ starts: [process.cwd()] });
    expect(r?.source).toBe('embedded');
    expect(r?.path).toMatch(new RegExp(String.raw`[\\/]@anthropic-ai[\\/]claude-agent-sdk-${process.platform}-${process.arch}[\\/]claude(\.exe)?$`));
    expect(fs.existsSync(r?.path ?? '')).toBe(true);
  });

  it('runs .mjs engines with this runtime as Node and never leaks that switch to real ones', () => {
    expect(commandFor('C:\\f\\fake.mjs', ['-p'], {})).toEqual({ command: process.execPath, args: ['C:\\f\\fake.mjs', '-p'], env: { ELECTRON_RUN_AS_NODE: '1' } });
    expect(commandFor('C:\\e\\claude.exe', ['-p'], { ELECTRON_RUN_AS_NODE: '1', A: 'b' })).toEqual({ command: 'C:\\e\\claude.exe', args: ['-p'], env: { A: 'b' } });
  });
});
