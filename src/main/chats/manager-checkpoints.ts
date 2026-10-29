// ChatManager layer (ADR 0200): checkpoints and receipts. The files before each turn of a work chat in a git
// repository (checkpoints.ts, ADR 0103), the turn's changed files as the run's receipts (agents/receipts.ts, ADR 0130),
// and «Annulla turno» (undoTurn).
import path from 'node:path';
import type { ChatItem } from '../../shared/contract';
import { errText, log } from '../log';
import type { AgentRun } from '../../shared/agents';
import { afterTree, KEEP as CHECKPOINTS_KEPT, prune as pruneCheckpoints, restore as restoreCheckpoint, snapshot as takeCheckpoint, turnFiles } from './checkpoints';
import { emptyReceipts, noteTool, noteTurnFiles, receiptVerdict, rowChanges, turnFilesWithoutGit } from '../agents/receipts';
import type { Rec } from './manager-types';
import { sysItem } from './manager-helpers';
import { ManagerSessions } from './manager-sessions';

/** ADR 0103 checkpoints before each turn and the run's receipts (ADR 0130); undo of the last turn. */
export abstract class ManagerCheckpoints extends ManagerSessions {

  /** Records the chat's files before a turn (checkpoints.ts); a folder outside git is asked once, a failure never holds
   *  the message. */
  protected async checkpoint(r: Rec): Promise<void> {
    if (r.gitRoot === null) return;
    try {
      const cp = await takeCheckpoint(r.s.cwd, `refs/sb/checkpoints/${r.s.id}/${Date.now()}`);
      if (!cp) { r.gitRoot = null; return; }
      r.gitRoot = cp.root;
      r.turnCheckpoint = true;
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
    const cp = r.checkpoints?.at(-1);
    if (!cp || cp.after || r.afterPending) return;
    r.afterPending = afterTree(cp.root).then(tree => { if (tree) cp.after = tree; }).finally(() => { r.afterPending = undefined; });
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
  protected receiptTurn(r: Rec, turnAt: number | undefined, end: number): void {
    const run = r.s.run;
    if (!run || run.source === 'oneshot' || (run.endedAt !== undefined && (turnAt === undefined || run.endedAt < turnAt))) return;
    const rc = run.receipts ??= emptyReceipts(), cp = r.checkpoints?.at(-1), turn = r.receiptTurn ?? { files: [], mayWrite: false };
    r.receiptTurn = undefined;
    if (!r.turnCheckpoint || !cp || r.receiptCp === cp) { noteTurnFiles(rc, turnFilesWithoutGit(turn), turnAt ?? end, end); this.receiptsIn(r, run); return; }
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
