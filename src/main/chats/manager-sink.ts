// ChatManager layer (ADR 0200): the session sink. Each engine session reports items, questions and permissions and
// state patches; sinkFor turns them into the chat record and the contract events (chat:item, pending:added, chat:updated)
// and applyPatch applies a state change (turn start and end, the Orchestrator's own turn, held results). decideFor is
// the same permission chain for run_code's internal calls (Code Mode, ADR 0331; code-mode/bridge.ts).
import { isNativeQuestion } from '../../shared/yes-no';
import type { Answer, ChatItem, PendingRequest } from '../../shared/contract';
import { randomUUID } from 'node:crypto';
import { errText, log } from '../log';
import { permissionText } from './claude-map';
import { trimInput } from './session';
import { aboveCeiling, allowsClass, readOnlyCommand, toolClassOf } from '../agents/tool-policy';
import { claudeVerdict, readableBy, readClaudeRuleSet, type ClaudeRuleSet } from '../code-mode/claude-rules';
import { COMMAND_WRAPPERS } from '../code-mode/policy';
import { AFTER_CALLS } from './continuity';
import { HANDOFF_END, HANDOFF_START } from './handoff';
import type { HarnessSession, SessionPatch, SessionSink } from './session';
import { engineOf } from '../engines/registry';
import { addSkill, addTurn, skillOfRead } from '../agents/runs';
import { AgentChildrenReducer } from './agent-children';
import { effortValue, initialEffort, observeEffort, submitEffort } from './effort';
import type { Rec } from './manager-types';
import { ManagerLadder } from './manager-ladder';
import { CRASH_RESUME_TEXT, sysItem } from './manager-helpers';
import { pausedState } from './remote-control';
import { runtimePerformance } from '../runtime-performance';
import { maskTypedItem, maskTypedRequest } from './typed-text';

/** The app's verdict on one internal call of a run_code script (decideFor, ADR 0331): deny = an error the script
 *  sees; esegui = only the user runs it (the Esegui button), the script stops there. */
export type InternalVerdict = { kind: 'allow' } | { kind: 'deny'; message: string } | { kind: 'esegui'; message: string };
const refused = (message: string): InternalVerdict => ({ kind: 'deny', message });
/** decideFor's options: the run's signal (its end takes a pending panel away), and the user's wait (start, length). */
export interface DecideOpts { signal?: AbortSignal; asking?: () => void; waited?: (ms: number) => void }

/** What a session reports (items, requests, state patches) turned into the chat record and contract events. */
export abstract class ManagerSink extends ManagerLadder {
  /** The one permission chain for a run_code internal call (ADR 0331), in the order a native call meets it: the chat
   *  must be live in Code Mode; in plan mode a write is refused; a Claude chat's own deny rules refuse and its ask
   *  rules send the call to the user (code-mode/claude-rules.ts, fail closed); a tool class its role was not given
   *  is refused (as Claude's --tools would); the chat's in-process PreToolUse hook and the brain's product guard may refuse it; then the same gates as a native
   *  request (gateDecision: role gate, read-only commands, auto-permit). A request they leave to the user is shown as
   *  his panel, with no «always» (no engine would keep the rule), and waits for his answer: `asking` says the wait
   *  began and `waited` gets the time spent, which never counts against the script's limits. A refusal by a brain
   *  rule shows its line in the chat, as a native one does; its message reaches the model as the call's error. */
  async decideFor(chatId: string, tool: string, input: unknown, opts: DecideOpts = {}): Promise<InternalVerdict> {
    const r = this.chats.get(chatId);
    if (!r?.session || !r.codeMode) return refused('This chat does not run in Code Mode: run_code cannot call tools for it.');
    if (opts.signal?.aborted) return refused('The call was cancelled.');
    // plan mode only reads (as Claude's own plan mode): no file write, no command that does not only read
    if (r.s.permissionMode === 'plan') {
      const command = (input as { command?: unknown } | null)?.command;
      const shell = COMMAND_WRAPPERS.includes(tool);
      if (tool === 'Write' || tool === 'Edit' || (shell && !readOnlyCommand(command, this.readScripts(r)))) {
        log.info('chats', 'code mode: write refused in plan mode', { chat: chatId, data: { tool } });
        return refused(`The chat is in plan mode: ${shell ? 'only commands that read run' : `${tool} is not allowed`}. Present the plan instead.`);
      }
    }
    // Claude's own deny and ask rules (its settings files, the session's --settings, the stable app's guard rails):
    // a native call meets them in the CLI, an internal one here; rules that cannot be read refuse every call
    const ctx = this.codeModeRules(r);
    if ('error' in ctx) return refused(ctx.error);
    const claude = ctx.set ? claudeVerdict(ctx.set, tool, input, ctx.cwd) : null;
    if (claude?.kind === 'deny') {
      log.info('chats', 'code mode: denied by Claude settings', { chat: chatId, data: { tool, rule: claude.rule } });
      return refused(`Permission to use ${tool} has been denied by the user's Claude settings (${claude.rule}).`);
    }
    const c = toolClassOf(tool);
    if (r.policy?.tools && c && !allowsClass(r.policy, c)) {
      log.info('chats', 'code mode: tool class not given to the role', { chat: chatId, data: { tool } });
      return refused(`${tool} is not among this role's tools.`);
    }
    try {
      const pre = await r.preToolUse?.decide({ tool, input });
      if (pre) return refused(pre.deny);
    } catch (e) { log.warn('chats', 'code mode: the chat\'s PreToolUse hook failed, the call goes on', { chat: chatId, cause: errText(e), hint: 'as on the native path, a failing hook never blocks a call' }); }
    if (this.opts.productGuard) {
      let why: string | null;
      // a guard that cannot read the brain fails closed, as its runner does on the native path
      try { why = this.opts.productGuard({ chatId, sessionId: r.s.sessionId ?? chatId, tool, input }); }
      catch (e) { why = 'Product safety guard could not verify this operation.'; log.warn('chats', 'code mode: product guard failed: call refused', { chat: chatId, cause: errText(e), hint: 'check brain.json and the rules folder' }); }
      if (why) return refused(why);
    }
    const t = permissionText(tool, input, { cwd: ctx.cwd });
    const req: Omit<PendingRequest, 'chatId'> = { id: `code-${randomUUID()}`, type: 'permission', tool, title: `(run_code) ${t.title}`, detail: t.detail, input, at: Date.now(), noAlways: true };
    const d = this.gateDecision(r, req, true);
    // a Claude «ask» rule, or an app tool in plan mode: the gates may refuse it, never allow it without the user
    const userOnly = claude?.kind === 'ask' || (r.s.permissionMode === 'plan' && tool.startsWith('mcp__'));
    if (d.kind === 'allow' && !userOnly) return { kind: 'allow' };
    if (d.kind === 'deny') {
      this.addItem(r, d.item, false);
      this.updated(r);
      return d.rule?.action === 'esegui' ? { kind: 'esegui', message: d.message } : refused(d.message);
    }
    return this.askInternal(r, { ...req, input: trimInput(input) }, opts);
  }

  /** Where run_code's wrappers work for this chat and what they meet (ADR 0331): the folder (a Claude --worktree
   *  chat's worktree, once its engine named it), the chat's own engine environment, and a Claude chat's rules (a
   *  search leaves out files a Read deny covers). An error: they cannot run (fail closed). */
  codeModeContext(chatId: string): { cwd: string; env: NodeJS.ProcessEnv; readable?: (abs: string) => boolean } | { error: string } {
    const r = this.chats.get(chatId);
    if (!r?.session || !r.codeMode) return { error: 'This chat does not run in Code Mode.' };
    const ctx = this.codeModeRules(r);
    if ('error' in ctx) return ctx;
    return { cwd: ctx.cwd, env: ctx.env, ...(ctx.set ? { readable: readableBy(ctx.set, ctx.cwd) } : {}) };
  }

  /** A Code Mode chat's folder, env and (Claude) rule set, read again at each call: a settings file changed mid-run
   *  applies at once. */
  private codeModeRules(r: Rec): { cwd: string; env: NodeJS.ProcessEnv; set: Extract<ClaudeRuleSet, { ok: true }> | null } | { error: string } {
    const chatEnv = { ...process.env, ...this.opts.env, SB_EVENT_CONTEXT: '' };
    if (engineOf(r.s.harness)?.kind !== 'claude') return { cwd: r.s.cwd, env: chatEnv, set: null };
    const ctx = r.session?.toolContext?.();
    if (!ctx) return { error: 'Claude\'s permission rules for this chat cannot be read: run_code refuses every call.' };
    if (!ctx.cwd) return { error: 'The chat\'s worktree is not known yet: run the call again in a moment.' };
    const set = readClaudeRuleSet({ files: ctx.files, inline: ctx.inline, cwd: ctx.cwd });
    if (!set.ok) {
      log.warn('chats', 'code mode: Claude settings unreadable, every call refused', { chat: r.s.id, cause: set.error, hint: 'fix the settings file: Claude itself would not start the same way' });
      return { error: `Claude's settings cannot be read (${set.error}): run_code refuses every call until they can.` };
    }
    return { cwd: ctx.cwd, env: ctx.env, set };
  }

  /** An internal call the gates left to the user: his panel, as a native request is shown (night mode may answer it),
   *  settled by deliverAnswer through internalAsks; the script's call cancelled (its MCP request gone) takes it away. */
  private askInternal(r: Rec, req: Omit<PendingRequest, 'chatId'>, opts: DecideOpts): Promise<InternalVerdict> {
    const started = Date.now();
    opts.asking?.();
    return new Promise<InternalVerdict>(resolve => {
      const finish = (v: InternalVerdict): void => {
        opts.signal?.removeEventListener('abort', cancel);
        opts.waited?.(Date.now() - started);
        resolve(v);
      };
      // whoever takes the waiter out settles it, once: deliverAnswer (the user, night mode) or here
      const done = (v: InternalVerdict): void => { if (this.internalAsks.delete(req.id)) finish(v); };
      const cancel = (): void => { if (!this.internalAsks.has(req.id)) return; done(refused('The call was cancelled.')); this.dropPending(r, req.id); };
      this.internalAsks.set(req.id, (a: Answer) => finish(a.kind === 'permission' && a.allow ? { kind: 'allow' }
        : refused(a.kind === 'permission' && a.message ? `The user refused this call: ${a.message}` : 'The user refused this call.')));
      if (opts.signal?.aborted) { cancel(); return; }
      opts.signal?.addEventListener('abort', cancel);
      try { this.exposeRequest(r, maskTypedRequest(req)); }
      catch (e) {
        log.warn('chats', 'code mode: internal request not shown', { chat: r.s.id, cause: errText(e), hint: 'the script gets a refusal; read the request journal' });
        done(refused('The request could not be shown to the user.'));
      }
    });
  }

  /** One compact row in the chat for a run_code internal call (ADR 0331): name, input, decision, outcome. replace = the
   *  same row updated (running → its outcome). */
  codeModeRow(chatId: string, item: Extract<ChatItem, { kind: 'tool' }>, replace = false): void {
    const r = this.chats.get(chatId);
    if (!r) return;
    this.addItem(r, maskTypedItem(item), replace);
    this.updated(r);
  }

  /** A request past the gates: answered by night mode, held by the agent above (a worker's question, ADR 0344), else
   *  shown (also a held twin whose first left, #379). */
  protected exposeRequest(r: Rec, req: Omit<PendingRequest, 'chatId'>): void {
    if (this.awayAnswered(r, req) || this.ladderHeld(r, req)) return;
    this.reveal(r, { ...req, chatId: r.s.id });
  }
  /** Shows a request in the user's row. */
  protected override reveal(r: Rec, full: PendingRequest): void {
    const req = full;
    this.hook('analytics', () => this.analytics.pending(r.s, req));
    this.autoActivity(r);
    this.countRequest(r, req);
    if (r.s.isOrchestrator && isNativeQuestion(req) && req.questions?.length === 1) r.intakePanelId = req.id;
    // beside a question an agent holds the chat read as at work: this one is the user's (ADR 0344)
    if (r.s.state === 'running' && [...r.pending.values()].some(p => p.ladder)) r.s.state = 'waiting';
    r.pending.set(req.id, full);
    r.s.pending = this.shownPending(r);
    this.opts.emitter.emit('pending:added', full);
    this.updated(r);
    const on = this.opts.onWaiting;
    if (on) this.hook('onWaiting', () => on(r.s.id, full));
  }


  /** The chat's side of a session: every report lands in r while current() is r's session. */
  protected override sinkFor(r: Rec, current: () => HarnessSession | null): SessionSink {
    const chatId = r.s.id;
    const live = (): boolean => { const sess = current(); return !!sess && r.session === sess && this.chats.get(chatId) === r; };
    return {
      item: (item, replace) => {
        if (!live()) return;
        if (item.kind !== 'result') runtimePerformance.item(chatId, item.kind, item.kind === 'assistant' && !!item.text, r.replaying === r.session);
        item = maskTypedItem(item);      // what an agent typed into a page (a password, ADR 0237) never reaches the feed
        // a replayed past (a resume) is no answer of the engine: its cold start goes on
        if (item.kind !== 'user' && item.kind !== 'system' && r.replaying !== r.session) this.coldStarted(r);
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
        if (r.replaying !== r.session) this.afterWords(r, item, !!replace);
        if (item.kind === 'result') runtimePerformance.item(chatId, item.kind, false, r.replaying === r.session);
        // a skill Claude loaded while the run is open joins its tags (only Claude reports skills as a tool)
        if (item.kind === 'tool' && item.name === 'Skill' && r.s.harness === 'claude' && r.s.run) {
          const input = item.input as { skill?: unknown; command?: unknown } | null;
          if (addSkill(r.s.run, input?.skill ?? input?.command)) { this.runSaveSoon(); this.updated(r); }
        }
        // any other engine: the skill it opened by reading its SKILL.md (they have no Skill tool); the card shows it at once
        if (item.kind === 'tool' && r.s.harness !== 'claude' && r.s.run) {
          if (addSkill(r.s.run, skillOfRead(item.input, item.name))) { this.runSaveSoon(); this.updated(r); }
        }
        if (item.kind === 'tool' && r.s.run) this.noteReceipt(r, item);
        if (item.kind === 'result' && !replace) { delete r.crashResumed; this.turnEnded(r, item); }
      },
      pending: (req, whole) => {
        if (!live()) return;
        this.coldStarted(r);
        // only the app's gate says a brain rule holds a request (it may then be answered from the phone): never an engine
        if ('heldBy' in req || 'ladder' in req) { req = { ...req }; delete req.heldBy; delete req.ladder; }
        // the gates read the input as the engine sent it (ADR 0290): the one in the request is shortened for the screen
        const shown = req.input;
        if (whole !== undefined) req = { ...req, input: whole };
        if (this.answeredByGates(r, req, whole !== undefined)) return;
        // what the gates marked on the request (no «always», the rule that holds it) stays; its input is the short one again
        if (whole !== undefined) req = { ...req, input: shown };
        // decided on the real input above; parked for night mode, shown and kept masked from here (ADR 0237)
        req = maskTypedRequest(req);
        if (this.heldAsRepeat(r, req) || this.heldAsTwin(r, req)) return;
        this.exposeRequest(r, req);
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
      resolved: id => { if (this.chats.get(chatId) === r) { this.dropPending(r, id); this.showTwins(r, id); } },
      changed: p => {
        if (!live()) return;
        // kept as the replaying session: an engine that exits mid-replay leaves no flag on its successor
        if (p.replaying !== undefined) { r.replaying = p.replaying ? r.session ?? undefined : undefined; return; }
        this.applyPatch(r, p);
      },
      exit: ({ error }) => {
        const sess = current();
        // only the current engine's exit ends its cold start: an old, replaced engine exiting late must not free the slot
        if (this.chats.get(chatId) === r && (!r.session || r.session === sess)) this.coldStarted(r);
        if (!sess || this.chats.get(chatId) !== r || r.session !== sess) return;
        runtimePerformance.fail(chatId);
        this.hook('analytics', () => this.analytics.end(r.s));
        r.session = null;
        this.wordsPast(r);
        delete r.replaying; // its replay, if any, ended with it
        const verifiedEmpty = r.autoEnding && !error && r.children?.snapshot().coverage === 'complete' && r.children.snapshot().active === 0;
        if (engineOf(r.s.harness)?.kind !== 'api' && !verifiedEmpty) r.children?.end();
        if (r.children) r.s.agentChildren = r.children.snapshot();
        // gone mid-turn (crash, close, kill): no result will settle the estimate, which stays as spent (no "≈")
        delete r.s.costLiveUsd;
        delete r.turnAt; // its turn is over, result or not
        r.turnChained = false;
        r.handoffTurn?.done(null);
        delete r.s.background; // its background tasks died with it
        // its Remote Control bridge went with it: on, it comes back with the next engine (manager-remote.ts)
        if (r.s.remoteControl) r.s.remoteControl = pausedState(r.s.remoteControl);
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
        if (crashed) this.recoverCrash(r);
      },
    };
  }

  /** One recovery after an engine crashed mid-turn (ADR 0238; cloudroom: one recovery attempt after cleanup): the
   *  chat restarts on its own session with CRASH_RESUME_TEXT and re-reads its state; nothing of the crashed turn is
   *  sent again. A second crash in the same turn, a chat the user closed and the maintenance research stay as
   *  they are (an error the user or the parent sees). */
  private recoverCrash(r: Rec): void {
    // a delegated child is not resumed: owedReport already gave its parent a blocked result, the parent decides (#152)
    if (r.crashResumed || r.s.delegation || r.s.research || this.closedByUser(r)) return;
    r.crashResumed = true;
    const chatId = r.s.id;
    setTimeout(() => {
      if (this.quitting || this.chats.get(chatId) !== r || r.s.closedAt || r.working) return;
      r.s.resumedAt = Date.now();
      this.updated(r);
      log.info('chats', 'resuming a chat after its engine crashed', { chat: chatId });
      this.send(chatId, CRASH_RESUME_TEXT, undefined, true, undefined, false, { kind: 'app' }).catch(e => {
        log.warn('chats', 'resume after a crash failed', { chat: chatId, cause: errText(e), hint: 'the chat stays in error: a message resumes it' });
        if (r.s.resumedAt) { delete r.s.resumedAt; this.updated(r); }
      });
    }, 0);
  }

  /** An engine that ignored the user's stop (SessionPatch.restart): it ends now, the next message (the user's «Invia
   *  subito») waits for that in ensureSession and resumes the same session on a new engine; messages it had queued
   *  but never sent go there first, as composed (their transcript rows are already shown). */
  private restartEngine(r: Rec, sess: HarnessSession, carry: NonNullable<SessionPatch['restart']>): void {
    const chatId = r.s.id;
    log.info('chats', 'engine restart after an unanswered stop', { chat: chatId, data: { harness: r.s.harness, carried: carry.length } });
    r.releasing = this.closeKeeping(r, sess).finally(() => { r.releasing = undefined; });
    if (!carry.length) return;
    void r.releasing.then(async () => {
      if (this.chats.get(chatId) !== r || this.quitting || this.resendDropped(r, carry.length)) return;
      await this.ensureSession(r);
      if (this.resendDropped(r, carry.length)) return;
      for (const m of carry) r.session?.send(m.text, m.images);
    }).catch(e => {
      log.warn('chats', 'queued messages not resent after an engine restart', { chat: chatId, cause: errText(e), hint: 'the user sends them again', data: { carried: carry.length } });
      // their rows already look sent: the chat says they were not
      if (this.chats.get(chatId) === r) this.addItem(r, sysItem('restartResendFailed', { n: carry.length }, 'warn'), false);
    });
  }

  /** The user's ✕ came while the engine restarted (ADR 0217): the chat stays closed, its queued messages go with its work. */
  private resendDropped(r: Rec, carried: number): boolean {
    if (!this.closedByUser(r)) return false;
    log.info('chats', 'queued messages dropped: the user closed the chat during an engine restart', { chat: r.s.id, data: { carried } });
    return true;
  }

  private applyPatch(r: Rec, p: SessionPatch): void {
    this.hook('analytics', () => this.analytics.patch(r.s, p));
    if (!(r.autoClosing || r.autoEnding) || p.state !== 'closed') this.autoActivity(r);
    let save = false;
    if (p.restart && r.session && !r.releasing) this.restartEngine(r, r.session, p.restart);
    if ('effortSubmitted' in p) r.s.effortStatus = submitEffort(r.s.effortStatus ?? initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort), p.effortSubmitted);
    if ('effortObserved' in p) r.s.effortStatus = observeEffort(r.s.effortStatus ?? initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort), p.effortObserved);
    if ('effortSessionDefault' in p) r.s.effortStatus = { ...(r.s.effortStatus ?? initialEffort(!!engineOf(r.s.harness)?.caps.effort, r.choice.effort)), sessionDefault: effortValue(p.effortSessionDefault) };
    if (p.state) {
      const was = r.s.state;
      // a cold note's turn is invisible (ADR 0031): the tile stays as it was
      if (!(r.handoffTurn?.quiet && (p.state === 'running' || p.state === 'starting'))) r.s.state = p.state === 'waiting' && this.allHeld(r) ? 'running' : p.state; // held by an agent: not the user's
      // a hand-off turn is not the chat's work: never resumed after a restart
      if ((p.state === 'running' || p.state === 'waiting') && !r.working && !r.handoffTurn) {
        r.working = true; save = true;
        // it works again (the user wrote to it, it was reassigned): its question about the stopped step is old (#358)
        if (r.userActionAsk) this.dropUserAsks(q => q.id === r.userActionAsk);
      }
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
    // the reply is complete, the engine only closes the turn (ADR 0318): what shows work stops, the state stays
    if (p.closing === true && r.s.state === 'running' && !r.handoffTurn?.quiet) r.s.turnClosing = true;
    else if (p.closing === false) delete r.s.turnClosing;
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
    else if (p.state === 'idle' || p.state === 'error' || p.state === 'closed') { delete r.turnAt; r.turnChained = false; }
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
      // one line per settled turn on every engine, with Code Mode's flag: the A/B reads tokens, turns and time here
      // (`npm run logs -- --scope chats --grep "timing: turn usage"`, ADR 0331)
      log.info('chats', 'timing: turn usage', { chat: r.s.id, data: { harness: r.s.harness, codeMode: r.codeMode === true, tokens: p.turnTokens ?? null, costUsd: p.turnCostUsd,
        turns: owner?.turns ?? null, turnMs: r.turnAt !== undefined ? Date.now() - r.turnAt : null } });
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
    if (p.remote && r.s.remoteControl?.on) {
      // a lost bridge is off for good: the user turns it on again (a new link)
      r.s.remoteControl = p.remote.status === 'failed'
        ? { on: false, url: null, bridgeSessionId: null, status: 'failed', ...(p.remote.error ? { error: p.remote.error } : {}) }
        : { ...r.s.remoteControl, status: p.remote.status };
      if (p.remote.status === 'failed') save = true;
    }
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
