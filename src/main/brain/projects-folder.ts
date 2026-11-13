// Finds the owner's projects folder by itself, read only, so the first-run setup asks for it only when it cannot tell
// (owner, 2026-10-19: "deve chiedere all'utente la sua cartella dei progetti se non lo capisce l'app da sola").
// Two kinds of evidence, both bounded and metadata only (directory names and the presence of `.git`, never a file's
// contents, so no config that may hold credentials is ever opened):
//   1. the folders the CLIs already worked in: the names of ~/.claude/projects/<slug> and ~/.cursor/projects/<slug>
//      (each slug is a path with every separator turned into "-"; resolved against the real folders), whose git repos'
//      common parent is a strong hint;
//   2. the usual places (~/source/repos, ~/Projects, ~/dev, ~/code, ~/git, ~/Documents/GitHub, ...) that hold git repos.
// The best-scored folder wins; the home folder itself, the brain and the app's data are never proposed.
// Used by main/index.ts ('app:projectsFolder'); the choice is saved in the setting projectsRoot (settings-schema.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DetectedProjects { path: string; repos: number; source: 'cli' | 'common' }
export interface DetectInput { home?: string; platform?: NodeJS.Platform; exclude?: (string | null | undefined)[] }

const COMMON = ['source/repos', 'source', 'repos', 'Projects', 'projects', 'Progetti', 'dev', 'Dev', 'code', 'Code', 'src', 'git', 'GitHub', 'github', 'workspace', 'Workspace', 'Documents/GitHub', 'Documents/Projects', 'Documents/Progetti', 'Developer', 'Sviluppo'];
const MAX_SLUGS = 300, MAX_CHILDREN = 400, MAX_WALK = 2000, MAX_DEPTH = 16;

/** Claude Code's folder slug: every character that is not a letter or a digit becomes "-" */
export const slugOf = (name: string): string => name.replace(/[^A-Za-z0-9]/g, '-');

function dirs(dir: string, max = MAX_CHILDREN): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).slice(0, max).filter(e => e.isDirectory() && !e.isSymbolicLink()).map(e => e.name);
  } catch { return []; }
}
const isDir = (dir: string): boolean => { try { const st = fs.lstatSync(dir); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; } };
const isRepo = (dir: string): boolean => { try { return fs.existsSync(path.join(dir, '.git')); } catch { return false; } };

/** a CLI's folder slug back to the real folder it names, by walking the folders that exist (null = none matches) */
export function resolveSlug(slug: string, platform: NodeJS.Platform = process.platform): string | null {
  let root: string, rest: string;
  const drive = /^([A-Za-z])--?(.*)$/.exec(slug);
  if (platform === 'win32' && drive) { root = `${drive[1]!.toUpperCase()}:\\`; rest = drive[2]!; }
  else { root = '/'; rest = slug.replace(/^-+/, ''); }
  const walk = (dir: string, left: string, depth: number): string | null => {
    if (!left) return dir;
    if (depth > MAX_DEPTH) return null;
    // the child names this slug may start with, the longest first ("my-app" must win over "my"): each prefix as it is
    // (a "-" kept as "-", the common case, checked directly), plus the listed names whose slug matches ("my_app", "a.b")
    const literal = [...left.matchAll(/-/g)].map(m => left.slice(0, m.index)).concat(left).filter(n => n && isDir(path.join(dir, n)));
    const listed = dirs(dir, MAX_WALK).filter(n => { const s = slugOf(n); return left === s || left.startsWith(`${s}-`); });
    const matches = [...new Set([...literal, ...listed])].sort((a, b) => b.length - a.length);
    for (const name of matches) {
      const s = slugOf(name), found = walk(path.join(dir, name), left === s ? '' : left.slice(s.length + 1), depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(root, rest, 0);
}

const inside = (child: string, parent: string): boolean => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/** the projects folder the evidence points to, or null when the app cannot tell (the setup then asks) */
export function detectProjectsFolder(input: DetectInput = {}): DetectedProjects | null {
  const home = path.resolve(input.home ?? os.homedir()), platform = input.platform ?? process.platform;
  const exclude = (input.exclude ?? []).filter((p): p is string => !!p).map(p => path.resolve(p));
  const allowed = (dir: string) => path.resolve(dir) !== home && !exclude.some(x => inside(dir, x) || inside(x, dir)) && path.dirname(dir) !== dir;
  const score = new Map<string, { repos: number; source: DetectedProjects['source']; weight: number }>();
  const add = (dir: string, repos: number, source: DetectedProjects['source'], weight: number) => {
    if (!allowed(dir) || repos < 1) return;
    const prev = score.get(dir);
    score.set(dir, { repos: Math.max(prev?.repos ?? 0, repos), source: prev?.source === 'cli' ? 'cli' : source, weight: (prev?.weight ?? 0) + weight });
  };
  // 1. the folders the CLIs already know (names only)
  const parents = new Map<string, Set<string>>();
  for (const base of [path.join(home, '.claude', 'projects'), path.join(home, '.cursor', 'projects')]) {
    for (const slug of dirs(base).slice(0, MAX_SLUGS)) {
      const folder = resolveSlug(slug, platform);
      if (!folder || !isRepo(folder)) continue;
      const parent = path.dirname(folder);
      if (!parents.has(parent)) parents.set(parent, new Set());
      parents.get(parent)!.add(folder);
    }
  }
  for (const [parent, repos] of parents) add(parent, repos.size, 'cli', repos.size * 3);
  // 2. the usual places, with at least one git repo right inside
  const seen = new Set<string>(); // "Projects" and "projects" are one folder on Windows and macOS
  for (const rel of COMMON) {
    let dir = path.join(home, ...rel.split('/'));
    try { dir = fs.realpathSync.native(dir); } catch { continue; }
    if (seen.has(dir)) continue;
    seen.add(dir);
    const repos = dirs(dir).filter(n => isRepo(path.join(dir, n))).length;
    add(dir, repos, 'common', repos);
  }
  const best = [...score.entries()].sort((a, b) => b[1].weight - a[1].weight || b[1].repos - a[1].repos || a[0].length - b[0].length)[0];
  return best ? { path: best[0], repos: best[1].repos, source: best[1].source } : null;
}
