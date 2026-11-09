// Migration v2 (#367, ADR 0244): a section that becomes a skill leaves its file. The migration used to copy, so the
// brain kept two texts of each procedure (58 of 63 skills in the owner's brain were copies of sections still there) and a
// forgotten skill came back at the next pass (#311). Now the section's body is replaced by one pointer line to its skill
// (the heading stays, so links and the file's outline keep working; parseSections skips a pointer, MOVED_PREFIX), and the
// scripts and queries the section names (a file of the brain, named only there) move into the skill's scripts/ folder
// with their paths in the skill rewritten to ${CLAUDE_SKILL_DIR}/scripts/<name>. Pure planning: jobs.ts migrate writes
// every move out of one file as one change with its Undo, and an Undo is remembered in ops/state/migration-kept/ (the
// change log is bounded). Never moved: a file that is not plain UTF-8 (an Undo could not give its bytes back), a file
// with no heading above the section (its frontmatter), the brain's managed scripts/ and queries/ (their own pages), ops/
// (app machinery), dot folders, skill folders, files over 256 KB, binary files, scripts that find files next to
// themselves, and files any other text of the brain or of a role names. Tests: test/unit/brainmodel/migration-move.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { brainPath } from '../agents/pack/flows';
import type { ChangeLog } from './changes';
import { MOVED_PREFIX, parseSections, sourceOf, type ProcedureSection } from './procedure-sources';
import { sourceHash, sourceId } from './migration-source';

const MAX_BYTES = 256 * 1024;
const SCAN_FILES = 4000;
const TEXT_EXT = /\.(md|markdown|txt|json|jsonc|ya?ml|mjs|cjs|js|ts|ps1|psm1|sh|bash|py|sql|kql|cmd|bat|toml|ini|csv)$/i;
const RUNNABLE = /(?:^|[\s`'"(\[])((?:\.{1,2}\/)?[\w@.+-]+(?:\/[\w@.+-]+)*\.(?:mjs|cjs|js|ps1|psm1|sh|py|sql|kql|cmd|bat))(?=$|[\s`'")\],;:])/gm;
const NEVER = /^(?:\.|scripts\/|queries\/|ops\/|node_modules\/)|\/\./;
/** a script that finds files next to itself: moved, it would look in the skill's folder */
const SELF_RELATIVE = /(?:^|[\s'"`(=])\.{1,2}[\\/]|\$PSScriptRoot|\$MyInvocation|__dirname|__filename|import\.meta|%~dp0|BASH_SOURCE|\$\(dirname|\$0\b|sys\.argv\[0\]/;

/** The pointer line a moved section keeps in its file. */
export const movedLine = (skill: string, day: string): string => `${MOVED_PREFIX} \`${skill}\` il ${day}.`;

/** The file's text when it is plain UTF-8 (its bytes come back exactly from the text), else null. */
export function exactText(file: string): string | null {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    const buf = fs.readFileSync(file), text = buf.toString('utf8');
    return Buffer.from(text, 'utf8').equals(buf) ? text : null;
  } catch { return null; }
}

/** The section in the file's text as it is now (an earlier move in the same pass shifted the lines), by its stable id,
 *  parsed as the file's own kind of source; null when it is not there, or the id is not unique any more. */
export function locate(rel: string, text: string, source: string): ProcedureSection | null {
  const found = parseSections(rel, text, sourceOf(rel) ?? { kind: 'strong', label: 'Runbook' }).filter(x => sourceId(x) === source);
  return found.length === 1 ? found[0]! : null;
}

/** The file's text with the section's body replaced by the pointer line; null when the section is not there any more,
 *  or it has no heading of its own (a numbered file without a title: its frontmatter would go). Only the lines of the
 *  section change: the rest keeps its bytes, line endings included. */
export function withoutSection(rel: string, text: string, source: string, pointer: string): string | null {
  const s = locate(rel, text, source);
  if (!s || s.start < 1) return null;
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const heading = lines[s.start - 1] ?? '';
  const eol = heading.endsWith('\r\n') ? '\r\n' : '\n';
  const tail = lines.slice(s.end);
  const last = s.end >= lines.length ? lines[lines.length - 1] ?? '' : '';
  const end = tail.length ? (tail[0]!.trim() ? `${eol}${eol}` : eol) : /\n$/.test(last) ? eol : '';
  return [...lines.slice(0, s.start), heading.endsWith('\n') ? '' : eol, eol, pointer, end, ...tail].join('');
}

function inside(root: string, abs: string): boolean {
  const rel = path.relative(root, abs);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** What the brain says, for "is this script named anywhere else": every text file (bounded) and the roles' texts. */
export interface Corpus { texts: Map<string, string>; extra: string[]; truncated: boolean }
export function brainCorpus(root: string, extra: string[]): Corpus {
  const base = fs.realpathSync(root), texts = new Map<string, string>();
  let truncated = false;
  const visit = (dir: string, depth: number) => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(path.join(base, dir), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (texts.size >= SCAN_FILES) { truncated = true; return; }
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { if (/^(node_modules|\.git)$/.test(e.name)) continue; if (depth < 8) visit(rel, depth + 1); else truncated = true; }
      else if (e.isFile() && TEXT_EXT.test(e.name)) {
        try { const st = fs.statSync(path.join(base, rel)); if (st.size > 512 * 1024) { truncated = true; continue; } texts.set(rel, fs.readFileSync(path.join(base, rel), 'utf8')); }
        catch { truncated = true; }
      }
    }
  };
  visit('', 0);
  return { texts, extra, truncated };
}

export interface PlannedFile { from: string; rel: string; to: string; text: string }

/** The scripts and queries a section names that can move into the skill package (`skillDir`), with the section body's
 *  references rewritten to `${CLAUDE_SKILL_DIR}/scripts/<name>`. A file named anywhere else in the brain (`corpus`, read
 *  before this pass: `section` is where it was then) or by a role stays where it is; with no complete corpus nothing moves. */
export function planScripts(root: string, section: ProcedureSection, body: string, skillDir: string, corpus: Corpus | null): { body: string; files: PlannedFile[] } {
  if (!corpus || corpus.truncated) return { body, files: [] };
  const base = fs.realpathSync(root);
  const found = new Map<string, string>(); // token → brain-relative path
  for (const m of body.matchAll(RUNNABLE)) {
    const token = m[1]!;
    if (found.has(token)) continue;
    for (const cand of [path.resolve(base, token), path.resolve(base, path.posix.dirname(section.file), token)]) {
      if (!inside(base, cand)) continue;
      let real: string, st: fs.Stats;
      try { real = fs.realpathSync(cand); st = fs.lstatSync(cand); } catch { continue; }
      if (!st.isFile() || st.size > MAX_BYTES || !inside(base, real)) continue;
      const rel = path.relative(base, cand).split(path.sep).join('/'), realRel = path.relative(base, real).split(path.sep).join('/');
      if ([rel, realRel].some(r => NEVER.test(r) || /(^|\/)(\.agents|\.claude)\//.test(r))) continue;
      found.set(token, rel);
      break;
    }
  }
  if (!found.size) return { body, files: [] };
  const rels = [...new Set(found.values())];
  // named anywhere else (another file, this file outside the section, a role): it stays, the skill keeps its path
  const others: string[] = [...corpus.extra];
  for (const [rel, text] of corpus.texts) {
    if (rels.includes(rel)) continue;
    others.push(rel === section.file ? text.split(/\r?\n/).filter((_l, i) => i < section.line - 1 || i >= section.end).join('\n') : text);
  }
  const names = new Map<string, number>();
  const files: PlannedFile[] = [];
  const moved = new Map<string, string>(); // brain-relative → scripts/<name>
  for (const rel of rels) {
    const name = path.posix.basename(rel);
    if (others.some(t => t.includes(name))) continue;
    const text = exactText(path.join(base, rel));
    if (text === null || text.includes('\0') || SELF_RELATIVE.test(text)) continue;
    const n = names.get(name.toLowerCase()) ?? 0; names.set(name.toLowerCase(), n + 1);
    const target = n ? `${path.posix.basename(name, path.posix.extname(name))}-${n + 1}${path.posix.extname(name)}` : name;
    const to = path.join(skillDir, 'scripts', target);
    if (fs.existsSync(to)) continue;
    files.push({ from: path.join(base, rel), rel, to, text });
    moved.set(rel, `\${CLAUDE_SKILL_DIR}/scripts/${target}`);
  }
  if (!moved.size) return { body, files: [] };
  const out = body.replace(RUNNABLE, (all: string, token: string) => {
    const rel = found.get(token);
    const to = rel ? moved.get(rel) : undefined;
    return to ? all.replace(token, () => to) : all;
  });
  return { body: out, files };
}

// ── an Undo of a move is the user's decision, kept beyond the bounded change log ────────────────────────────────────
const keptFile = (root: string, source: string): string => brainPath(root, `ops/state/migration-kept/${sourceHash(source)}.json`);
export function migrationKept(root: string, source: string): boolean {
  try { return JSON.parse(fs.readFileSync(keptFile(root, source), 'utf8')).source === source; } catch { return false; }
}
/** Every move the user undid (a migration change with `move:` evidence, rolled back, that wrote inside this brain) gets
 *  its marker: the next pass neither moves nor recreates it. Called by the migration and right after an Undo. */
export function rememberUndoneMoves(root: string, log: ChangeLog): void {
  const base = fs.realpathSync(root);
  for (const c of log.all()) {
    if (c.job !== 'migration' || !c.rolledBackAt || !c.files.some(f => inside(base, f.file))) continue;
    for (const e of c.evidence) {
      if (!e.startsWith('move:')) continue;
      const source = e.slice(5);
      if (migrationKept(base, source)) continue;
      try { const file = keptFile(base, source); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify({ source, change: c.id, at: c.rolledBackAt }, null, 2)}\n`); }
      catch { /* unwritable: the change log still says it, for as long as it keeps the change */ }
    }
  }
}
