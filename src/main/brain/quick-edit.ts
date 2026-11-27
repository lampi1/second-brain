// The pure half of the Orchestrator's small brain edit (ADR 0370, owner proposal 4, 2026-11-27: a «d'ora in poi …» rule
// went Orchestrator → Artisan (p50 10.7 min) → Sentinel (p50 9.4 min) for a one-line change). What may be edited and how
// much: a path inside the brain, a Markdown or text file, never git, settings, hooks, permissions or the app's own files
// (those keep their own approval rules: ADR 0294 and the brain's permissions.json; nor an engine's agents and commands,
// and an edit whose text touches tools or permissions is refused by the service); at most QUICK_LIMITS.files files and
// QUICK_LIMITS.lines changed lines per edit, each change an exact replacement of text found once (or an append). A bigger
// edit goes to an Artisan. Also the line counts and the one compact diff line the user reads in the chat. No I/O: the
// service (quick-edit-service.ts) reads and writes; unit tests: test/unit/brain/quick-edit.test.ts.
import path from 'node:path';

export const QUICK_LIMITS = {
  /** files one edit may touch */
  files: 3,
  /** changed lines (added + removed) of one edit, all files together */
  lines: 40,
  /** a file larger than this is not edited here */
  bytes: 256 * 1024,
  /** new text (the lines added) per file, in bytes: a huge line or a new file is not small */
  addedBytes: 16 * 1024,
  /** changes in one edit */
  changes: 12,
  /** «Annulla» works this long after the edit */
  undoMs: 24 * 3_600_000,
} as const;

/** Text the user reads and agents follow; never code, data or configuration (those go to an Artisan or their own tool). */
export const QUICK_EXTS: readonly string[] = ['.md', '.txt'];

/** Folders never edited here: git and the engines' configuration (their settings and hooks), dependencies. */
const DENIED_DIRS = new Set(['.git', '.githooks', '.husky', 'hooks', 'node_modules', '.vscode', '.idea']);
/** Files never edited here: the brain's permissions and settings, the app's own log of changes. */
const DENIED_FILES = /^(?:permissions\.json|settings(?:\.[\w-]+)*\.json|domain\.json|config\.json|changelog\.md|\.gitignore|\.gitattributes|\.mcp\.json)$/i;

/** One change of a file: `old` found exactly once is replaced by `new`; no `old` (or empty) appends `new` at its end,
 *  creating the file when it does not exist. */
export interface QuickChange { path: string; old?: string; new: string }

/** The brain-relative path in one spelling (forward slashes), or why it may not be edited here. */
export function quickPath(raw: unknown): { rel: string } | { problem: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { problem: 'path: required, relative to the brain folder (e.g. rules/qa.md)' };
  const s = raw.trim().replace(/\\/g, '/');
  if (s.includes('\0') || /^[a-z]:/i.test(s) || s.startsWith('/') || s.startsWith('~')) return { problem: `${raw}: give a path relative to the brain folder` };
  const parts = s.split('/').filter(p => p && p !== '.');
  if (!parts.length || parts.includes('..')) return { problem: `${raw}: outside the brain folder` };
  const rel = parts.join('/'), base = parts[parts.length - 1]!;
  // an engine's agents and commands (.claude/agents, .claude/commands, .cursor/commands…) carry their tools and
  // permission mode in their frontmatter: their own approval too
  const engineDef = (p: string, i: number) => (p.toLowerCase() === 'agents' || p.toLowerCase() === 'commands') && i > 0 && parts[i - 1]!.startsWith('.');
  if (parts.slice(0, -1).some((p, i) => DENIED_DIRS.has(p.toLowerCase()) || engineDef(p, i)) || DENIED_FILES.test(base)) return { problem: `${rel}: settings, hooks, permissions and git keep their own approval (ADR 0294): not a quick edit; prepare the exact text for the user` };
  if (!QUICK_EXTS.includes(path.posix.extname(base).toLowerCase())) return { problem: `${rel}: only text files (${QUICK_EXTS.join(' ')}) are edited here; scripts and data go to brain_script_save or an Artisan` };
  return { rel };
}

/** True when `abs` lies inside `root` (both real paths; case-insensitive on Windows). */
export function inside(root: string, abs: string, win = process.platform === 'win32'): boolean {
  const r = path.relative(win ? root.toLowerCase() : root, win ? abs.toLowerCase() : abs);
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
}

/** How many lines a change adds and removes: the whole lines it touches, their common head and tail left out. */
function lineDelta(oldSpan: string, newSpan: string): { added: number; removed: number } {
  const a = oldSpan === '' ? [] : oldSpan.split('\n'), b = newSpan === '' ? [] : newSpan.split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { added: b.length - p - s, removed: a.length - p - s };
}

const lineCount = (t: string) => (t === '' ? 0 : t.replace(/\n$/, '').split('\n').length);

/** Applies one file's changes in order; the text after, the lines added and removed, the first added line (preview). */
export function applyChanges(before: string | null, changes: readonly Pick<QuickChange, 'old' | 'new'>[], file = 'file'):
  { after: string; added: number; removed: number; preview: string } | { problem: string } {
  let text = before ?? '';
  const crlf = text.includes('\r\n');
  let added = 0, removed = 0, preview = '';
  for (const c of changes) {
    if (typeof c.new !== 'string') return { problem: `${file}: new: required text` };
    const nu = crlf ? c.new.replace(/\r?\n/g, '\r\n') : c.new;
    if (!c.old) {
      // append: on a line of its own
      const sep = text && !text.endsWith('\n') ? (crlf ? '\r\n' : '\n') : '';
      const add = nu.endsWith('\n') || !nu ? nu : `${nu}${crlf ? '\r\n' : '\n'}`;
      text = `${text}${sep}${add}`;
      const n = lineCount(add.replace(/\r\n/g, '\n'));
      added += n;
      preview ||= add.replace(/\r\n/g, '\n').split('\n').find(l => l.trim()) ?? '';
      continue;
    }
    if (before === null) return { problem: `${file}: the file does not exist; to create it give only new (no old)` };
    const old = crlf ? c.old.replace(/\r?\n/g, '\r\n') : c.old;
    const at = text.indexOf(old);
    if (at < 0) return { problem: `${file}: old text not found (read the file again: it must match exactly, spaces included)` };
    if (text.indexOf(old, at + 1) >= 0) return { problem: `${file}: old text found more than once: give a longer, unique piece` };
    const start = text.lastIndexOf('\n', at - 1) + 1;
    const endNl = text.indexOf('\n', at + old.length);
    const end = endNl < 0 ? text.length : endNl;
    const oldSpan = text.slice(start, end), newSpan = text.slice(start, at) + nu + text.slice(at + old.length, end);
    const d = lineDelta(oldSpan.replace(/\r\n/g, '\n').replace(/\r$/, ''), newSpan.replace(/\r\n/g, '\n').replace(/\r$/, ''));
    added += d.added; removed += d.removed;
    if (!preview && d.added) {
      const a = oldSpan.replace(/\r/g, '').split('\n'), b = newSpan.replace(/\r/g, '').split('\n');
      preview = b.find(l => !a.includes(l) && l.trim()) ?? '';
    }
    text = text.slice(0, at) + nu + text.slice(at + old.length);
  }
  return { after: text, added, removed, preview };
}

export interface FileDelta { path: string; added: number; removed: number; created: boolean }

/** The compact line the user reads in the chat: «✎ rules/qa.md +2 −1 · me.md +1 — "first added line"». */
export function diffLine(files: readonly FileDelta[], preview: string): string {
  const parts = files.map(f => `${f.path}${f.created ? ' (nuovo)' : ''} ${[f.added ? `+${f.added}` : '', f.removed ? `−${f.removed}` : ''].filter(Boolean).join(' ') || '±0'}`);
  const p = preview.trim().replace(/\s+/g, ' ');
  return `✎ ${parts.join(' · ')}${p ? ` — «${p.length > 90 ? `${p.slice(0, 89)}…` : p}»` : ''}`;
}

/** The git commit message: «brain: <summary>» and the files; the user's words come in the summary. */
export function commitMessage(summary: string, files: readonly string[]): string {
  const s = summary.replace(/\s+/g, ' ').trim().slice(0, 100) || `edit ${files.join(', ')}`;
  return `brain: ${s}\n\nQuick edit by the Orchestrator (ADR 0370): ${files.join(', ')}`;
}
