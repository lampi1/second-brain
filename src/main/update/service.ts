// The single staged-update transaction: public acquisition, canonical release CLI, local checkpoint and explicit UI apply.
// No renderer-provided path/URL and no activation from MCP; dependencies let unit tests prove ordering without a real update.
import type { AppUpdateState, PreparedAppUpdate } from '../../shared/app-update';
import type { AcquiredUpdate } from './download';
import type { UpdateCheckpoint } from './checkpoint';

export interface StagedUpdate { id: string; version: string; source: string; manifestSha256: string }
export interface UpdateStatus { protocol: 1 | 2; current: string | null; previous: string | null; staged: StagedUpdate[] }
export interface UpdateServiceDeps {
  running: string;
  capability: { available: boolean; reason?: string; canApply: boolean };
  status: () => Promise<UpdateStatus>;
  acquire: () => Promise<AcquiredUpdate | null>;
  discard: (candidate: AcquiredUpdate) => void;
  stage: (candidate: AcquiredUpdate) => Promise<void>;
  activate: (candidate: StagedUpdate, expectedCurrent: string) => Promise<void>;
  rollback: (expectedCurrent: string, expectedPrevious: string) => Promise<void>;
  pause: () => () => void;
  problem: () => string | null;
  checkpoint: Pick<UpdateCheckpoint, 'capture' | 'arm' | 'release'>;
  saveChats: () => void;
  flush: () => void | Promise<void>;
  restart: () => Promise<{ cancel: () => Promise<void> }>;
  quit: () => void;
  emit: (state: AppUpdateState) => void;
}
const same = (row: StagedUpdate, expected: StagedUpdate): boolean => row.id === expected.id && row.version === expected.version && row.source === expected.source && row.manifestSha256 === expected.manifestSha256;
const message = (error: unknown): string => error instanceof Error ? error.message.slice(0, 500) : 'Operazione aggiornamento non riuscita.';

export class AppUpdateService {
  private st: AppUpdateState;
  private candidate: StagedUpdate | null = null;
  private busy = false;
  private conditionalApply = false;
  constructor(private readonly d: UpdateServiceDeps) {
    this.st = { available: d.capability.available, ...(d.capability.reason ? { reason: d.capability.reason } : {}), checking: false, checkedAt: null, update: null };
  }
  state(): AppUpdateState {
    const update = this.st.update;
    return { ...this.st, update: update ? { ...update, changes: [...update.changes], blocked: update.phase === 'ready' ? (!this.conditionalApply ? 'Pacchetto preparato. Questa installazione non supporta ancora l’applicazione automatica verificata.' : this.d.problem()) : update.blocked } : null };
  }
  private push(): void { this.d.emit(this.state()); }
  private checkProblem(): void { const problem = this.d.problem(); if (problem) throw new Error(problem); }
  private async checked(expected?: StagedUpdate, applying = false): Promise<UpdateStatus> {
    const state = await this.d.status();
    if ((state.protocol !== 1 && state.protocol !== 2) || applying && state.protocol !== 2) throw new Error('Questa installazione richiede il nuovo installer per gli aggiornamenti verificati.');
    this.conditionalApply = state.protocol === 2 && this.d.capability.canApply;
    if (state.current !== this.d.running) throw new Error('La versione selezionata è cambiata: riapri l’app prima di aggiornare.');
    if (expected && !state.staged.some(row => same(row, expected))) throw new Error('Il pacchetto preparato è cambiato: non viene applicato.');
    return state;
  }

  /** Main calls this in the background only on a supported shipped release. Preparation never quits or applies. */
  async prepare(): Promise<AppUpdateState> {
    if (!this.st.available || this.busy) return this.state();
    this.busy = true; this.st.checking = true; this.push();
    let acquired: AcquiredUpdate | null = null;
    try {
      await this.checked();
      acquired = await this.d.acquire();
      if (!acquired) { this.candidate = null; this.st.update = null; }
      else {
        this.st.update = { id: acquired.id, version: acquired.version, changes: acquired.changes.split(/\r?\n/).filter(Boolean).slice(0, 12), phase: 'preparing', blocked: null }; this.push();
        await this.d.stage(acquired);
        const expected: StagedUpdate = { id: acquired.id, version: acquired.version, source: acquired.source, manifestSha256: acquired.manifestSha256 };
        await this.checked(expected);
        this.candidate = expected; this.st.update.phase = 'ready';
      }
    } catch (error) {
      this.candidate = null;
      if (this.st.update) this.st.update = { ...this.st.update, phase: 'failed', blocked: message(error) };
      else this.st.reason = message(error);
    } finally {
      // The stage child is settled before discarding the acquired extraction. Its marker owns the staged assets.
      if (acquired) { try { this.d.discard(acquired); } catch { this.st.reason = 'Pulizia del pacchetto temporaneo non riuscita; la versione in uso è conservata.'; } }
      this.busy = false; this.st.checking = false; this.st.checkedAt = Date.now(); this.push();
    }
    return this.state();
  }

  /** Only a validated renderer click invokes this. All prerequisites are rechecked after asynchronous boundaries. */
  async apply(id: unknown): Promise<AppUpdateState> {
    if (!this.st.available || !this.conditionalApply || this.busy || typeof id !== 'string' || !this.candidate || id !== this.candidate.id || this.st.update?.phase !== 'ready') throw new Error('Aggiornamento non pronto o applicazione automatica non supportata.');
    this.busy = true;
    const expected = { ...this.candidate };
    let unlock: (() => void) | undefined, restart: { cancel: () => Promise<void> } | undefined, checkpoint: string | undefined;
    let activationAttempted = false, safeToResume = false;
    try {
      unlock = this.d.pause(); this.checkProblem();
      this.st.update = { ...this.st.update, phase: 'applying', blocked: null }; this.push();
      await this.checked(expected, true); this.checkProblem();
      checkpoint = await this.d.checkpoint.capture(expected.id); this.checkProblem();
      this.d.saveChats(); await this.d.flush(); this.checkProblem();
      restart = await this.d.restart(); this.checkProblem();
      await this.checked(expected, true); this.checkProblem();
      this.d.checkpoint.arm(checkpoint);
      activationAttempted = true;
      await this.d.activate(expected, this.d.running);
      const active = await this.d.status();
      if (active.protocol !== 2 || active.current !== expected.id || active.previous !== this.d.running) throw new Error('Attivazione non confermata: il riavvio viene fermato.');
      this.checkProblem(); this.d.saveChats();
      this.st.update = { ...this.st.update, phase: 'applied' }; this.push();
      this.d.quit(); // Do not unlock editing or abort the armed recovery while this process is quitting.
      return this.state();
    } catch (error) {
      let problem = message(error);
      try {
        if (restart) await restart.cancel();
        if (activationAttempted) {
          const active = await this.d.status();
          if (active.current === expected.id) {
            if (active.previous !== this.d.running) throw new Error('Versione precedente cambiata: ripristino automatico fermato.');
            await this.d.rollback(expected.id, this.d.running);
            const restored = await this.d.status();
            if (restored.current !== this.d.running) throw new Error('Ripristino non confermato.');
          }
          // A different external selection is never blindly swapped or overwritten here.
        }
        this.d.checkpoint.release(checkpoint);
        safeToResume = true;
      } catch (cleanupError) { problem = `${problem} ${message(cleanupError)} Il lavoro resta protetto nella finestra aperta.`; }
      this.st.update = { ...(this.st.update as PreparedAppUpdate), phase: 'failed', blocked: problem }; this.push();
      throw new Error(problem);
    } finally {
      if (safeToResume) unlock?.();
      this.busy = false;
    }
  }
}
