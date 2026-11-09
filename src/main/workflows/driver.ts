// Approved work goes on by itself (ADR 0238, stage 5 of total autonomy; cloudroom's "the parent hears every child turn
// end" and "a restart relaunches queued work"). A work thread with a recorded decision (an 'approved' event) that no
// chat is moving any more — every linked chat idle, closed or failed, nothing waiting on the user, for `stallMs` — is
// told to the Orchestrator as grouped news (OrchestratorWake.stalledWork), so it takes the thread up again with no
// nudge from the user: after a restart, a crash, a review that sent the work back, a delegate that went quiet. Again
// after 2x and 4x the wait while nothing moves, then it stops (a thread nobody can move is the Orchestrator's to report).
// A closed linked chat with unread mail is reopened with one line instead: the mail is the work (cloudroom: a message to
// a sleeping session wakes it). Never: a thread waiting for the user (a proposal, a question, a command for «Esegui»),
// a blocked one (it needs a new proposal), or one with an uncertain delivery (never re-executed, ADR 0234).
// Pure apart from its deps; ticked by wiring.ts; pinned by test/unit/workflows/driver.test.ts (fake clock).
import type { ChatSummary } from '../../shared/contract';
import { WORK_LABELS } from '../../shared/workflows';
import type { ProjectedWork } from '../coordination/projection';

export const STALL_MS = 15 * 60_000;
/** nudges per thread version while nothing moves: after stallMs, 2x and 4x */
export const MAX_NUDGES = 3;
const BUSY = new Set(['running', 'waiting', 'starting']);

export interface WorkDriverDeps {
  works(): ProjectedWork[];
  chats(): ChatSummary[];
  /** grouped news to the Orchestrator; false = not taken (no Orchestrator, news off) */
  tell(n: { threadId: string; title: string; detail: string }): boolean;
  /** unread mail waits for this chat (mail.ts hasWork) */
  mailWaiting?(chatId: string): boolean;
  /** an app line to a chat: reopens a closed one (ChatManager.send) */
  wake?(chatId: string, text: string): Promise<unknown>;
  now?(): number;
  stallMs?: number;
}

export const MAIL_WAKE = (title: string): string =>
  `[evento app] Hai posta non letta per il filo «${title}», che è approvato: leggila (mail_inbox) e continua il lavoro. Fermati solo per scritture su DB, release in produzione o scritture Azure.`;

interface Told { version: number; movedAt: number; count: number }

export class WorkDriver {
  private told = new Map<string, Told>();
  constructor(private readonly d: WorkDriverDeps) {}

  private get stallMs(): number { return this.d.stallMs ?? STALL_MS; }

  /** Approved threads that nothing moves now, with when they last moved. */
  stalled(now = this.d.now?.() ?? Date.now()): { work: ProjectedWork; movedAt: number; linked: ChatSummary[] }[] {
    const chats = this.d.chats();
    const out: { work: ProjectedWork; movedAt: number; linked: ChatSummary[] }[] = [];
    for (const w of this.d.works()) {
      if (!w.events.some(e => e.kind === 'approved')) continue;            // no recorded decision: not approved work
      if (w.coordination.state === 'waiting-user' || w.coordination.state === 'done') continue;
      // blocked on purpose (agent_report block, a rejected proposal, 3 failed review cycles): it needs a new proposal
      const last = w.events.at(-1)?.kind;
      if (last === 'blocked' || last === 'rejected' || w.cycles >= 3) continue;
      if (w.coordination.requests.some(r => r.state === 'accepted' && r.delivery && !['delivered', 'applied'].includes(r.delivery.state))) continue;
      const linked = chats.filter(c => w.chatIds.includes(c.id));
      if (linked.some(c => !c.closedAt && (BUSY.has(c.state) || c.pending > 0 || !!c.queued))) continue;
      const movedAt = Math.max(w.updatedAt, ...linked.map(c => c.updatedAt ?? 0));
      if (now - movedAt < this.stallMs) continue;
      out.push({ work: w, movedAt, linked });
    }
    return out;
  }

  /** One pass: tell what is due. Returns how many threads were told (or woken through their mail). */
  tick(now = this.d.now?.() ?? Date.now()): number {
    let n = 0;
    const live = new Set<string>();
    for (const { work, movedAt, linked } of this.stalled(now)) {
      live.add(work.id);
      const prev = this.told.get(work.id);
      const fresh = !prev || prev.version !== work.version || prev.movedAt !== movedAt;
      const count = fresh ? 0 : prev.count;
      if (count >= MAX_NUDGES) continue;
      if (now - movedAt < this.stallMs * 2 ** count) continue;
      const mailed = linked.find(c => !!c.closedAt && c.closedBy !== 'user' && this.d.mailWaiting?.(c.id));
      let done = false;
      if (mailed && this.d.wake) { void this.d.wake(mailed.id, MAIL_WAKE(work.title)).catch(() => {}); done = true; }
      else done = this.d.tell({ threadId: work.id, title: work.title, detail: this.detail(work, movedAt, linked, now) });
      if (!done) continue;
      this.told.set(work.id, { version: work.version, movedAt, count: count + 1 });
      n++;
    }
    for (const id of [...this.told.keys()]) if (!live.has(id)) this.told.delete(id);   // it moved: a later stall is new
    return n;
  }

  private detail(w: ProjectedWork, movedAt: number, linked: ChatSummary[], now: number): string {
    const min = Math.round((now - movedAt) / 60_000);
    const chats = !linked.length ? 'nessuna chat collegata' : linked.every(c => c.closedAt || c.state === 'closed') ? 'le sue chat sono chiuse'
      : linked.some(c => c.state === 'error') ? 'una sua chat si è fermata su un errore' : 'nessuna sua chat sta lavorando';
    return `Fase ${WORK_LABELS[w.stage]}, nulla si muove da ${min} min (${chats}). Prossima azione: ${w.coordination.nextAction || w.nextAction || 'decidila dal filo'}. `
      + 'Riprendilo tu adesso, senza chiedere all’utente: delega o scrivi alla chat del filo; review → correzione → nuova review → merge vanno avanti da soli. '
      + 'All’utente servono solo scritture su DB (test e produzione), release in produzione e scritture Azure.';
  }
}
