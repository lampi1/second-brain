// The file paths a memory fact, a skill or a rule cites, and whether they still exist (ADR 0194, M2; Solenta checks the
// files its facts cite: a fact about a file that is gone misleads every agent that reads it). Conservative on purpose:
// a path counts only when it looks like one (a backticked token with a slash or an extension, or a bare token with a
// folder and an extension), and «missing» only when its folder's first part exists where it should be and the file does
// not: a path of another machine, a URL or a template is «unknown», never missing, so a fact is never dropped on a guess.
// Used by rules/launch-memory.ts (facts citing missing files are not given to an agent) and brainmodel/brain-lint.ts
// (the cards); tests: test/unit/brainmodel/brain-lint.test.ts, test/unit/launch-memory.test.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BACKTICK = /`([^`\n]{2,260})`/g;
// a bare path: an optional root (C:\, /, ./, ../, ~/), at least one folder, a file name with an extension
const BARE = /(?:^|[\s(«"'[])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|[\\/])?(?:[\w.@-]+[\\/])+[\w.@-]+\.[A-Za-z0-9]{1,8})(?=$|[\s)»"'\],;:!?]|\.(?:\s|$))/g;

/** Looks like a file path (not a URL, a flag, a glob, a template, a domain or a version). */
export function pathLike(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 260 || /\s/.test(t) || /:\/\//.test(t) || /^[-@]/.test(t) || /[*?<>{}$|%]/.test(t)) return false;
  if (/^[\w-]+(?:\.[\w-]+)+\//.test(t) && !/^\.{1,2}\//.test(t)) return false; // github.com/x, example.org/y
  if (/^v?\d+(?:\.\d+)+$/.test(t)) return false;
  const slash = /[\\/]/.test(t), ext = /\.[A-Za-z0-9]{1,8}$/.test(t);
  if (!slash && !ext) return false;
  if (!slash && !/^[\w.-]+\.(?:md|ts|tsx|js|mjs|cjs|json|ya?ml|toml|ps1|psm1|py|sh|bat|cmd|sql|kql|csv|txt|cs|java|go|rs|rb|php|html|css|xml|ini|cfg|config|env|lock)$/i.test(t)) return false;
  return true;
}

/** The paths a text cites, in order, each once. */
export function citedPaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(BACKTICK)) { const t = m[1]!.trim().replace(/[.,;:]+$/, ''); if (pathLike(t)) out.add(t); }
  const plain = text.replace(BACKTICK, ' ');
  for (const m of plain.matchAll(BARE)) { const t = m[1]!.replace(/[.,;:]+$/, ''); if (pathLike(t)) out.add(t); }
  return [...out];
}

const exists = (p: string): boolean => { try { fs.statSync(p); return true; } catch { return false; } };
const isDir = (p: string): boolean => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

export type PathState = 'exists' | 'missing' | 'unknown';
/** Does a cited path still exist? `bases`: the folders a relative path is read from (the brain, the fact's repository
 *  and project); `local`: the citing file's own folder (a skill's), read first. Missing only when the place it points
 *  into is there; a bare file name («package.json») is never missing (it could live anywhere). */
export function pathState(cited: string, bases: readonly string[], o: { home?: string; local?: string } = {}): PathState {
  const home = o.home ?? os.homedir();
  const raw = cited.replace(/^~(?=[\\/])/, home);
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
    const p = path.normalize(raw);
    if (exists(p)) return 'exists';
    // the top two folders of the path exist (the drive and its first folder): the file is gone from a place that is here
    const parts = p.split(/[\\/]+/).filter(Boolean);
    const top = /^[A-Za-z]:$/.test(parts[0] ?? '') ? `${parts[0]}${path.sep}${parts[1] ?? ''}` : `${path.sep}${parts[0] ?? ''}${parts[1] ? `${path.sep}${parts[1]}` : ''}`;
    return parts.length > 2 && isDir(top) ? 'missing' : 'unknown';
  }
  const rel = raw.replace(/\\/g, '/');
  const local = o.local && isDir(o.local) ? o.local : null;
  const usable = [...(local ? [local] : []), ...bases.filter(b => !!b && isDir(b))];
  if (!usable.length) return 'unknown';
  if (usable.some(b => exists(path.resolve(b, rel)))) return 'exists';
  // a bare file name («package.json») could live anywhere: never missing
  if (!rel.includes('/')) return 'unknown';
  // the folder it points into exists under a base (src/ of the repository): the file is gone from there
  const into = rel.startsWith('.') ? path.dirname(rel) : rel.split('/')[0]!;
  return usable.some(b => isDir(path.resolve(b, into))) ? 'missing' : 'unknown';
}

/** The cited paths of a text that are missing. */
export const missingPaths = (text: string, bases: readonly string[], o: { home?: string; local?: string } = {}): string[] =>
  citedPaths(text).filter(p => pathState(p, bases, o) === 'missing');
