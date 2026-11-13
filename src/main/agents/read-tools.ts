// The brain's declared read-only tools (issue #93): `read-only-tools.md` at the brain root lists, one per line, the node
// scripts a role limited to read-only commands (shell-read) may run, e.g. `- tools/my-tasks.mjs: my work items`. A path
// is relative to the brain folder (or absolute); only an existing .mjs/.js/.cjs file counts, by its real path (links
// resolved), so `node <that file> [args]` passes the read-only classifier (tool-policy.ts readOnlyCommand) and any other
// script stays refused. The list is the user's: the role gate refuses every role's edit of this file
// (agents/role-gate.ts), and a declared script is trusted to only read: the user vouches for it by listing it.
// Cached by the file's mtime. Used by chats/manager.ts (refusedCommand, the role gate).
import fs from 'node:fs';
import path from 'node:path';

export const READ_TOOLS_FILE = 'read-only-tools.md';
const SCRIPT = /\.(?:mjs|cjs|js)$/i;
const MAX_LINES = 200, MAX_BYTES = 64 * 1024;

/** The script path a line names: the first word in backticks, else the first word, after a list marker. */
export function lineScript(line: string): string | null {
  const l = line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, '');
  if (!l || l.startsWith('#') || l.startsWith('<!--')) return null;
  const word = /^`([^`]+)`/.exec(l)?.[1] ?? l.split(/[\s:—–]+/)[0] ?? '';
  const p = word.trim().replace(/^node\s+/, '');
  return SCRIPT.test(p) && !p.includes('\0') ? p : null;
}

let cache: { file: string; mtime: number; size: number; paths: string[] } | null = null;

/** The declared scripts' real paths (existing files only); [] without a brain or a list. */
export function readOnlyTools(brainRoot: string | null | undefined): string[] {
  if (!brainRoot || !path.isAbsolute(brainRoot)) return [];
  const file = path.join(brainRoot, READ_TOOLS_FILE);
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return []; }
  if (!st.isFile() || st.size > MAX_BYTES) return [];
  if (cache && cache.file === file && cache.mtime === st.mtimeMs && cache.size === st.size) return cache.paths;
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const paths: string[] = [];
  for (const line of text.split(/\r?\n/).slice(0, MAX_LINES)) {
    const p = lineScript(line);
    if (!p) continue;
    try {
      const real = fs.realpathSync.native(path.resolve(brainRoot, p));
      if (fs.statSync(real).isFile() && !paths.includes(real)) paths.push(real);
    } catch { /* missing: not declared */ }
  }
  cache = { file, mtime: st.mtimeMs, size: st.size, paths };
  return paths;
}

