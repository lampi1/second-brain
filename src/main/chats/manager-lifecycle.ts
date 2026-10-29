// ChatManager layer (ADR 0200): a chat's life. Stop, close (keeping the engine's tools until the real close),
// archive and reopen, the automatic close (ADR 0084: candidates, what each waits for), stale agent runs, turns a
// restart cut (resumeInterrupted) and the app's shutdown.
import type { ChatSummary } from '../../shared/contract';
import { errText, log } from '../log';
import { reapEnabled, reapEngine, snapshotTrees } from './proctree';
import { jobGuard } from './jobguard';
import { coldArmed } from './continuity';
import type { HarnessSession } from './session';
import { updateActivity } from '../update/activity';
import { staleDue } from '../agents/runs';
import { autoCloseNow, type AutoCloseCandidate } from './auto-close';
import type { AutoCloseWaiting } from '../../shared/auto-close';
import type { Rec } from './manager-types';
import { clearInterval, clearTimeout, RESUME_TEXT, uniqueChildResults, workBehind, WAITING_REASON } from './manager-helpers';
import { ManagerDelegation } from './manager-delegation';

/** A chat's life: stop, close, archive and reopen, the automatic close's candidates, stale runs, resume after a restart, shutdown. */
export abstract class ManagerLifecycle extends ManagerDelegation {

  protected override autoActivity(r: Rec): void {
    r.autoActivityAt = autoCloseNow(); r.activityRevision = (r.activityRevision ?? 0) + 1;
    this.opts.onAutoCloseActivity?.(r.s.id);
  }

  /** Main-only reservation held before delivery/mail takes its first asynchronous step. */
  holdActivity(chatId: string): () => void {
    const r = this.need(chatId); this.autoActivity(r);
    r.deliveryHolds = (r.deliveryHolds ?? 0) + 1;
    let released = false;
    return () => { if (!released) { released = true; r.deliveryHolds = Math.max(0, (r.deliveryHolds ?? 1) - 1); this.autoActivity(r); } };
  }

  /** Main guards, combined with mailbox/command/browser holds by wiring. Unknown children are never zero.
   *  externalHold: true / a waiting kind = held by wiring (a waiting kind also names the "In attesa di…" label). */
  /** A delegation tree closes as one (owner, 2026-10-21: «in una chat ad albero dopo 2 minuti che hanno finito tutti»):
   *  a chat of a tree is ready only when every open chat of its tree is, and its clock starts at the tree's last activity. */
  autoCloseCandidates(externalHold: (chatId: string) => boolean | AutoCloseWaiting = () => true): AutoCloseCandidate[] {
    const own = this.ownAutoCloseCandidates(externalHold);
    const rootOf = (id: string): string => {
      let cur = id;
      for (let i = 0; i < 50; i++) { const up = this.chats.get(cur)?.s.parentId; if (!up || !this.chats.has(up)) break; cur = up; }
      return cur;
    };
    const trees = new Map<string, AutoCloseCandidate[]>();
    for (const c of own) { const root = rootOf(c.id); trees.set(root, [...trees.get(root) ?? [], c]); }
    for (const root of this.treeActivity.keys()) if (!trees.has(root)) this.treeActivity.delete(root);
    const depthOf = (id: string): number => {
      let n = 0;
      for (let cur = this.chats.get(id)?.s.parentId; cur && this.chats.has(cur) && n < 50; cur = this.chats.get(cur)?.s.parentId) n++;
      return n;
    };
    return own.map(lone => {
      const root = rootOf(lone.id), tree = trees.get(root)!;
      // a lone chat, unless what is left of a tree whose other chats closed first
      if (tree.length < 2 && !this.treeActivity.has(root)) return lone;
      const c = { ...lone, depth: depthOf(lone.id), tree: root };
      // only a member still at work holds the tree: one that ended with an error, a Stop or no result never closes by
      // itself and must not keep its tree open forever
      if (c.eligible && tree.some(x => !x.eligible && this.atWork(x.id))) return { ...c, eligible: false, reason: 'Si chiude insieme al resto dell’albero, quando hanno finito tutti' };
      // the tree's last activity only grows: a member closing first never restarts the others' clock (its own closing
      // touches are left out, so a closing member never pushes its siblings' deadline)
      const at = Math.max(this.treeActivity.get(root) ?? 0, ...tree.filter(x => { const r = this.chats.get(x.id); return !r?.autoClosing && !r?.autoEnding; }).map(x => x.activityAt));
      this.treeActivity.set(root, at);
      return { ...c, activityAt: at };
    });
  }
  /** A chat still doing or waiting for something: running, a pending request, a turn or a delivery under way. */
  private atWork(id: string): boolean {
    const r = this.chats.get(id);
    if (!r || r.s.closedAt) return false;
    const c = r.s;
    return c.state === 'running' || c.state === 'starting' || c.state === 'waiting' || r.pending.size > 0 || !!r.working || !!r.session?.busy ||
      !!r.deliveryHolds || !!c.queued || !!r.opening || !!c.waitsOn || c.plan?.phase === 'proposed' || workBehind(c) || (c.agentChildren?.active ?? 0) > 0;
  }

  private ownAutoCloseCandidates(externalHold: (chatId: string) => boolean | AutoCloseWaiting): AutoCloseCandidate[] {
    return [...this.chats.values()].filter(r => !r.s.closedAt).map(r => {
      const c = r.s;
      let held: boolean | AutoCloseWaiting = true;
      try { held = externalHold(c.id); } catch { /* fail closed */ }
      // finished: idle after a clean result, or its engine gone (ended by itself, or restored at start-up with its saved
      // result; a chat saved before results were saved counts as done when it had turns). Errors, the user's Stop and an
      // engine gone mid-turn stay open.
      const ended = c.state === 'closed' && (!r.session || r.autoClosing);
      const finished = (c.state === 'idle' || ended) && !c.lastError &&
        !r.unfinished && ((result => result ? !result.isError && !result.interrupted : ended && !r.session && r.lastTurnAt > 0)(c.lastResult ?? r.savedResult));
      const eligible = !this.quitting && !updateActivity.frozen && !c.isOrchestrator && !c.quick && !held && finished &&
        !r.working && !r.session?.busy && r.pending.size === 0 && !workBehind(c) && !c.waitsOn && c.plan?.phase !== 'proposed' && !c.queued && !r.deliveryHolds &&
        !r.opening && !r.releasing && !r.switching && !r.handoffTurn && (!r.archiving || r.autoClosing) && this.childrenDone(r);
      const waitingFor = eligible || c.isOrchestrator || c.quick ? undefined : this.waitingOf(r, held);
      return { id: c.id, eligible: !!eligible, stamp: `${r.activityRevision ?? 0}:${r.lastTurnAt}:${c.lastResult?.at ?? 0}:${c.pending}:${c.model ?? ''}:${c.work?.status ?? ''}:${c.waitsOn ?? ''}`,
        activityAt: r.autoActivityAt ??= autoCloseNow(), ...(waitingFor ? { waitingFor } : {}),
        reason: waitingFor ? WAITING_REASON[waitingFor] : !this.childrenDone(r) ? 'Sottoagenti ancora al lavoro' : 'Attività o stato da verificare' };
    });
  }
  /** No sub-agent left at work. The CLI engines (Claude, Codex, Cursor) never report a complete census, so a live
   *  session counts what it saw: every sub-agent it observed has ended (its background tasks are held apart, `background`).
   *  An engine that is gone left none running (its sub-agents ended with it; rows it never saw end read 'unknown'). */
  protected override childrenDone(r: Rec): boolean {
    const child = r.s.agentChildren;
    if (!r.session) return (child?.active ?? 0) === 0 && !child?.children.some(x => x.state === 'running' || x.state === 'waiting');
    if (!child) return false;
    if (child.coverage === 'complete' && child.active !== 0) return false;
    return !child.children.some(x => x.state === 'running' || x.state === 'waiting' || x.state === 'unknown');
  }

  /** What a held work chat waits for, the most urgent first (#86): the user's answers before running work, running
   *  work before a missing report. undefined = held for another reason (busy, starting, an error, ...). */
  private waitingOf(r: Rec, external: boolean | AutoCloseWaiting): AutoCloseWaiting | undefined {
    const c = r.s, pend = [...r.pending.values()];
    if (pend.some(p => p.type === 'permission')) return 'permission';
    if (pend.some(p => p.type === 'question')) return 'answer';
    if (c.plan?.phase === 'proposed') return 'answer'; // its plan waits for «Approva e parti» (ADR 0108)
    if (external === 'command' || external === 'browser') return external;
    if (c.waitsOn) return c.waitsOn;
    if (r.session?.busy || r.working || c.state === 'running' || c.state === 'starting') return undefined;
    if ((c.background ?? 0) > 0 || c.waitsOnWork || this.observedChildrenBusy(r) || (c.agentChildren?.active ?? 0) > 0 || external === 'work') return 'work';
    if (c.work?.status === 'waiting-mail' || external === 'mail') return 'mail';
    if (c.work?.status === 'assigned' && c.lastResult && !c.lastResult.isError && !c.lastResult.interrupted) return 'report';
    return undefined;
  }

  /** No renderer flag can authorize this path. The scheduler supplies a current, main-owned reservation. */
  async archiveAutomatic(chatId: string, stillValid: () => boolean): Promise<boolean> {
    const r = this.need(chatId);
    const eligible = (): boolean => this.autoCloseCandidates(() => false).find(c => c.id === chatId)?.eligible === true;
    if (!stillValid() || !eligible() || r.archiving || r.autoClosing || r.pending.size || r.deliveryHolds) return false;
    r.autoClosing = true;
    let authorized = false;
    const valid = (): boolean => stillValid() && eligible() && this.chats.get(chatId) === r && !r.pending.size && !r.deliveryHolds && !r.session?.busy && !r.working && !workBehind(r.s);
    const sess = r.session;
    const run = (async () => {
      if (!valid()) return;
      try { await this.ensureHandoff(chatId, { ask: false, allowStart: false }); } catch { return; }
      if (!valid()) return;
      if (sess) { r.autoEnding = true; await sess.close(); if (!valid()) return; }
      this.reapKept(r); // the engines it outlived, also when it had none left (archive above)
      authorized = true;
    })();
    r.archiving = run;
    try {
      await run;
      if (!authorized || !valid()) return false;
      this.flushItems(chatId);
      r.s.closedAt = Date.now(); r.s.closedBy = 'auto'; r.s.state = 'closed';
      this.endRunOf(r, 'closed', r.s.closedAt);
      this.pruneArchived(); this.persist(); this.updated(r);
      return true;
    } finally { r.archiving = undefined; r.autoClosing = false; r.autoEnding = false; }
  }

  /** Interrupts whenever a process exists, whatever the shown state says (an interrupt on an idle CLI is harmless). */
  async stop(chatId: string, keepQueued = false): Promise<void> {
    const r = this.need(chatId);
    if (!r.session) return;
    try { await r.session.interrupt({ keepQueued, byUser: true }); } catch (e) {
      log.warn('chats', 'interrupt failed', { chat: chatId, data: errText(e) });
      throw new Error(`Stop non riuscito: ${errText(e)}`);
    }
  }

  /** Interrupts every live session; returns how many were working. */
  async stopAll(): Promise<number> {
    const live = [...this.chats.values()].filter(r => r.session);
    const busy = live.filter(r => r.session?.busy).length;
    await Promise.allSettled(live.map(r => r.session?.interrupt({ byUser: true })));
    log.info('chats', 'stop all', { data: { live: live.length, busy } });
    return busy;
  }

  /** Removes the chat from the app (its process ends; the transcript stays where the CLI keeps it). */
  async close(chatId: string): Promise<void> {
    const r = this.need(chatId);
    this.admission?.drop(chatId); // its waiting work goes with it
    const sess = r.session;
    if (sess) await sess.close();
    this.reapKept(r);
    for (const id of [...r.pending.keys()]) this.dropPending(r, id);
    this.flushItems(chatId);
    this.endRunOf(r, 'closed');
    this.chats.delete(chatId);
    this.persist();
    log.info('chats', 'chat closed', { chat: chatId });
    this.opts.emitter.emit('chat:removed', { chatId });
  }

  /** The chat goes on in a new process: the old one ends, but a dev server it started stays for the next turn
   *  (owner, 2026-10-12); its tools are reaped when the chat really closes (reapKept). */
  protected override closeKeeping(r: Rec, sess: HarnessSession): Promise<void> {
    // the Orchestrator and Flash never close, so nothing would ever reap what their old engines left: MCP servers and
    // shells piled up all day (2026-10-29). Their tools end with the engine, unless a background command still runs
    // (a check it started): that engine is kept until their next engine change, which reaps the ones kept before.
    if (r.s.isOrchestrator || r.s.quick) {
      this.reapKept(r);
      if (!(r.s.background ?? 0)) return sess.close();
    }
    (r.kept ??= []).push(sess);
    return sess.close(undefined, true);
  }

  /** The chat really closes (✕, Ctrl+W, Chiudi, auto close): the engines it outlived leave nothing behind either. */
  protected override reapKept(r: Rec): void {
    for (const s of r.kept?.splice(0) ?? []) {
      if (s.root && reapEnabled()) void reapEngine(s.root, { chatId: r.s.id, what: 'a previous engine of this chat' });
    }
  }

  /** Archives a finished work chat: its process ends gracefully, the record stays (closedAt) and reopen() brings it
   *  back with its history. auto = the UI's auto-close: refused if the chat went back to work meanwhile. undoable = the
   *  user's ✕ with its «Annulla» (#168): the run ends only when the close is final (chat:close, or 15 s with no reopen),
   *  so an Annulla gets the chat back with its run still open. */
  async archive(chatId: string, opts: { auto?: boolean; undoable?: boolean } = {}): Promise<ChatSummary> {
    const r = this.need(chatId);
    // the Orchestrator never closes (its title is the mail address the brain's rules and the chats write to)
    if (r.s.isOrchestrator) throw new Error('L’Orchestrator non si chiude: per ripartire usa Pulisci.');
    if (r.archiving) await r.archiving;
    if (r.s.closedAt) return { ...r.s };
    if (opts.auto && (r.session?.busy || r.pending.size > 0 || workBehind(r.s) || r.s.queued)) throw new Error('La chat è tornata al lavoro: resta aperta.');
    if (opts.auto) throw new Error('La chiusura automatica richiede il timer verificato dal processo principale.');
    // closed by hand while an agent's message waited in the CPU queue: that message is dropped with the chat's work
    if (this.admission?.drop(chatId)) log.info('chats', 'queued work dropped: the chat was archived', { chat: chatId });
    const sess = r.session;
    const note = opts.auto && r.lastTurnAt > 0;
    // a long Claude chat that still waits for its cold note keeps its engine until it wrote it (never a turn at close:
    // the note comes at its usual time, coldTick; ADR 0031)
    const keep = !!opts.auto && !!sess?.alive && this.coldOn() && coldArmed(this.coldView(r), Date.now(), this.ttl());
    if (sess || note) {
      // one promise for the whole close, set before any await: a message sent meanwhile waits for it, then reopens
      r.archiving = (async () => {
        // the auto-close leaves the token-free hand-off for a later "Riprendi" (ADR 0014: never a turn at close)
        if (note) {
          try { await this.ensureHandoff(chatId, { ask: false }); } catch (e) {
            log.warn('chats', 'hand-off before the auto-close not written', { chat: chatId, cause: errText(e), hint: '"Riprendi" on this chat writes it then' });
          }
        }
        // the user's ✕ stops a running turn at once (#168): the engine's exit may take seconds, its work must not
        if (sess && !opts.auto && sess.busy) await sess.interrupt({ byUser: true }).catch(e => log.info('chats', 'interrupt at close failed', { chat: chatId, data: errText(e) }));
        if (sess && !keep) await sess.close();
      })();
      try { await r.archiving; } finally { r.archiving = undefined; }
    }
    // the engines it outlived (a model change, an idle release) go too, even when it had no engine left now: only
    // close() reaped them before, and a chat archived without one left its MCP servers running all day (2026-10-29).
    // The user's ✕ leaves them to its final close (chat:close after the «Annulla» toast): an Annulla finds its dev server.
    if (!opts.undoable) this.reapKept(r);
    for (const id of [...r.pending.keys()]) this.dropPending(r, id);
    this.flushItems(chatId);
    r.s.closedAt = Date.now();
    r.s.closedBy = opts.auto ? 'auto' : 'user';
    if (opts.undoable && !opts.auto) {
      const at = r.s.closedAt;
      const t = setTimeout(() => { if (this.chats.get(chatId) === r && r.s.closedAt === at) this.endRunOf(r, 'closed', at); }, 15_000);
      t.unref?.();
    } else this.endRunOf(r, 'closed', r.s.closedAt);
    r.working = false;
    if (keep) r.closeAfterCold = true;
    if (r.s.state !== 'error') r.s.state = 'closed';
    delete r.s.background; delete r.s.waitsOnWork; delete r.s.waitsOn;
    this.pruneArchived();
    this.persist();
    log.info('chats', 'chat archived', { chat: chatId, data: { auto: !!opts.auto, ...(keep ? { engineKeptForColdNote: true } : {}) } });
    this.updated(r);
    return { ...r.s };
  }

  /** Back on the grid; the session resumes on the next message (Claude --resume, Cursor session/load). */
  async reopen(chatId: string): Promise<ChatSummary> {
    const r = this.need(chatId);
    if (r.s.routineArchived || r.s.routine || r.s.routinePackage) throw new Error('Archived routine chat: use the terminal routine CLI.');
    if (r.s.closedAt) this.unarchive(r);
    return { ...r.s };
  }

  /** Ends the open runs with no turn and nothing waiting on the user for STALE_MS (the timer; tests call it). */
  override staleRuns(now = Date.now()): number {
    let n = 0;
    for (const r of this.chats.values()) {
      if (r.s.routineArchived) continue;
      const run = r.s.run;
      if (!run || run.endedAt !== undefined) continue;
      const waiting = r.pending.size > 0 || !!r.commandsOpen?.size || !!r.working || !!r.session?.busy || !!r.s.queued;
      if (!staleDue(run, Math.max(run.startedAt, r.lastTurnAt, r.idleSince ?? 0, r.activeAt ?? 0), waiting, now)) continue;
      this.finishRun(run, 'stale', now); n++;
    }
    if (n) { this.runSave(); this.persist(); }
    return n;
  }

  /** After a start: every chat whose turn the last quit or crash cut (working still set) resumes by itself with
   *  RESUME_TEXT and the "ripresa dopo il riavvio" mark (resumedAt). Chats that had finished stay closed. */
  resumeInterrupted(): number {
    this.restoreRootNotices();
    this.resumeRootSyntheses();
    for (const r of this.chats.values()) if (r.heldResult && !r.working) this.releaseResult(r);
    // child results the last quit held back reach their parent now, as one batch
    for (const r of this.chats.values()) {
      if (r.s.routineArchived) continue;
      const held = r.heldResults?.filter(item => !item.runId || !this.runs.get(item.runId)?.delivery?.synthesisSubmittedAt);
      const removed = (r.heldResults?.length ?? 0) !== (held?.length ?? 0);
      r.heldResults = held;
      if (removed) this.persist(true);
      if (!held?.length) continue;
      this.childResults.set(r.s.id, { items: held, timer: null });
      this.flushChildResults(r.s.id);
    }
    const cut = [...this.chats.values()].filter(r => r.working && !r.s.closedAt);
    for (const r of cut) {
      r.s.resumedAt = Date.now();
      this.updated(r);
      log.info('chats', 'resuming a chat cut by the restart', { chat: r.s.id });
      this.send(r.s.id, RESUME_TEXT, undefined, true, undefined, false, { kind: 'app' }).catch(e => {
        log.warn('chats', 'resume after restart failed', { chat: r.s.id, cause: errText(e), hint: 'the chat stays closed: a message from the user resumes it' });
        if (r.s.resumedAt) { delete r.s.resumedAt; this.updated(r); }
      });
    }
    return cut.length;
  }

  /** App quit. Every CLI gets its tree killed at once, idle ones too: one that ended cleanly would leave its MCP
   *  servers and shells running, and the reap after an exit (a 3-40 s process list) does not finish before the app is
   *  gone (owner, 2026-10-12). Busy turns are lost at quit anyway; transcripts are already on disk. We wait for the
   *  kills to land, because taskkill /T needs claude.exe alive to find its children and takes 1-3.5 s to start on
   *  Windows (15-40 s on a loaded one); then one more kill for anything left, awaited without blocking the main
   *  process. Resolves within `capMs` (under the app's 6 s quit cap, index.ts): what is still alive then is the
   *  orphan sweep's on the next start. */
  async shutdown(graceMs = 800, capMs = 5500): Promise<void> {
    const end = Date.now() + capMs;
    this.quitting = true;
    for (const timer of this.synthesisRetry.values()) clearTimeout(timer);
    this.synthesisRetry.clear();
    // child results still waiting for their siblings: kept on the parent, sent after the next start (resumeInterrupted)
    for (const [parentId, q] of this.childResults) {
      const parent = this.chats.get(parentId);
      if (parent && q.items.length) parent.heldResults = uniqueChildResults([...(parent.heldResults ?? []), ...q.items]);
    }
    this.persist();
    this.warm.stop();
    this.admission?.stop(); // what still waits is lost with the run; a cut turn (working) resumes on the next start anyway
    const live = [...this.chats.values()].map(r => r.session).concat(this.warm.engines.map(w => w.session)).filter((x): x is HarnessSession => !!x && x.alive);
    // the engines outside a Job Object: what they started, pictured now (WMI is slow) for the kill at the cap
    // each of these spawns a process (WMI's PowerShell, a taskkill per engine): the slowest says what one costs now
    let spawnMs = 0;
    const timed = <T>(f: () => T): T => { const t = Date.now(); try { return f(); } finally { spawnMs = Math.max(spawnMs, Date.now() - t); } };
    const kids = timed(() => snapshotTrees(process.platform === 'win32' ? live.filter(x => !jobGuard.has(x.jobHandle)).flatMap(x => (x.pid ? [x.pid] : [])) : [], capMs));
    for (const x of live) timed(() => x.killNow());
    const closes = Promise.allSettled(live.map(x => x.close(graceMs)));
    // timed from the start, not from here, and the last kill keeps room for what it spawns (the reaper) at this load:
    // a fixed 1 s let the quit end 146 ms past the app's 6 s cap at full CPU (2026-10-14)
    const last = Math.max(1000, 3 * spawnMs);
    await Promise.race([closes, new Promise(r => setTimeout(r, Math.max(0, Math.min(end - capMs + graceMs + 4500, end - last) - Date.now())).unref())]);
    await this.killLeft(Math.max(0, end - Date.now()), kids, spawnMs);
    if (this.usageTimer) clearInterval(this.usageTimer);
    if (this.coldTimer) clearInterval(this.coldTimer);
    if (this.runTimer) clearInterval(this.runTimer);
    for (const q of this.childResults.values()) if (q.timer) clearTimeout(q.timer); // the results stay on the children (agent_children)
    this.counters.flush();
    this.flushWrites();
    this.runs.close(); // app.db's handle released at quit (a later save opens it again)
    process.off('exit', this.onExit);
    log.info('chats', 'manager stopped', { data: { sessions: live.length, left: live.filter(x => x.alive).length, ms: Date.now() - end + capMs, spawnMs } });
  }
}
