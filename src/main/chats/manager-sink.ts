// ChatManager layer (ADR 0200): the session sink. Each engine session reports items, questions and permissions and
// state patches; sinkFor turns them into the chat record and the contract events (chat:item, pending:added, chat:updated)
// and applyPatch applies a state change (turn start and end, the Orchestrator's own turn, held results).
import type { PendingRequest } from '../../shared/contract';
import { errText, log } from '../log';
import { AFTER_CALLS } from './continuity';
import { HANDOFF_END, HANDOFF_START } from './handoff';
import type { HarnessSession, SessionPatch, SessionSink } from './session';
import { engineOf } from '../engines/registry';
import { aboveCeiling } from '../agents/tool-policy';
import { addSkill, addTurn } from '../agents/runs';
import { AgentChildrenReducer } from './agent-children';
import { effortValue, initialEffort, observeEffort, submitEffort } from './effort';
import type { Rec } from './manager-types';
import { ManagerWork } from './manager-work';

/** What a session reports (items, requests, state patches) turned into the chat record and contract events. */
export abstract class ManagerSink extends ManagerWork {

  /** The chat's side of a session: every report lands in r while current() is r's session. */
  protected override sinkFor(r: Rec, current: () => HarnessSession | null): SessionSink {
    const chatId = r.s.id;
    const live = (): boolean => { const sess = current(); return !!sess && r.session === sess && this.chats.get(chatId) === r; };
    return {
      item: (item, replace) => {
        if (!live()) return;
        this.hook('analytics', () => this.analytics.item(r.s, item, replace));
        this.autoActivity(r);
        if (r.handoffTurn && item.kind === 'assistant') {
          r.handoffTurn.texts.set(item.id, item.text);
          // the markers are for the app: the transcript shows the note without them
          item = { ...item, text: item.text.split('\n').filter(l => l.trim() !== HANDOFF_START && l.trim() !== HANDOFF_END).join('\n') };
        }
        // a cold note's turn stays out of the tile (ADR 0031): only its result settles the turn
        if (r.handoffTurn?.quiet && item.kind !== 'system') { if (item.kind === 'result' && !replace) this.turnEnded(r, item); return; }
        this.addItem(r, item, replace);
        // a skill Claude loaded while the run is open joins its tags (only Claude reports skills as a tool)
        if (item.kind === 'tool' && item.name === 'Skill' && r.s.harness === 'claude' && r.s.run) {
          const input = item.input as { skill?: unknown; command?: unknown } | null;
          if (addSkill(r.s.run, input?.skill ?? input?.command)) this.runSaveSoon();
        }
        if (item.kind === 'tool' && r.s.run) this.noteReceipt(r, item);
        if (item.kind === 'result' && !replace) this.turnEnded(r, item);
      },
      pending: req => {
        if (!live()) return;
        if (this.gated(r, req) || this.refusedCommand(r, req) || this.autoPermitted(r, req) || this.awayAnswered(r, req)) return;
        this.hook('analytics', () => this.analytics.pending(r.s, req));
        this.autoActivity(r);
        const full: PendingRequest = { ...req, chatId };
        this.countRequest(r, req);
        r.pending.set(req.id, full);
        r.s.pending = r.pending.size;
        this.opts.emitter.emit('pending:added', full);
        this.updated(r);
        const on = this.opts.onWaiting;
        if (on) this.hook('onWaiting', () => on(chatId, full));
      },
      rateLimit: msg => { const on = this.opts.onRateLimit; if (live() && on) this.hook('onRateLimit', () => on(msg)); },
      commands: list => { if (live()) r.commands = list; },
      models: list => { const on = this.opts.onModels; if (live() && on) this.hook('onModels', () => on(r.s.harness, list)); },
      children: observation => {
        if (!live()) return;
        this.autoActivity(r);
        const children = r.children ??= new AgentChildrenReducer();
        if (!children.observe(observation)) return;
        r.s.agentChildren = children.snapshot(); this.persist(); this.updated(r);
      },
      childrenCoverage: (coverage, reason) => {
        if (!live()) return;
        const children = r.children ??= new AgentChildrenReducer();
        if (reason === 'exit' && r.autoEnding && children.snapshot().coverage === 'complete' && children.snapshot().active === 0) return;
        children.coverage(coverage); r.s.agentChildren = children.snapshot(); this.persist(); this.updated(r);
      },
      resolved: id => { if (this.chats.get(chatId) === r) this.dropPending(r, id); },
      changed: p => { if (live()) this.applyPatch(r, p); },
      exit: ({ error }) => {
        const sess = current();
        if (!sess || this.chats.get(chatId) !== r || r.session !== sess) return;
        this.hook('analytics', () => this.analytics.end(r.s));
        r.session = null;
        const verifiedEmpty = r.autoEnding && !error && r.children?.snapshot().coverage === 'complete' && r.children.snapshot().active === 0;
        if (engineOf(r.s.harness)?.kind !== 'api' && !verifiedEmpty) r.children?.end();
        if (r.children) r.s.agentChildren = r.children.snapshot();
        // gone mid-turn (crash, close, kill): no result will settle the estimate, which stays as spent (no "≈")
        delete r.s.costLiveUsd;
        delete r.turnAt; // its turn is over, result or not
        r.handoffTurn?.done(null);
        delete r.s.background; // its background tasks died with it
        // died mid-turn with an error while the app runs: no result will come, so no onDone either; tell the brain now
        const crashed = !!error && r.working && !this.quitting;
        // gone with an error, or by itself in the middle of a turn: its work is not finished (no auto-close, ADR 0134)
        if (!this.quitting && (error || (r.working && !r.autoEnding && !r.releasing && !r.archiving))) r.unfinished = true;
        if (!this.quitting) r.working = false; // a crash while the app runs shows as an error, it is not resumed later
        if (error) r.s.lastError = error;
        if (error) delete r.s.resumedAt; // a resume that failed is no "ripresa": the error shows alone
        if (r.s.state !== 'error') r.s.state = error ? 'error' : r.releasing ? 'idle' : 'closed';
        this.persist();
        this.updated(r);
        this.releaseResult(r); // its engine is gone: a held result never waits for a turn end that will not come
        if (error) this.owedReport(r, 'exit'); // a delegated child that died owes nothing more: its parent is told (#152)
        const onCrash = this.opts.onCrash;
        if (crashed && error && onCrash) this.hook('onCrash', () => onCrash(chatId, error));
      },
    };
  }

  private applyPatch(r: Rec, p: SessionPatch): void {
    this.hook('analytics', () => this.analytics.patch(r.s, p));
    if (!(r.autoClosing || r.autoEnding) || p.state !== 'closed') this.autoActivity(r);
    let save = false;
    if ('effortSubmitted' in p) r.s.effortStatus = submitEffort(r.s.effortStatus ?? initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort), p.effortSubmitted);
    if ('effortObserved' in p) r.s.effortStatus = observeEffort(r.s.effortStatus ?? initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort), p.effortObserved);
    if ('effortSessionDefault' in p) r.s.effortStatus = { ...(r.s.effortStatus ?? initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort)), sessionDefault: effortValue(p.effortSessionDefault) };
    if (p.state) {
      const was = r.s.state;
      // a cold note's turn is invisible (ADR 0031): the tile stays as it was
      if (!(r.handoffTurn?.quiet && (p.state === 'running' || p.state === 'starting'))) r.s.state = p.state;
      // a hand-off turn is not the chat's work: never resumed after a restart
      if ((p.state === 'running' || p.state === 'waiting') && !r.working && !r.handoffTurn) { r.working = true; save = true; }
      // idle only once the CLI's queue is empty: a queued turn starts with no state change, so not cleared per result
      if (p.state === 'idle' && r.working) { r.working = false; save = true; }
      // the turn is over and nothing waits for the user: "done" (once per turn, never at boot)
      if (p.state === 'idle' && was !== 'idle' && r.turnSinceDone && r.pending.size === 0) {
        r.turnSinceDone = false;
        const on = this.opts.onDone;
        if (on) this.hook('onDone', () => on(r.s.id));
        this.owedReport(r, 'idle');
      }
      // a Cursor model change or an Orchestrator role change asked mid-turn: reopen now that the turn is over
      if (p.state === 'idle' && r.reopen && r.session && !r.session.busy) {
        r.reopen = false;
        void this.closeKeeping(r, r.session);
      }
    }
    if (p.sessionId && p.sessionId !== r.s.sessionId) {
      r.s.sessionId = p.sessionId; delete r.forkFrom; save = true;
      if (r.rolePrimed) r.rolePrimed = { ...r.rolePrimed, session: p.sessionId }; // same engine, same context: a new id only
    }
    if (p.model) r.s.model = p.model;
    // shown, never persisted: only the user's own choice (create / chat:set) is saved and used on the next start,
    // so a mode the CLI took from a suggestion or ExitPlanMode does not outlive this process
    if (p.permissionMode) r.s.permissionMode = p.permissionMode;
    // second guard: a mode the engine took on its own (ExitPlanMode, a suggestion, its settings) above the ceiling is
    // set back at once
    if (p.permissionMode && r.policy && aboveCeiling(p.permissionMode, r.policy.ceiling) && r.session) {
      const ceiling = r.policy.ceiling!;
      log.warn('chats', 'agent mode above its ceiling, set back', { chat: r.s.id, data: { mode: p.permissionMode, ceiling } });
      r.s.permissionMode = ceiling;
      void r.session.setPermissionMode(ceiling).catch(e => log.error('chats', 'agent ceiling not restored', { chat: r.s.id, cause: errText(e), hint: 'stop the chat: its mode is above the agent ceiling' }));
    }
    if (p.effort !== undefined) r.s.effort = p.effort;
    if (p.contextTokens !== undefined) r.s.contextTokens = p.contextTokens;
    const run = r.s.run;
    // A fresh submission also starts a turn while Claude is still running after its previous result (delayed idle).
    if ('effortSubmitted' in p && !r.handoffTurn) r.turnAt = Date.now();
    if (p.state === 'running' && !r.handoffTurn) r.turnAt ??= Date.now();
    // out of the turn with no result (a crash, a clean exit mid-turn): the next turn starts its own clock
    else if (p.state === 'idle' || p.state === 'error' || p.state === 'closed') delete r.turnAt;
    // execution time: only while running (waiting on Brother, a permission or the queue is not), never a hand-off note
    if (p.state && run && run.endedAt === undefined) {
      if (p.state === 'running' && !r.handoffTurn) r.runningSince ??= Date.now();
      else if (p.state !== 'running') this.ranUntil(r, Date.now());
    }
    if (run && run.endedAt === undefined) {
      if (p.contextTokens !== undefined && p.contextTokens > (run.counters.contextPeak ?? 0)) { run.counters.contextPeak = p.contextTokens; this.runs.touch(); }
    }
    if (p.turnCostUsd !== undefined) {
      // Engines publish result before accounting. Completion or reassignment can happen between the two.
      const owner = r.turnAccounting ? r.turnAccounting.pending.shift() : run;
      if (owner) { addTurn(owner, p.costKnown === false ? null : p.turnCostUsd, p.turnTokens, !!r.turnAccounting); this.runSaveSoon(); }
      // Flash answered (a turn's result): what the user does next decides it (agents/flash-outcomes.ts, ADR 0131)
      if (r.s.quick) this.runs.flashEvent({ kind: 'answered', at: Date.now() });
    }
    if (p.contextMaxTokens !== undefined) r.s.contextMaxTokens = p.contextMaxTokens;
    if (p.turnCostUsd !== undefined || p.liveCostUsd !== undefined) {
      // costUsd = settled turns + the running turn's estimate; a result settles it (its real cost replaces the estimate)
      const live = r.s.costLiveUsd ?? 0;
      const settled = r.s.costUsd - live + (p.turnCostUsd ?? 0);
      const next = p.liveCostUsd ?? (p.turnCostUsd !== undefined ? 0 : live);
      r.s.costUsd = Math.round((settled + next) * 1e6) / 1e6;
      if (next > 0) r.s.costLiveUsd = Math.round(next * 1e6) / 1e6; else delete r.s.costLiveUsd;
    }
    if (p.contextEstimated === true) r.s.contextEstimated = true;
    else if (p.contextEstimated === false) delete r.s.contextEstimated;
    if (p.costKnown === true) delete r.s.costKnown;
    else if (p.costKnown === false && !r.s.costUsd) r.s.costKnown = false;
    if (p.totalCostUsd !== undefined) { r.costTotalUsd = p.totalCostUsd; save = true; }
    if (p.lastText !== undefined) r.s.lastText = p.lastText;
    if (p.background !== undefined) {
      if (p.background > 0) r.s.background = p.background;
      else if (r.s.background) { delete r.s.background; r.s.backgroundEndedAt = r.activeAt = Date.now(); }
    }
    if (p.version) this.version = p.version;
    if (p.call) {
      const a = r.after;
      if (a) { a.left--; if (a.left <= 0) r.after = undefined; }
      // the prompt cache per kind of chat, and whether a new session found its prefix cached (ContextStats.cache)
      const first = r.cacheSession !== r.s.sessionId;
      r.cacheSession = r.s.sessionId ?? undefined;
      this.counters.call(r.s.id, p.call, a ? a.kind : null, { kind: r.s.isOrchestrator ? 'orchestrator' : r.s.parentId ? 'child' : 'root', first });
    }
    if (p.compacted) {
      this.counters.compaction(r.s.id, p.compacted.pre, p.compacted.post);
      r.after = { kind: 'compaction', left: AFTER_CALLS };
      // the context starts again from its summary: an Orchestrator's next day compaction counts from now
      r.ctxSince = Date.now(); save = true;
      r.rolePrimed = undefined; // the summary may have dropped the role text: the next message carries it again
    }
    // the meter of a closed chat survives a restart: saved when it changes outside a turn; inside one, the turn's end
    // saves it (working → idle above), not a full chats.json write for nearly every assistant message (2026-10-29)
    if (p.contextTokens !== undefined && p.contextTokens > 0 && !r.working) save = true;
    if (save) this.persist();
    this.updated(r);
    // the turn that reported is over: its result goes now, after the chat shows as finished (#123)
    if (r.heldResult && p.state && p.state !== 'running' && p.state !== 'starting' && !this.midTurn(r)) this.releaseResult(r);
    // the Orchestrator's turn ended: a later turn the CLI starts by itself is not the user's (#123)
    if (r.s.isOrchestrator && r.turnFromUser && p.state && p.state !== 'running' && p.state !== 'starting' && !this.midTurn(r)) r.turnFromUser = false;
  }
}
