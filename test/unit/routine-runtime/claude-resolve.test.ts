// The terminal Claude engine never spawns through a shell (packages/routine-runtime/src/claude.ts): `claude` is resolved
// on PATH to claude.exe, or to Node + the npm package's cli.js behind a claude.cmd shim on Windows.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveClaudeCommand } from '../../../packages/routine-runtime/src/index';

describe('resolveClaudeCommand', () => {
  it('Windows: claude.exe first, else the npm shim through node + cli.js', () => {
    const files = new Set(['C:\\a\\claude.cmd', 'C:\\a\\node_modules\\@anthropic-ai\\claude-code\\cli.js', 'C:\\b\\claude.exe']);
    expect(resolveClaudeCommand({ Path: 'C:\\b;C:\\a' }, 'win32', f => files.has(f))).toEqual({ command: 'C:\\b\\claude.exe', prefix: [] });
    expect(resolveClaudeCommand({ Path: '"C:\\a";C:\\b' }, 'win32', f => files.has(f))).toEqual({ command: process.execPath, prefix: ['C:\\a\\node_modules\\@anthropic-ai\\claude-code\\cli.js'] });
  });
  it('Linux: the first claude on PATH; nothing found = null', () => {
    expect(resolveClaudeCommand({ PATH: '/x:/usr/bin' }, 'linux', f => f === path.posix.join('/usr/bin', 'claude'))).toEqual({ command: '/usr/bin/claude', prefix: [] });
    expect(resolveClaudeCommand({ PATH: '/x' }, 'linux', () => false)).toBeNull();
  });
});
