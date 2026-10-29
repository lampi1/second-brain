// Binds the private checkpoint and canonical release CLI to renderer-only update channels.
// The cooperative writer is wired, but application stays disabled until the real restart lifecycle is verified.
import fs from 'node:fs';
import path from 'node:path';
import type { AppUpdateState, UpdateCheckpointAnswer, UpdateRecovery } from '../../shared/app-update';
import type { Emitter } from '../ipc';
import { electronNode, runNode } from '../brain/node';
import { sharedDir } from '../platform';
import { UpdateAcquirer } from './download';
import { UpdateCheckpoint } from './checkpoint';
import { AppUpdateService } from './service';
import { parseUpdateStatus, updateApplyArgs, updateRollbackArgs } from './protocol';
import { updateActivity } from './activity';
import { prepareUpdateRestart } from './restart';

interface UpdateWiring {
  appPath: string; userData: string; running: string | null; version: string; disabled: boolean; emitter: Emitter;
  problem: () => string | null; saveChats: () => void; flush: () => void; quit: () => void;
}
export interface AppUpdates {
  state(): AppUpdateState; prepare(): Promise<AppUpdateState>; apply(id: unknown): Promise<AppUpdateState>;
  answer(value: UpdateCheckpointAnswer): void; recovery(): UpdateRecovery | null; acknowledge(id: string): void;
}
const SHA = /^[a-f0-9]{64}$/;
const samePath = (a: string, b: string): boolean => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
// Isolated helper9106134 restart/cancel are verified (lxnHvi/jmiJIs). This integration gate remains false until
// cockpit quit/jobguard, real quiescence/abort, conditional activation, recovery adoption and installed smoke pass.
// See docs/update-integration-evidence.md. It is not a user preference or environment bypass.
const RESTART_LIFECYCLE_VERIFIED = false;

export function createAppUpdates(d: UpdateWiring): AppUpdates {
  const base = path.resolve(process.env.SB_RELEASES_ROOT ?? sharedDir());
  let capability: { available: boolean; reason?: string; canApply: boolean } = { available: false, canApply: false, reason: 'Aggiornamenti preparati disponibili nella versione Windows installata.' };
  try {
    if (!d.disabled && process.platform === 'win32' && d.running && !d.running.includes('-draft-') && !fs.existsSync(path.join(d.appPath, '.git'))) {
      const appPath = fs.realpathSync.native(d.appPath), root = fs.realpathSync.native(base);
      const release = JSON.parse(fs.readFileSync(path.join(appPath, 'release.json'), 'utf8')) as { id?: string; version?: string; repo?: unknown; templateManifestSha256?: string };
      if (!samePath(root, base) || !samePath(appPath, path.join(root, 'releases', d.running)) || release.id !== d.running || release.version !== d.version || release.repo || !SHA.test(release.templateManifestSha256 ?? '') || !fs.lstatSync(path.join(root, 'release.mjs')).isFile()) throw new Error('Installazione non compatibile con il nuovo updater.');
      capability = { available: true, canApply: RESTART_LIFECYCLE_VERIFIED };
    }
  } catch { capability = { available: false, canApply: false, reason: 'Installa la versione Windows con il nuovo updater verificato.' }; }
  let checkpoint: UpdateCheckpoint;
  try { checkpoint = new UpdateCheckpoint({ userData: d.userData, running: d.running ?? 'dev', request: value => d.emitter.emit('update:checkpointRequest', value), release: value => d.emitter.emit('update:checkpointRelease', value) }); }
  catch {
    const reason = 'Il recupero locale non è leggibile. Il file originale è conservato; aggiornamento fermato.';
    const state: AppUpdateState = { available: false, reason, checking: false, checkedAt: null, update: null };
    const fail = (): never => { throw new Error(reason); };
    return { state: () => state, prepare: async () => state, apply: async () => fail(), answer: fail, recovery: fail, acknowledge: fail };
  }
  const node = electronNode(), script = path.join(base, 'release.mjs');
  const cli = async (args: string[], timeout = 60_000): Promise<string> => {
    const result = await runNode({ ...node, env: { ...node.env, SB_RELEASES_ROOT: base } }, script, args, base, timeout);
    if (result.code !== 0) throw new Error('Verifica del servizio aggiornamenti non riuscita. La versione aperta è conservata.');
    return result.stdout.trim();
  };
  const acquirer = new UpdateAcquirer({ cacheRoot: path.join(d.userData, 'update-cache') });
  const service = new AppUpdateService({ running: d.running ?? 'dev', capability,
    status: async () => parseUpdateStatus(await cli(['status', '--json']), base),
    acquire: () => acquirer.prepareLatest(d.version), discard: candidate => acquirer.discard(candidate),
    stage: async candidate => { await cli(['stage-update', candidate.payloadDir, candidate.manifestSha256], 300_000); },
    activate: async (candidate,expectedCurrent) => { await cli(updateApplyArgs(candidate,expectedCurrent)); },
    rollback: async (expectedTarget,expectedPrevious) => { await cli(updateRollbackArgs(expectedTarget,expectedPrevious)); },
    pause: () => updateActivity.acquire(), problem: d.problem, checkpoint, saveChats: d.saveChats, flush: d.flush,
    restart: () => prepareUpdateRestart({ base, pid: process.pid }), quit: d.quit, emit: state => d.emitter.emit('update:state', state),
  });
  return { state: () => service.state(), prepare: () => service.prepare(), apply: id => service.apply(id), answer: value => checkpoint.answer(value), recovery: () => checkpoint.recovery(), acknowledge: id => checkpoint.acknowledge(id) };
}
