// Where the Ctrl+K index reads from, read-only and incrementally: a Claude transcript (only the bytes appended since the
// last read; user and assistant text, no tools, thinking or injected reminders), the brain folder's markdown files
// (re-read only when size or mtime changed) and the git branch of a folder (its .git/HEAD, worktrees included). Why
// files and not the chat manager: asking the manager for a closed chat's items would load its whole history into the
// running app. Async I/O; the service parses in slices so a first index never blocks the window. Used by search/service.ts.
import fs from 'node:fs';
import path from 'node:path';
import { userText } from '../chats/transcript';
import { part, type Part } from './text-index';

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The searchable parts of transcript lines (main thread only). */
export function transcriptParts(lines: string[]): Part[] {
  const out: Part[] = [];
  for (const line of lines) {
    if (!line.trim() || (!line.includes('"user"') && !line.includes('"assistant"'))) continue;
    let m: Obj;
    try { m = o(JSON.parse(line)); } catch { continue; }
    if (m.isSidechain === true || m.isMeta === true || m.isCompactSummary === true) continue;
    if (m.type !== 'user' && m.type !== 'assistant') continue;
    const at = Date.parse(s(m.timestamp)) || 0;
    const content = o(m.message).content;
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content.map(o) : [];
    const text = blocks.filter(b => b.type === 'text').map(b => s(b.text)).join('\n');
    if (!text.trim()) continue;
    const t = m.type === 'user' ? userText(text)?.text ?? '' : text;
    if (t.trim()) out.push(part(at, t));
  }
  return out;
}

/** A transcript read so far: the next read starts at `offset` (after the last complete line). */
export interface TailState { offset: number; size: number; mtimeMs: number }

/** The complete lines appended to `file` since `st` (all of it, at most the last `firstMax` bytes, the first time).
 *  A file that shrank (rewritten) is read again from the start. null = unchanged. */
export async function readAppended(file: string, st: TailState | null, firstMax = 8 * 1024 * 1024): Promise<{ lines: string[]; state: TailState; reset: boolean } | null> {
  const stat = await fs.promises.stat(file);
  if (st && stat.size === st.size && stat.mtimeMs === st.mtimeMs) return null;
  const reset = !st || stat.size < st.offset;
  const from = reset ? Math.max(0, stat.size - firstMax) : st.offset;
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(stat.size - from);
    if (buf.length) await fh.read(buf, 0, buf.length, from);
    const end = buf.lastIndexOf(0x0a);
    const done = end >= 0 ? buf.subarray(0, end + 1) : Buffer.alloc(0);
    const lines = done.toString('utf8').split('\n');
    if (reset && from > 0) lines.shift(); // partial first line of a tail
    return { lines, state: { offset: from + done.length, size: stat.size, mtimeMs: stat.mtimeMs }, reset };
  } finally { await fh.close(); }
}

const SKIP_DIR = /^(\.|node_modules$|out$|dist$|bin$|obj$)/;

/** The markdown files under `root` ('/'-separated relative paths, with size and mtime): hidden folders and build
 *  output skipped, at most `max` files, `depth` levels. */
export async function listMarkdown(root: string, max = 4000, depth = 8): Promise<{ rel: string; size: number; mtimeMs: number }[]> {
  const out: { rel: string; size: number; mtimeMs: number }[] = [];
  const walk = async (dir: string, rel: string, d: number): Promise<void> => {
    let ents: fs.Dirent[];
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= max) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (d < depth && !SKIP_DIR.test(e.name)) await walk(path.join(dir, e.name), r, d + 1); continue; }
      if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
      try { const st = await fs.promises.stat(path.join(dir, e.name)); out.push({ rel: r, size: st.size, mtimeMs: st.mtimeMs }); } catch { /* gone meanwhile */ }
    }
  };
  await walk(root, '', 0);
  return out;
}

/** The branch checked out in the git repository holding `cwd` (a worktree too), null if none or detached. */
export async function gitBranch(cwd: string): Promise<string | null> {
  let dir = path.resolve(cwd);
  for (let i = 0; i < 8; i++) {
    const dotgit = path.join(dir, '.git');
    try {
      const st = await fs.promises.stat(dotgit);
      let gitdir = dotgit;
      if (st.isFile()) {
        const m = (await fs.promises.readFile(dotgit, 'utf8')).match(/^gitdir:\s*(.+)$/m);
        if (!m?.[1]) return null;
        gitdir = path.resolve(dir, m[1].trim());
      }
      const head = (await fs.promises.readFile(path.join(gitdir, 'HEAD'), 'utf8')).trim();
      return head.match(/^ref:\s*refs\/heads\/(.+)$/)?.[1] ?? null;
    } catch { /* not here: one level up */ }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}
