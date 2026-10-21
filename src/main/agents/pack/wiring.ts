// Electron-facing pack dependencies, shared by real and isolated demo wiring. Dialogs keep output paths in main.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import type { BrainService } from '../../services';
import type { AgentCatalogService } from '../catalog';
import { AgentPackFlows } from './flows';
import { AgentPackLearning } from './learning';
import { discoverDomains, domainsOfConfig } from '../../brain/domains';
import { appScanner, findGuard, scanTree } from '../../brain/guard';
import { electronNode } from '../../brain/node';
import { readLocal } from '../local-store';
import type { AgentRun } from '../../../shared/agents';
import type { BrainShareResult } from '../../../shared/contract';
import { isWorkRole } from '../../../shared/roles';
import { buildBrainShare } from './brain-share';
import { portableId, writePackFiles } from './flows';
import { BRAIN_ZIP_LIMITS, writeZip } from './zip';
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
  const packs: AgentPackFlows = new AgentPackFlows({ catalog, brainRoot: root, version: app.getVersion(), guards, runtimeRoot: path.join(userData, 'agent-pack-runtime'),
    scan: folder => scanTree(folder, guards(), electronNode()),
    openFile: file => new Promise<void>((resolve, reject) => {
      // Never invoke a script through its shell association: this action is an editor, not an execution grant.
      if (process.platform !== 'win32') { shell.showItemInFolder(file); resolve(); return; }
      const child = spawn('notepad.exe', [file], { shell: false, detached: true, stdio: 'ignore' });
      child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
    }),
    pickImport: async () => {
      const result = await dialog.showOpenDialog({ properties: ['openFile', 'openDirectory'], filters: [{ name: 'Agent pack', extensions: ['sbagent', 'zip', 'md', 'toml'] }] });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    pickExport: async (target, name) => {
      if (target === 'sbagent') { const r = await dialog.showSaveDialog({ defaultPath: `${name}.sbagent`, filters: [{ name: 'Agent pack', extensions: ['sbagent'] }] }); return r.canceled ? null : r.filePath ?? null; }
      const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0] ?? null;
    },
    sharedSkills: () => {
      const brain = root() ?? null;
      // the app's rendered copy of its shipped skills (#146): only a brain the app made has one; a failed render is logged
      let appTools: string | null = null;
      if (brain && !demo && isProduct(brain)) {
        try { appTools = ensureTools(brain); }
        catch (e) { log.warn('agents', 'App skills not available', { cause: e instanceof Error ? e.message : String(e), hint: 'Reinstall the release: its brain template could not be rendered' }); }
      }
      return skillsIn(skillFolders({ root: brain, home: demo ? null : os.homedir(), appTools }));
    },
    stats: id => {
      const store = readLocal(path.join(userData, 'agent-runs.json')) as { runs?: AgentRun[]; rollups?: unknown[] } | undefined;
      if (store?.rollups?.length) throw new Error('Anonymous summary unavailable for compacted run history');
      const runs = (store?.runs ?? []).filter(r => r.agentId === id), profile = packs.profile(id);
      return { runs: runs.length, successHuman: runs.filter(r => r.outcome?.basis === 'human' && r.outcome.verdict === 'success').length,
        failHuman: runs.filter(r => r.outcome?.basis === 'human' && r.outcome.verdict === 'fail').length, versions: profile.version,
        monthsUsed: Math.max(0, Math.floor((Date.now() - profile.createdAt) / (30.4375 * 86400000))) };
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
  return { packs, learning, share };
}
