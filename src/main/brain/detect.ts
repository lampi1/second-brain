// Suggest existing brains by signature, one level below home and its usual project folders.
// The first-run interview asks before using any match. Its IPC caller accepts SB_HOME for isolated trials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const isBrainFolder = (dir: string): boolean =>
  fs.existsSync(path.join(dir, 'AGENTS.md')) && fs.existsSync(path.join(dir, 'ops', 'tools', 'brain-site.mjs'));

export function findBrainCandidates(home = os.homedir()): string[] {
  const out = new Set<string>();
  for (const base of [home, path.join(home, 'source', 'repos'), path.join(home, 'Documents')]) {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || /^(AppData|OneDrive|node_modules)/i.test(e.name)) continue;
      const dir = path.join(base, e.name);
      if (isBrainFolder(dir)) out.add(dir);
    }
  }
  return [...out];
}
