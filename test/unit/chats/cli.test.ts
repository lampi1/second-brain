// Engine resolution (src/main/chats/cli.ts): the embedded Claude binary by default (ADR 0010), a release's copy from
// SB_ENGINE_CLAUDE, SB_CLAUDE_PATH for tests; scripts run with this runtime as Node.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { commandFor, resolveClaude } from '../../../src/main/chats/cli';
import { tmp } from './helpers';

const saved = { SB_CLAUDE_PATH: process.env.SB_CLAUDE_PATH, SB_ENGINE_CLAUDE: process.env.SB_ENGINE_CLAUDE };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('Claude engine resolution', () => {
  it('uses the embedded official binary of the dependency by default', () => {
    delete process.env.SB_CLAUDE_PATH; delete process.env.SB_ENGINE_CLAUDE;
    const r = resolveClaude();
    expect(r?.source).toBe('embedded');
    expect(r?.path).toMatch(/[\\/]@anthropic-ai[\\/]claude-agent-sdk-win32-x64[\\/]claude\.exe$/);
    expect(fs.existsSync(r?.path ?? '')).toBe(true);
  });

  it('a release passes its own copy in SB_ENGINE_CLAUDE; SB_CLAUDE_PATH (tests) wins over everything', () => {
    const rel = path.join(tmp('engines'), 'claude.exe');
    fs.writeFileSync(rel, '');
    delete process.env.SB_CLAUDE_PATH;
    process.env.SB_ENGINE_CLAUDE = rel;
    expect(resolveClaude()).toEqual({ path: rel, source: 'release' });
    process.env.SB_ENGINE_CLAUDE = path.join(tmp('x'), 'missing.exe'); // a stale variable never wins over the embedded one
    expect(resolveClaude()?.source).toBe('embedded');
    process.env.SB_CLAUDE_PATH = 'C:\\fake\\claude.mjs';
    expect(resolveClaude()).toEqual({ path: 'C:\\fake\\claude.mjs', source: 'override' });
    expect(resolveClaude('D:\\x.exe')).toEqual({ path: 'D:\\x.exe', source: 'override' });
  });

  it('runs .mjs engines with this runtime as Node and never leaks that switch to real ones', () => {
    expect(commandFor('C:\\f\\fake.mjs', ['-p'], {})).toEqual({ command: process.execPath, args: ['C:\\f\\fake.mjs', '-p'], env: { ELECTRON_RUN_AS_NODE: '1' } });
    expect(commandFor('C:\\e\\claude.exe', ['-p'], { ELECTRON_RUN_AS_NODE: '1', A: 'b' })).toEqual({ command: 'C:\\e\\claude.exe', args: ['-p'], env: { A: 'b' } });
  });
});
