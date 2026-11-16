// How big a piece of a project is (ADR 0316, «Quanto è grande» beside the map): the files under the paths it was read
// from (its evidence, relative to the map's root) and their lines, counted by the app without a token. Bounded so a huge
// folder never holds the app up: at most SIZE_MAX_FILES files and SIZE_MAX_BYTES read; generated and dependency folders
// (node_modules, bin, obj, dist, out, build, target, coverage, vendor) and hidden ones are skipped, and so is a file that
// is not text (a NUL in its head) or bigger than SIZE_FILE_BYTES (counted as a file, without lines). Async: the page
// asks when a box is picked. Never a network share (rule 2): a root that is not a local path counts nothing, and an
// evidence path that is, or leads by a link to, a share is skipped (open-path.ts). At most SIZE_MAX_DIRS folders are
// listed. Used by projectmap/service.ts; pinned by test/unit/projectmap-size.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { linksToShare, localPath } from '../open-path';

export interface PieceSize { files: number; lines: number; capped: boolean }

export const SIZE_MAX_FILES = 3000;
export const SIZE_MAX_BYTES = 40_000_000;
export const SIZE_FILE_BYTES = 2_000_000;
export const SIZE_MAX_DIRS = 2000;
const share = (p: string) => p.startsWith('\\\\') || p.startsWith('//');
const SKIP = new Set(['node_modules', 'bin', 'obj', 'dist', 'out', 'build', 'target', 'coverage', 'vendor', '__pycache__']);

/** The files and lines under `evidence` (files, or folders ending in /), inside `root`; a path that leaves the root is ignored. */
export async function sizeOf(root: string, evidence: readonly string[]): Promise<PieceSize> {
  const out: PieceSize = { files: 0, lines: 0, capped: false };
  const local = localPath(root);
  if (!local || share(local)) return out;
  const base = path.resolve(local), within = base.endsWith(path.sep) ? base : base + path.sep;
  let dirs = 0;
  const seen = new Set<string>();
  let bytes = 0;
  const file = async (abs: string, size: number) => {
    if (seen.has(abs)) return;
    seen.add(abs);
    if (out.files >= SIZE_MAX_FILES) { out.capped = true; return; }
    out.files++;
    if (size > SIZE_FILE_BYTES) return;
    if (bytes + size > SIZE_MAX_BYTES) { out.capped = true; return; }
    bytes += size;
    let buf: Buffer;
    try { buf = await fs.promises.readFile(abs); } catch { return; }
    if (buf.subarray(0, 8000).includes(0)) return;
    let n = 0;
    for (let i = buf.indexOf(10); i >= 0; i = buf.indexOf(10, i + 1)) n++;
    out.lines += buf.length && buf[buf.length - 1] !== 10 ? n + 1 : n;
  };
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (out.capped || depth > 12) return;
    if (++dirs > SIZE_MAX_DIRS) { out.capped = true; return; }
    let names: fs.Dirent[];
    try { names = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    names.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of names) {
      if (out.capped) return;
      if (d.name.startsWith('.') || d.isSymbolicLink()) continue;
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) { if (!SKIP.has(d.name.toLowerCase())) await walk(abs, depth + 1); }
      else if (d.isFile()) { try { await file(abs, (await fs.promises.stat(abs)).size); } catch { /* gone meanwhile */ } }
    }
  };
  for (const rel of evidence) {
    const abs = path.resolve(base, rel);
    if (abs !== base && !abs.startsWith(within)) continue;
    if (linksToShare(abs)) continue;
    let st: fs.Stats;
    try { if (share(await fs.promises.realpath(abs))) continue; st = await fs.promises.stat(abs); } catch { continue; }
    if (st.isDirectory()) await walk(abs, 0);
    else if (st.isFile()) await file(abs, st.size);
    if (out.capped) break;
  }
  return out;
}
