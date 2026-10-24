// The shareable brain (ADR 0088; the owner, 2026-10-20: "vorrei che il brain fosse esportabile e condivisibile con i
// colleghi ... uno zip ... semplice da usare anche su Cursor o Claude Code o Codex senza passare dall'app"). One zip a
// colleague unzips and opens as a folder in their own tool: AGENTS.md (the index Codex, Cursor and Claude Code read),
// CLAUDE.md (imports it), README.md (for the person), the brain's rules (rules/<name>.md, pack/rules.ts), its skills
// in the two folders the tools look in (.agents/skills: Codex and Cursor; .claude/skills: Claude Code), the work roles
// as each tool's subagents (.claude/agents, .cursor/agents, .codex/agents) and the brain's scripts (scripts/).
// Never memory: me.md, now.md, the journal, agents/<id>/memory.md and memory/ are not read here at all; skill hooks are
// dropped; the guard scan (the same as an agent pack's) checks every file before the zip is written.
// Used by pack/wiring.ts (`brain:share` IPC). Unit tests: test/unit/agents/brain-share.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { claudePackTools } from '../../../shared/agent-pack';
import type { AgentProfile } from '../../../shared/agents';
import { isWorkRole } from '../../../shared/roles';
import { field, parseMd, setFields } from '../../../shared/skillmd';
import { SCRIPT_EXTS, SCRIPTS_DIR } from '../../brain/scripts';
import { packRules } from './rules';
import { emitAgentToml } from './toml';
import { checkPackPath, type PackFiles } from './zip';

export interface ShareRole { profile: AgentProfile; skillName: string; own: PackFiles }
export interface BrainShareInput { root: string; name: string; date: string; roles: ShareRole[] }
export interface BrainShareSummary { skills: string[]; rules: string[]; roles: string[]; scripts: string[]; skipped: string[] }

export const SKILL_DIRS = ['.agents/skills', '.claude/skills'];
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_FILE = 2 * 1024 ** 2, MAX_SKILL = 10 * 1024 ** 2, MAX_SCRIPT = 200 * 1024;
const OUTSIDE_APP = 'Outside the second-brain app: where these instructions name agent_delegate, use your tool\'s own subagents; agent_report means your final answer; agent_ask_parent means asking the user.';

export const text = (data: Buffer): boolean => {
  if (data.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(data); return true; } catch { return false; }
};

/** One skill folder as relative files; null when it is not a plain, text-only skill (links, binaries, too big). */
export function readSkill(folder: string, skipped: string[], label: string): PackFiles | null {
  const files: PackFiles = new Map(); let total = 0;
  const walk = (dir: string, prefix: string): boolean => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + item.name, full = path.join(dir, item.name), info = fs.lstatSync(full);
      if (info.isSymbolicLink() || item.name === '.git' || item.name.toLowerCase() === 'bin') { skipped.push(`${label}/${rel}`); continue; }
      if (info.isDirectory()) { if (!walk(full, rel + '/')) return false; continue; }
      if (!info.isFile()) continue;
      if (info.size > MAX_FILE || /\.(exe|dll|com|so|dylib)$/i.test(item.name)) { skipped.push(`${label}/${rel}`); continue; }
      const data = fs.readFileSync(full);
      if (!text(data)) { skipped.push(`${label}/${rel}`); continue; }
      try { checkPackPath(`.claude/skills/x/${rel}`); } catch { skipped.push(`${label}/${rel}`); continue; }
      if ((total += data.length) > MAX_SKILL) return false;
      files.set(rel, data);
    }
    return true;
  };
  try { if (!walk(folder, '')) { skipped.push(label); return null; } } catch { skipped.push(label); return null; }
  const md = files.get('SKILL.md');
  if (!md) { skipped.push(label); return null; }
  // hooks run code in the colleague's tool: a shared skill never carries them
  files.set('SKILL.md', Buffer.from(setFields(md.toString('utf8'), {}, ['hooks'])));
  return files;
}

/** The brain's own skills (never the ones in the user's home): `.agents/skills` first, then `.claude/skills`. */
export function brainSkills(root: string, skipped: string[]): Map<string, PackFiles> {
  const out = new Map<string, PackFiles>();
  for (const dir of SKILL_DIRS) {
    const base = path.join(root, ...dir.split('/'));
    let names: string[] = [];
    try { if (!fs.lstatSync(base).isDirectory()) continue; names = fs.readdirSync(base).sort(); } catch { continue; }
    for (const name of names) {
      if (out.has(name) || !SKILL_NAME.test(name)) continue;
      const folder = path.join(base, name);
      try { if (!fs.lstatSync(folder).isDirectory()) continue; } catch { continue; }
      const files = readSkill(folder, skipped, `${dir}/${name}`);
      if (files) out.set(name, files);
    }
  }
  return out;
}

function brainScripts(root: string, skipped: string[]): PackFiles {
  const out: PackFiles = new Map(), dir = path.join(root, SCRIPTS_DIR);
  let names: string[] = [];
  try { names = fs.readdirSync(dir).sort(); } catch { return out; }
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const info = fs.lstatSync(full);
      if (!info.isFile() || !SCRIPT_EXTS.includes(path.extname(name).toLowerCase())) continue;
      const data = fs.readFileSync(full);
      if (info.size > MAX_SCRIPT || !text(data)) { skipped.push(`scripts/${name}`); continue; }
      checkPackPath(`scripts/${name}`);
      out.set(`scripts/${name}`, data);
    } catch { skipped.push(`scripts/${name}`); }
  }
  return out;
}

export const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
export const description = (md: Buffer | undefined) => {
  const v = md && field(parseMd(md.toString('utf8')), 'description');
  return oneLine(typeof v === 'string' ? v.replace(/^["']|["']$/g, '') : '');
};

/** A rule's `when` ({"prompt":[…],"tools":[…],"paths":[…]}, rules/storage.ts) in words; free text as it is. */
export function whenText(when: string): string {
  if (!when.trim()) return 'Always';
  try {
    const w = JSON.parse(when) as Record<string, unknown>, list = (k: string) => Array.isArray(w[k]) ? (w[k] as unknown[]).filter(v => typeof v === 'string') as string[] : [];
    const parts = [list('prompt').length && `the request mentions ${list('prompt').join(', ')}`, list('tools').length && `you use ${list('tools').join(', ')}`, list('paths').length && `you touch ${list('paths').join(', ')}`].filter(Boolean);
    return parts.length ? `When ${parts.join('; or ')}` : 'Always';
  } catch { return oneLine(when); }
}

function roleBody(role: ShareRole, skills: string[]): string {
  const p = role.profile;
  return [p.instructions.trim(), OUTSIDE_APP, skills.length ? `Skills that fit this role: ${skills.join(', ')}.` : '', 'Read AGENTS.md at the brain root first: its rules apply to you.'].filter(Boolean).join('\n\n') + '\n';
}

/** A role as each tool's subagent (.claude/agents, .cursor/agents, .codex/agents), naming the skills it can load. */
export function roleFiles(r: ShareRole, skills: Map<string, PackFiles>): [string, Buffer][] {
  const declared = [...new Set([...(r.profile.skills ?? []), ...(r.profile.knowhow?.linked ?? []), r.skillName])].filter(n => skills.has(n));
  return [[`.claude/agents/${r.skillName}.md`, Buffer.from(roleMd(r, declared, true))], [`.cursor/agents/${r.skillName}.md`, Buffer.from(roleMd(r, declared, false))],
    [`.codex/agents/${r.skillName}.toml`, Buffer.from(emitAgentToml({ name: r.skillName, description: oneLine(r.profile.purpose), developer_instructions: roleBody(r, declared),
      ...(r.profile.effort ? { model_reasoning_effort: r.profile.effort === 'max' ? 'xhigh' : r.profile.effort } : {}) }))]];
}

function roleMd(role: ShareRole, skills: string[], claude: boolean): string {
  const p = role.profile, lines = ['---', `name: ${role.skillName}`, `description: ${JSON.stringify(oneLine(p.purpose).slice(0, 1024))}`, 'model: inherit'];
  if (claude && p.tools) lines.push(`tools: ${JSON.stringify(claudePackTools(p.tools))}`);
  if (claude && skills.length) lines.push(`skills: ${JSON.stringify(skills)}`);
  return [...lines, '---', '', roleBody(role, skills)].join('\n');
}

function agentsMd(input: BrainShareInput, skills: Map<string, PackFiles>, rules: PackFiles, roles: ShareRole[], scripts: PackFiles): string {
  const out = [`# ${input.name}: shared brain`, '',
    `Exported from the second-brain app on ${input.date}. Every agent (Claude Code, Cursor, Codex, others) starts here.`,
    'This file is the index: read the other files only when the tables below say so.', '',
    '## Hard rules', '',
    '1. The rules in `rules/` are the team\'s way of working: read the one whose "When" matches the task before acting.',
    '2. No secrets in these files: credentials stay outside this folder, and agents never read them.',
    '3. Production and shared systems: propose the exact command, the person runs it.',
    '4. Never claim something is done, missing or passing without having checked it.', ''];
  out.push('## Rules', '');
  if (!rules.size) out.push('None yet.', '');
  else {
    out.push('| When | Read |', '|------|------|');
    for (const [file, data] of rules) {
      const when = field(parseMd(data.toString('utf8')), 'when');
      out.push(`| ${whenText(typeof when === 'string' ? when : '').replace(/\|/g, '/')} | \`${file}\` |`);
    }
    out.push('');
  }
  out.push('## Skills', '', 'How a job is done: each one is a folder with a `SKILL.md`, in `.agents/skills/` (Codex, Cursor) and the same copy in `.claude/skills/` (Claude Code). Load the one whose description fits.', '');
  if (!skills.size) out.push('None yet.', '');
  else { for (const [name, files] of skills) out.push(`- \`${name}\`: ${description(files.get('SKILL.md')) || 'no description'}`); out.push(''); }
  if (roles.length) {
    out.push('## Roles', '', 'Subagents for a part of the work: `.claude/agents/` (Claude Code), `.cursor/agents/` (Cursor), `.codex/agents/` (Codex).', '');
    for (const r of roles) out.push(`- \`${r.skillName}\` (${r.profile.name}): ${oneLine(r.profile.purpose)}`);
    out.push('');
  }
  if (scripts.size) {
    out.push('## Scripts', '', 'Tested, reusable scripts in `scripts/`; each one says how to run it in its first lines. Read a script before running it.', '');
    for (const name of scripts.keys()) out.push(`- \`${name}\``);
    out.push('');
  }
  return out.join('\n');
}

function readme(input: BrainShareInput, s: BrainShareSummary): string {
  return [`# ${input.name}: brain condiviso`, '',
    `Esportato dall'app second-brain il ${input.date}: ${s.rules.length} regole, ${s.skills.length} skill, ${s.roles.length} ruoli, ${s.scripts.length} script. Non contiene la memoria personale di chi l'ha esportato.`, '',
    '## Come si usa', '',
    '1. Estrai lo zip in una cartella.',
    '2. Aprila nel tuo strumento, oppure copia il suo contenuto nella radice del repository su cui lavori:',
    '   - **Claude Code**: `claude` dentro la cartella. Legge `CLAUDE.md` (che importa `AGENTS.md`), le skill in `.claude/skills/` e i ruoli in `.claude/agents/`.',
    '   - **Cursor**: apri la cartella. Legge `AGENTS.md`, le skill in `.agents/skills/` e i ruoli in `.cursor/agents/`.',
    '   - **Codex**: `codex` dentro la cartella. Legge `AGENTS.md`, le skill in `.agents/skills/` e i ruoli in `.codex/agents/`.',
    '3. Chiedi all\'agente di lavorare come al solito: le regole e le skill si caricano quando servono.', '',
    'Le skill sono in due cartelle con lo stesso contenuto perché ogni strumento guarda in una cartella diversa: se ne cambi una, copia la modifica anche nell\'altra.',
    'Per avere anche la memoria, il diario e l\'app: https://github.com/lampi1/second-brain.', ''].join('\n');
}

/** A role's own know-how (agents/<id>/skills/<id>) as a plain skill named after the role (null = none, or too big). */
export function roleSkill(r: ShareRole, skipped: string[]): PackFiles | null {
  if (!r.own.size) return null;
  const own: PackFiles = new Map([...r.own].filter(([f]) => f.startsWith(`skills/${r.skillName}/`)).map(([f, d]) => [f.slice(`skills/${r.skillName}/`.length), d]));
  for (const [f, d] of own) { let ok = d.length <= MAX_FILE && text(d); try { checkPackPath(`.claude/skills/x/${f}`); } catch { ok = false; } if (!ok) { own.delete(f); skipped.push(`agents/${r.skillName}/skills/${r.skillName}/${f}`); } }
  const md = own.get('SKILL.md');
  if (!md || [...own.values()].reduce((n, d) => n + d.length, 0) > MAX_SKILL) return null;
  own.set('SKILL.md', Buffer.from(setFields(md.toString('utf8'), {}, ['hooks'])));
  return own;
}

/** Every file of the shared brain, by its path in the zip, and what went in. */
export function buildBrainShare(input: BrainShareInput): { files: PackFiles; summary: BrainShareSummary } {
  const skipped: string[] = [];
  const skills = brainSkills(input.root, skipped);
  const roles = input.roles.filter(r => isWorkRole(r.profile.id) && SKILL_NAME.test(r.skillName));
  // a role's own know-how (agents/<id>/skills) travels as a skill named after the role
  for (const r of roles) if (!skills.has(r.skillName)) { const own = roleSkill(r, skipped); if (own) skills.set(r.skillName, own); }
  const rules = packRules(input.root), scripts = brainScripts(input.root, skipped), files: PackFiles = new Map();
  for (const [name, own] of skills) for (const dir of SKILL_DIRS) for (const [rel, data] of own) files.set(`${dir}/${name}/${rel}`, Buffer.from(data));
  for (const [name, data] of rules) files.set(name, Buffer.from(data));
  for (const [name, data] of scripts) files.set(name, Buffer.from(data));
  for (const r of roles) for (const [name, data] of roleFiles(r, skills)) files.set(name, data);
  const summary: BrainShareSummary = { skills: [...skills.keys()], rules: [...rules.keys()], roles: roles.map(r => r.skillName), scripts: [...scripts.keys()], skipped };
  files.set('AGENTS.md', Buffer.from(agentsMd(input, skills, rules, roles, scripts)));
  files.set('CLAUDE.md', Buffer.from(['# Claude Code entry point', '', 'The canonical context is AGENTS.md; do not duplicate it here.', '', '@AGENTS.md', ''].join('\n')));
  files.set('README.md', Buffer.from(readme(input, summary)));
  for (const name of files.keys()) checkPackPath(name);
  return { files, summary };
}
