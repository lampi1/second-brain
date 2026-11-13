// Scripts and queries belong to skills (ADR 0263; the owner, 2026-11-10: «mi aspettavo che script e query sparissero
// dalle tab di memoria dato che sono sempre legati alle skill», and the Agent Skills format: a skill's code in
// scripts/, its data and templates in assets/). Three things here:
// - skillParts: a skill package's files by group (scripts/, assets/queries/, references/, the rest of assets/), each with
//   the title and description its header gives, for the Skill page.
// - migrateAssets: once per brain per launch, automatic and idempotent, every file still in the brain's old scripts/ and
//   queries/ moves into the one brain skill that names it (`scripts/<name>`, `queries/<name>` or the bare file name in
//   any of its text files): to <skill>/scripts/<name> or <skill>/assets/queries/<name>, the skill's references rewritten
//   to ${CLAUDE_SKILL_DIR}/…, as one change of the brain's change log (job 'migration', Annulla on the skill's history),
//   after a copy of the file in <userData>/backups/scripts-queries/<stamp>/. A file already in that skill with the same
//   bytes only leaves the old folder. A file no skill names, or several, or whose name the skill already uses for other
//   content, or too big for the history, stays where it is and is listed (unassigned) for the user to place.
// - assignAsset: the user's pick for one listed file (Skill page «Da assegnare»), the same move with job 'user'.
// A move runs again harmlessly: a moved file is no longer in the old folder. Used by skills/library.ts; pinned by
// test/unit/skills/assets.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AssetAssign, AssetAssignResult, SkillFile, SkillParts, UnassignedAsset } from '../../shared/skill-library';
import type { ChangeLog } from '../brainmodel/changes';
import { declareRemoved, WHOLE_FILE } from '../brainmodel/item-delta';
import { QUERIES_DIR, QUERY_EXTS, languageLabel, readQueryText, SKILL_QUERIES } from '../brain/queries';
import { insideReal, langOf, parseHeader, SCRIPTS_DIR, SKILL_SCRIPTS, type SkillPlace } from '../brain/scripts';
import { migrationKept, rememberUndoneMoves } from '../brainmodel/migration-move';
import { maskSecrets } from '../brain/mask';
import { errText, log } from '../log';

const HEAD_BYTES = 4096, MAX_PARTS = 60, SNAP = 256 * 1024;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const headOf = (file: string): string => {
  try { const fd = fs.openSync(file, 'r'); try { const b = Buffer.alloc(HEAD_BYTES); const n = fs.readSync(fd, b, 0, b.length, 0); return b.subarray(0, n).toString('utf8'); } finally { fs.closeSync(fd); } } catch { return ''; }
};
const pretty = (file: string) => path.basename(file).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');

/** A skill package's scripts, queries, references and assets with their titles (only text heads are read, bounded). */
export function skillParts(folder: string, files: readonly SkillFile[]): SkillParts {
  const out: SkillParts = { scripts: [], queries: [], references: [], assets: [] };
  for (const f of files) {
    const abs = path.join(folder, ...f.path.split('/'));
    if (f.path.startsWith(`${SKILL_SCRIPTS}/`)) {
      if (out.scripts.length >= MAX_PARTS) continue;
      const h = f.text ? parseHeader(headOf(abs)) : null;
      out.scripts.push({ path: f.path, title: h?.title || pretty(f.path), description: maskSecrets(h?.description || h?.firstComment || '').text, language: langOf(f.path)?.[0] ?? '', tested: h?.tested.state ?? 'untested' });
    } else if (f.path.startsWith(`${SKILL_QUERIES}/`) && QUERY_EXTS.includes(path.extname(f.path).toLowerCase())) {
      if (out.queries.length >= MAX_PARTS) continue;
      // a query note's code comes after its header: the head is enough for title and description, the full text for the
      // language of a long one
      let q = f.text ? readQueryText(f.path, headOf(abs)) : null;
      if (f.text && !q && f.size <= SNAP) { try { q = readQueryText(f.path, fs.readFileSync(abs, 'utf8')); } catch { /* unreadable */ } }
      out.queries.push({ path: f.path, title: maskSecrets(q?.title || pretty(f.path)).text, description: maskSecrets(q?.description ?? '').text, language: q ? languageLabel(q.lang) : '' });
    } else if (f.path.startsWith('references/')) {
      if (out.references.length >= MAX_PARTS) continue;
      const head = f.text ? headOf(abs) : '';
      const title = /^#\s+(.+)$/m.exec(head)?.[1]?.trim();
      out.references.push({ path: f.path, title: title || pretty(f.path), description: '', language: '' });
    } else if (f.path.startsWith('assets/')) {
      if (out.assets.length < MAX_PARTS) out.assets.push({ path: f.path, title: path.basename(f.path), description: '', language: '' });
    }
  }
  return out;
}

export interface AssetsDeps {
  root: string;
  /** the brain's own skills (origin brain): the only ones a file moves into */
  skills: readonly SkillPlace[];
  log: ChangeLog;
  /** <userData>/backups/scripts-queries; null = no copy (tests that do not check it) */
  backupDir: string | null;
  now?: () => Date;
}

type Kind = UnassignedAsset['kind'];
interface Legacy { kind: Kind; name: string; file: string; size: number }
const OLD_DIR: Record<Kind, string> = { script: SCRIPTS_DIR, query: QUERIES_DIR };
const NEW_DIR: Record<Kind, string> = { script: SKILL_SCRIPTS, query: SKILL_QUERIES };

/** The files still in the brain's scripts/ and queries/ (hidden ones, as scripts/.deleted/, stay). */
function legacyFiles(root: string): Legacy[] {
  const out: Legacy[] = [];
  for (const kind of ['script', 'query'] as const) {
    const dir = path.join(root, OLD_DIR[kind]);
    try { if (fs.lstatSync(dir).isSymbolicLink()) continue; } catch { continue; }
    let names: string[] = [];
    try { names = fs.readdirSync(dir).filter(n => !n.startsWith('.')).sort(); } catch { continue; }
    for (const name of names) {
      const file = path.join(dir, name);
      try { const st = fs.lstatSync(file); if (!st.isFile()) continue; if (kind === 'script' ? !langOf(name) : !QUERY_EXTS.includes(path.extname(name).toLowerCase())) continue; out.push({ kind, name, file, size: st.size }); } catch { /* gone */ }
    }
  }
  return out;
}

/** The text files of a skill the move may read and rewrite (SKILL.md, references/…, not its scripts or assets). */
function skillTexts(folder: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let items: fs.Dirent[];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of items) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0 || !['scripts', 'assets'].includes(e.name)) walk(abs, depth + 1); continue; }
      if (!/\.(?:md|txt)$/i.test(e.name)) continue;
      try { if (fs.statSync(abs).size <= SNAP) out.push({ file: abs, text: fs.readFileSync(abs, 'utf8') }); } catch { /* unreadable */ }
    }
  };
  walk(folder, 0);
  return out;
}

/** «scripts/x.py» or the bare «x.py» (not a longer name, not already under another folder or ${CLAUDE_SKILL_DIR}; a
 *  full stop after it ends the sentence). */
const END = '(?![\\w-]|\\.\\w)';
// «scripts\x.ps1» and «.\scripts\x.ps1» too (Windows); names compare without case where the file system ignores it
const FLAGS = process.platform === 'linux' ? '' : 'i';
const pathRef = (kind: Kind, name: string) => new RegExp(`(?<![\\w.\\-/\\\\$}])(?:\\.[\\\\/])?${esc(OLD_DIR[kind])}[\\\\/]${esc(name)}${END}`, `g${FLAGS}`);
const bareRef = (name: string) => new RegExp(`(?<![\\w.\\-/\\\\$}])${esc(name)}${END}`, FLAGS);
const names = (texts: readonly { text: string }[], kind: Kind, name: string) => texts.some(t => pathRef(kind, name).test(t.text) || bareRef(name).test(t.text));

const sameBytes = (a: string, b: string) => { try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; } };
const titleOf = (l: Legacy): { title: string; description: string } => {
  const head = headOf(l.file);
  if (l.kind === 'script') { const h = parseHeader(head); return { title: h.title || pretty(l.name), description: maskSecrets(h.description || h.firstComment).text }; }
  const q = readQueryText(l.name, head);
  return { title: maskSecrets(q?.title || pretty(l.name)).text, description: maskSecrets(q?.description ?? '').text };
};

/** Text the history can keep as is: UTF-8 that reads back to the same bytes (a UTF-16 or cp1252 script would come out
 *  garbled, and Annulla would put the garbled text back). */
const plainText = (file: string) => { try { const raw = fs.readFileSync(file); return Buffer.from(raw.toString('utf8'), 'utf8').equals(raw); } catch { return false; } };

/** The old files whose automatic move the user undid (Annulla on a `migration` change): never moved again by itself,
 *  they wait on the Skill page. The undo is also kept as a marker in ops/state/migration-kept/ (migration-move.ts
 *  rememberUndoneMoves, after every Annulla), so it outlives the change log's last 400 entries. */
const keptId = (rel: string) => `asset:${rel}`;
function undoneMoves(root: string, log: ChangeLog | null | undefined): (rel: string) => boolean {
  let fromLog = new Set<string>();
  try {
    if (log) rememberUndoneMoves(root, log);
    fromLog = new Set((log?.all() ?? []).filter(c => c.job === 'migration' && c.rolledBackAt).flatMap(c => c.evidence ?? []));
  } catch { /* the markers still say it */ }
  return rel => fromLog.has(rel) || migrationKept(root, keptId(rel));
}

/** Where one old file goes: its skill, or why it stays. */
function place(l: Legacy, skills: readonly SkillPlace[], texts: Map<string, { file: string; text: string }[]>, undone: (rel: string) => boolean): { skill: SkillPlace; done: boolean } | { reason: UnassignedAsset['reason']; candidates: string[] } {
  const target = (s: SkillPlace) => path.join(s.folder, ...NEW_DIR[l.kind].split('/'), l.name);
  const candidates = skills.filter(s => names(texts.get(s.name) ?? [], l.kind, l.name)).map(s => s.name);
  if (undone(`${OLD_DIR[l.kind]}/${l.name}`)) return { reason: 'undone', candidates };
  if (l.size > 200 * 1024) return { reason: 'too-big', candidates };
  if (!plainText(l.file)) return { reason: 'not-utf8', candidates };
  // already moved by hand (or a copy): the same bytes in the skill that names it (or in one, when none does), only the
  // old copy goes; other skills that name it would be left pointing at a file that is gone
  const same = skills.find(s => fs.existsSync(target(s)) && sameBytes(target(s), l.file));
  if (same && (!candidates.length || (candidates.length === 1 && candidates[0] === same.name))) return { skill: same, done: true };
  if (candidates.length !== 1) return { reason: candidates.length ? 'many' : 'none', candidates };
  const skill = skills.find(s => s.name === candidates[0])!;
  if (fs.existsSync(target(skill))) return { reason: 'conflict', candidates };
  return { skill, done: false };
}

/** The history kept nothing (a text over its limit): nothing was written. */
class NotKept extends Error {}

/** Moves one old file into a skill as one change (Annulla puts it back where it was). */
function move(d: AssetsDeps, l: Legacy, skill: SkillPlace, job: 'migration' | 'user', alreadyThere: boolean, stamp: string): string {
  const to = path.join(skill.folder, ...NEW_DIR[l.kind].split('/'), l.name);
  if (!insideReal(skill.folder, to)) throw new Error(`la cartella ${NEW_DIR[l.kind]}/ della skill «${skill.name}» è un collegamento fuori dalla skill`);
  const text = fs.readFileSync(l.file, 'utf8');
  const mode = fs.statSync(l.file).mode & 0o777;
  // the copy first: nothing moves without it
  if (d.backupDir) {
    const keep = path.join(d.backupDir, stamp, OLD_DIR[l.kind], l.name);
    fs.mkdirSync(path.dirname(keep), { recursive: true });
    fs.copyFileSync(l.file, keep);
  }
  const reason = `Spostato nella skill «${skill.name}» (script e query stanno nelle skill, ADR 0263).`;
  const newRef = `\${CLAUDE_SKILL_DIR}/${NEW_DIR[l.kind]}/${l.name}`;
  const rewrites = skillTexts(skill.folder).map(t => ({ ...t, after: t.text.replace(pathRef(l.kind, l.name), newRef) })).filter(t => t.after !== t.text);
  const writes = [
    ...(alreadyThere ? [] : [{ file: to, text }]),
    { file: l.file, text: null, removed: [{ item: WHOLE_FILE, reason }] },
    ...rewrites.map(t => ({ file: t.file, text: t.after, removed: declareRemoved(t.text, t.after, reason) })),
  ];
  const c = d.log.apply({ job, kind: l.kind === 'script' ? 'script' : 'skill', action: 'update', target: skill.name,
    summary: `${l.kind === 'script' ? 'Script' : 'Query'} ${OLD_DIR[l.kind]}/${l.name} → ${skill.name}/${NEW_DIR[l.kind]}/${l.name}`, reason, evidence: [`${OLD_DIR[l.kind]}/${l.name}`, `move:${keptId(`${OLD_DIR[l.kind]}/${l.name}`)}`] }, writes);
  if (!c) throw new NotKept('troppo grande per la cronologia: nulla è stato spostato');
  // a script keeps its permissions (the executable bit of a .sh)
  if (!alreadyThere) { try { fs.chmodSync(to, mode); } catch { /* a file system without modes */ } }
  return c.id;
}

const stampOf = (now: Date) => now.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');

/** The automatic pass: moves what has one clear skill, lists the rest. Never throws (a file that fails stays listed). */
export function migrateAssets(d: AssetsDeps): { moved: string[]; unassigned: UnassignedAsset[] } {
  const brain = d.skills.filter(s => s.origin === 'brain');
  const texts = new Map(brain.map(s => [s.name, skillTexts(s.folder)]));
  const stamp = stampOf(d.now?.() ?? new Date());
  const undone = undoneMoves(d.root, d.log);
  const moved: string[] = [], unassigned: UnassignedAsset[] = [];
  for (const l of legacyFiles(d.root)) {
    const p = place(l, brain, texts, undone);
    if ('reason' in p) { unassigned.push({ kind: l.kind, name: l.name, ...titleOf(l), candidates: p.candidates, reason: p.reason }); continue; }
    try { move(d, l, p.skill, 'migration', p.done, stamp); moved.push(`${OLD_DIR[l.kind]}/${l.name} → ${p.skill.name}`); }
    catch (e) {
      log.warn('skills', 'script or query not moved into its skill', { cause: errText(e), data: { file: `${OLD_DIR[l.kind]}/${l.name}`, skill: p.skill.name }, hint: 'it stays in the old folder and is listed on the Skill page to assign' });
      unassigned.push({ kind: l.kind, name: l.name, ...titleOf(l), candidates: [p.skill.name], reason: e instanceof NotKept ? 'too-big' : 'conflict' });
    }
  }
  if (moved.length) log.info('skills', 'scripts and queries moved into their skills', { data: { moved: moved.length, left: unassigned.length } });
  return { moved, unassigned };
}

/** What is still in the old folders, without moving anything (the Skill page's list). */
export function unassignedAssets(root: string, skills: readonly SkillPlace[], log?: ChangeLog | null): UnassignedAsset[] {
  const brain = skills.filter(s => s.origin === 'brain');
  const texts = new Map(brain.map(s => [s.name, skillTexts(s.folder)]));
  const undone = undoneMoves(root, log);
  return legacyFiles(root).map(l => {
    const p = place(l, brain, texts, undone);
    return { kind: l.kind, name: l.name, ...titleOf(l), candidates: 'reason' in p ? p.candidates : [p.skill.name], reason: 'reason' in p ? p.reason : 'none' };
  });
}

/** The user's pick: one old file into the brain skill they chose. */
export function assignAsset(d: AssetsDeps, req: AssetAssign): AssetAssignResult {
  const kind: Kind = req?.kind === 'query' ? 'query' : 'script';
  const l = legacyFiles(d.root).find(x => x.kind === kind && x.name === String(req?.name ?? ''));
  if (!l) return { ok: false, error: 'Il file non è più nella cartella vecchia: ricarica la pagina.' };
  const skill = d.skills.find(s => s.origin === 'brain' && s.name === String(req?.skill ?? ''));
  if (!skill) return { ok: false, error: 'Scegli una skill del brain.' };
  if (l.size > SNAP) return { ok: false, error: 'File troppo grande per la cronologia: spostalo a mano nella cartella della skill.' };
  if (!plainText(l.file)) return { ok: false, error: 'Il file non è testo UTF-8 (per esempio UTF-16): salvalo in UTF-8 o spostalo a mano nella cartella della skill.' };
  const to = path.join(skill.folder, ...NEW_DIR[kind].split('/'), l.name);
  const there = fs.existsSync(to);
  if (there && !sameBytes(to, l.file)) return { ok: false, error: `La skill «${skill.name}» ha già un file ${NEW_DIR[kind]}/${l.name} diverso: rinominane uno, poi riprova.` };
  try {
    const id = move(d, l, skill, 'user', there, stampOf(d.now?.() ?? new Date()));
    return { ok: true, changeId: id, file: `${skill.name}/${NEW_DIR[kind]}/${l.name}` };
  } catch (e) { return { ok: false, error: `Non spostato: ${errText(e)}` }; }
}

