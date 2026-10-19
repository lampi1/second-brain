// What an agent pack carries beside the agent and its skills (ADR 0077): the brain's rules (its topic files and the
// files of rules/, as `rules/<name>.md`) and a generated TOOLS.md that lists the tools the agent and its skills call
// (tool classes, MCP servers, each skill's allowed-tools and scripts). A list only: TOOLS.md grants nothing, and an
// import never turns it into a permission. Never memory or private knowledge: the always-loaded files (me.md, AGENTS.md,
// CLAUDE.md), now.md, the journal and agents/<id>/memory.md never enter a pack; the guard scan still checks what does.
// On import the rules are written to <brain>/rules/ when absent (the user's own file with the same name is kept) and
// listed in brain.json rules.topicFiles when they carry a `when` frontmatter. Used by pack/flows.ts and pack/emit.ts;
// unit tests: test/unit/agents/pack-rules.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentPackManifest } from '../../../shared/agent-pack';
import { field, parseMd } from '../../../shared/skillmd';
import { configOf } from '../../rules/storage';
import type { PackFiles } from './zip';

export const RULE_FILE = /^rules\/[a-z0-9][a-z0-9._-]{0,80}\.md$/;
export const TOOLS_FILE = 'TOOLS.md';
const MAX_RULE = 256 * 1024, MAX_RULES = 50;
/** Folders whose files are memory or the app's state, never rules (even when listed as topic files). */
const PRIVATE = /^(agents|memory|journal|ops\/state|\.[^/]+)\//;
const PRIVATE_FILE = /^(me|now|AGENTS|CLAUDE|ai-errors)\.md$/i;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'regola';

/** The brain's rules as pack files: topic files first, then rules/ (one per name; private files never). */
export function packRules(root: string): PackFiles {
  const out: PackFiles = new Map();
  let topics: string[] = [];
  try { topics = configOf(root).topicFiles; } catch { /* unreadable brain.json: rules/ only */ }
  const rels = [...topics];
  try { for (const f of fs.readdirSync(path.join(root, 'rules')).sort()) if (/\.md$/i.test(f)) rels.push(`rules/${f}`); } catch { /* none */ }
  for (const rel of rels) {
    if (out.size >= MAX_RULES || PRIVATE.test(rel) || PRIVATE_FILE.test(rel) || /(credential|secret|password|token)/i.test(rel)) continue;
    const name = `rules/${slug(path.posix.basename(rel, '.md'))}.md`;
    if (out.has(name)) continue;
    try {
      const file = path.join(root, rel), st = fs.lstatSync(file);
      if (!st.isFile() || st.size > MAX_RULE) continue;
      out.set(name, fs.readFileSync(file));
    } catch { /* listed but missing */ }
  }
  return out;
}

/** TOOLS.md: what the agent and its skills call, in words. */
export function packTools(agent: AgentPackManifest['agent'], skills: PackFiles): string {
  const lines = [`# Strumenti di ${agent.name}`, '', 'Cosa chiamano l’agente e le sue skill. È solo un elenco: questo file non concede nessun permesso.', '',
    '## Agente', '', `- Classi di strumenti: ${agent.tools.allow.length ? agent.tools.allow.join(', ') : 'nessuna'}`,
    `- Server MCP: ${agent.tools.mcp?.length ? agent.tools.mcp.join(', ') : 'nessuno'}`, `- Permessi massimi: ${agent.permissionCeiling}`, ''];
  const names = [...new Set([...skills.keys()].filter(n => n.startsWith('skills/')).map(n => n.split('/')[1]!))].sort();
  if (names.length) lines.push('## Skill', '');
  for (const name of names) {
    const md = skills.get(`skills/${name}/SKILL.md`), allowed = md ? field(parseMd(md.toString('utf8')), 'allowed-tools') : undefined;
    const scripts = [...skills.keys()].filter(n => n.startsWith(`skills/${name}/`) && (n.split('/').includes('scripts') || /\.(sh|ps1|py|js|mjs|cjs|cmd|bat)$/i.test(n))).map(n => n.slice(`skills/${name}/`.length));
    lines.push(`### ${name}`, '', `- allowed-tools: ${allowed?.trim() || 'non dichiarati'}`, `- Script: ${scripts.length ? scripts.join(', ') : 'nessuno'}`, '');
  }
  return lines.join('\n');
}

/** Writes the imported rules into <brain>/rules/ (absent ones only) and lists the topic ones in brain.json. Returns the
 *  files written (brain-relative) and the names kept as the user's. Throws before writing anything on a bad name. */
export function installRules(root: string, files: PackFiles): { written: string[]; kept: string[]; created: string[] } {
  const rules = [...files].filter(([n]) => RULE_FILE.test(n));
  const written: string[] = [], kept: string[] = [], created: string[] = [];
  try { if (fs.lstatSync(path.join(root, 'rules')).isSymbolicLink()) throw new Error('Symbolic links are not brain rules'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  for (const [rel, data] of rules) {
    const dest = path.join(root, ...rel.split('/'));
    if (fs.existsSync(dest)) { kept.push(rel); continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data, { flag: 'wx' });
    written.push(rel); created.push(dest);
  }
  const topics = written.filter(rel => files.get(rel)!.toString('utf8').replace(/\r\n/g, '\n').startsWith('---\nwhen: '));
  if (topics.length) {
    const file = path.join(root, 'brain.json');
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as { rules?: { topicFiles?: string[] } };
      const r = cfg.rules ?? {}, list = Array.isArray(r.topicFiles) ? r.topicFiles : [];
      const next = { ...cfg, rules: { ...r, topicFiles: [...list, ...topics.filter(t => !list.includes(t))] } };
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`); fs.renameSync(tmp, file);
    } catch { /* no brain.json: the rules are on disk and shown on Regole, loaded once listed */ }
  }
  return { written, kept, created };
}
