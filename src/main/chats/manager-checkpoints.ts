// ChatManager layer (ADR 0200): checkpoints and receipts. The files before each turn of a work chat in a git
// repository (checkpoints.ts, ADR 0103), the turn's changed files as the run's receipts (agents/receipts.ts, ADR 0130),
// and «Annulla turno» (undoTurn). A checkpoint may run alongside its turn (ADR 0228): the engine's writing tools wait
// for it (write-barrier.ts), and everything here that reads the turn's checkpoint waits for it first.
import path from 'node:path';
import type { ChatItem } from '../../shared/contract';
import { errText, log } from '../log';
import type { AgentRun } from '../../shared/agents';
import { afterTree, KEEP as CHECKPOINTS_KEPT, prune as pruneCheckpoints, restore as restoreCheckpoint, snapshot as takeCheckpoint, turnFiles } from './checkpoints';
import { emptyReceipts, noteTool, noteTurnFiles, receiptVerdict, rowChanges, turnFilesWithoutGit } from '../agents/receipts';
import type { Checkpoint } from './checkpoints';
import type { Rec } from './manager-types';
import { sysItem } from './manager-helpers';
import { ManagerSessions } from './manager-sessions';

/** ADR 0228: a turn's checkpoint not in this long after it was asked for (waiting for the previous turn's included) is
 *  given up (that turn cannot be undone, as when git fails); below the write barrier's CLI hook timeout (claude.ts
 *  WRITE_BARRIER_TIMEOUT_S), so a held write never runs before the barrier opens. */
export const CHECKPOINT_DEADLINE_MS = 45_000;

/** the turn (Rec.checkpointSeq) each checkpoint belongs to: a turn's end and receipts read only their own */
const turnOf = new WeakMap<Checkpoint, number>();

/** ADR 0103 checkpoints before each turn and the run's receipts (ADR 0130); undo of the last turn. */
export abstract class ManagerCheckpoints extends ManagerSessions {

  /** Records the chat's files before a turn (checkpoints.ts); a folder outside git is asked once, a failure never holds
   *  the message. Settles (never rejects) once the snapshot is in, failed or was given up (CHECKPOINT_DEADLINE_MS); a
   *  snapshot starts only after the previous one settled, so the list stays in turn order (ADR 0228). */
  protected checkpoint(r: Rec): Promise<void> {
    // the previous snapshot, and the previous turn's end still being read: this turn's writes never reach that record
    const prev = r.checkpointPending || r.afterPending ? Promise.all([r.checkpointPending, r.afterPending]) : undefined;
    const seq = r.checkpointSeq = (r.checkpointSeq ?? 0) + 1;
    const limit = this.opts.checkpointDeadlineMs ?? CHECKPOINT_DEADLINE_MS;
    let timer: NodeJS.Timeout | undefined;
    // one clock from now, the wait for the previous snapshot included: the barrier never stays shut past it
    const late = new Promise<'late'>(resolve => { timer = setTimeout(() => resolve('late'), limit); });
    const p: Promise<void> = (async () => {
      if (prev && await Promise.race([prev.then(() => 'in' as const), late]) === 'late') return this.givenUp(r, limit, 'the previous turn’s snapshot is still running');
      await this.takeTurnCheckpoint(r, seq, late, limit);
    })().finally(() => { clearTimeout(timer); if (r.checkpointPending === p) r.checkpointPending = undefined; });
    r.checkpointPending = p;
    return p;
  }

  private givenUp(r: Rec, limit: number, why: string): void {
    log.warn('chats', 'checkpoint before the turn given up: git too slow', { chat: r.s.id, cause: `no snapshot ${limit} ms after the turn asked for it: ${why}`, hint: 'this turn cannot be undone from the app; its held writes go on now' });
  }

  private async takeTurnCheckpoint(r: Rec, seq: number, late: Promise<'late'>, limit: number): Promise<void> {
    if (r.gitRoot === null) return;
    const t0 = Date.now();
    const snap = takeCheckpoint(r.s.cwd, `refs/sb/checkpoints/${r.s.id}/${Date.now()}`);
    try {
      const cp = await Promise.race([snap, late]);
      if (cp === 'late') {
        snap.catch(() => {}); // its ref, if it ever lands, is pruned with the others; it is never this turn's checkpoint
        return this.givenUp(r, limit, 'git did not finish');
      }
      if (!cp) { r.gitRoot = null; return; }
      r.gitRoot = cp.root;
      // a newer turn's checkpoint already in (the next turn stopped waiting for this one): out of order, dropped.
      // Defensive: with one constant deadline a turn's snapshot always settles before the next turn's deadline.
      const newest = r.checkpoints?.at(-1);
      if (newest && (turnOf.get(newest) ?? 0) > seq) return;
      turnOf.set(cp, seq);
      // a snapshot that landed after a newer turn began is still its own turn's, never the newer turn's
      if (seq === r.checkpointSeq) r.turnCheckpoint = true;
      log.info('chats', 'timing: checkpoint', { chat: r.s.id, data: { ms: Date.now() - t0 } });
      const list = r.checkpoints ??= [];
      list.push(cp);
      if (list.length > CHECKPOINTS_KEPT) list.shift();
      r.s.checkpointAt = cp.at;
      this.updated(r);
      void pruneCheckpoints(cp.root, `refs/sb/checkpoints/${r.s.id}/`).catch(() => {});
    } catch (e) {
      log.warn('chats', 'checkpoint before the turn not taken', { chat: r.s.id, cause: errText(e), hint: 'this turn cannot be undone from the app; git itself still has the committed work' });
    }
  }

  /** «Annulla l'ultimo turno» (ADR 0103): the files back as they were before the chat's last turn. Never while it works. */
  /** The files when the turn ended (Checkpoint.after): the undo puts back only what this turn changed. */
  protected recordTurnEnd(r: Rec): void {
    // bound to this turn's own checkpoint: a turn whose snapshot was given up records nothing on the one before
    const seq = r.checkpointSeq;
    const record = (): Promise<void> | undefined => {
      const cp = r.checkpoints?.at(-1);
      return cp && !cp.after && turnOf.get(cp) === seq ? afterTree(cp.root).then(tree => { if (tree) cp.after = tree; }) : undefined;
    };
    // a turn that ended before its snapshot landed (no writing tool ran: they wait for it): its end is recorded after
    // it; every turn end is recorded in order, none is dropped while an earlier one is still being read
    const before = r.afterPending, pending = r.checkpointPending;
    if (!before && !pending) { const p = record(); if (p) this.trackAfter(r, p); return; }
    this.trackAfter(r, (async () => { await before; await pending; await record(); })());
  }
  private trackAfter(r: Rec, p: Promise<void>): void {
    const after: Promise<void> = p.catch(() => {}).finally(() => { if (r.afterPending === after) r.afterPending = undefined; });
    r.afterPending = after;
  }

  /** A finished tool row of the open run (or of the turn it ended in) goes into its receipts (agents/receipts.ts,
   *  ADR 0130): a command and its exit code, an edit, a PR. Each row once. */
  protected noteReceipt(r: Rec, item: Extract<ChatItem, { kind: 'tool' }>): void {
    const run = r.s.run!;
    if (item.status === 'running' || run.source === 'oneshot' || (run.endedAt !== undefined && (r.turnAt === undefined || run.endedAt < r.turnAt))) return;
    const seen = r.receiptRows ??= new Set();
    if (seen.has(item.id) || !noteTool(run.receipts ??= emptyReceipts(), item)) return;
    seen.add(item.id);
    // the turn's own record of its changes, for a turn without a checkpoint (receiptTurn)
    const ch = rowChanges(item), turn = r.receiptTurn ??= { files: [], mayWrite: false };
    const inCwd = (f: string): string => { const rel = path.relative(r.s.cwd, path.resolve(r.s.cwd, f)); return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.replace(/\\/g, '/') : f; };
    if (turn.files.length < 200) turn.files.push(...ch.files.slice(0, 200 - turn.files.length).map(inCwd));
    if (ch.mayWrite) turn.mayWrite = true;
    if (seen.size > 500) seen.delete(seen.values().next().value!);
    this.runs.touch();
  }
  /** A turn of the run ended: the files it changed go into the receipts once git recorded its end (recordTurnEnd); a
   *  turn without its own checkpoint is a gap (files unknown). An ended run gets its verdict once they are in. */
  protected receiptTurn(r: Rec, turnAt: number | undefined, end: number, seq?: number, rows?: Rec['receiptTurn']): void {
    // its snapshot still running (ADR 0228): read once it settled, with this turn's own rows (a newer turn fills its own)
    const pending = r.checkpointPending;
    if (seq === undefined && pending) {
      const at = r.checkpointSeq ?? 0, mine = r.receiptTurn ?? { files: [], mayWrite: false };
      r.receiptTurn = undefined;
      void pending.then(() => this.receiptTurn(r, turnAt, end, at, mine));
      return;
    }
    const run = r.s.run;
    if (!run || run.source === 'oneshot' || (run.endedAt !== undefined && (turnAt === undefined || run.endedAt < turnAt))) return;
    const rc = run.receipts ??= emptyReceipts(), cp = r.checkpoints?.at(-1), turn = rows ?? r.receiptTurn ?? { files: [], mayWrite: false };
    if (!rows) r.receiptTurn = undefined;
    const own = seq === undefined ? !!r.turnCheckpoint : !!cp && turnOf.get(cp) === seq;
    if (!own || !cp || r.receiptCp === cp) { noteTurnFiles(rc, turnFilesWithoutGit(turn), turnAt ?? end, end); this.receiptsIn(r, run); return; }
    r.receiptCp = cp; r.receiptsBusy = true;
    void (async () => {
      let files: string[] | null = null;
      try { await r.afterPending; if (cp.after) files = await turnFiles(cp); } catch (e) { log.debug('chats', 'turn files not read for the receipts', { chat: r.s.id, data: errText(e) }); }
      noteTurnFiles(rc, files, cp.at, end);
      r.receiptsBusy = false;
      this.receiptsIn(r, run);
    })();
  }
  private receiptsIn(r: Rec, run: AgentRun): void {
    if (run.endedAt !== undefined && !r.receiptsBusy) this.settleReceipts(run); else this.runs.touch();
  }
  /** The run's deterministic verdict at its end (receipts.ts receiptVerdict), once. */
  protected override settleReceipts(run: AgentRun): void {
    const rc = run.receipts;
    if (!rc || rc.verdict) return;
    rc.verdict = { ...receiptVerdict({ receipts: rc, ...(run.report ? { report: run.report } : {}), doneWhen: run.taskContract?.doneWhen ?? [] }), at: Date.now() };
    this.runSave();
  }

  async undoTurn(chatId: string): Promise<{ restored: number; removed: number }> {
    const r = this.need(chatId);
    await r.checkpointPending; // ADR 0228: the last turn's snapshot may still be landing
    if (this.midTurn(r) || r.pending.size > 0) throw new Error('La chat sta lavorando: fermala prima di annullare il suo ultimo turno.');
    if (this.unsettledChildren(r)) throw new Error('Le chat che questa ha avviato lavorano ancora: aspetta che finiscano prima di annullare il turno.');
    const cp = r.checkpoints?.at(-1);
    if (!cp) throw new Error('Niente da annullare: questa chat non lavora in un repository git, o non ha ancora fatto un turno da quando l’app è aperta.');
    // another chat working in the same repository now: its files would move under it
    for (const o of this.chats.values()) if (o !== r && o.gitRoot === cp.root && this.midTurn(o)) throw new Error(`«${o.s.title}» sta lavorando nella stessa cartella: aspetta che finisca prima di annullare il turno.`);
    await r.afterPending;
    const out = await restoreCheckpoint(cp, `refs/sb/undo/${r.s.id}/${Date.now()}`);
    void pruneCheckpoints(cp.root, `refs/sb/undo/${r.s.id}/`, 10).catch(() => {});
    r.checkpoints!.pop();
    const prev = r.checkpoints!.at(-1)?.at;
    if (prev === undefined) delete r.s.checkpointAt; else r.s.checkpointAt = prev;
    const kept = out.skipped.length ? ` ${out.skipped.length} file cambiati di nuovo dopo il turno sono rimasti come sono.` : '';
    r.undoNote = `[nota dell'app · l'utente ha annullato il tuo ultimo turno: i file che avevi cambiato sono tornati com'erano prima (${out.restored.length} ripristinati, ${out.removed.length} rimossi).${kept} Le modifiche di quel turno non ci sono più.]`;
    this.addItem(r, sysItem('turnUndone', { restored: out.restored.length, removed: out.removed.length, skipped: out.skipped.length }, 'info'), false);
    this.updated(r);
    log.info('chats', 'turn undone: files restored from the checkpoint', { chat: r.s.id, data: { restored: out.restored.length, removed: out.removed.length, skipped: out.skipped.length } });
    return { restored: out.restored.length, removed: out.removed.length };
  }
}
