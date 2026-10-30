// The user's files and folders as sources of a lesson (ADR 0204): read here, in the page, with the browser's File API
// (a drop on Impara's field, or «Aggiungi fonte» → a file or a folder), so main never opens a path the page names; the
// text goes to main with the start request (LessonStart.files, checked again by main/learn/user-files.ts). Folders are
// walked (webkitGetAsEntry on a drop, webkitRelativePath on a pick), skipping the usual build and dependency folders
// and anything that is not text. Used by components/impara/ImparaStart.tsx; the pure rules pinned by
// test/unit/impara-files.test.ts.
import type { LessonFile } from '@shared/lesson';

export const PICK_MAX = 40;
export const PICK_BYTES = 400_000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'bin', 'obj', '.venv', 'venv', '__pycache__', 'target', 'coverage', '.cache', '.idea', '.vs']);
const BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|svgz|pdf|zip|gz|tgz|7z|rar|exe|dll|so|dylib|bin|class|jar|woff2?|ttf|otf|eot|mp[34]|wav|ogg|webm|mov|avi|mkv|db|sqlite|lock|psd|ai|docx?|xlsx?|pptx?|wasm|node|pyc)$/i;

/** A path left out: inside a build, dependency or hidden folder, a hidden file, or a known binary type. */
export function skipPath(path: string): boolean {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.slice(0, -1).some(p => SKIP_DIRS.has(p) || p.startsWith('.'))) return true;
  const name = parts.at(-1) ?? '';
  // a hidden file (.env and the like may hold secrets) never goes to a model
  return !name || name.startsWith('.') || BINARY.test(name);
}

/** The files to add, from the ones already there: new names only, at most PICK_MAX in all. */
export function mergeFiles(have: readonly LessonFile[], add: readonly LessonFile[]): LessonFile[] {
  const out = [...have];
  for (const f of add) if (out.length < PICK_MAX && !out.some(x => x.name === f.name)) out.push(f);
  return out;
}

async function textOf(file: File, name: string): Promise<LessonFile | null> {
  if (skipPath(name) || file.size > PICK_BYTES || file.size === 0) return null;
  try {
    const text = await file.text();
    return text.includes('\u0000') ? null : { name, text };
  } catch { return null; }
}

/** Files picked with an <input type=file> (a folder pick gives each file its path inside the folder). */
export async function readPicked(list: FileList | readonly File[]): Promise<LessonFile[]> {
  const out: LessonFile[] = [];
  for (const f of [...list]) {
    if (out.length >= PICK_MAX) break;
    const x = await textOf(f, (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
    if (x) out.push(x);
  }
  return out;
}

type Entry = { isFile: boolean; isDirectory: boolean; name: string; fullPath: string; file?: (ok: (f: File) => void, ko: (e: unknown) => void) => void; createReader?: () => { readEntries: (ok: (e: Entry[]) => void, ko: (e: unknown) => void) => void } };

async function walk(e: Entry, out: LessonFile[]): Promise<void> {
  if (out.length >= PICK_MAX) return;
  const name = e.fullPath.replace(/^\/+/, '') || e.name;
  if (e.isFile && e.file) {
    const f = await new Promise<File | null>(ok => e.file!(ok, () => ok(null)));
    const x = f ? await textOf(f, name) : null;
    if (x) out.push(x);
  } else if (e.isDirectory && e.createReader && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) {
    const reader = e.createReader();
    // readEntries gives a batch at a time: read until an empty one
    for (;;) {
      const batch = await new Promise<Entry[]>(ok => reader.readEntries(ok, () => ok([])));
      if (!batch.length) break;
      for (const c of batch) { if (out.length >= PICK_MAX) return; await walk(c, out); }
    }
  }
}

/** Files and folders dropped on the field. */
export async function readDropped(dt: DataTransfer): Promise<LessonFile[]> {
  const entries = [...dt.items].filter(i => i.kind === 'file').map(i => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null);
  if (entries.some(Boolean)) {
    const out: LessonFile[] = [];
    for (const e of entries) if (e) await walk(e, out);
    return out;
  }
  return readPicked(dt.files);
}

/** Does a drag carry files (not a text being moved)? */
export const dragHasFiles = (dt: DataTransfer | null): boolean => !!dt && [...dt.types].includes('Files');
