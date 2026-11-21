// The file reads of run_code's wrappers (Code Mode, ADR 0331): Read, the folder walk of Grep and Glob, and Grep's
// search over a list of files, with size limits. They run in a worker thread (code-mode/fs-worker.ts, started by
// code-mode/fs-run.ts), never on the Electron main process: a huge folder or a regex that backtracks forever stops
// only that thread, which a time limit ends. Pure over node:fs; tests call them directly.
import fs from 'node:fs';
import path from 'node:path';

export const FS_LIMITS = {
  /** a file larger than this is not read whole (Read refuses it, Grep skips it) */
  maxFileBytes: 10 * 1024 * 1024,
  /** at most so many files in one walk */
  walkMax: 20_000,
  /** the longest regex a Grep may use */
  patternMax: 1_000,
  /** the longest line shown */
  lineMax: 2_000,
};

const SKIP_DIRS = new Set(['node_modules', '.git']);

export type FsRequest =
  | { op: 'read'; file: string; from: number; count: number }
  | { op: 'walk'; root: string }
  | { op: 'grep'; base: string; files: string[]; pattern: string; ignoreCase: boolean; mode: 'files_with_matches' | 'content' | 'count'; limit: number };

export type FsResult = { op: 'read'; text: string } | { op: 'walk'; files: string[]; single: boolean } | { op: 'grep'; lines: string[] };

const cutLine = (l: string): string => (l.length > FS_LIMITS.lineMax ? `${l.slice(0, FS_LIMITS.lineMax)}…` : l);

/** Every file under dir (node_modules and .git left out), relative with /, at most walkMax. */
function walk(dir: string): string[] {
  const out: string[] = [];
  const go = (d: string, rel: string): void => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= FS_LIMITS.walkMax) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) go(path.join(d, e.name), r); }
      else if (e.isFile()) out.push(r);
    }
  };
  go(dir, '');
  return out;
}

/** One request. Throws an Error with a message the script can read (a missing file, a file too large). */
export function fsOp(req: FsRequest): FsResult {
  switch (req.op) {
    case 'read': {
      const size = fs.statSync(req.file).size;
      if (size > FS_LIMITS.maxFileBytes) throw new Error(`${req.file} is ${Math.round(size / 1048576)} MB: over the ${FS_LIMITS.maxFileBytes / 1048576} MB a Read takes (use Grep, or Bash with head/tail)`);
      const lines = fs.readFileSync(req.file, 'utf8').split(/\r?\n/);
      return { op: 'read', text: lines.slice(req.from - 1, req.from - 1 + req.count).map((l, i) => `${req.from + i}\t${cutLine(l)}`).join('\n') };
    }
    case 'walk': {
      const single = fs.existsSync(req.root) && fs.statSync(req.root).isFile();
      return { op: 'walk', single, files: single ? [path.basename(req.root)] : walk(req.root) };
    }
    case 'grep': {
      if (req.pattern.length > FS_LIMITS.patternMax) throw new Error(`the pattern is over ${FS_LIMITS.patternMax} characters`);
      const re = new RegExp(req.pattern, req.ignoreCase ? 'i' : '');
      const out: string[] = [];
      for (const f of req.files) {
        if (req.limit > 0 && out.length >= req.limit) break;
        const full = path.join(req.base, f);
        let text: string;
        try { if (fs.statSync(full).size > FS_LIMITS.maxFileBytes) continue; text = fs.readFileSync(full, 'utf8'); } catch { continue; }
        if (text.includes('\u0000')) continue; // a binary file
        if (req.mode === 'files_with_matches') { if (re.test(text)) out.push(full); continue; }
        const lines = text.split(/\r?\n/);
        if (req.mode === 'count') { const n = lines.filter(l => re.test(l)).length; if (n) out.push(`${full}:${n}`); continue; }
        lines.forEach((l, i) => { if ((req.limit <= 0 || out.length < req.limit) && re.test(l)) out.push(`${full}:${i + 1}:${cutLine(l)}`); });
      }
      return { op: 'grep', lines: out };
    }
  }
}
