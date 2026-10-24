// Electron-facing know-how dependencies, shared by real and isolated demo wiring: the roles' runtime skills and know-how
// (pack/flows.ts), the lessons queue (pack/learning.ts) and the shareable brain zip (brain:share, ADR 0088). The agent
// pack import/export is gone (ADR 0125). Dialogs keep output paths in main.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dialog } from 'electron';
import type { BrainService } from '../../services';
import type { AgentCatalogService } from '../catalog';
import { AgentPackFlows } from './flows';
import { AgentPackLearning } from './learning';
import { discoverDomains, domainsOfConfig } from '../../brain/domains';
import { appScanner, findGuard, scanTree } from '../../brain/guard';
import { electronNode } from '../../brain/node';
import type { BrainShareResult, RoutineImportPreview, RoutinePackageResult, RoutinePackageSummary } from '../../../shared/contract';
import type { FlowDefinition } from '../../../shared/flows';
import { isWorkRole } from '../../../shared/roles';
import { buildBrainShare } from './brain-share';
import { brainPath, portableId, writePackFiles } from './flows';
import { applyImport, buildRoutinePackage, parsePackage, previewImport, readSkills, routineRoles, routineSkills, type ImportProbe, type ImportWriter, type RoutinePackageInput } from './routine-share';
import { BRAIN_ZIP_LIMITS, readZip, writeZip } from './zip';
import { log } from '../../log';
import { ensureTools, isProduct } from '../../rules/tools';
import { skillFolders, skillsIn } from './shared-skills';

export function createAgentPacks(userData: string, brain: BrainService, catalog: AgentCatalogService, demo = false) {
  const demoRoot = path.join(userData, 'demo-agent-brain');
  if (demo) fs.mkdirSync(demoRoot, { recursive: true });
  const demoDeny = path.join(userData, 'demo-agent-deny.txt');
  if (demo && (!fs.existsSync(demoDeny) || !fs.readFileSync(demoDeny, 'utf8').trim())) fs.writeFileSync(demoDeny, 'sb-demo-private-marker\n');
  const root = () => demo ? demoRoot : brain.info().brainRoot;
  const guards = () => demo ? [{ scan: appScanner()!, deny: demoDeny, allow: path.join(userData, 'allow-agentpacks.txt') }] : discoverDomains(root(), domainsOfConfig(brain.settings())).domains.map(domain => {
    const guard = findGuard(domain.denyList);
    return guard ? { ...guard, allow: path.join(path.dirname(guard.deny), 'allow-agentpacks.txt') } : null;
  });
  let toolsCache: { root: string; dir: string; at: number } | null = null;
  const packs: AgentPackFlows = new AgentPackFlows({ catalog, brainRoot: root, runtimeRoot: path.join(userData, 'agent-pack-runtime'),
    sharedSkills: () => {
      const brain = root() ?? null;
      // the app's rendered copy of its shipped skills (#146): only a brain the app made has one; a failed render is logged
      let appTools: string | null = null;
      if (brain && !demo && isProduct(brain)) {
        // rendered once per brain and minute: ensureTools hashes every template file, and roles start often
        const cached = toolsCache?.root === brain && Date.now() - toolsCache.at < 60_000 ? toolsCache.dir : null;
        try { appTools = cached ?? ensureTools(brain); if (!cached) toolsCache = { root: brain, dir: appTools, at: Date.now() }; }
        catch (e) { log.warn('agents', 'App skills not available', { cause: e instanceof Error ? e.message : String(e), hint: 'Reinstall the release: its brain template could not be rendered' }); }
      }
      return skillsIn(skillFolders({ root: brain, home: demo ? null : os.homedir(), appTools }));
    },
  });
  // Every version change that swaps the know-how (a restore, a trial decision, an Annulla) republishes it.
  catalog.onKnowhowChange((profile, previousHash) => packs.publishCurrent(profile, previousHash));
  const learning = new AgentPackLearning(packs, userData);
  /** The shareable brain zip (brain-share.ts, ADR 0088): built, guard-scanned, then saved where the user picks. */
  const share = async (): Promise<BrainShareResult | null> => {
    let brainRoot: string;
    try { brainRoot = packs.root(); } catch { return { ok: false, error: 'Collega prima la cartella del brain.' }; }
    const roles = catalog.list().profiles.filter(p => isWorkRole(p.id)).map(profile => {
      let own = new Map<string, Buffer>();
      try { if (profile.knowhow) own = packs.ownSkills(profile, true); } catch { /* unreadable know-how: the role goes without it */ }
      return { profile, skillName: portableId(profile.id), own };
    });
    const name = path.basename(brainRoot), date = new Date().toISOString().slice(0, 10);
    let built: ReturnType<typeof buildBrainShare>, zip: Buffer;
    try { built = buildBrainShare({ root: brainRoot, name, date, roles }); zip = writeZip(built.files, BRAIN_ZIP_LIMITS); }
    catch (e) {
      log.warn('brain', 'Shareable brain not built', { cause: e instanceof Error ? e.message : String(e), hint: 'Too many files, or a file name the zip refuses: check the brain skills and scripts' });
      return { ok: false, error: 'Lo zip non si può creare: il brain ha troppi file o un nome di file non valido. Dettagli nei log.' };
    }
    const { files, summary } = built;
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-brain-share-'));
    try {
      writePackFiles(staging, files);
      const result = await scanTree(staging, guards(), electronNode());
      if (!result.ok) return 'findings' in result ? { ok: false, findings: result.findings } : { ok: false, error: 'missing' in result ? result.missing : result.error };
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
    const picked = await dialog.showSaveDialog({ defaultPath: `${name}-condiviso-${date}.zip`, filters: [{ name: 'Zip', extensions: ['zip'] }] });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, zip);
    return { ok: true, path: picked.filePath, skills: summary.skills.length, rules: summary.rules.length, roles: summary.roles.length, scripts: summary.scripts.length, skipped: summary.skipped.length };
  };
  /** Guard-scans files in a temp folder (the same scan as the shared brain); null = clean. */
  const scan = async (files: Map<string, Buffer>): Promise<Exclude<RoutinePackageResult, { ok: true }> | null> => {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-routine-share-'));
    try {
      writePackFiles(staging, files);
      const result = await scanTree(staging, guards(), electronNode());
      return result.ok ? null : 'findings' in result ? { ok: false, findings: result.findings } : { ok: false, error: 'missing' in result ? result.missing : result.error };
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  };
  /** The routine package (routine-share.ts, ADR 0156): its roles, their skills and memory, what the steps cite. */
  const routineInput = (definition: FlowDefinition, version: number, flowJson: string, memory: boolean): RoutinePackageInput => {
    const brainRoot = packs.root(), wanted = routineRoles(definition), skipped: string[] = [];
    const roles = catalog.list().profiles.filter(p => isWorkRole(p.id) && wanted.includes(portableId(p.id))).map(profile => {
      let own = new Map<string, Buffer>();
      try { if (profile.knowhow) own = packs.ownSkills(profile, true); } catch { /* unreadable know-how: the role goes without it */ }
      let text: string | null = null;
      try { text = fs.readFileSync(brainPath(brainRoot, `agents/${portableId(profile.id)}/memory.md`), 'utf8'); } catch { /* no memory yet */ }
      return { role: { profile, skillName: portableId(profile.id), own }, memory: text };
    });
    const found = packs.deps.sharedSkills?.() ?? [];
    const skills = readSkills(found, routineSkills(definition, roles.map(r => r.role), found.map(f => f.name)), skipped);
    return { root: brainRoot, brainName: path.basename(brainRoot), date: new Date().toISOString().slice(0, 10), definition, version, flowJson, roles, skills, memory };
  };
  const routine = {
    preview: (definition: FlowDefinition, version: number, flowJson: string): RoutinePackageSummary => buildRoutinePackage(routineInput(definition, version, flowJson, true)).summary,
    export: async (definition: FlowDefinition, version: number, flowJson: string, memory: boolean): Promise<RoutinePackageResult | null> => {
      let built: ReturnType<typeof buildRoutinePackage>, zip: Buffer;
      try { built = buildRoutinePackage(routineInput(definition, version, flowJson, memory)); zip = writeZip(built.files, BRAIN_ZIP_LIMITS); }
      catch (e) {
        log.warn('flows', 'Routine package not built', { cause: e instanceof Error ? e.message : String(e), hint: 'Too many or too big files cited by the steps, or a file name the zip refuses' });
        return { ok: false, error: 'Il pacchetto non si può creare: troppi file citati, o un nome di file non valido. Dettagli nei log.' };
      }
      const findings = await scan(built.files);
      if (findings) return findings;
      const picked = await dialog.showSaveDialog({ defaultPath: `${definition.id}-v${version}.zip`, filters: [{ name: 'Zip', extensions: ['zip'] }] });
      if (picked.canceled || !picked.filePath) return null;
      fs.writeFileSync(picked.filePath, zip);
      return { ok: true, path: picked.filePath, summary: built.summary };
    },
    probe: (): ImportProbe => {
      const brainRoot = packs.root(), found = packs.deps.sharedSkills?.() ?? [], base = fs.realpathSync(brainRoot);
      return { root: brainRoot, skill: name => { const hit = found.find(s => s.name === name); return hit ? { folder: hit.folder, inBrain: path.resolve(hit.folder).startsWith(base + path.sep) } : null; } };
    },
    read: (data: string) => parsePackage(readZip(Buffer.from(data, 'base64'), BRAIN_ZIP_LIMITS)),
    inspect: (data: string): RoutineImportPreview => previewImport(routine.read(data), routine.probe()),
    apply: (data: string, digest: string, keys: string[], memory: boolean, writer: ImportWriter, propose: (flowJson: string) => void) => {
      const pkg = routine.read(data);
      if (pkg.digest !== digest) throw new Error('Il pacchetto è cambiato: riaprilo.');
      propose(pkg.flowJson);
      return applyImport(pkg, routine.probe(), keys, memory, writer, pkg.manifest.title);
    },
  };
  return { packs, learning, share, routine };
}
