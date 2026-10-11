// First run without a brain folder: look for one by its signature (AGENTS.md + ops/tools/brain-site.mjs) one level
// under the user's home folder and its usual "source/repos" folder, so the app works at once without choosing anything
// (the user, 2026-10-11: "io non voglio sbattermi a scegliere la cartella giusta"). No personal names in code: only the
// signature. Exactly one match is used automatically; zero or several leave the choice to the banner. Used by
// brain/index.ts at start.
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
