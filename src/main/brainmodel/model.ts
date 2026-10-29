// Reads the brain model (ADR 0077) from disk for the Brain pages: the skills (the brain's shared skill folders and the
// user's own), which agents declare each one, the rules (the brain's always-loaded files, its topic files and the
// files of rules/), and the memory: knowledge notes (customers, environments, people, reference), what happened (open
// threads, journal, errors) and one memory per agent (agents/<id>/memory.md, plus memory/shared.md where the
// maintenance job keeps what several agents had in common). Plain bounded file reads, zero tokens, nothing written.
// The app's own product rules and tools (rules/tools.ts copy under userData) are never listed: they are the app's.
// Used by brainmodel/service.ts and the jobs; unit tests: test/unit/brainmodel/model.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile } from '../../shared/agents';
import type { BrainRule, BrainSkill, MemoryFile, SkillHome } from '../../shared/brain-model';
import { field, parseMd } from '../../shared/skillmd';
import { configOf } from '../rules/storage';
import { portableId } from '../agents/pack/flows';

const MAX_BYTES = 256 * 1024;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A change that may move a Brain page: a markdown file, or a folder (Windows names only the folder on a move). */
export const touchesBrainModel = (rel: string): boolean => {
  const base = path.posix.basename(rel.replace(/\\/g, '/'));
  return !base.includes('.') || /\.md$/i.test(base);
};

export function readSmall(file: string): string | null {
  try { const st = fs.lstatSync(file); if (!st.isFile() || st.size > MAX_BYTES) return null; return fs.readFileSync(file, 'utf8'); } catch { return null; }
}
/** A file about to be written inside the brain really lands there: the nearest folder of it that exists, resolved
 *  through every link (a symlinked .claude/skills, a junction), is the brain root or inside it. Written by the
 *  maintenance's new skills (service.ts applyResearch, research-candidate.ts). */
export function landsInsideBrain(root: string, file: string): boolean {
  try {
    const top = fs.realpathSync(root);
    let dir = path.dirname(path.resolve(file));
    while (!fs.existsSync(dir)) { const up = path.dirname(dir); if (up === dir) return false; dir = up; }
    const rel = path.relative(top, fs.realpathSync(dir));
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch { return false; }
}
const mtime = (file: string): number | null => { try { return fs.statSync(file).mtimeMs; } catch { return null; } };
const inside = (root: string | null, file: string): string | null => {
  if (!root) return null;
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : null;
};
const plain = (s: string) => s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
/** The first line of prose of a markdown body (no frontmatter, headings, fences, tables). */
export function firstProse(body: string): string {
  let fence = false;
  for (const raw of body.split(/\r?\n/)) {
    const l = raw.trim();
    if (/^(`{3,}|~{3,})/.test(l)) { fence = !fence; continue; }
    if (fence || !l || l.startsWith('|') || l.startsWith('#') || l === '---' || l.startsWith('<!--')) continue;
    const t = plain(l.replace(/^([-*+]|\d+[.)])\s+/, ''));
    if (t) return t.length > 200 ? `${t.slice(0, 199)}…` : t;
  }
  return '';
}

/** The tools a skill calls: its allowed-tools, the scripts in its folder, the commands and MCP tools its text names. */
export function skillTools(text: string, folder: string | null): string[] {
  const out = new Set<string>();
  const allowed = field(parseMd(text), 'allowed-tools');
  if (allowed) for (const t of allowed.replace(/^\[|\]$/g, '').split(/[,\s]+/)) { const v = t.replace(/^["']|["']$/g, '').trim(); if (v) out.add(v); }
  for (const m of text.matchAll(/`((?:node|npx|npm|pwsh|powershell|az|git|gh|sqlcmd|python3?|bash|dotnet|docker|kubectl|curl)\s+[^`\s]+)/g)) out.add(m[1]!.slice(0, 80));
  for (const m of text.matchAll(/\bmcp__[A-Za-z0-9_-]+__[A-Za-z0-9_*-]+/g)) out.add(m[0]);
  if (folder) {
    try { for (const f of fs.readdirSync(path.join(folder, 'scripts'))) out.add(`scripts/${f}`); } catch { /* no scripts */ }
  }
  return [...out].sort().slice(0, 40);
}

export interface SkillDir { dir: string; home: SkillHome }
/** Every skill of the given folders (a folder with SKILL.md, named like a skill); the first folder wins a name. */
export function readSkills(dirs: SkillDir[], root: string | null, profiles: readonly AgentProfile[]): BrainSkill[] {
  const found = new Map<string, BrainSkill>();
  for (const { dir, home } of dirs) {
    let names: string[] = [];
    try { names = fs.readdirSync(dir).sort(); } catch { continue; }
    for (const name of names) {
      if (!NAME.test(name) || found.has(name)) continue;
      const file = path.join(dir, name, 'SKILL.md'), text = readSmall(file);
      if (text === null) continue;
      const p = parseMd(text);
      found.set(name, {
        name, description: (field(p, 'description') ?? '').trim() || firstProse(p.body), file, rel: inside(root, file), home,
        usedBy: profiles.filter(a => a.scope === 'role' && (a.skills.includes(name) || !!a.knowhow?.linked.includes(name))).map(a => a.id),
        tools: skillTools(text, path.join(dir, name)), lines: text.split(/\r?\n/).length, changedAt: mtime(file), madeBy: null,
      });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const WHEN = /^---\nwhen: (\{[^\n]+\})\n---\n/;
function rule(root: string, rel: string, loaded: BrainRule['loaded']): BrainRule | null {
  const text = readSmall(path.join(root, rel));
  if (text === null) return null;
  let when: BrainRule['when'] = null;
  const m = WHEN.exec(text.replace(/\r\n/g, '\n'));
  if (m) { try { const w = JSON.parse(m[1]!) as Partial<NonNullable<BrainRule['when']>>; when = { prompt: w.prompt ?? [], tools: w.tools ?? [], paths: w.paths ?? [] }; } catch { when = null; } }
  const body = m ? text.replace(/\r\n/g, '\n').slice(m[0].length) : text;
  const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? path.posix.basename(rel, '.md');
  return { file: rel, title: plain(title), summary: firstProse(body), when, loaded, lines: text.split(/\r?\n/).length, changedAt: mtime(path.join(root, rel)) };
}
/** The brain's rules: its always-loaded files (not me.md: the profile has its own page), its topic files and rules/. */
export function readRules(root: string | null): BrainRule[] {
  if (!root) return [];
  let fixed: string[] = [], topics: string[] = [];
  try { const c = configOf(root); fixed = c.fixedFiles.filter(f => f !== 'me.md'); topics = c.topicFiles; } catch { /* an unreadable brain.json: only rules/ */ }
  const files = new Set<string>([...fixed, ...topics]);
  try { for (const f of fs.readdirSync(path.join(root, 'rules')).sort()) if (/\.md$/i.test(f)) files.add(`rules/${f}`); } catch { /* none */ }
  return [...files].flatMap(rel => rule(root, rel, fixed.includes(rel) ? 'always' : topics.includes(rel) ? 'topic' : 'none') ?? []);
}

/** Folder names that hold knowledge notes, and the group the page shows them under. */
const KNOWLEDGE: [RegExp, string][] = [
  [/^(clienti|customers?|clients?|accounts?)$/i, 'Clienti'],
  [/^(ambienti|environments?|envs?|servers?|infra(structure)?)$/i, 'Ambienti'],
  [/^(persone|people|contacts?|contatti|team|colleghi)$/i, 'Persone'],
  [/^(knowledge|conoscenza|kb|wiki|references?|riferimenti)$/i, 'Riferimenti'],
];
const ENTRY = /^\s*(?:[-*]\s+\S|\|\s*\d{4}-\d{2}-\d{2})/;
/** The entry lines as written (list marker dropped, table pipes kept as separators), oldest first. */
export const rawEntries = (text: string): string[] => text.split(/\r?\n/).filter(l => ENTRY.test(l)).map(l => l.replace(/^\s*[-*]\s+/, '').trim());
const entriesOf = (text: string): string[] => rawEntries(text).map(l => plain(l.replace(/\|/g, ' ')));
function memoryFile(root: string, rel: string, kind: MemoryFile['kind'], group: string, agentId?: string): MemoryFile | null {
  const text = readSmall(path.join(root, rel));
  if (text === null) return null;
  const entries = entriesOf(text), raw = rawEntries(text);
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? path.posix.basename(rel, '.md');
  return { kind, group, title: plain(title), file: rel, ...(agentId ? { agentId } : {}), entries: entries.length || (text.trim() ? 1 : 0), preview: (entries.length ? entries.slice(-3) : [firstProse(text)]).filter(Boolean).reverse(), previewMd: (raw.length ? raw.slice(-3) : [firstProse(text)]).filter(Boolean).reverse(), changedAt: mtime(path.join(root, rel)) };
}
function walkMd(root: string, dir: string, depth: number, out: string[]): void {
  let ents: fs.Dirent[] = [];
  try { ents = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
  for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= 200) return;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory() && depth < 3 && !e.name.startsWith('.')) walkMd(root, rel, depth + 1, out);
    else if (e.isFile() && /\.md$/i.test(e.name) && !/(credential|secret|password|token)/i.test(e.name)) out.push(rel);
  }
}
/** The brain's memory. One file per agent at agents/<portable id>/memory.md (written on first use, never seeded). */
export function readMemory(root: string | null, profiles: readonly AgentProfile[]): MemoryFile[] {
  if (!root) return [];
  const out: MemoryFile[] = [];
  // knowledge: a folder named like the groups above, up to two levels down (e.g. areas/clienti/), outside agents/
  const visit = (dir: string, depth: number) => {
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'agents' || e.name === 'node_modules') continue;
      const rel = dir ? `${dir}/${e.name}` : e.name, group = KNOWLEDGE.find(([re]) => re.test(e.name))?.[1];
      if (group) { const files: string[] = []; walkMd(root, rel, 1, files); for (const f of files) { const m = memoryFile(root, f, 'knowledge', group); if (m) out.push(m); } }
      else if (depth < 2) visit(rel, depth + 1);
    }
  };
  visit('', 0);
  const now = memoryFile(root, 'now.md', 'threads', 'Fili aperti'); if (now) out.push(now);
  const journal: string[] = [];
  try { for (const f of fs.readdirSync(path.join(root, 'journal')).sort().reverse()) if (/\.md$/i.test(f)) journal.push(`journal/${f}`); } catch { /* none yet */ }
  if (journal.length) {
    const latest = memoryFile(root, journal[0]!, 'journal', 'Diario');
    if (latest) out.push({ ...latest, title: 'Diario', entries: journal.length, preview: journal.slice(0, 3).map(f => path.posix.basename(f, '.md')), previewMd: latest.previewMd });
  }
  const errors = memoryFile(root, 'ai-errors.md', 'errors', 'Errori'); if (errors) out.push(errors);
  const shared = memoryFile(root, 'memory/shared.md', 'shared', 'Condivisa'); if (shared) out.push(shared);
  for (const p of profiles) {
    const m = memoryFile(root, `agents/${portableId(p.id)}/memory.md`, 'agent', p.name, p.id);
    if (m) out.push(m);
  }
  return out;
}

/** An agent's memory file (brain-relative), whether or not it exists yet. */
export const agentMemoryFile = (id: string): string => `agents/${portableId(id)}/memory.md`;
