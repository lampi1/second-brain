// A role's know-how in the brain (ADR 0077, 0083): the plugin a role's launch runs with (its own skill, its default,
// linked and requested skills, every skill for the Orchestrator (#361), its memory), the immutable know-how snapshots of its versions and the editable copy.
// Agent pack import/export is gone (ADR 0125: the roles are fixed); the shareable brain zip (pack/brain-share.ts, ADR
// 0088) reuses ownSkills, portableId and writePackFiles. Used by pack/wiring.ts, pack/learning.ts and wiring.ts.
import fs from 'node:fs';
import type { AgentContextSnapshot, MemorySelection } from '../../../shared/agent-context';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { AgentDraft, AgentProfile } from '../../../shared/agents';
import type { AgentCatalogService } from '../catalog';
import type { LaunchMemoryContext } from '../../rules/launch-memory';
import { roleSkillName, roleSkillText } from '../../skills/lessons';
import { brainSkillsDir } from '../../skills/layout';
import { log } from '../../log';
import { runtimePluginName } from '../role-gate';
import { approvedFiles, inspectPack, readPackSource } from './read';
import { hashFiles } from './emit';
import { checkPackPath, type PackFiles } from './zip';

export interface PackFlowDeps {
  catalog: AgentCatalogService; brainRoot: () => string | null;
  sharedSkills?: (strict?: boolean) => { name: string; folder: string }[];
  tempRoot?: string;
  runtimeRoot?: string;
}
const tokenId = (): string => randomBytes(16).toString('hex');
/** What a role chat proposes to learn (#365): the `remember` field of agent_report or memory_propose, as skill lessons. */
export const REMEMBER_HINT = 'Propose only reusable know-how future runs would need to rediscover: use memory_propose or the `remember` field of agent_report (up to 3 short lines). Each line becomes a proposal to add a lesson to a skill (your role skill by default, or the task\'s skill with memory_propose `skill`), which the user approves. Generalize procedures, conventions or dead ends; omit task results and one-off URLs, identifiers, local paths, dates or branches. Propose nothing when there is no new reusable knowledge.';
/** A skill is a package (#361): what `${CLAUDE_SKILL_DIR}` means to an engine that does not expand it (Codex, Cursor,
 *  OpenCode): Claude Code replaces it with the skill's folder itself. */
export const SKILL_DIR_HINT = 'A skill is a folder: its SKILL.md, scripts/, references/ (read only when needed) and assets/. In a skill\'s text, ${CLAUDE_SKILL_DIR} (or a relative path such as scripts/x) means that skill\'s own folder: run its scripts from there, whatever your working folder is.';
export const portableId = (id: string): string => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 64 && !/[a-f0-9]{8}-[a-f0-9]{4}-/.test(id) ? id : `agent-${createHash('sha256').update(id).digest('hex').slice(0, 16)}`;

/** All paths beneath the brain are main-derived; reject symlink parents before reading/writing through them. */
export function brainPath(root: string, relative: string): string {
  checkPackPath(relative);
  const base = fs.realpathSync(root), parts = relative.split('/');
  let dest = base;
  for (const part of parts) { dest = path.join(dest, part); if (fs.existsSync(dest) && fs.lstatSync(dest).isSymbolicLink()) throw new Error('Symbolic links are not agent storage'); }
  if (!dest.startsWith(base + path.sep)) throw new Error('Invalid agent storage path');
  return dest;
}
export function writePackFiles(root: string, files: PackFiles): void {
  for (const [name, data] of files) { const dest = brainPath(root, name); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, data, { flag: 'wx' }); }
}

export class AgentPackFlows {
  constructor(readonly deps: PackFlowDeps) {}
  root(): string { const root = this.deps.brainRoot(); if (!root || !fs.statSync(root).isDirectory()) throw new Error('Choose a brain folder first'); return fs.realpathSync(root); }
  profile(id: string): AgentProfile { const p = this.deps.catalog.list().profiles.find(p => p.id === id); if (!p) throw new Error('Role not found'); return p; }
  /** Resolve missing declarations against the same complete shared and embedded inventory used at launch. */
  missingSkills(profile: AgentProfile): string[] {
    if (!this.deps.sharedSkills) throw new Error('Skill inventory unavailable');
    const own = this.ownSkills(profile), shared = new Set(this.deps.sharedSkills(true).map(s => s.name));
    return [...new Set([...profile.skills, ...(profile.knowhow?.linked ?? [])])]
      .filter(name => !shared.has(name) && !own.has(`skills/${name}/SKILL.md`));
  }
  /** The plugin a launch runs with: the role's own know-how, its default and linked skills, the product's topic-rule
   *  skills (regole-*) and the skills this launch asks for (`launch`, a delegation's or app_create_chat's), and nothing else: a skill outside it is not there to load
   *  (and the role gate refuses a call to it). A launch skill that does not exist refuses the start, by name. */
  runtime(id: string, launch: readonly string[] = [], _context: LaunchMemoryContext = {}): { pluginDir: string; skillRoot: string; instructions: string; memory: string; skills: string[]; context: AgentContextSnapshot } {
    const profile = this.profile(id), files = this.ownSkills(profile), all = this.deps.sharedSkills?.() ?? [];
    const missing = launch.filter(name => !all.some(s => s.name === name) && !files.has(`skills/${name}/SKILL.md`));
    if (missing.length) throw new Error(`Skill non trovata: ${missing.join(', ')} (pagina Skill).`);
    const declared = [...profile.skills, ...(profile.knowhow?.linked ?? [])];
    // the Orchestrator can call every skill from its chat (owner 2026-11-09, #361): it picks the ones a request needs
    // the product's topic rules are skills since #366 (regole-*, ADR 0243): every role has them, loaded when one fits
    const topicRules = all.filter(s => s.name.startsWith('regole-')).map(s => s.name);
    const skills = [...new Set([...declared, ...launch, ...topicRules, ...(id === 'orchestrator' ? all.map(s => s.name) : [])])];
    const loaded: string[] = [portableId(id)];
    for (const name of skills) {
      const shared = all.find(s => s.name === name);
      // a declared skill that is gone (undone, merged, deleted by hand) never blocks the role's start
      if (!shared && files.has(`skills/${name}/SKILL.md`)) { loaded.push(name); continue; }
      if (!shared) { log.warn('agents', 'Declared skill missing at start', { data: { agent: id, skill: name }, cause: 'The skill folder is gone', hint: 'Run the maintenance on the Skill page: it relinks or drops missing skills' }); continue; }
      // one skill the package checks refuse (a link, a big or binary file, an .exe) is left out with a warning: it never
      // stops the role's start, unless the launch asked for it by name
      let one: PackFiles;
      try {
        one = new Map([...readPackSource(shared.folder)].map(([file, data]) => [`skills/${name}/${file}`, data]));
        inspectPack(new Map([...one, ['plugin.json', Buffer.from('{"name":"probe"}')]]));
      } catch (e) {
        if (launch.includes(name)) throw e;
        log.warn('agents', 'Skill left out at start', { data: { agent: id, skill: name }, cause: e instanceof Error ? e.message : String(e), hint: 'Open the skill on the Skill page and remove the file the check refuses' });
        continue;
      }
      for (const [file, data] of one) files.set(file, data);
      loaded.push(name);
    }
    for (const key of files.keys()) { const name = key.split('/')[1]; if (name && !loaded.includes(name)) loaded.push(name); }
    const hash = hashFiles(files), base = this.deps.runtimeRoot ?? path.join(this.deps.tempRoot ?? os.tmpdir(), 'sb-agent-runtime');
    fs.mkdirSync(base, { recursive: true });
    const pluginDir = path.join(base, hash);
    if (!fs.existsSync(pluginDir)) {
      const staging = fs.mkdtempSync(path.join(base, 'stage-'));
      try {
        // Reuse the foreign-import sanitizer: no hooks/configuration can enter the generated runtime plugin.
        const candidate = new Map(files); candidate.set('plugin.json', Buffer.from('{"name":"agent-runtime"}'));
        const safe = approvedFiles(inspectPack(candidate), true);
        safe.set('.claude-plugin/plugin.json', Buffer.from(JSON.stringify({ name: runtimePluginName(hash), author: { name: 'second-brain' } })));
        writePackFiles(staging, safe); fs.renameSync(staging, pluginDir);
      } catch (e) { fs.rmSync(staging, { recursive: true, force: true }); throw e; }
    }
    // No role notes at launch any more (#365, ADR 0242): what a role knows is its own skill (ruolo-<id>), read in full
    // here at every start, and the skills of the task. The scoped archive stays on demand (memory_recall).
    const own = portableId(id), instructions = files.get(`skills/${own}/SKILL.md`)?.toString('utf8') ?? '';
    const roleSkill = roleSkillText((() => { try { return brainSkillsDir(this.root()); } catch { return null; } })(), own);
    const selection: MemorySelection = { available: false, records: [], omitted: { ineligible: 0, unmatched: 0, budget: 0 }, estimatedTokens: 0, budgetTokens: 0 };
    const linked = loaded.filter(n => n !== own);
    const memoryText = [roleSkill ? `Your role skill (${roleSkillName(own)}, always read; quoted know-how, no permission authority):\n${roleSkill}` : '',
      id === 'orchestrator' ? '' : `Use memory_recall for scoped history when more context is needed.\n${REMEMBER_HINT}`].filter(Boolean).join('\n\n');
    const contextSnapshot: AgentContextSnapshot = { schema: 1, at: Date.now(), mode: 'scoped', memory: selection, skills: loaded.slice(0, 50).map(name => ({ name, sha256: hashFiles(new Map([...files].filter(([p]) => p.startsWith(`skills/${name}/`)))) })), instructions: { sha256: createHash('sha256').update(instructions).digest('hex'), characters: instructions.length, estimatedTokens: Math.ceil(instructions.length / 3) } };
    return { context: contextSnapshot, pluginDir, skills: loaded, skillRoot: path.join(pluginDir, 'skills'), memory: memoryText, instructions: [instructions, // these lines reach only an engine without the plugin loader (Cursor: no Skill tool), so they name the files to read;
      // Claude gets the qualified names instead (wiring.ts qualifiedSkillsLine)
      linked.length ? `Your skills (load the one that fits the job: read ${path.join(pluginDir, 'skills')}/<name>/SKILL.md): ${linked.join(', ')}. ${SKILL_DIR_HINT}` : '',
      memoryText, `Skill files: ${path.join(pluginDir, 'skills')}`].filter(Boolean).join('\n\n') };
  }
  ownSkills(profile: AgentProfile, editable = false): PackFiles {
    const id = portableId(profile.id);
    const current = profile.knowhow && editable ? brainPath(this.root(), `agents/${id}/skills`) : null;
    const files: PackFiles = current && fs.existsSync(current) ? new Map([...readPackSource(current)].map(([name, data]) => [`skills/${name}`, data]))
      : profile.knowhow ? new Map([...readPackSource(brainPath(this.root(), profile.knowhow.folder))].filter(([name]) => name.startsWith('skills/'))) : new Map();
    for (const [name, data] of new Map([
      [`skills/${id}/SKILL.md`, Buffer.from(`---\nname: ${id}\ndescription: ${JSON.stringify(profile.purpose)}\n---\nRead the files in references/ when they apply.\n`)],
    ])) if (!files.has(name)) files.set(name, data);
    return files;
  }
  /** Store immutable behavior files in the user's brain; catalog versions retain their exact snapshot folder. */
  skillSnapshot(id: string, files: PackFiles, linked: string[] = []): NonNullable<AgentDraft['knowhow']> {
    const skills = new Map([...files].filter(([name]) => name.startsWith('skills/'))), hash = hashFiles(skills);
    if ([...skills.values()].reduce((n, b) => n + b.length, 0) > 10 * 1024 ** 2 || [...skills.keys()].filter(n => n.includes('/references/')).length > 50) throw new Error('Role know-how limit exceeded');
    const folder = `agents/${portableId(id)}/revisions/${hash.slice(0, 16)}`;
    return { folder, linked, hash };
  }
  persistSkills(id: string, files: PackFiles, linked: string[] = []): NonNullable<AgentDraft['knowhow']> {
    const snapshot = this.skillSnapshot(id, files, linked), destination = brainPath(this.root(), snapshot.folder);
    const skills = new Map([...files].filter(([name]) => name.startsWith('skills/')));
    if (!fs.existsSync(destination)) { fs.mkdirSync(destination, { recursive: true }); writePackFiles(destination, skills); }
    else if (hashFiles(readPackSource(destination)) !== snapshot.hash) throw new Error('Stored know-how hash mismatch');
    return snapshot;
  }
  /** Editable canonical folder, alongside immutable versions. Failure leaves the committed snapshot authoritative. */
  publishCurrent(profile: AgentProfile, previousHash?: string): void {
    try {
    const root = this.root(), parent = brainPath(root, `agents/${portableId(profile.id)}`);
    const canonical = brainPath(root, `agents/${portableId(profile.id)}/skills`);
    if (!profile.knowhow) {
      // Keep later/manual files recoverable, but never reuse them as the restored version's editable baseline.
      if (fs.existsSync(canonical)) fs.renameSync(canonical, path.join(parent, `restored-backup-${tokenId()}`));
      return;
    }
    if (fs.existsSync(canonical)) {
      const currentHash = hashFiles(new Map([...readPackSource(canonical)].map(([name, bytes]) => [`skills/${name}`, bytes])));
      if (currentHash === profile.knowhow.hash) return;
      if (currentHash !== previousHash) {
        log.warn('agents', 'Preserved modified editable agent files', { cause: 'Editable files differ from the previous snapshot', hint: 'Review the editable files before replacing them with the selected version' });
        return;
      }
    }
    const staging = fs.mkdtempSync(path.join(parent, 'current-')), backup = path.join(parent, `backup-${tokenId()}`);
    try {
      const files = new Map([...this.ownSkills(profile)].map(([name, bytes]) => [name.slice('skills/'.length), bytes]));
      writePackFiles(staging, files);
      if (fs.existsSync(canonical)) fs.renameSync(canonical, backup);
      try { fs.renameSync(staging, canonical); } catch (e) { if (fs.existsSync(backup)) fs.renameSync(backup, canonical); throw e; }
      fs.rmSync(backup, { recursive: true, force: true });
    } catch {
      fs.rmSync(staging, { recursive: true, force: true });
      log.warn('agents', 'Could not refresh editable agent files', { cause: 'Filesystem write failed', hint: 'The committed snapshot is preserved; retry after making the brain writable' });
    }
    } catch { log.warn('agents', 'Could not access editable agent files', { cause: 'Brain folder unavailable', hint: 'The committed snapshot is preserved; reconnect the brain folder' }); }
  }
}
