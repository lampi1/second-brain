// Memoria → Artifact (ADR 0319): the files under a folder that may be artifacts, found without reading them: a bounded
// walk (depth, entries per folder, files in all) that never follows a link and skips tool folders (node_modules, .git,
// bin, obj, …: shared/library.ts artifactKind). Async, so a big brain/tmp never holds the main process up; it yields to
// the event loop every few hundred entries. Used by library/service.ts; pinned by test/unit/library-service.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { artifactKind, type ArtifactKind } from '../../shared/library';

export interface WalkRoot { dir: string; depth: number }
export interface Found { path: string; kind: ArtifactKind; mtimeMs: number; size: number }

const PER_DIR = 3000;
/** Entries looked at in all (files and folders): past it the walk stops, whatever it found so far is kept. */
const ENTRIES_MAX = 200_000;
const SKIP_DIR = /^(node_modules|\.git|\.claude|\.cursor|\.agents|\.codex|\.vscode|\.idea|\.next|\.cache|__pycache__|bin|obj|dist|coverage|site-packages|vendor|voice-samples)$/i;
const yieldNow = () => new Promise<void>(r => setImmediate(r));

/** Every artifact file under the roots, at most `max` (the newest kept when there are more). */
export async function walk(roots: readonly WalkRoot[], max = 20_000): Promise<Found[]> {
  const out: Found[] = [];
  let seen = 0;
  const visit = async (dir: string, depth: number): Promise<void> => {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    // a folder this full is a build's or a cache's output, not where reports are kept
    if (entries.length > PER_DIR) return;
    for (const e of entries) {
      if (++seen > ENTRIES_MAX) return;
      if (seen % 400 === 0) await yieldNow();
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0 && !SKIP_DIR.test(e.name)) await visit(full, depth - 1); continue; }
      if (!e.isFile()) continue;
      const kind = artifactKind(full);
      if (!kind) continue;
      try { const st = await fs.promises.stat(full); if (st.size > 0) out.push({ path: full, kind, mtimeMs: st.mtimeMs, size: st.size }); } catch { /* gone meanwhile */ }
    }
  };
  for (const r of roots) {
    try { const st = await fs.promises.lstat(r.dir); if (!st.isDirectory()) continue; } catch { continue; }
    await visit(r.dir, r.depth);
  }
  return out.length > max ? out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, max) : out;
}

/** The first `bytes` of a file as UTF-8 (the head a title and a summary come from); '' when unreadable. */
export async function head(file: string, bytes = 64 * 1024): Promise<string> {
  let fd: fs.promises.FileHandle | undefined;
  try {
    fd = await fs.promises.open(file, 'r');
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fd.read(buf, 0, bytes, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch { return ''; } finally { await fd?.close().catch(() => undefined); }
}
