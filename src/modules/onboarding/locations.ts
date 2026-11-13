// OS-specific locations are data, never shell commands or manually assembled separators.
import os from 'node:os';
import path from 'node:path';
import type { Harness } from './contract';
export type Platform = 'win32' | 'darwin' | 'linux';
export function locations(home = os.homedir(), platform: NodeJS.Platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const configs = [p.join(home, '.claude.json'), p.join(home, '.codex', 'config.toml'), p.join(home, '.cursor', 'mcp.json')];
  const roots = ['repos', 'projects', 'work', 'code', ...(platform === 'darwin' ? ['Developer'] : [])].map(name => p.join(home, name));
  roots.unshift(p.join(home, 'source', 'repos'));
  const cli: Record<Harness, string[]> = platform === 'win32' ? {
    claude: [p.join(home, '.local', 'bin', 'claude.exe'), p.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd')],
    codex: [p.join(home, 'AppData', 'Roaming', 'npm', 'codex.cmd')],
    cursor: [p.join(home, 'AppData', 'Local', 'cursor-agent', 'agent.cmd')],
  } : {
    claude: [p.join(home, '.local', 'bin', 'claude'), p.join(p.parse(home).root, 'usr', 'local', 'bin', 'claude')],
    codex: [p.join(home, '.local', 'bin', 'codex'), p.join(p.parse(home).root, 'usr', 'local', 'bin', 'codex'), ...(platform === 'darwin' ? [p.join(p.parse(home).root, 'opt', 'homebrew', 'bin', 'codex')] : [])],
    cursor: [p.join(home, '.local', 'bin', 'agent'), p.join(home, '.local', 'bin', 'cursor-agent')],
  };
  return { roots, configs, cli };
}
export function projectConfigs(project: string, platform: NodeJS.Platform = process.platform): Record<Harness, string> {
  const p = platform === 'win32' ? path.win32 : path.posix;
  return { claude: p.join(project, '.mcp.json'), codex: p.join(project, '.codex', 'config.toml'), cursor: p.join(project, '.cursor', 'mcp.json') };
}
