// Bounded, metadata-only discovery. No subprocesses, network, credentials or home recursion.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { Discovery, Evidence, Harness } from './contract';
import { LocalFiles } from './local';
import { locations } from './locations';
export function remoteHost(raw: string): string | null {
  // Return a fixed provider label only: credentials, query strings and repository paths never leave this function.
  const value = raw.trim();
  try {
    const host = value.includes('://') ? new URL(value).hostname.toLowerCase() : value.match(/^(?:[^@\s]+@)?([^:/\s]+):/)?.[1]?.toLowerCase();
    if (host === 'github.com' || host === 'ssh.github.com') return 'github.com';
    if (host === 'dev.azure.com' || host === 'ssh.dev.azure.com' || host?.endsWith('.visualstudio.com')) return 'dev.azure.com';
  } catch { /* malformed remote is not evidence */ }
  return null;
}
export async function discoverLocal(input: { home?: string; roots?: string[]; cliPaths?: Partial<Record<Harness, string>> }, local = new LocalFiles()): Promise<Discovery> {
  local.requireMetadata();
  const result: Discovery = { evidence: [], limited: false, skipped: 0 }, started = Date.now();
  const add = (kind: Evidence['kind'], file: string, source: string, hosts?: string[]) => result.evidence.push({ kind, path: file, source, checkedAt: new Date().toISOString(), login: 'unknown', ...(hosts ? { remoteHosts: hosts } : {}) });
  const known = locations(input.home ?? os.homedir());
  const roots = [...new Set(input.roots ?? known.roots)].slice(0, 8);
  // Known roots only, root plus immediate children; directory count and elapsed time bound every loop.
  let count = 0;
  for (const root of roots) {
    try {
      await local.check(root); add('workspace', root, 'known-root');
      const children = await fs.readdir(root, { withFileTypes: true });
      for (const folder of [root, ...children.filter(c => c.isDirectory()).slice(0, 200).map(c => path.join(root, c.name))]) {
        if (++count > 200 || Date.now() - started > 3000) { result.limited = true; break; }
        try {
          await local.check(folder);
          const config = await local.read(path.join(folder, '.git', 'config'));
          if (config !== null) {
            const hosts = [...new Set([...config.matchAll(/^\s*url\s*=\s*(.+)$/gm)].map(m => remoteHost(m[1]!)).filter((s): s is string => !!s))];
            add('repo', folder, 'git/config metadata', hosts);
          }
        } catch { result.skipped++; }
      }
      if (children.length > 200) result.limited = true;
    } catch { result.skipped++; }
    if (result.limited) break;
  }
  const candidates = input.cliPaths ? Object.entries(input.cliPaths) : Object.entries(known.cli).flatMap(([h, files]) => files.map(file => [h, file] as const));
  for (const [harness, file] of candidates) {
    try { await local.check(file); if ((await fs.stat(file)).isFile()) add('cli', file, harness); } catch { result.skipped++; }
  }
  for (const file of known.configs) {
    // Only existence/attributes: configs might contain credentials, so discovery never opens them.
    try { await local.check(file); add('config', file, 'known-harness-location'); } catch { result.skipped++; }
  }
  return result;
}
