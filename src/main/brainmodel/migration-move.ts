// Migration v2 (#367, ADR 0244): a section that becomes a skill leaves its file. The migration used to copy, so the
// brain kept two texts of each procedure (58 of 63 skills in the owner's brain were copies of sections still there) and a
// forgotten skill came back at the next pass (#311). Now the section's body is replaced by one pointer line to its skill
// (the heading stays, so links and the file's outline keep working; parseSections skips a pointer, MOVED_PREFIX), and the
// scripts and queries the section names (a file of the brain, named only there) move into the skill's scripts/ folder
// with their paths in the skill rewritten. Pure planning: jobs.ts migrate writes everything as one change with its
// Undo. Never moved: the brain's managed scripts/ and queries/ (their own pages), ops/ (app machinery), dot folders,
// skill folders, files over 256 KB, binary files, and files any other text of the brain names. Tests:
// test/unit/brainmodel/migration-move.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { MOVED_PREFIX, parseSections, sourceOf, type ProcedureSection } from './procedure-sources';
import { sourceId } from './migration-source';

const MAX_BYTES = 256 * 1024;
const SCAN_FILES = 4000;
const TEXT_EXT = /\.(md|markdown|txt|json|jsonc|ya?ml|mjs|cjs|js|ts|ps1|psm1|sh|bash|py|sql|kql|cmd|bat|toml|ini|csv)$/i;
const RUNNABLE = /(?:^|[\s`'"(\[])((?:\.{1,2}\/)?[\w@.+-]+(?:\/[\w@.+-]+)*\.(?:mjs|cjs|js|ps1|psm1|sh|py|sql|kql|cmd|bat))(?=$|[\s`'")\],;:])/gm;
const NEVER = /^(?:\.|scripts\/|queries\/|ops\/|node_modules\/)|\/\./;

/** The pointer line a moved section keeps in its file. */
export const movedLine = (skill: string, day: string): string => `${MOVED_PREFIX} \`${skill}\` il ${day}.`;

/** The section in the file's text as it is now (an earlier move in the same pass shifted the lines), by its stable id.
 *  Parsed as a strong source: a soft source's sections are a subset with the same ids. */
export function locate(rel: string, text: string, source: string): ProcedureSection | null {
  const label = sourceOf(rel)?.label ?? 'Runbook';
  return parseSections(rel, text, { kind: 'strong', label }).find(x => sourceId(x) === source) ?? null;
}

/** The file's text with the section's body replaced by the pointer line; null when the section is not there any more. */
export function withoutSection(rel: string, text: string, source: string, pointer: string): string | null {
  const s = locate(rel, text, source);
  if (!s) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n', lines = text.split(/\r?\n/);
  const tail = lines.slice(s.end);
  const out = [...lines.slice(0, s.start), '', pointer, ...(tail.length && tail[0]!.trim() ? [''] : []), ...tail];
  const joined = out.join(eol).replace(/(\r?\n){3,}/g, `${eol}${eol}`).replace(/\s+$/, '');
  return /\n$/.test(text) ? `${joined}${eol}` : joined;
}

function inside(root: string, abs: string): boolean {
  const rel = path.relative(root, abs);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Every text file of the brain (bounded), brain-relative with forward slashes, the skill folders included. */
function brainTexts(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    let ents: fs.Dirent[];
    try { ents = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= SCAN_FILES) return;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { if (depth < 8 && !/^(node_modules|\.git)$/.test(e.name)) visit(rel, depth + 1); }
      else if (e.isFile() && TEXT_EXT.test(e.name)) out.push(rel);
    }
  };
  visit('', 0);
  return out;
}

export interface PlannedFile { from: string; rel: string; to: string; text: string }

/** The scripts and queries a section names that can move into the skill package (`skillDir`), with the section body's
 *  references rewritten to `scripts/<name>`. A file named anywhere else in the brain stays where it is. */
export function planScripts(root: string, section: ProcedureSection, body: string, skillDir: string): { body: string; files: PlannedFile[] } {
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
      const rel = path.relative(base, cand).split(path.sep).join('/');
      if (NEVER.test(rel) || /(^|\/)(\.agents|\.claude)\//.test(rel)) continue;
      found.set(token, rel);
      break;
    }
  }
  if (!found.size) return { body, files: [] };
  const rels = [...new Set(found.values())];
  // named anywhere else (another file, or this file outside the section): it stays, the skill keeps its path
  const others = new Map<string, string>();
  for (const rel of brainTexts(base)) {
    if (rels.includes(rel)) continue;
    try {
      const st = fs.statSync(path.join(base, rel));
      if (st.size > 512 * 1024) continue;
      let text = fs.readFileSync(path.join(base, rel), 'utf8');
      if (rel === section.file) text = text.split(/\r?\n/).filter((_l, i) => i < section.line - 1 || i >= section.end).join('\n');
      others.set(rel, text);
    } catch { /* unreadable: ignored */ }
  }
  const names = new Map<string, number>();
  const files: PlannedFile[] = [];
  const moved = new Map<string, string>(); // brain-relative → scripts/<name>
  for (const rel of rels) {
    const name = path.posix.basename(rel);
    if ([...others.values()].some(t => t.includes(name))) continue;
    const buf = fs.readFileSync(path.join(base, rel));
    if (buf.subarray(0, 8000).includes(0)) continue;
    const n = names.get(name.toLowerCase()) ?? 0; names.set(name.toLowerCase(), n + 1);
    const target = n ? `${path.posix.basename(name, path.posix.extname(name))}-${n + 1}${path.posix.extname(name)}` : name;
    files.push({ from: path.join(base, rel), rel, to: path.join(skillDir, 'scripts', target), text: buf.toString('utf8') });
    moved.set(rel, `scripts/${target}`);
  }
  if (!moved.size) return { body, files: [] };
  const out = body.replace(RUNNABLE, (all: string, token: string) => {
    const rel = found.get(token);
    const to = rel ? moved.get(rel) : undefined;
    return to ? all.replace(token, to) : all;
  });
  return { body: out, files };
}
