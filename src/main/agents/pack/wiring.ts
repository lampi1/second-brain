// Electron-facing pack dependencies, shared by real and isolated demo wiring. Dialogs keep output paths in main.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { app, dialog, shell } from 'electron';
import { spawn } from 'node:child_process';
import type { BrainService } from '../../services';
import type { AgentCatalogService } from '../catalog';
import { AgentPackFlows } from './flows';
import { presetSkills } from './read';
import { AgentPackLearning } from './learning';
import { discoverDomains, domainsOfConfig } from '../../brain/domains';
import { appScanner, findGuard, scanTree } from '../../brain/guard';
import { electronNode } from '../../brain/node';
import { readLocal } from '../local-store';
import type { AgentRun } from '../../../shared/agents';

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
    presetSkills: id => presetSkills(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agent-presets'), id),
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
      const dirs = [root() && path.join(root()!, '.agents/skills'), root() && path.join(root()!, '.claude/skills'), !demo && path.join(os.homedir(), '.agents/skills'), !demo && path.join(os.homedir(), '.claude/skills')].filter((p): p is string => !!p);
      const found = new Map<string, { name: string; folder: string }>();
      for (const folder of dirs) if (fs.existsSync(folder)) for (const name of fs.readdirSync(folder)) {
        if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && !found.has(name) && fs.existsSync(path.join(folder, name, 'SKILL.md'))) found.set(name, { name, folder: path.join(folder, name) });
      }
      return [...found.values()];
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
  // Every version change that swaps the know-how (IPC restore, trial decisions, the Orchestrator's rollback) republishes it.
  catalog.onKnowhowChange((profile, previousHash) => packs.publishCurrent(profile, previousHash));
  const learning = new AgentPackLearning(packs, userData);
  return { packs, learning };
}
