// A routine as a self-contained package (ADR 0156; the owner, 2026-10-24: «quando esporto la routine come si porta dietro
// i prompt e rule e memoria degli agenti?»). One zip a cloud agent (Claude Code, Cursor, Codex) or another app opens and
// gets the same results from: the routine (routine.json, the portable definition; ROUTINE.md, its steps in words), the
// brain files its steps cite by path (rules/air-dev-qa.md, a reviews/ folder), the brain's rules, the skills its roles
// and steps use, its roles as each tool's subagents, its pinned scripts and queries as files, and, when the user leaves
// it on, what those roles learned (agents/<role>/memory.md). Private files (me.md, now.md, the journal, memory/) never go
// in; the guard scan checks the zip before it is saved (pack/wiring.ts).
// Import reads the same zip: the routine becomes a new draft (never active), and only the files the user ticks are
// written into the brain, each kind as one Log entry with Annulla; a memory line becomes a proposed fact of that role.
// Used by pack/wiring.ts (flows:package* IPC). Unit tests: test/unit/agents/routine-share.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { FlowDefinition } from '../../../shared/flows';
import type { RoutineImportItem, RoutineImportPreview, RoutinePackageSummary } from '../../../shared/contract';
import { roleOf } from '../../../shared/routine';
import { isWorkRole } from '../../../shared/roles';
import { field, parseMd, setFields } from '../../../shared/skillmd';
import { SCRIPTS_DIR } from '../../brain/scripts';
import { QUERIES_DIR } from '../../brain/queries';
import { markdown, parsePortable, type PortableFile } from '../../flows/portable';
import { SKILL_DIRS, SKILL_NAME, description, oneLine, readSkill, roleFiles, roleSkill, text, whenText, type ShareRole } from './brain-share';
import { brainPath } from './flows';
import { isPrivatePath, packRules } from './rules';
import { checkPackPath, type PackFiles } from './zip';

export const MANIFEST = 'routine-package.json';
const RESERVED = new Set(['agents.md', 'claude.md', 'readme.md', 'routine.md', 'routine.json', MANIFEST]);
const MAX_FILE = 2 * 1024 ** 2, MAX_CITED = 120, MAX_DEPTH = 4;
const EXT = /\.(md|txt|json|ya?ml|csv|sql|ps1|psm1|sh|py|m?js|ts|xml|html?|ini|toml)$/i;

export interface RoutineRole { role: ShareRole; memory: string | null }
export interface RoutinePackageInput {
  root: string; brainName: string; date: string; definition: FlowDefinition; version: number;
  /** the portable JSON export (flows/portable.ts exportFlow), with the pinned scripts/queries it carried */
  flowJson: string;
  roles: RoutineRole[];
  /** every skill the routine's roles or steps can load, by name, wherever it lives (brain, home, the app's copy) */
  skills: Map<string, PackFiles>;
  memory: boolean;
}
interface Manifest {
  format: 'second-brain-routine'; schemaVersion: 1; title: string; exportedAt: string;
  cited: string[]; rules: string[]; skills: string[]; roles: string[]; memory: string[]; scripts: string[];
}

/** The brain paths a routine's text names: `rules/x.md`, `reviews/`, `my-brain/reviews/v7.json` (a leading brain
 *  folder name is dropped). URLs, absolute paths and `..` are not paths of the brain. */
export function citedPaths(definition: FlowDefinition, brainName: string): string[] {
  const texts = [definition.description, ...definition.steps.flatMap(s => [s.instructions, s.title, ...s.evidence, ...Object.values(s.args ?? {})])];
  const out = new Set<string>(), prefix = `${brainName.toLowerCase()}/`;
  for (const raw of texts) {
    const body = raw.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ');
    for (const match of body.matchAll(/(?:^|[\s`'"(\[«])((?:\.\/)?[A-Za-z0-9_][A-Za-z0-9_.@-]*(?:\/[A-Za-z0-9_.@-]+)*\/?)/g)) {
      let token = match[1]!.replace(/^\.\//, '').replace(/[.,;:!?]+$/, '');
      if (!token.includes('/') && !EXT.test(token)) continue;
      if (token.toLowerCase().startsWith(prefix)) token = token.slice(prefix.length);
      const folder = token.endsWith('/');
      token = token.replace(/\/+$/, '');
      if (!token || token.split('/').some(p => p === '..' || p === '.')) continue;
      out.add(folder ? `${token}/` : token);
    }
  }
  return [...out];
}

/** The cited files that exist in the brain (a folder: its text files, a few levels down); private ones never. */
export function collectCited(root: string, cited: string[]): { files: PackFiles; missing: string[]; skipped: string[] } {
  const files: PackFiles = new Map(), missing: string[] = [], skipped: string[] = [];
  let base: string;
  try { base = fs.realpathSync(root); } catch { return { files, missing: cited, skipped }; }
  const add = (rel: string): void => {
    const norm = rel.toLowerCase();
    if (isPrivatePath(norm) || RESERVED.has(norm)) { skipped.push(rel); return; }
    try {
      checkPackPath(rel);
      const full = brainPath(base, rel), info = fs.lstatSync(full);
      if (!info.isFile()) return;
      const data = fs.readFileSync(full);
      if (info.size > MAX_FILE || !text(data)) { skipped.push(rel); return; }
      if (files.size >= MAX_CITED) { skipped.push(rel); return; }
      files.set(rel, data);
    } catch { skipped.push(rel); }
  };
  const walk = (rel: string, depth: number): void => {
    let items: fs.Dirent[] = [];
    try { items = fs.readdirSync(brainPath(base, rel), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1); } catch { skipped.push(`${rel}/`); return; }
    for (const item of items) {
      const child = `${rel}/${item.name}`;
      if (item.name.startsWith('.')) continue;
      if (item.isDirectory()) { if (depth < MAX_DEPTH) walk(child, depth + 1); }
      else if (item.isFile()) add(child);
    }
  };
  for (const entry of cited) {
    const rel = entry.replace(/\/$/, '');
    if (isPrivatePath(`${rel.toLowerCase()}/`) || isPrivatePath(rel.toLowerCase())) { skipped.push(entry); continue; }
    let info: fs.Stats;
    try { checkPackPath(rel); info = fs.lstatSync(brainPath(base, rel)); } catch { missing.push(entry); continue; }
    if (info.isDirectory()) walk(rel, 1);
    else if (info.isFile()) add(rel);
    else skipped.push(entry);
  }
  return { files, missing, skipped };
}

/** The roles a routine's agent steps run with (a step without one: the role its effect picks). */
export const routineRoles = (definition: FlowDefinition): string[] => [...new Set(definition.steps.filter(s => s.kind === 'agent').map(s => roleOf(s)))];
/** The skills a routine needs: its roles' declared and linked ones, its roles' own know-how, and skills its steps name. */
export function routineSkills(definition: FlowDefinition, roles: ShareRole[], known: string[]): string[] {
  const named = new Set<string>(), body = definition.steps.map(s => s.instructions).join('\n');
  for (const name of known) {
    const at = name.replace(/[-]/g, '\\-');
    if (new RegExp(`(^|[^a-z0-9-])(/|\`)${at}(?![a-z0-9-])`, 'i').test(body) || (name.includes('-') && new RegExp(`(^|[^a-z0-9-])${at}(?![a-z0-9-])`, 'i').test(body))) named.add(name);
  }
  for (const r of roles) for (const name of [...(r.profile.skills ?? []), ...(r.profile.knowhow?.linked ?? [])]) named.add(name);
  return [...named];
}

const scriptPath = (file: PortableFile): string => `${file.kind === 'script' ? SCRIPTS_DIR : QUERIES_DIR}/${file.ref}`;

function agentsMd(input: RoutinePackageInput, m: Manifest, rules: PackFiles, skills: Map<string, PackFiles>): string {
  const d = input.definition, lines = [`# ${d.title}: routine package`, '',
    `Exported from the second-brain app on ${input.date} (version ${input.version}). It holds everything this routine needs to give the same results outside the app.`, '',
    '## How to run it', '',
    '1. Read `ROUTINE.md`: the steps in order, each with its role, model, inputs, evidence and limits. `routine.json` is the same routine as data.',
    '2. Run the steps one at a time, in order. An agent step runs as the subagent named after its role (`.claude/agents/`, `.cursor/agents/`, `.codex/agents/`).',
    `3. The paths the steps cite are relative to this folder${input.brainName ? ` (a path that starts with \`${input.brainName}/\` means this folder)` : ''}.`,
    '4. Before a step, its role reads its own memory (`agents/<role>/memory.md`) when it is here: it is what that role learned on earlier runs.',
    '5. A step whose environment is `prod`, or whose effect is `production`: never run it. Show the exact command and let the person run it.',
    '6. A step with required evidence is done only when that evidence exists; a step marked "back to step X" sends its failure there as feedback.',
    ...(d.params?.length ? [`7. Ask the person for the parameters first: ${d.params.map(p => `\`${p.name}\` (${p.type}${p.required ? ', required' : ''})`).join(', ')}.`] : []), '',
    '## Hard rules', '',
    '- The rules below are the team\'s way of working: read the one whose "When" matches the step before acting.',
    '- No secrets in these files: credentials stay outside this folder.',
    '- Never claim something is done, missing or passing without having checked it.', ''];
  if (m.cited.length) { lines.push('## Files the steps cite', ''); for (const f of m.cited) lines.push(`- \`${f}\``); lines.push(''); }
  if (rules.size) {
    lines.push('## Rules', '', '| When | Read |', '|------|------|');
    for (const [file, data] of rules) {
      const when = field(parseMd(data.toString('utf8')), 'when');
      lines.push(`| ${whenText(typeof when === 'string' ? when : '').replace(/\|/g, '/')} | \`${file}\` |`);
    }
    lines.push('');
  }
  if (skills.size) {
    lines.push('## Skills', '', 'In `.agents/skills/` (Codex, Cursor) and the same copy in `.claude/skills/` (Claude Code). Load the one whose description fits.', '');
    for (const [name, files] of skills) lines.push(`- \`${name}\`: ${description(files.get('SKILL.md')) || 'no description'}`);
    lines.push('');
  }
  if (input.roles.length) {
    lines.push('## Roles', '');
    for (const r of input.roles) lines.push(`- \`${r.role.skillName}\` (${r.role.profile.name}): ${oneLine(r.role.profile.purpose)}${m.memory.includes(r.role.skillName) ? ` Memory: \`agents/${r.role.skillName}/memory.md\`.` : ''}`);
    lines.push('');
  }
  if (m.scripts.length) { lines.push('## Scripts and queries', '', 'Pinned by sha256 in `routine.json`: run only a file whose hash still matches.', ''); for (const f of m.scripts) lines.push(`- \`${f}\``); lines.push(''); }
  return lines.join('\n');
}

function readme(input: RoutinePackageInput, s: RoutinePackageSummary): string {
  return [`# ${input.definition.title}: pacchetto della routine`, '',
    `Esportato dall'app second-brain il ${input.date}: la routine (v${input.version}), ${s.cited.length} file citati, ${s.rules.length} regole, ${s.skills.length} skill, ${s.roles.length} ruoli, ${s.scripts.length} script o query${s.memory.length ? `, la memoria di ${s.memory.length} ruoli` : ', senza memoria degli agenti'}.`, '',
    '## Con un agente cloud (Claude Code, Cursor, Codex)', '',
    '1. Estrai lo zip in una cartella, oppure nella radice del repository su cui lavora l\'agente.',
    '2. Chiedi all\'agente: «Esegui la routine di AGENTS.md». Legge `AGENTS.md` (Claude Code tramite `CLAUDE.md`), poi `ROUTINE.md`.',
    '3. I passi in produzione non partono mai da soli: l\'agente ti mostra il comando e lo lanci tu.', '',
    '## In un\'altra app second-brain', '',
    'Pagina Routine → Importa → scegli questo zip. Vedi cosa contiene e scegli cosa scrivere nel tuo brain; la routine arriva come bozza da approvare.', ''].join('\n');
}

/** Every file of the routine package, by its path in the zip, and what went in. */
export function buildRoutinePackage(input: RoutinePackageInput): { files: PackFiles; summary: RoutinePackageSummary } {
  const { definition } = input, skipped: string[] = [];
  const cited = collectCited(input.root, citedPaths(definition, input.brainName));
  skipped.push(...cited.skipped);
  const rules = packRules(input.root), files: PackFiles = new Map();
  const portable = parsePortable(input.flowJson);
  const skills = new Map<string, PackFiles>();
  for (const [name, own] of input.skills) {
    const md = own.get('SKILL.md');
    // hooks run code in the reader's tool: a shared skill never carries them
    if (SKILL_NAME.test(name) && md) skills.set(name, new Map([...own, ['SKILL.md', Buffer.from(setFields(md.toString('utf8'), {}, ['hooks']))]]));
  }
  for (const r of input.roles) if (!skills.has(r.role.skillName)) { const own = roleSkill(r.role, skipped); if (own) skills.set(r.role.skillName, own); }
  for (const [name, data] of rules) files.set(name, Buffer.from(data));
  for (const [name, data] of cited.files) files.set(name, Buffer.from(data));
  for (const [name, own] of skills) for (const dir of SKILL_DIRS) for (const [rel, data] of own) files.set(`${dir}/${name}/${rel}`, Buffer.from(data));
  const scripts: string[] = [];
  for (const file of portable.files) {
    if (file.redacted) { skipped.push(scriptPath(file)); continue; }
    files.set(scriptPath(file), Buffer.from(file.content)); scripts.push(scriptPath(file));
  }
  const memory: string[] = [];
  for (const r of input.roles) {
    for (const [name, data] of roleFiles(r.role, skills)) files.set(name, data);
    if (input.memory && r.memory?.trim()) { files.set(`agents/${r.role.skillName}/memory.md`, Buffer.from(r.memory)); memory.push(r.role.skillName); }
  }
  const manifest: Manifest = { format: 'second-brain-routine', schemaVersion: 1, title: definition.title, exportedAt: input.date,
    cited: [...cited.files.keys()], rules: [...rules.keys()], skills: [...skills.keys()], roles: input.roles.map(r => r.role.skillName), memory, scripts };
  const summary: RoutinePackageSummary = { title: definition.title, cited: manifest.cited, missing: cited.missing, rules: manifest.rules, skills: manifest.skills, roles: manifest.roles, memory, scripts, skipped };
  files.set('routine.json', Buffer.from(input.flowJson));
  files.set('ROUTINE.md', Buffer.from(markdown(definition, input.version)));
  files.set(MANIFEST, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  files.set('AGENTS.md', Buffer.from(agentsMd(input, manifest, rules, skills)));
  files.set('CLAUDE.md', Buffer.from(['# Claude Code entry point', '', 'The canonical context is AGENTS.md; do not duplicate it here.', '', '@AGENTS.md', ''].join('\n')));
  files.set('README.md', Buffer.from(readme(input, summary)));
  for (const name of files.keys()) checkPackPath(name);
  return { files, summary };
}

// ── Import ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const digest = (files: PackFiles): string => {
  const h = createHash('sha256');
  for (const [name, data] of [...files].sort(([a], [b]) => a < b ? -1 : 1)) h.update(name).update('\0').update(data).update('\0');
  return h.digest('hex');
};
export interface ImportProbe {
  root: string;
  /** where a skill of this name already loads from (null = nowhere): the brain's own folder, or somewhere else */
  skill(name: string): { folder: string; inBrain: boolean } | null;
}
export interface ParsedPackage {
  flowJson: string; manifest: Manifest; digest: string;
  /** importable files by item key: `file:<path>`, `skill:<name>`, `script:<path>` */
  writes: Map<string, { kind: RoutineImportItem['kind']; label: string; files: PackFiles; dest: (probe: ImportProbe) => string }>;
  memory: Map<string, string[]>;
}

/** Reads a routine package zip's files (readZip): the manifest, the routine, and what could go into a brain. */
export function parsePackage(files: PackFiles): ParsedPackage {
  const raw = files.get(MANIFEST), flow = files.get('routine.json');
  if (!raw || !flow) throw new Error('Questo zip non è un pacchetto di routine (manca routine-package.json).');
  let m: Record<string, unknown>;
  try { m = JSON.parse(raw.toString('utf8')) as Record<string, unknown>; } catch { throw new Error('Il pacchetto è rovinato: routine-package.json non si legge.'); }
  if (m.format !== 'second-brain-routine' || m.schemaVersion !== 1) throw new Error('Pacchetto di una versione che questa app non conosce.');
  const manifest: Manifest = { format: 'second-brain-routine', schemaVersion: 1, title: typeof m.title === 'string' ? m.title.slice(0, 200) : '', exportedAt: typeof m.exportedAt === 'string' ? m.exportedAt.slice(0, 40) : '',
    cited: strings(m.cited), rules: strings(m.rules), skills: strings(m.skills), roles: strings(m.roles), memory: strings(m.memory), scripts: strings(m.scripts) };
  const flowJson = flow.toString('utf8'), portable = parsePortable(flowJson);
  const writes: ParsedPackage['writes'] = new Map();
  const plain = (rel: string): boolean => { try { checkPackPath(rel); } catch { return false; } return !isPrivatePath(rel.toLowerCase()) && !RESERVED.has(rel.toLowerCase()) && !rel.startsWith('.'); };
  for (const rel of new Set([...manifest.cited, ...manifest.rules])) {
    const data = files.get(rel);
    if (!data || !plain(rel) || !text(data)) continue;
    writes.set(`file:${rel}`, { kind: manifest.cited.includes(rel) ? 'cited' : 'rule', label: rel, files: new Map([['', data]]), dest: p => brainPath(p.root, rel) });
  }
  for (const name of manifest.skills) {
    if (!SKILL_NAME.test(name) || isWorkRole(name)) continue; // a role's own know-how stays with that role in each app
    const prefix = `.agents/skills/${name}/`, own: PackFiles = new Map();
    for (const [file, data] of files) if (file.startsWith(prefix) && text(data)) own.set(file.slice(prefix.length), data);
    const md = own.get('SKILL.md');
    if (!md) continue;
    own.set('SKILL.md', Buffer.from(setFields(md.toString('utf8'), {}, ['hooks'])));
    writes.set(`skill:${name}`, { kind: 'skill', label: name, files: own, dest: p => p.skill(name)?.inBrain ? p.skill(name)!.folder : brainPath(p.root, `.agents/skills/${name}`) });
  }
  for (const file of portable.files) {
    const rel = scriptPath(file), data = files.get(rel);
    if (!data || createHash('sha256').update(data).digest('hex') !== file.sha256) continue; // only the exact pinned text
    writes.set(`script:${rel}`, { kind: file.kind, label: rel, files: new Map([['', data]]), dest: p => brainPath(p.root, rel) });
  }
  const memory = new Map<string, string[]>();
  for (const role of manifest.memory) {
    const data = files.get(`agents/${role}/memory.md`);
    if (!isWorkRole(role) || !data || !text(data)) continue;
    const lines = data.toString('utf8').split(/\r?\n/).filter(l => l.startsWith('- ')).map(l => l.slice(2).replace(/^\d{4}-\d{2}-\d{2} · /, '').trim()).filter(l => l && l.length <= 1000);
    if (lines.length) memory.set(role, lines.slice(0, 200));
  }
  return { flowJson, manifest, digest: digest(files), writes, memory };
}

const readOr = (file: string): Buffer | null => { try { return fs.readFileSync(file); } catch { return null; } };
/** What importing would do: each file, skill and script with whether the brain already has it (same or different). */
export function previewImport(pkg: ParsedPackage, probe: ImportProbe): RoutineImportPreview {
  const portable = parsePortable(pkg.flowJson), items: RoutineImportItem[] = [];
  for (const [key, w] of pkg.writes) {
    let status: RoutineImportItem['status'] = 'new';
    if (w.kind === 'skill') {
      const where = probe.skill(w.label);
      if (where && !where.inBrain) status = 'elsewhere';
      else if (where) status = [...w.files].every(([rel, data]) => readOr(path.join(where.folder, rel))?.equals(data)) ? 'same' : 'different';
    } else {
      let dest: string | null = null;
      try { dest = w.dest(probe); } catch { continue; }
      const before = readOr(dest);
      status = before === null ? 'new' : before.equals(w.files.get('')!) ? 'same' : 'different';
    }
    const body = w.kind === 'skill' ? w.files.get('SKILL.md')! : w.files.get('')!;
    items.push({ key, kind: w.kind, label: w.label, status, files: w.kind === 'skill' ? [...w.files.keys()] : undefined, text: body.toString('utf8').slice(0, 6000) });
  }
  return { digest: pkg.digest, title: portable.definition.title, steps: portable.definition.steps.length, version: portable.version, exportedAt: pkg.manifest.exportedAt,
    items, memory: [...pkg.memory].map(([role, lines]) => ({ role, lines: lines.length, sample: lines.slice(0, 3) })) };
}

export interface ImportWriter {
  /** one Log entry with Annulla for the writes (null = nothing changed, or a file too big to keep its undo copy) */
  apply(kind: 'skill' | 'rule' | 'script', target: string, summary: string, writes: { file: string; text: string }[]): boolean;
  remember(role: string, line: string): void;
}
/** Writes the items the user ticked (keys from previewImport) and, when asked, each role's memory lines as proposed facts. */
export function applyImport(pkg: ParsedPackage, probe: ImportProbe, keys: string[], memory: boolean, writer: ImportWriter, title: string): { written: number; failed: string[]; remembered: number; refused: number } {
  const failed: string[] = [];
  const files: { file: string; text: string }[] = [], scripts: { file: string; text: string }[] = [];
  let written = 0;
  for (const key of keys) {
    const w = pkg.writes.get(key);
    if (!w) continue;
    try {
      if (w.kind === 'skill') {
        if (probe.skill(w.label) && !probe.skill(w.label)!.inBrain) continue;
        const dest = w.dest(probe);
        const writes = [...w.files].map(([rel, data]) => { checkPackPath(`.claude/skills/x/${rel}`); return { file: path.join(dest, ...rel.split('/')), text: data.toString('utf8') }; });
        if (writer.apply('skill', w.label, `Skill importata con la routine «${title}»: ${w.label}`, writes)) written++;
        else failed.push(w.label);
      } else (w.kind === 'script' || w.kind === 'query' ? scripts : files).push({ file: w.dest(probe), text: w.files.get('')!.toString('utf8') });
    } catch { failed.push(w.label); }
  }
  if (files.length) { if (writer.apply('rule', title, `File importati con la routine «${title}»: ${files.length}`, files)) written += files.length; else failed.push(...files.map(f => path.basename(f.file))); }
  if (scripts.length) { if (writer.apply('script', title, `Script e query importati con la routine «${title}»: ${scripts.length}`, scripts)) written += scripts.length; else failed.push(...scripts.map(f => path.basename(f.file))); }
  let remembered = 0, refused = 0;
  if (memory) for (const [role, lines] of pkg.memory) for (const line of lines) { try { writer.remember(role, oneLine(line)); remembered++; } catch { refused++; } }
  return { written, failed, remembered, refused };
}

/** The skill folders a routine package carries, read from where each one loads (readSkill: text files only, no hooks). */
export function readSkills(found: { name: string; folder: string }[], names: string[], skipped: string[]): Map<string, PackFiles> {
  const out = new Map<string, PackFiles>();
  for (const name of names) {
    const hit = found.find(s => s.name === name);
    if (!hit) continue;
    const files = readSkill(hit.folder, skipped, `skills/${name}`);
    if (files) out.set(name, files);
  }
  return out;
}
