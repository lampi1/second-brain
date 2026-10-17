// Main-owned renderer checkpoint handshake and private restart/rollback recovery. No activation or download here.
// Only the typed app-page IPC may answer; capture fails closed on stale ACKs, unsafe data, timeout or disk errors.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { UPDATE_CHECKPOINT_MAX_BYTES, UPDATE_SNAPSHOT_KEYS, type UpdateCheckpointAnswer, type UpdateCheckpointRequest, type UpdateRecovery, type UpdateSnapshot } from '../../shared/app-update';
import { readLocal } from '../agents/local-store';

interface SavedCheckpoint { version: 1; id: string; from: string; target: string; phase: 'captured' | 'armed' | 'aborted'; adopted: string[]; snapshot: UpdateSnapshot }
interface CheckpointDeps {
  userData: string; running: string;
  request: (value: UpdateCheckpointRequest) => void;
  release: (value: { requestId: string }) => void;
  timeoutMs?: number;
}
const identity = (x: unknown): x is string => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(x);
const uuid = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
function snapshot(value: unknown): UpdateSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Checkpoint non valido.');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== UPDATE_SNAPSHOT_KEYS.length || !UPDATE_SNAPSHOT_KEYS.every(k => Object.hasOwn(row, k) && typeof row[k] === 'string')) throw new Error('Il checkpoint contiene dati non previsti.');
  const copy = {} as UpdateSnapshot;
  let rawBytes = 0;
  for (const k of UPDATE_SNAPSHOT_KEYS) {
    rawBytes += Buffer.byteLength(row[k] as string, 'utf8');
    if (rawBytes > UPDATE_CHECKPOINT_MAX_BYTES) throw new Error('Checkpoint oltre 8 MB: il lavoro resta nella versione aperta.');
    copy[k] = row[k] as string;
  }
  if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > UPDATE_CHECKPOINT_MAX_BYTES) throw new Error('Checkpoint oltre 8 MB: il lavoro resta nella versione aperta.');
  for (const k of UPDATE_SNAPSHOT_KEYS) JSON.parse(copy[k]);
  return copy;
}
function saved(value: unknown): SavedCheckpoint | null {
  if (value === undefined) return null;
  const row = value as Partial<SavedCheckpoint> | null;
  if (!row || row.version !== 1 || !uuid(row.id) || !identity(row.from) || !identity(row.target) || !['captured', 'armed', 'aborted'].includes(row.phase ?? '') || !Array.isArray(row.adopted) || row.adopted.length > 2 || !row.adopted.every(id => id === row.from || id === row.target)) throw new Error('Recupero aggiornamento non valido: originale conservato.');
  return { version: 1, id: row.id, from: row.from, target: row.target, phase: row.phase!, adopted: [...row.adopted], snapshot: snapshot(row.snapshot) };
}

export class UpdateCheckpoint {
  private readonly file: string;
  private record: SavedCheckpoint | null;
  private inherited = true;
  private issuedRecovery: string | null = null;
  private pending: { id: string; resolve: (value: UpdateSnapshot) => void; reject: (error: Error) => void } | null = null;
  private held: string | null = null;
  constructor(private readonly d: CheckpointDeps) {
    if (!identity(d.running)) throw new Error('Versione in uso non valida.');
    this.file = path.join(d.userData, 'update-checkpoint.json');
    this.record = saved(readLocal(this.file));
  }

  /** Call only after main quiescence; the renderer stays frozen until release() even after a valid ACK. */
  async capture(target: string): Promise<string> {
    if (!identity(target) || target === this.d.running) throw new Error('Versione destinazione non valida.');
    if (this.held) throw new Error('Un salvataggio aggiornamento è già in corso.');
    if (this.inherited && this.record?.phase === 'armed' && !this.record.adopted.includes(this.d.running)) throw new Error('Completa prima il recupero del lavoro precedente.');
    const id = randomUUID(); this.held = id;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const data = await new Promise<UpdateSnapshot>((resolve, reject) => {
        this.pending = { id, resolve, reject };
        timer = setTimeout(() => reject(new Error('La finestra non ha confermato il salvataggio: aggiornamento fermato.')), this.d.timeoutMs ?? 20_000);
        this.d.request({ requestId: id, maxBytes: UPDATE_CHECKPOINT_MAX_BYTES });
      });
      if (this.held !== id) throw new Error('Salvataggio annullato prima della scrittura.');
      const record: SavedCheckpoint = { version: 1, id, from: this.d.running, target, phase: 'captured', adopted: [], snapshot: data };
      // Adoption metadata for both the new and rollback releases must fit before accepting the snapshot.
      if (Buffer.byteLength(JSON.stringify({ ...record, adopted: [record.from, record.target] }), 'utf8') > UPDATE_CHECKPOINT_MAX_BYTES) throw new Error('Checkpoint oltre 8 MB con i dati di recupero: aggiornamento fermato.');
      this.persist(record);
      this.inherited = false;
      return id;
    } catch (error) { this.release(id); throw error; }
    finally { if (timer) clearTimeout(timer); if (this.pending?.id === id) this.pending = null; }
  }

  answer(answer: UpdateCheckpointAnswer): void {
    const pending = this.pending;
    if (!answer || !pending || answer.requestId !== pending.id) throw new Error('Conferma di salvataggio scaduta.');
    // Consume exactly once, including malformed snapshots; a second response cannot replace already captured data.
    this.pending = null;
    try {
      if ('problem' in answer) throw new Error(typeof answer.problem === 'string' ? answer.problem.slice(0, 500) : 'Salvataggio finestra non riuscito.');
      pending.resolve(snapshot(answer.snapshot));
    } catch (error) { pending.reject(error instanceof Error ? error : new Error('Checkpoint non valido.')); }
  }

  release(requestId?: string): void {
    const id = this.held;
    if (!id || (requestId !== undefined && requestId !== id)) return;
    // The user may edit again after Release. This older attempt must never be offered as automatic recovery.
    if (this.record?.id === id && this.record.phase !== 'aborted') this.persist({ ...this.record, phase: 'aborted' });
    this.pending?.reject(new Error('Salvataggio annullato.')); this.pending = null; this.held = null;
    this.d.release({ requestId: id });
  }

  recovery(): UpdateRecovery | null {
    const row = this.record;
    if (!row || row.phase !== 'armed' || row.adopted.includes(this.d.running)) return null;
    if (this.d.running !== row.target && this.d.running !== row.from) throw new Error('Il recupero appartiene a un’altra versione.');
    this.issuedRecovery = row.id;
    return { id: row.id, snapshot: { ...row.snapshot } };
  }

  acknowledge(id: string): void {
    const row = this.record;
    if (row?.phase === 'armed' && id === row.id && row.adopted.includes(this.d.running)) return;
    if (!row || row.phase !== 'armed' || id !== row.id || id !== this.issuedRecovery) throw new Error('Recupero non richiesto o scaduto.');
    this.persist({ ...row, adopted: [...new Set([...row.adopted, this.d.running])] });
    this.issuedRecovery = null;
    // Keep the snapshot: the previous release may need it on rollback. Never delete it merely on recovery:get.
  }

  /** Main arms only immediately before the validated activation/restart transaction. Success never unlocks editing. */
  arm(id: string): void {
    if (this.held !== id || this.record?.id !== id || this.record.phase !== 'captured') throw new Error('Checkpoint non pronto per il riavvio.');
    this.persist({ ...this.record, phase: 'armed' });
  }

  private persist(row: SavedCheckpoint): void {
    const body = JSON.stringify(row);
    if (Buffer.byteLength(body, 'utf8') > UPDATE_CHECKPOINT_MAX_BYTES) throw new Error('Checkpoint oltre 8 MB: aggiornamento fermato.');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    try { const stat = fs.lstatSync(this.file); if (!stat.isFile() || stat.nlink !== 1 || stat.isSymbolicLink()) throw new Error('Archivio recupero collegato: scrittura rifiutata.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      fd = fs.openSync(tmp, 'wx', 0o600); fs.writeFileSync(fd, body, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(tmp, this.file);
      if (fs.readFileSync(this.file, 'utf8') !== body) throw new Error('Verifica del salvataggio non riuscita.');
      this.record = row;
    } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(tmp); } catch { /* renamed or not created */ } }
  }
}
