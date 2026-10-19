// Main-owned pack transactions (ADR 0069, 0083): a pack is a role's skills and the brain's rules. Export writes a role's
// pack (for this app, Claude, Cursor or Codex); import attaches a pack's skills to the built-in role the user picks.
// Review tokens bind bounded staging bytes to one operation for ten minutes. Used by pack/wiring.ts (agents:* IPC).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { AgentDraft, AgentProfile } from '../../../shared/agents';
import { isWorkRole, type WorkRoleId } from '../../../shared/roles';
import { checkedPack, SKILL_SPEC_KEYS, type AgentPackManifest, type PackExportPlan, type PackFinding, type PackImportReview, type PackStats, type PackTarget } from '../../../shared/agent-pack';
import { parseMd, setFields } from '../../../shared/skillmd';
import type { AgentCatalogService, PackInstall } from '../catalog';
import type { GuardPaths, GuardResult } from '../../brain/guard';
import { log } from '../../log';
import { approvedFiles, inspectPack, readPackSource, type PackInspection } from './read';
import { emitPack, emitTarget, hashFiles, skillFiles } from './emit';
import { checkPackPath, writeZip, type PackFiles } from './zip';
import { installRules, packRules, packTools, TOOLS_FILE } from './rules';

export interface PackFlowDeps {
  catalog: AgentCatalogService; brainRoot: () => string | null; version: string;
  scan: (folder: string) => Promise<GuardResult>;
  guards: () => (GuardPaths | null)[];
  pickImport: () => Promise<string | null>;
  pickExport: (target: PackTarget, name: string) => Promise<string | null>;
  openFile?: (file: string) => Promise<void>;
  sharedSkills?: () => { name: string; folder: string }[];
  mcpNames?: () => string[];
  stats?: (id: string) => PackStats;
  now?: () => number;
  tempRoot?: string;
  runtimeRoot?: string;
}
interface BaseToken { root: string; staging: string; expires: number; busy: boolean }
interface ExportToken extends BaseToken { kind: 'export'; profile: AgentProfile; target: PackTarget; manifest: AgentPackManifest; instructions: string; skills: PackFiles; rules: PackFiles; excluded: Set<string>; extraAllowed: Set<string>; files: PackFiles; findings: PackFinding[]; warnings: string[] }
interface ImportToken extends BaseToken { kind: 'import'; inspection: PackInspection; findings: PackFinding[]; collision: PackImportReview['collision'] }
const tokenId = (): string => randomBytes(16).toString('hex');
export const portableId = (id: string): string => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 64 && !/[a-f0-9]{8}-[a-f0-9]{4}-/.test(id) ? id : `agent-${createHash('sha256').update(id).digest('hex').slice(0, 16)}`;
const secretFinding = (f: PackFinding): boolean => !['user-path', 'short-user-name', 'home-path', 'email', 'guid', 'ipv4-private', 'internal-host', 'deny'].includes(f.rule);

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
  private readonly tokens = new Map<string, ExportToken | ImportToken>();
  constructor(readonly deps: PackFlowDeps) {}
  private now(): number { return this.deps.now?.() ?? Date.now(); }
  root(): string { const root = this.deps.brainRoot(); if (!root || !fs.statSync(root).isDirectory()) throw new Error('Choose a brain folder first'); return fs.realpathSync(root); }
  profile(id: string): AgentProfile { const p = this.deps.catalog.list().profiles.find(p => p.id === id); if (!p) throw new Error('Role not found'); return p; }
  /** The plugin a launch runs with: the role's own know-how, its default and linked skills and the skills this launch
   *  asks for (`launch`, a delegation's or app_create_chat's), and nothing else: a skill outside it is not there to load
   *  (and the role gate refuses a call to it). A launch skill that does not exist refuses the start, by name. */
  runtime(id: string, launch: readonly string[] = []): { pluginDir: string; skillRoot: string; instructions: string; skills: string[] } {
    const profile = this.profile(id), files = this.ownSkills(profile), all = this.deps.sharedSkills?.() ?? [];
    const missing = launch.filter(name => !all.some(s => s.name === name));
    if (missing.length) throw new Error(`Skill non trovata: ${missing.join(', ')} (pagina Skill).`);
    const declared = [...profile.skills, ...(profile.knowhow?.linked ?? [])];
    const skills = [...new Set([...declared, ...launch])];
    const loaded: string[] = [portableId(id)];
    for (const name of skills) {
      const shared = all.find(s => s.name === name);
      // a declared skill that is gone (undone, merged, deleted by hand) never blocks the role's start
      if (!shared) { log.warn('agents', 'Declared skill missing at start', { data: { agent: id, skill: name }, cause: 'The skill folder is gone', hint: 'Run the maintenance on the Skill page: it relinks or drops missing skills' }); continue; }
      for (const [file, data] of readPackSource(shared.folder)) files.set(`skills/${name}/${file}`, data);
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
        safe.set('.claude-plugin/plugin.json', Buffer.from(JSON.stringify({ name: `agent-${hash.slice(0, 16)}`, author: { name: 'second-brain' } })));
        writePackFiles(staging, safe); fs.renameSync(staging, pluginDir);
      } catch (e) { fs.rmSync(staging, { recursive: true, force: true }); throw e; }
    }
    // the agent's own memory (ADR 0077: one per agent, agents/<id>/memory.md, never exported) travels with its run
    const own = portableId(id), instructions = files.get(`skills/${own}/SKILL.md`)?.toString('utf8') ?? '';
    let memory = '';
    try { const file = brainPath(this.root(), `agents/${own}/memory.md`); if (fs.existsSync(file) && fs.statSync(file).size <= 256 * 1024) memory = fs.readFileSync(file, 'utf8').trim().slice(-4000); } catch { /* no brain or no memory yet */ }
    // what several agents knew (moved there once by the maintenance, memory/shared.md) reaches each of them
    let shared = '';
    try { const file = brainPath(this.root(), 'memory/shared.md'); if (fs.existsSync(file) && fs.statSync(file).size <= 256 * 1024) shared = fs.readFileSync(file, 'utf8').trim().slice(-2000); } catch { /* none */ }
    const linked = loaded.filter(n => n !== own);
    return { pluginDir, skills: loaded, skillRoot: path.join(pluginDir, 'skills'), instructions: [instructions, linked.length ? `Your skills (load the one that fits the job): ${linked.join(', ')}.` : '',
      shared ? `Shared memory (memory/shared.md):\n${shared}` : '',
      `Your memory (agents/${own}/memory.md; add a line with the product memory writer: agent "<brain>" "${own}" "…")${memory ? `:\n${memory}` : ': empty so far.'}`, `Skill files: ${path.join(pluginDir, 'skills')}`].filter(Boolean).join('\n\n') };
  }
  private sweep(): void { for (const [key, item] of this.tokens) if (!item.busy && item.expires <= this.now()) this.cancel(key); }
  private base(): BaseToken {
    this.sweep(); if (this.tokens.size >= 10) throw new Error('Too many open pack reviews');
    return { root: this.root(), staging: fs.mkdtempSync(path.join(this.deps.tempRoot ?? os.tmpdir(), 'sb-agent-pack-')), expires: this.now() + 600000, busy: false };
  }
  private get<K extends 'export' | 'import'>(key: string, kind: K): Extract<ExportToken | ImportToken, { kind: K }> {
    this.sweep(); const item = this.tokens.get(key);
    if (!item || item.kind !== kind || item.busy || item.root !== this.root()) throw new Error('Review expired or already used; inspect again');
    return item as Extract<ExportToken | ImportToken, { kind: K }>;
  }
  cancel(key: string): void {
    const item = this.tokens.get(key); if (!item) return;
    if (item.busy) throw new Error('Pack operation in progress');
    this.tokens.delete(key); fs.rmSync(item.staging, { recursive: true, force: true });
  }
  close(): void { for (const key of this.tokens.keys()) { const t = this.tokens.get(key)!; t.busy = false; this.cancel(key); } }
  private async scan(item: BaseToken, files: PackFiles): Promise<PackFinding[]> {
    const folder = fs.mkdtempSync(path.join(item.staging, 'scan-'));
    try {
      writePackFiles(folder, files);
      const result = await this.deps.scan(folder);
      if (result.ok) return [];
      if ('findings' in result) return result.findings;
      throw new Error('missing' in result ? result.missing : result.error);
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
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
  async exportPlan(id: string, target: PackTarget): Promise<PackExportPlan> {
    if (!['sbagent', 'claude', 'cursor', 'codex'].includes(target)) throw new Error('Invalid pack target');
    let profile = this.profile(id); const safeId = portableId(profile.id), now = new Date(this.now()).toISOString();
    if (!isWorkRole(profile.id)) throw new Error('Only a work role has a pack');
    if (!profile.pack) { this.deps.catalog.packIdentity(id, { id: `${safeId}-${randomBytes(8).toString('hex')}`, revision: 1 }); profile = this.profile(id); }
    const skills = this.ownSkills(profile, true), metadata: AgentPackManifest['skills'] = [];
    for (const name of new Set([...skills.keys()].map(p => p.split('/')[1]!))) metadata.push({ name, ownership: 'owned', hash: hashFiles(skillFiles(skills, name)) });
    for (const name of profile.knowhow?.linked ?? []) {
      if (metadata.some(s => s.name === name)) continue;
      const shared = this.deps.sharedSkills?.().find(s => s.name === name);
      if (!shared) throw new Error(`Shared skill missing: ${name}`);
      for (const [file, data] of readPackSource(shared.folder)) skills.set(`skills/${name}/${file}`, data);
      metadata.push({ name, ownership: 'shared', hash: hashFiles(skillFiles(skills, name)) });
    }
    const manifest = checkedPack({ format: 1, packId: profile.pack!.id, revision: profile.pack!.revision + 1, contentHash: '0'.repeat(64),
      agent: { id: safeId, name: profile.name, role: profile.id, summary: profile.purpose, instructionsFile: `agents/${safeId}.md`,
        engine: profile.engine, model: profile.model, effort: profile.effort, tools: profile.tools ?? { allow: [] }, permissionCeiling: profile.permissionCeiling ?? 'default' },
      skills: metadata, createdAt: new Date(profile.createdAt).toISOString(), exportedAt: now, appVersion: this.deps.version });
    const item: ExportToken = { ...this.base(), kind: 'export', profile, target, manifest, instructions: profile.instructions, skills, rules: packRules(this.root()), excluded: new Set(), extraAllowed: new Set(), files: new Map(), findings: [], warnings: [] };
    const key = tokenId(); this.tokens.set(key, item);
    try { await this.rebuild(item); return this.plan(key, item); } catch (e) { this.cancel(key); throw e; }
  }
  private async rebuild(item: ExportToken): Promise<void> {
    const manifest = { ...item.manifest, skills: item.manifest.skills.filter(s => !item.excluded.has(`skills/${s.name}`)) };
    const files = new Map([...item.skills].filter(([name]) => !item.excluded.has(name) && !item.excluded.has(name.split('/').slice(0, 2).join('/'))));
    item.warnings = [];
    for (const [name, data] of files) if (name.endsWith('/SKILL.md')) {
      const extras = parseMd(data.toString('utf8')).fields.filter(f => !(SKILL_SPEC_KEYS as readonly string[]).includes(f.key));
      if (extras.length) item.warnings.push(`${name}: ${extras.map(f => f.key).join(', ')}. Cursor/Codex may ignore these keys; claude.ai rejects them. Hooks are always removed.`);
      files.set(name, Buffer.from(setFields(data.toString('utf8'), {}, extras.filter(f => f.key === 'hooks' || !item.extraAllowed.has(`key:${name}:${f.key}`)).map(f => f.key))));
    }
    // the brain's rules and the list of tools travel with the agent (ADR 0077); memory never does
    const extras: PackFiles = new Map([...item.rules].filter(([name]) => !item.excluded.has(name)));
    extras.set(TOOLS_FILE, Buffer.from(packTools(manifest.agent, files)));
    item.files = emitPack(manifest, item.instructions, files, true, extras);
    item.findings = await this.scan(item, item.files);
  }
  private plan(key: string, item: ExportToken): PackExportPlan {
    return { token: key, items: [...item.manifest.skills.map(s => ({ id: `skills/${s.name}`, label: s.name, included: !item.excluded.has(`skills/${s.name}`), required: s.name === item.manifest.agent.id, ownership: s.ownership })),
      ...[...item.skills.keys()].filter(n => !n.endsWith('/SKILL.md')).map(n => ({ id: n, label: n, included: !item.excluded.has(n), required: false })),
      ...[...item.rules.keys()].map(n => ({ id: n, label: n, included: !item.excluded.has(n), required: false })),
      { id: TOOLS_FILE, label: TOOLS_FILE, included: true, required: true },
      ...[...item.skills].filter(([name]) => name.endsWith('/SKILL.md')).flatMap(([name, data]) => parseMd(data.toString('utf8')).fields.filter(f => f.key !== 'hooks' && !(SKILL_SPEC_KEYS as readonly string[]).includes(f.key))
        .map(f => ({ id: `key:${name}:${f.key}`, label: `${name} · ${f.key}`, included: item.extraAllowed.has(`key:${name}:${f.key}`), required: false })))], findings: item.findings, warnings: item.warnings };
  }
  async exportFix(key: string, name: string, action: 'exclude' | 'rescan' | 'allow' | 'open'): Promise<PackExportPlan> {
    const item = this.get(key, 'export'); item.busy = true;
    try {
      if (action === 'open') {
        if (!item.skills.has(name) || !name.startsWith('skills/') || !item.manifest.skills.some(s => s.ownership === 'owned' && name.startsWith(`skills/${s.name}/`)) || !this.deps.openFile) throw new Error('Only owned skill files can be edited');
        const profile = this.profile(item.profile.id);
        if (!profile.knowhow) {
          const knowhow = this.persistSkills(profile.id, this.ownSkills(profile));
          item.profile = this.deps.catalog.save({ ...profile, knowhow }, profile.id);
          this.publishCurrent(item.profile);
        }
        await this.deps.openFile(brainPath(item.root, `agents/${portableId(profile.id)}/${name}`));
      } else if (action === 'exclude') {
        if (!this.plan(key, item).items.some(i => i.id === name && !i.required)) throw new Error('Required or unknown pack item');
        if (name.startsWith('key:')) item.extraAllowed.delete(name); else item.excluded.add(name);
      } else if (action === 'allow') {
        if (name.startsWith('key:') && this.plan(key, item).items.some(i => i.id === name)) item.extraAllowed.add(name);
        else {
        const finding = item.findings.find(f => `${f.file}:${f.line ?? 0}:${f.rule}` === name);
        if (!finding || !item.files.has(finding.file)) throw new Error('Unknown guard finding');
        const hash = createHash('sha256').update(item.files.get(finding.file)!).digest('hex');
        const guards = this.deps.guards(); if (!guards.length || guards.some(g => !g)) throw new Error('Guard missing');
        for (const guard of guards) {
          const allow = path.join(path.dirname(guard!.deny), 'allow-agentpacks.txt');
          fs.appendFileSync(allow, `${finding.file} ${finding.rule} sha256:${hash}\n`);
        }
        }
      } else if (action === 'rescan') {
        item.excluded.delete(name);
        // Re-read edited owned files; shared selections stay tied to the original reviewed plan.
        const current = this.profile(item.profile.id), owned = this.ownSkills(current, true);
        if (current.knowhow && hashFiles(owned) !== current.knowhow.hash) {
          const knowhow = this.persistSkills(current.id, owned, current.knowhow.linked);
          item.profile = this.deps.catalog.save({ ...current, knowhow }, current.id);
        }
        const shared = new Set(item.manifest.skills.filter(s => s.ownership === 'shared').map(s => s.name));
        for (const file of item.skills.keys()) if (!shared.has(file.split('/')[1]!)) item.skills.delete(file);
        for (const [file, data] of owned) item.skills.set(file, data);
        item.rules = packRules(item.root);
        item.manifest.skills = [...item.manifest.skills.filter(s => s.ownership === 'shared'), ...[...new Set([...owned.keys()].map(file => file.split('/')[1]!))].map(name => ({ name, ownership: 'owned' as const, hash: hashFiles(skillFiles(owned, name)) }))];
      } else throw new Error('Invalid export action');
      await this.rebuild(item); return this.plan(key, item);
    } finally { item.busy = false; }
  }
  async export(key: string, includeStats: boolean): Promise<{ ok: true; path: string } | { ok: false; findings: PackFinding[] }> {
    if (typeof includeStats !== 'boolean') throw new Error('Invalid summary choice');
    const item = this.get(key, 'export'); item.busy = true;
    try {
      if (this.profile(item.profile.id).updatedAt !== item.profile.updatedAt || this.profile(item.profile.id).pack?.revision !== item.profile.pack?.revision) throw new Error('Role changed; plan export again');
      const freshManifest = checkedPack(JSON.parse(item.files.get('sbagent.json')!.toString()));
      delete freshManifest.stats;
      if (includeStats) {
        if (!this.deps.stats) throw new Error('Anonymous summary unavailable');
        freshManifest.stats = this.deps.stats(item.profile.id);
      }
      item.files.set('sbagent.json', Buffer.from(JSON.stringify(checkedPack(freshManifest), null, 2) + '\n'));
      item.findings = await this.scan(item, item.files);
      if (item.findings.length) return { ok: false, findings: item.findings };
      const destination = await this.deps.pickExport(item.target, item.manifest.agent.id);
      if (!destination) return { ok: false, findings: [] };
      if (item.root !== this.root() || this.profile(item.profile.id).updatedAt !== item.profile.updatedAt) throw new Error('Role changed; plan export again');
      if (item.target === 'sbagent') fs.writeFileSync(destination, writeZip(item.files));
      else { fs.mkdirSync(destination, { recursive: true }); if (fs.readdirSync(destination).length) throw new Error('Choose an empty export folder'); writePackFiles(destination, emitTarget(item.files, item.target)); }
      this.deps.catalog.packIdentity(item.profile.id, { ...item.profile.pack!, revision: item.manifest.revision });
      this.tokens.delete(key); fs.rmSync(item.staging, { recursive: true, force: true });
      return { ok: true, path: destination };
    } finally { item.busy = false; }
  }
  async importInspect(request: { pick: true } | { dropped: string }): Promise<PackImportReview | null> {
    const source = 'pick' in request && request.pick === true ? await this.deps.pickImport() : 'dropped' in request && typeof request.dropped === 'string' ? request.dropped : null;
    if (!source) return null;
    if (!path.isAbsolute(source)) throw new Error('Invalid dropped path');
    const files = readPackSource(source), inspection = inspectPack(files), item: ImportToken = { ...this.base(), kind: 'import', inspection, findings: [], collision: { kind: 'none' } };
    const key = tokenId(); this.tokens.set(key, item);
    try {
      item.findings = await this.scan(item, files);
      if (item.findings.some(secretFinding)) throw new Error('Pack contains secrets; import refused');
      const profiles = this.deps.catalog.list().profiles, manifest = inspection.manifest;
      const prior = manifest && profiles.find(p => p.pack?.id === manifest.packId);
      item.collision = prior ? { kind: manifest!.revision > prior.pack!.revision ? 'update' : 'present', agentId: prior.id } : { kind: 'none' };
      const clamps = ['Il pacchetto porta abilità e regole: il ruolo tiene le sue istruzioni, i suoi strumenti e i suoi permessi.'];
      return { token: key, kind: inspection.kind, role: manifest?.agent.role ?? null, agents: inspection.agents.map(a => ({ name: a.name, description: a.description })), skills: inspection.skills, rules: inspection.rules,
        scripts: inspection.scripts, ignored: inspection.ignored, findings: item.findings, clamps, collision: item.collision, warnings: inspection.warnings };
    } catch (e) { this.cancel(key); throw e; }
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
  /** Attaches the reviewed pack to the built-in role `roleId`: the role's know-how (its own skill and the pack's skills)
   *  changes as a trial version; the pack's shared skills and rules are written to the brain when absent. The pack's role
   *  text, tools and permissions are never applied: the role keeps its own. A pack of shared skills only installs them. */
  async importApply(key: string, approveScripts: boolean, roleId: WorkRoleId, approvePersonalData = false): Promise<AgentProfile[]> {
    if (typeof approveScripts !== 'boolean' || typeof approvePersonalData !== 'boolean' || !isWorkRole(roleId)) throw new Error('Invalid import choices');
    const item = this.get(key, 'import');
    if (item.findings.length && !approvePersonalData) throw new Error('Review personal-data findings before importing');
    item.busy = true;
    try {
      const review = item.inspection, files = approvedFiles(review, approveScripts), profiles = this.deps.catalog.list().profiles;
      if (!review.agents.length) {
        for (const name of review.skills) if (fs.existsSync(brainPath(item.root, `.agents/skills/${name}`))) throw new Error('Shared skill already exists');
        const created: string[] = [];
        this.tokens.delete(key);
        try {
        for (const name of review.skills) {
          const destination = brainPath(item.root, `.agents/skills/${name}`);
          created.push(destination);
          fs.mkdirSync(destination, { recursive: true }); writePackFiles(destination, new Map([...skillFiles(files, name)].map(([file, data]) => [file.slice(`skills/${name}/`.length), data])));
        }
        created.push(...installRules(item.root, files).created);
        } catch (e) { for (const folder of created) fs.rmSync(folder, { recursive: true, force: true }); throw e; }
        finally { fs.rmSync(item.staging, { recursive: true, force: true }); }
        return [];
      }
      const m = review.manifest, old = this.profile(roleId);
      if (item.collision.kind === 'present' && item.collision.agentId === roleId) throw new Error('This pack revision is already on the role');
      // the pack's shared skills go back to the brain's shared skills and are declared by the role (ADR 0077); its own
      // skill stays in the role's know-how snapshot
      const shared = (m?.skills ?? []).filter(s => s.ownership === 'shared' && s.name !== m!.agent.id).map(s => s.name);
      const own: PackFiles = new Map([...files].filter(([n]) => n.startsWith('skills/') && !shared.some(s => n.startsWith(`skills/${s}/`))));
      const linked = [...new Set([...(old.knowhow?.linked ?? []), ...shared])];
      const update = !!m && old.pack?.id === m.packId;
      const pack = { id: m && (update || !old.pack) ? m.packId : `${portableId(roleId)}-${randomBytes(8).toString('hex')}`, revision: m?.revision ?? 1, ...(m ? { importedFrom: m.packId } : {}) };
      const install: PackInstall = { id: roleId, knowhow: this.skillSnapshot(roleId, own, linked), pack };
      this.deps.catalog.validatePacks([install]);
      this.tokens.delete(key);
      const created: string[] = [];
      try {
        const folder = brainPath(item.root, install.knowhow.folder);
        if (!fs.existsSync(folder)) created.push(folder);
        this.persistSkills(roleId, own, linked);
        for (const name of shared) {
          const destination = brainPath(item.root, `.claude/skills/${name}`);
          if (fs.existsSync(destination)) continue; // the brain's own copy of that skill is used
          created.push(destination);
          fs.mkdirSync(destination, { recursive: true });
          writePackFiles(destination, new Map([...skillFiles(files, name)].map(([file, data]) => [file.slice(`skills/${name}/`.length), data])));
        }
        created.push(...installRules(item.root, files).created);
        const applied = this.deps.catalog.applyPacks([install]);
        for (const profile of applied) this.publishCurrent(profile, profiles.find(p => p.id === profile.id)?.knowhow?.hash);
        return applied;
      } catch (e) { for (const folder of created) fs.rmSync(folder, { recursive: true, force: true }); throw e; }
      finally { fs.rmSync(item.staging, { recursive: true, force: true }); }
    } finally { item.busy = false; }
  }
}
