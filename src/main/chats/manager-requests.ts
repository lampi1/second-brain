// ChatManager layer (ADR 0200): questions and permissions. The user's answer, the gates a request passes before
// it reaches the user (role gate, read-only commands, auto-permit, «Modalità notte» ADR 0191), the away recap and
// the count of a run's requests and «Comando da eseguire» asks.
import type { Answer, PendingRequest } from '../../shared/contract';
import { errText, log } from '../log';
import { engineOf } from '../engines/registry';
import { allowsClass, COMMAND_TOOLS, commandsReadOnly, readOnlyCommand, toolClassOf, type ReadScripts } from '../agents/tool-policy';
import { readOnlyTools } from '../agents/read-tools';
import { gateRequest, runtimePluginName } from '../agents/role-gate';
import { autoPermit } from './auto-permit';
import { AWAY_PARKED, AWAY_PLAN_NOTE, recommendedAnswers } from '../../shared/away';
import { PLAN_APPROVED, withClarified } from '../../shared/strategy';
import type { SubmissionReceipt, Rec } from './manager-types';
import { sysItem } from './manager-helpers';
import { ManagerCheckpoints } from './manager-checkpoints';

/** Questions and permissions: the user's answer, the role gate, auto-permit, «Modalità notte», counted requests. */
export abstract class ManagerRequests extends ManagerCheckpoints {

  async answer(chatId: string, requestId: string, answer: Answer): Promise<void> {
    const r = this.need(chatId);
    if (!r.pending.has(requestId)) throw new Error('Questa richiesta non è più aperta.');
    if (!r.session) { this.dropPending(r, requestId); throw new Error('La chat non è più attiva: la richiesta è scaduta.'); }
    const req = r.pending.get(requestId)!;
    const ok = r.session.answer(requestId, answer);
    if (!ok) { this.dropPending(r, requestId); return; }
    // Full request scope stays private (ADR 0083); shared user events carry only the user's own choices/words.
    const decision = JSON.stringify({ requestId, title: req.title, detail: req.detail, questions: req.questions ?? [], answer });
    r.continuationDecisions = r.continuationDecisions ? `${r.continuationDecisions}\n${decision}` : decision;
    // one checkpoint carries the decision and the user's event: two synchronous checkpoints per click froze the window (#294)
    let saved = false;
    try {
      saved = answer.kind === 'question' ? this.userWrote(chatId, JSON.stringify({ requestId, answers: Object.values(answer.answers) }))
        : this.userWrote(chatId, JSON.stringify({ requestId, allow: answer.allow, ...(answer.message ? { message: answer.message } : {}) }));
    } finally { if (!saved) this.persist(true); } // the decision is on disk even when the event could not be recorded
    // a Strategist still asking: the answer is one more thing its strip shows as already clear (ADR 0108)
    const plan = r.s.plan;
    if (plan && (plan.phase === 'asking' || plan.phase === 'revising') && answer.kind === 'question' && req.questions?.length) {
      const next = withClarified(plan, req.questions, answer.answers);
      if (next !== plan) { r.s.plan = next; this.persist(); this.updated(r); }
    }
  }

  /** «Modalità notte» just went on (ADR 0191): what already waits for the user is settled the way a new request would be
   *  (recommended answer, parked permission) and a plan waiting on its strip starts. Returns how many it settled. */
  settleForAway(): number {
    if (!this.opts.away?.()) return 0;
    let n = 0;
    for (const r of this.chats.values()) {
      if (r.s.closedAt) continue;
      for (const req of [...r.pending.values()]) if (this.awayAnswered(r, req)) { this.dropPending(r, req.id); n++; }
      const plan = r.s.plan;
      if (plan?.phase === 'proposed') {
        n++;
        this.hook('onAway', () => this.opts.onAway?.({ kind: 'plan', chatId: r.s.id, title: r.s.title || 'Strategist', text: plan.steps.map(x => x.title).join(' · ') }));
        void this.decidePlan(r.s.id, 'approve', plan.at, undefined, `${PLAN_APPROVED}\n${AWAY_PLAN_NOTE}`, undefined, true)
          .catch(e => log.warn('chats', 'away: plan not started', { chat: r.s.id, cause: errText(e), hint: 'the plan stays on its strip for the user' }));
      }
    }
    if (n) log.info('chats', 'away: open requests settled', { data: { n } });
    return n;
  }

  /** What still waits for the user (for the recap when they are back): one line per open question or permission. */
  openForUser(): { title: string; what: string }[] {
    const out: { title: string; what: string }[] = [];
    for (const r of this.chats.values()) {
      if (r.s.closedAt) continue;
      for (const req of r.pending.values()) if (req.type !== 'command') out.push({ title: r.s.title || 'Chat', what: req.type === 'question' ? (req.questions?.[0]?.question ?? req.title) : `permesso ${req.tool}` });
      if (r.s.plan?.phase === 'proposed') out.push({ title: r.s.title || 'Strategist', what: 'piano da approvare' });
    }
    return out;
  }

  /** Puts the night's recap in the Orchestrator's chat (an app notice: no turn, no token). False = no open Orchestrator. */
  awayRecap(text: string): boolean {
    const o = this.openOrchestrator();
    if (!o) return false;
    this.addItem(o, sysItem('awayRecap', { text }, 'info'), false);
    this.updated(o);
    return true;
  }

  /** A "Comando da eseguire" request (run/asks.ts keeps it, not the engine): counted once on the chat's open run. */
  commandAsked(chatId: string, requestId: string): void {
    const r = this.chats.get(chatId);
    if (!r) return;
    this.countRequest(r, { id: requestId, type: 'command' });
    (r.commandsOpen ??= new Set()).add(requestId);
  }
  /** That request left (run, "Non serve", the chat went on): when nothing else waits, the stale clock starts again. */
  commandDone(chatId: string, requestId: string): void {
    const r = this.chats.get(chatId);
    if (!r?.commandsOpen?.delete(requestId)) return;
    if (!r.commandsOpen.size && !r.pending.size) this.idleAgain(r);
  }

  /** The role gate (agents/role-gate.ts) on a request before it reaches the user: an assigned skill is allowed at once,
   *  an unassigned one, an engine sub-agent other than a search and a request beyond the delegating chat's permissions
   *  are refused, visibly. True = answered here. */
  protected gated(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    const owner = r.s.agent, parent = r.s.parentId ? this.chats.get(r.s.parentId) : undefined;
    if (owner?.source !== 'catalog' || r.s.isOrchestrator) return false;
    const verdict = gateRequest(req, { role: { id: owner.id, name: owner.name }, skills: r.skills ?? [],
      rewrite: engineOf(r.s.harness)?.kind === 'claude',
      policy: r.policy ?? null, brainRoot: this.opts.brainRoot?.() ?? null, readScripts: this.readScripts(r),
      ...(r.agentAssets ? { plugin: runtimePluginName(r.agentAssets.pluginDir) } : {}),
      ...(r.s.parentId ? { parent: { policy: parent ? parent.policy ?? null : r.policy ?? null, title: parent?.s.title ?? r.s.parentId } } : {}) });
    if (verdict.kind === 'pass') return false;
    if (verdict.kind === 'allow') {
      r.session?.answer(req.id, { kind: 'permission', allow: true }, verdict.patch);
      log.info('chats', 'role gate allowed', { chat: r.s.id, data: { tool: req.tool, qualified: !!verdict.patch } });
      return true;
    }
    this.addItem(r, sysItem(verdict.code, verdict.params, 'warn'), false);
    r.session?.answer(req.id, { kind: 'permission', allow: false, message: verdict.message });
    log.info('chats', 'role gate refused', { chat: r.s.id, data: { tool: req.tool, code: verdict.code } });
    return true;
  }

  /** A role that may only read commands (shell-read): a command it asks to run that does not only read is refused at
   *  once, visibly, and never reaches the user, unless a delegating chat that may run any command is above it (beyond
   *  the role, within the parent: the user's call; one beyond the parent never got here, gated). One that reads, or
   *  that the user decides, reaches the user without "always" (a rule would let later commands through unchecked). */
  protected refusedCommand(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    if (req.type !== 'permission' || !COMMAND_TOOLS.includes(req.tool) || !commandsReadOnly(r.policy)) return false;
    const command = (req.input as { command?: unknown } | null)?.command;
    const parent = r.s.parentId ? this.chats.get(r.s.parentId) : undefined;
    const parentRuns = !!parent && !commandsReadOnly(parent.policy) && allowsClass(parent.policy, 'shell');
    if (readOnlyCommand(command, this.readScripts(r)) || parentRuns) { req.noAlways = true; delete req.alwaysRules; return false; }
    const shown = typeof command === 'string' ? command.slice(0, 120) : req.tool;
    log.info('chats', 'command refused: read-only role', { chat: r.s.id, data: { tool: req.tool } });
    this.addItem(r, sysItem('commandReadOnly', { command: shown }, 'warn'), false);
    r.session?.answer(req.id, { kind: 'permission', allow: false, message: `This role may only run commands that read (shell-read): ${shown} was refused. Use a reading command, or report what you need to your parent.` });
    return true;
  }

  /** ADR 0103: the app answers a permission request itself (chats/auto-permit.ts): normal work inside the chat's folder
   *  passes, a destructive command is refused visibly with its reason, anything else reaches the user. True = answered. */
  protected autoPermitted(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    // a class the role was not given, or a writing command of a role that may only read commands, stays the user's call
    // (Cursor and Codex do not enforce the role's tools themselves)
    const c = toolClassOf(req.tool);
    const command = (req.input as { command?: unknown } | null)?.command;
    if (r.policy?.tools && c && !allowsClass(r.policy, c)) return false;
    if (COMMAND_TOOLS.includes(req.tool) && commandsReadOnly(r.policy) && !readOnlyCommand(command, this.readScripts(r))) return false;
    const v = autoPermit(req, { cwd: r.s.cwd, ceiling: r.policy?.ceiling ?? null, undoable: !!r.turnCheckpoint, readScripts: this.readScripts(r) });
    if (v.kind === 'ask') return false;
    if (v.kind === 'allow') {
      r.session?.answer(req.id, { kind: 'permission', allow: true });
      log.info('chats', 'auto-permit allowed', { chat: r.s.id, data: { tool: req.tool } });
      return true;
    }
    this.addItem(r, sysItem('commandDestructive', { command: v.shown, reason: v.reason }, 'warn'), false);
    r.session?.answer(req.id, { kind: 'permission', allow: false, message: v.message });
    log.info('chats', 'auto-permit refused', { chat: r.s.id, data: { tool: req.tool } });
    return true;
  }

  /** «Modalità notte» (ADR 0191): nobody will answer, so a question gets its recommended option (shared/away.ts) and a
   *  permission is refused with a note to go on without it, parked for the user's return (never granted by the app). A
   *  command left for the user (Esegui) never blocks the chat: it stays in the queue. True = answered here. */
  protected awayAnswered(r: Rec, req: Omit<PendingRequest, 'chatId'>): boolean {
    if (req.type === 'command' || !this.opts.away?.()) return false;
    const title = r.s.title || r.s.agent?.name || 'Chat';
    if (req.type === 'question') {
      // Cursor's «plan ready» (cursor/create_plan) is a plan to approve like Claude's ExitPlanMode below: its first option
      const q0 = req.questions?.[0], plan = req.tool === 'CreatePlan' && q0?.options[0] ? { [q0.question]: q0.options[0].label } : null;
      const answers = plan ?? recommendedAnswers(req.questions ?? []);
      if (!answers) return false;
      const choice = Object.values(answers).flat().join(', ');
      if (!r.session?.answer(req.id, { kind: 'question', answers })) return false;
      this.addItem(r, sysItem('awayPicked', { choice }, 'info'), false);
      this.hook('onAway', () => this.opts.onAway?.({ kind: 'picked', chatId: r.s.id, title, text: `${req.questions?.[0]?.question ?? req.title} → ${choice}` }));
      log.info('chats', 'away: recommended answer', { chat: r.s.id, data: { questions: req.questions?.length ?? 0 } });
      return true;
    }
    // a plan mode's «plan ready» is a plan to approve, not a permission: it starts like a Strategist's plan, and every
    // permission the work then asks for still goes through the checks above or is parked here
    if (req.tool === 'ExitPlanMode') {
      if (!r.session?.answer(req.id, { kind: 'permission', allow: true })) return false;
      this.addItem(r, sysItem('awayPicked', { choice: 'Approva il piano' }, 'info'), false);
      this.hook('onAway', () => this.opts.onAway?.({ kind: 'plan', chatId: r.s.id, title, text: req.title || 'piano' }));
      return true;
    }
    if (!r.session?.answer(req.id, { kind: 'permission', allow: false, message: AWAY_PARKED })) return false;
    const what = `${req.tool}${req.detail ? `: ${req.detail}` : req.title ? `: ${req.title}` : ''}`;
    this.addItem(r, sysItem('awayParked', { what: what.slice(0, 160) }, 'warn'), false);
    this.hook('onAway', () => this.opts.onAway?.({ kind: 'parked', chatId: r.s.id, title, text: `permesso non concesso, ${what}` }));
    log.info('chats', 'away: permission parked', { chat: r.s.id, data: { tool: req.tool } });
    return true;
  }

  /** The brain's declared read-only tools (read-only-tools.md), resolved from the chat's folder (issue #93). */
  private readScripts(r: Rec): ReadScripts {
    return { cwd: r.s.cwd, paths: readOnlyTools(this.opts.brainRoot?.() ?? null) };
  }

  /** Each request once per run, by its id: question, permission or command. */
  protected countRequest(r: Rec, req: Pick<PendingRequest, 'id' | 'type'>): void {
    const run = r.s.run;
    if (!run || run.endedAt !== undefined || r.pending.has(req.id)) return;
    const seen = r.runSeen ??= new Set();
    if (seen.has(req.id)) return;
    seen.add(req.id);
    if (seen.size > 1000) seen.delete(seen.values().next().value!);
    run.counters[req.type === 'question' ? 'questions' : req.type === 'permission' ? 'permissions' : 'commands']++;
    this.runSave();
  }

  // ---- implemented in a later layer (ADR 0200: manager.ts and its manager-*.ts layers)
  abstract userWrote(chatId: string, text: string): boolean;
  protected abstract decidePlan(chatId: string, decision: 'approve' | 'change', at: number, text?: string, message?: string, receipt?: SubmissionReceipt, byApp?: boolean): Promise<void>;
  protected abstract openOrchestrator(): Rec | undefined;
}
