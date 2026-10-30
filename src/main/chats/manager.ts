// ChatManager = the ChatService of the app (src/main/services.ts): every chat the user runs inside the cockpit, on one of
// the engines of the registry (engines/registry.ts, ADR 0046; today Claude, embedded binary, and Cursor over ACP): it
// asks an engine's caps, never its name, and gets the session from engines/sessions.ts.
// It owns the chat records (summary, items capped at ~2000, open questions/permissions), starts one engine session per
// chat on demand, turns session reports into contract events (chat:updated, chat:item with replace for streaming,
// pending:added/resolved, chat:removed), persists the chats (store.ts) and restores them as 'closed' on start; the
// first message to a closed chat resumes it (Claude --resume after loading its past from the transcript, transcript.ts;
// Cursor session/load). A finished chat can be archived (closedAt: its process ends, the record and transcript stay,
// the palette lists it under "Chiuse", Ctrl+K) and reopened; a message to an archived chat reopens it. A turn cut by a quit or
// crash (persisted "working") resumes by itself on the next start (resumeInterrupted). An app Claude chat can be forked (a copy, never two writers on one transcript). There is
// one Orchestrator, created only by the user; one created with `replaces` takes that one's role (the old one goes on as a
// normal chat). Long chats:
// each chat carries its context size (Claude: get_context_usage; Cursor: an estimate); every Claude engine gets the
// compaction window (option compactWindowTokens, ADR 0031); continueChat ("Riprendi") opens a NEW chat from a hand-off
// note, linked to the old one (handoff.ts); a cold chat (idle, long, Claude) writes its note quietly while the cache is
// warm and a message after the cache expired goes on in a fresh session of the same chat (coldTick / coldSwitch, ADR
// 0031), counted with the other context numbers (context-stats.ts, contextStats()). Brain hooks
// (options onRateLimit, onTurnEnd, onWaiting, onDone; method isOwnSession) let wiring.ts feed the brain
// without this module knowing it. Wired in src/main/wiring.ts.
// The class is built in layers, one concern per file (ADR 0200), each an abstract class extending the one before:
// manager-core.ts (state, items) → -persistence (chats.json, runs) → -sessions (engines) → -checkpoints → -requests
// (questions, permissions) → -continuity (hand-offs, cold notes) → -delegation (reports) → -lifecycle (stop, archive,
// auto-close) → -work (assignments, user events, plans) → -sink (session reports) → this file: the ChatService entry
// points (list, create, send and deliver, Flash, set). Shapes in manager-types.ts, constants in manager-helpers.ts.
import crypto from 'node:crypto';
import type { ModelTier } from '../../shared/roles';
import fs from 'node:fs';
import type { AgentContextSnapshot } from '../../shared/agent-context';
import path from 'node:path';
import type { ChatCommand, ChatItem, ChatSummary, Effort, Harness, NewChat, PendingRequest, PermissionMode } from '../../shared/contract';
import { replyLangTurn } from './reply-lang';
import { voiceReplyHint } from './voice-reply';
import { checkImages } from './images';
import { errText, log } from '../log';
import type { ChatService } from '../services';
import { coldPrompt } from './handoff';
import { cut, isUuid, nextId } from './session';
import { updateActivity } from '../update/activity';
import { PLAIN_LAUNCH } from './warm';
import { isAppChat } from '../brain/routing';
import { engineOf, engineOrThrow } from '../engines/registry';
import { ORCHESTRATOR_TITLE } from '../../shared/orchestrator';
import { plainOwner, type ResolvedRole } from '../agents/catalog';
import { withinParent } from '../agents/worktrees';
import { FAIL_CLOSED, aboveCeiling, belowParent, narrowest, within, type AgentPolicy } from '../agents/tool-policy';
import type { AgentOwnerSnapshot } from '../../shared/agents';
import type { RunLinks } from '../agents/runs';
import { newRequest } from '../agents/task-estimate';
import { AWAY_BACK, AWAY_RULE } from '../../shared/away';
import type { TaskSource } from '../../shared/delegation';
import { isPlanApproval, stopsQuestions, STRATEGY_FLOW } from '../../shared/strategy';
import { isCorrection } from '../../shared/correction';
import { initialEffort, selectEffort } from './effort';
import { orchestratorRole, roleFrame } from '../agents/orchestrator-role';
import { slug as slugTitle } from './mail';
import { splitMode } from '../../shared/newchat';
import { orchestratorContext } from './lampo-context';
import { recallWarning } from '../search/hybrid/recall';
import type { SubmissionReceipt, Rec } from './manager-types';
import { sysItem, MODES, LAMPO_TITLE, LAMPO_POLICY, RESEARCH_TITLE, RESEARCH_FRAME, LAMPO_FRAME, FOLLOW_UP_WINDOW_MS, USER_NOTES_LABEL, EFFORTS, MODEL_ID, startTags, repoOf } from './manager-helpers';
import { ManagerSink } from './manager-sink';
export { RESUME_TEXT, turnReply, workBehind, WAITING_REASON, lastAnswer, LAMPO_TITLE, RESEARCH_TITLE, RUN_SAVE_MS, USER_NOTES_LABEL, userNoteLine, restoredOwner, startTags, repoOf } from './manager-helpers';
export type { ChatManagerOptions, HandoffOptions, TurnEndInfo, CleanReportNote, UserWroteNote } from './manager-types';

export class ChatManager extends ManagerSink implements ChatService {

  // ---- ChatService ----

  /** Every chat, oldest first. Called many times a second (the automatic archive's tick, the mailbox, the app MCP):
   *  the result ids come from one pass over the runs (resultIndex), never one pass per chat (O(chats × runs) froze the
   *  window every second with ~75 chats and ~800 runs, 2026-10-27). */
  override list(): ChatSummary[] {
    const index = this.resultIndex();
    return [...this.chats.values()].sort((a, b) => a.createdAt - b.createdAt).map(r => { this.refreshTaskSummary(r, index); return { ...r.s }; });
  }
  /** One chat's summary, without building the whole list (mail.hasWork asks it for each open chat every second). */
  summary(chatId: string): ChatSummary | undefined {
    const r = this.chats.get(chatId);
    if (!r) return undefined;
    this.refreshTaskSummary(r);
    return { ...r.s };
  }

  items(chatId: string): ChatItem[] {
    const r = this.chats.get(chatId);
    if (!r) return [];
    this.ensureHistory(r);
    return r.items.slice();
  }

  /** The commands its engine reported, null when it has not reported any yet (the caller falls back to the disk). */
  commands(chatId: string): ChatCommand[] | null {
    return this.chats.get(chatId)?.commands ?? null;
  }

  /** The tool policy and ceiling this chat runs with (null = none: the engine's own gates); agent_delegate bounds a child by it. */
  agentPolicy(chatId: string): AgentPolicy | null { const p = this.chats.get(chatId)?.policy; return p ? structuredClone(p) : null; }
  pending(): PendingRequest[] {
    return [...this.chats.values()].flatMap(r => [...r.pending.values()]).sort((a, b) => a.at - b.at);
  }

  /** links = the run links an Orchestrator tool sets (A7): refused before anything starts when one names an unknown run. */
  /** by: who asks; 'app' = one of the app's own jobs (the sampled Sentinel reviews, agents/judge-sample.ts): like an agent, its run says startedBy 'app' */
  override async create(req: NewChat, by: 'user' | 'agent' | 'app' = 'user', inherited?: { launchContext?: AgentContextSnapshot; tier?: ModelTier; routinePackage?: string; owner: AgentOwnerSnapshot; instructions: string; policy?: AgentPolicy | null; assets?: { pluginDir: string; skillRoot: string }; skills?: string[]; maxContext?: number }, links: RunLinks = {}, opts: { routine?: ChatSummary['routine']; boundByOrchestrator?: boolean; continuation?: boolean; continuationOf?: string } = {}): Promise<ChatSummary> {
    if (opts.routine || inherited?.routinePackage) throw new Error('Routine execution is terminal-only.');
    const createdT0 = Date.now();
    this.deliveryPolicy(req.deliveryPolicy, !!req.parentId);
    if (req.doneWhen && (req.doneWhen.length > 12 || req.doneWhen.some(x => typeof x !== 'string' || !x.trim() || x.length > 300))) throw new Error('Invalid task criteria.');
    updateActivity.assertOpen();
    links = { ...links, ...(req.parentRunId !== undefined ? { parentRunId: req.parentRunId } : {}), ...(req.reviewOf !== undefined ? { reviewOf: req.reviewOf } : {}), ...(req.reworkOf !== undefined ? { reworkOf: req.reworkOf } : {}) };
    if (req.goal !== undefined && (typeof req.goal !== 'string' || !req.goal.trim() || req.goal.length > 2000)) throw new Error('Run goal must contain 1 to 2000 characters.');
    if (Object.values(links).some(v => v !== undefined)) this.runs.checkLinks(links);
    const asked = startTags(req);
    if (req.quick) {
      if (by !== 'user' || req.orchestrator || req.parentId || req.roleId) throw new Error('Flash: only the user opens it, as a plain chat.');
      const current = this.list().find(c => c.quick && !c.closedAt);
      if (current) return current;
      req = { ...req, title: LAMPO_TITLE, permissionMode: 'plan' };
    }
    if (req.research) {
      if (by !== 'app' || req.orchestrator || req.parentId || req.roleId || req.quick) throw new Error('The maintenance research is the app\'s own chat.');
      req = { ...req, title: RESEARCH_TITLE, permissionMode: 'default' };
    }
    if (req.orchestrator) {
      if (by !== 'user') throw new Error('Only the user can create the Orchestrator.');
      const current = this.list().find(c => c.isOrchestrator && !c.closedAt);
      // one Orchestrator: only a replacement of the current one (Cambia motore, Ricomincia) creates another
      if (current && req.replaces !== current.id) return current;
      req = { ...req, orchestrator: true, title: ORCHESTRATOR_TITLE };
    }
    const agent: Pick<ResolvedRole, 'request' | 'owner' | 'instructions' | 'policy' | 'maxContext' | 'tier' | 'launchContext'> & { skills?: string[]; launches?: string[]; assets?: { pluginDir: string; skillRoot: string } } = inherited ? { ...inherited, policy: inherited.policy ?? null, request: req }
      // Flash reads and answers: read and web tools only, plan mode (no edit, no command, no popup), its own short frame
      // Flash (ADR 0107): its card's engine, model and instructions, under the fixed frame and the read-only policy
      : req.quick ? this.flashAgent(req)
      : req.research ? { request: req, owner: { ...plainOwner(req.harness, req.model ?? null), name: RESEARCH_TITLE }, instructions: RESEARCH_FRAME,
        policy: { tools: { allow: req.research.web ? ['read', 'web'] : ['read'] }, ceiling: 'default' } }
      : this.opts.resolveAgent?.(req) ?? { request: req, owner: plainOwner(req.harness, req.model ?? null), instructions: '', policy: null };
    req = agent.request;
    // a delegated chat (agent_delegate): only an agent's, under a live parent, in the parent's folder, linked to its run
    const delegator = req.parentId !== undefined ? await this.delegator(req, by, opts.continuation === true) : undefined;
    if (delegator?.s.run) links = { ...links, parentRunId: delegator.s.run.runId };
    // never wider than the chat it comes from: a fork of its session (and an Orchestrator renewed without a role policy).
    // A root chat the Orchestrator opens is bound by its own role (and the user's defaults), not by the Orchestrator's
    // policy: the Orchestrator plans, the Artisan it starts writes (ADR 0083)
    const forkSrc = req.resumeSessionId?.trim() ? [...this.chats.values()].find(r => r.s.sessionId === req.resumeSessionId?.trim()) : undefined;
    if (forkSrc?.s.routineArchived || forkSrc?.s.routine || forkSrc?.s.routinePackage) throw new Error('Archived routine chats cannot be forked.');
    // a chat from the unauthenticated /mcp/app mount (any local process can call it) runs no wider than the Orchestrator
    const bound = opts.boundByOrchestrator ? [...this.chats.values()].find(r => r.s.isOrchestrator && !r.s.closedAt) : undefined;
    if (opts.boundByOrchestrator && !bound) throw new Error('Senza un Orchestrator aperto questo endpoint non apre chat.');
    // a new Orchestrator the user starts (Ricomincia, Cambia motore) runs its role as the catalog says now (the user edits
    // it in Agenti, ADR 0085): the old chat's frozen policy bounds it only when the role has none
    const renewed = req.orchestrator && by === 'user' && !!agent.policy;
    const parent = delegator ?? forkSrc ?? (req.replaces && !renewed ? this.chats.get(req.replaces) : undefined) ?? bound;
    // a delegated chat: its role's policy, below its parent's, narrowed again by the contract's tool classes. A chat from
    // the unauthenticated mount reads only, in plan mode, whatever the Orchestrator may (ADR 0085: the Orchestrator's
    // default is every permission, the mount is any local process)
    const policy = delegator ? narrowest(belowParent(agent.policy, delegator.policy, this.modeFor(delegator)), req.delegation?.tools ? { tools: { allow: req.delegation.tools }, ceiling: null } : null)
      : narrowest(agent.policy, parent === bound && bound ? narrowest(bound.policy, FAIL_CLOSED) : parent?.policy);
    let bindDelegation: ((childId: string) => void) | undefined;
    if (delegator && this.opts.prepareDelegation) {
      const parentPermissions = JSON.stringify({ policy: delegator.policy, mode: this.modeFor(delegator) });
      const prepared = await this.opts.prepareDelegation(structuredClone(delegator.s), req, policy, opts.continuationOf);
      if (delegator.s.closedAt || delegator.s.run?.endedAt !== undefined || delegator.s.run?.report?.via === 'agent_report' || delegator.s.delegation?.result || delegator.s.run?.runId !== prepared.parentRunId || delegator.s.run?.taskVersion !== prepared.parentTaskVersion) throw new Error('Parent assignment changed while preparing isolation.');
      if (parentPermissions !== JSON.stringify({ policy: delegator.policy, mode: this.modeFor(delegator) })) throw new Error('Parent permissions changed while preparing isolation.');
      req = { ...req, cwd: prepared.cwd };
      bindDelegation = id => {
        if (delegator.s.closedAt || delegator.s.run?.endedAt !== undefined || delegator.s.run?.report?.via === 'agent_report' || delegator.s.delegation?.result || delegator.s.run?.runId !== prepared.parentRunId || delegator.s.run?.taskVersion !== prepared.parentTaskVersion
          || parentPermissions !== JSON.stringify({ policy: delegator.policy, mode: this.modeFor(delegator) })) throw new Error('Parent assignment or permissions changed before delegation started.');
        prepared.bind?.(id);
      };
    }
    // an explicit mode above the agent's ceiling runs at the ceiling (the chat shows the mode it really has)
    if (policy && req.permissionMode && aboveCeiling(req.permissionMode, policy.ceiling)) req = { ...req, permissionMode: policy.ceiling! };
    const engine = engineOrThrow(req.harness);
    this.needOn(engine.id);
    const caps = engine.caps;
    const cwd = typeof req.cwd === 'string' ? req.cwd.trim() : '';
    if (!cwd || !path.isAbsolute(cwd) || !fs.existsSync(cwd)) throw new Error(`Cartella non valida: ${cwd || '(vuota)'}`);
    if (req.permissionMode && !MODES.includes(req.permissionMode)) throw new Error(`Modalità permessi non valida: ${req.permissionMode}`);
    if (req.effort && !EFFORTS.includes(req.effort)) throw new Error(`Effort non valido: ${req.effort}`);
    if (!caps.effort && req.effort) throw new Error(`L’effort non si imposta con ${engine.label}: scegli il modello.`);
    if (req.model !== undefined && !MODEL_ID.test(req.model)) throw new Error(`Modello non valido: ${req.model}`);
    // only a copy of one of the app's own Claude chats (ADR 0010: no sessions from other apps; never two writers)
    const forkOf = req.resumeSessionId?.trim() || null;
    if (forkOf) {
      const src = [...this.chats.values()].find(r => r.s.sessionId === forkOf);
      if (!req.fork || !caps.fork || !isUuid(forkOf) || !src || src.s.harness !== req.harness) throw new Error('Si può solo duplicare (fork) una chat dell’app, sullo stesso motore, se il motore lo permette.');
    }

    // a new Claude chat adopts an engine already waiting in its folder and launched like it (warm.ts): no 10-25 s
    // start-up. A role's tools, ceiling, skills plugin and "Contesto massimo" are fixed when the engine starts (#80), so
    // only an engine launched with the same ones fits (launchSig)
    // a delegated chat takes only an engine launched for a child of the same role under the same role chain: its
    // endpoint lists the child's tools (agent_ask_parent) and its managed MCP servers are bounded by those ancestors
    const warmable = caps.warm && !forkOf && !req.worktree && !req.orchestrator && req.permissionMode !== 'bypassPermissions';
    const ancestors = delegator ? this.mcpContext(delegator.s.id)?.roles ?? null : undefined;
    const role = agent.owner?.source === 'catalog' ? agent.owner.id : null;
    const launch = this.warmLaunch(policy, agent.assets, agent.maxContext, delegator ? (ancestors ? { role, launches: agent.launches ?? null, child: { ancestors } } : undefined)
      : policy ? { role, launches: agent.launches ?? null } : undefined);
    // a child whose parent has no known role chain starts cold, as before (fail closed: no managed server)
    const childOk = !delegator || !!ancestors;
    const warm = warmable && childOk ? this.warm.take(cwd, launch.sig) : null;
    const id = warm?.chatId ?? `c_${crypto.randomBytes(5).toString('hex')}`;
    const now = Date.now();
    // `replaces`: the new Orchestrator takes the role, the old one goes on as a normal chat (history kept, never deleted)
    const old = req.orchestrator && req.replaces ? this.chats.get(req.replaces) : undefined;
    if (req.orchestrator && req.replaces && !old?.s.isOrchestrator) throw new Error('L’Orchestrator da sostituire non c’è più.');
    const typedTitle = req.title?.trim() || (req.prompt?.trim() ? cut(req.prompt, 50) : forkOf ? 'Fork' : 'Nuova chat');
    // every open chat keeps its own mail box (mail.ts: box = slug of the title, #187); a placeholder («Nuova chat»,
    // «Fork») is checked when the session's own title replaces it; the Orchestrator's below, Flash is one of a kind
    const uniqueOk = !req.orchestrator && !req.quick && (!!req.title?.trim() || !!req.prompt?.trim());
    const title = uniqueOk ? this.uniqueTitle(typedTitle) : typedTitle;
    // an agent's chat with a prompt starts with its first message, through the CPU queue (ADR 0036); a warm engine is
    // already running: adopting it is no new start (its first turn still asks the queue)
    const given = req.prompt?.trim() ? req.prompt : null;
    // a Sentinel checks a change: the app gathers it (branch, base, commits, files, diff) instead of 5-15 git calls
    const pack = given && agent.owner.source === 'catalog' && agent.owner.id === 'sentinel' && this.opts.reviewPack
      ? await this.opts.reviewPack(cwd).catch(e => { log.warn('chats', 'review pack not gathered', { cause: errText(e), hint: 'the Sentinel reads the change itself' }); return ''; }) : '';
    // a Strategist the Orchestrator opens for the user (its «Strategist» send mode) asks the user, proposes a plan and
    // shows its progress on its strip (ADR 0108): the app's fixed flow follows the request, the plan starts asking
    const strategist = by === 'agent' && agent.owner.source === 'catalog' && agent.owner.id === 'strategist' && !delegator && !req.orchestrator;
    const prompt = given && pack ? `${given}\n\n${pack}` : given && strategist ? `${given}\n\n${STRATEGY_FLOW}` : given;
    // a root chat the Orchestrator opens while answering the user's own message is the user's request: like his own
    // messages (ADR 0036) it never waits for the CPU queue (a start of 10-25 s was then followed by the queue's wait)
    const forUser = by === 'agent' && !delegator && !req.orchestrator && this.orchestratorAnswering();
    const viaQueue = by !== 'user' && !forUser && !!prompt && !!this.admission;
    const observedContext = agent.launchContext;
    const r: Rec = {
      s: {
        agent: agent.owner,
        ...(observedContext ? { launchContext: { ...observedContext, instructions: { sha256: crypto.createHash('sha256').update(agent.instructions).digest('hex'), characters: agent.instructions.length, estimatedTokens: Math.ceil(agent.instructions.length / 3) } } } : {}),
        ...(by !== 'user' ? {work:{status:'assigned' as const,updatedAt:now}} : {}),
        effortStatus: initialEffort(caps.effort, req.effort ?? null),
        id, harness: req.harness, origin: 'app', title, cwd, sessionId: forkOf || !caps.transcript ? null : warm?.sessionId ?? crypto.randomUUID(),
        model: req.model ?? null, effort: req.effort ?? null, permissionMode: req.permissionMode ?? null,
        // a chat that goes through the queue has started nothing yet: 'starting' only with an engine on its way (a queued
        // chat that went starting → idle read as a finished turn: the Orchestrator was told "ha finito il turno", 2026-10-14)
        state: viaQueue && !warm ? 'idle' : 'starting', costUsd: 0, pending: 0, isOrchestrator: !!req.orchestrator, lastText: '', updatedAt: now, browserTabIds: [],
        ...(req.quick ? { quick: true as const } : {}),
        ...(req.research ? { research: true as const } : {}),
        ...(caps.cost ? {} : { costKnown: false as const }),
        ...(req.route ? { route: req.route } : {}),
        ...(delegator ? { parentId: delegator.s.id, ...(req.delegation ? { delegation: req.delegation } : {}) } : {}),
        ...(strategist && given ? { plan: { phase: 'asking' as const, clarified: [], steps: [], at: now } } : {}),
      },
      createdAt: now,
      agentInstructions: agent.instructions,
      ...(agent.assets ? { agentAssets: agent.assets } : {}),
      ...(agent.assets && agent.skills ? { skills: agent.skills } : {}),
      ...(agent.launches && agent.owner.source === 'catalog' ? { launches: [...agent.launches] } : {}),
      ...(policy ? { policy } : {}),
      // a delegated chat freezes its parent's role chain now (a parent with no chain: the child has none either and,
      // once the parent is gone, no managed MCP server at all)
      ...(delegator && this.mcpContext(delegator.s.id) ? { mcpAncestors: this.mcpContext(delegator.s.id)!.roles } : {}),
      ...(agent.maxContext ? { maxContext: agent.maxContext } : {}),
      choice: { model: req.model ?? null, effort: req.effort ?? null, permissionMode: req.permissionMode ?? null },
      ...(forkOf ? { forkFrom: forkOf } : {}),
      worktree: !!req.worktree && caps.worktree,
      ...(req.worktree && caps.worktree ? { inWorktree: true } : {}),
      costTotalUsd: 0,
      items: [], pending: new Map(), session: null, historyLoaded: false,
      jobNew: true, firstPrompt: null, turnSinceDone: false, lastTurnAt: 0,
    };
    // Finish every await and bind live delegation authority before a durable child run exists.
    bindDelegation?.(id);
    if (agent.owner.source === 'catalog' && !req.orchestrator) this.startRun(r, { agentId: agent.owner.id, version: agent.owner.version ?? 1, goal: req.goal ?? prompt ?? title, startedBy: delegator ? 'parent' : by === 'app' ? 'app' : by === 'agent' ? 'orchestrator' : 'user', costKnown: caps.cost, ...links,
      tags: { ...asked, repo: repoOf(cwd) }, ...(agent.tier ? { tier: agent.tier } : {}), model: req.model ?? null });
    if (r.s.run) { r.s.run.taskContract = { ...(by === 'app' && req.doneWhen !== undefined ? { reportExpected: true } : {}), goal: r.s.run.goal, doneWhen: req.doneWhen ?? req.delegation?.doneWhen ?? [], deliveryPolicy: this.deliveryPolicy(req.deliveryPolicy, !!delegator) }; this.runSave(); }
    if (r.s.run?.startedBy === 'app' && r.s.run.reviewOf && r.s.run.taskContract?.reportExpected && !r.s.work) r.s.work = { status: 'assigned', updatedAt: now };
    // the Orchestrator opened it while answering the user's own message: the user waits for what it finds (#123)
    if (by === 'agent' && !delegator && r.s.run?.startedBy === 'orchestrator') r.userWaits = this.orchestratorAnswering();
    // checked again where the chat joins the list: chats created at once (agent_delegate's children) awaited in between
    if (uniqueOk) r.s.title = this.uniqueTitle(r.s.title);
    this.chats.set(id, r);
    if (r.s.isOrchestrator) { this.restoreRootNotices(); this.resumeRootSyntheses(); for (const worker of this.chats.values()) if (worker.heldResult && !this.midTurn(worker)) this.releaseResult(worker); }
    if (old) {
      this.demoteOrchestrator(old);
      // two chats titled "Orchestrator" would make its mailbox ambiguous (mail.ts liveChats): the old one gives the name up
      if (slugTitle(old.s.title) === slugTitle(title)) old.s.title = `Orchestrator precedente · ${old.s.id.slice(2)}`;
    }
    this.ensureHistory(r); // a fork shows the past it starts from
    this.persist();
    log.info('chats', 'chat created', { chat: id, data: { harness: req.harness, cwd, fork: !!forkOf, model: r.choice.model, permissionMode: r.choice.permissionMode, orchestrator: r.s.isOrchestrator, warm: !!warm, prepMs: Date.now() - createdT0, queued: viaQueue } });
    this.updated(r);
    if (warm) this.adoptWarm(r, warm); else if (!viaQueue) this.startSession(r);
    // the next chat like this one finds an engine waiting (a role's own launch; an Orchestrator, fork or bypass chat: a plain one)
    if (caps.warm) this.warm.schedule(cwd, this.opts.prewarmDelayMs ?? 5000, warmable && childOk ? launch : PLAIN_LAUNCH);
    // the chat exists from here on: a failed first send shows as state 'error' + lastError, not as a lost chat
    if (prompt) {
      // a delegated chat's contract says who sent it (the parent's title), like mail between chats
      const from = delegator?.s.title;
      try { await (viaQueue ? this.gate(r, () => this.deliver(id, prompt, undefined, false, from, false, undefined, this.taskHint(r, prompt, { kind: 'app' }))) : this.send(id, prompt, undefined, false, from, false, { kind: by === 'user' ? 'user' : 'app' })); } catch (e) {
        if (!r.s.lastError) r.s.lastError = errText(e);
        this.updated(r);
      }
    }
    return { ...r.s };
  }

  /** The live chat a delegated chat starts under (agent_delegate): it exists, is open and is not the Orchestrator (the
   *  Orchestrator opens root chats with app_create_chat), and the child's folder lies inside the parent's. */
  /** continuation: "Riprendi" of a delegated chat, by whoever clicks it: the successor is the same child of the same parent */
  private async delegator(req: NewChat, by: 'user' | 'agent' | 'app', continuation = false): Promise<Rec> {
    const parent = req.parentId ? this.chats.get(req.parentId) : undefined;
    if ((by !== 'agent' && !continuation) || !parent || parent.s.closedAt || parent.s.isOrchestrator) throw new Error('Delega rifiutata: la chat che delega non è una chat di lavoro aperta.');
    const cwd = typeof req.cwd === 'string' ? req.cwd.trim() : '';
    // the parent's folder, or a worktree of its repository (agents/worktrees.ts); git is asked only when it matters, and
    // the parent may have closed meanwhile
    if (!within(parent.s.cwd, cwd) && !withinParent(parent.s.cwd, cwd, this.opts.worktrees ? await this.opts.worktrees(parent.s.cwd) : [])) {
      throw new Error(`Delega rifiutata: la cartella deve stare dentro quella del genitore (${parent.s.cwd}) o in un worktree del suo repository.`);
    }
    if (parent.s.closedAt) throw new Error('Delega rifiutata: la chat che delega non è una chat di lavoro aperta.');
    return parent;
  }

  /** A message, optionally with images (pasted screenshots; checked here: images.ts). Text may be empty with images.
   *  resumed = the app's own "riprendi" after a restart (keeps the tile's mark; any other message clears it);
   *  from = not the user's: the sender shown above the bubble (another chat's title, the Orchestrator);
   *  liveOnly = mail (chats/mail.ts): never into a chat that has no engine or is closing, never reopens one */
  override async send(chatId: string, text: string, images?: unknown, resumed = false, from?: string, liveOnly = false, source?: TaskSource, receipt?: SubmissionReceipt): Promise<void> {
    updateActivity.assertOpen();
    const r = this.need(chatId);
    if (r.s.routineArchived || r.s.routine || r.s.routinePackage) throw new Error('Archived routine chat: use the terminal routine CLI.');
    // Flash follows its card (ADR 0107): the user's question goes to a Flash on the card's engine and model
    if (r.s.quick && from === undefined && !resumed && (!source || source.kind === 'user')) {
      const next = await this.flashFollow(r);
      if (next !== chatId) {
        if (r.voiceText === text) { this.spokenNext(next, text); r.voiceText = undefined; } // the spoken message moves with it
        return this.send(next, text, images, resumed, from, liveOnly, source, receipt);
      }
    }
    if (!(typeof text === 'string' && text.trim()) && !checkImages(images).length) throw new Error('Messaggio vuoto.');
    this.autoActivity(r);
    this.needAgentMay(r, from);
    if (!resumed && !liveOnly && r.s.run?.report?.via === 'agent_report' && this.midTurn(r) && (from === undefined && (!source || source.kind === 'user') || source?.kind === 'chat')) throw new Error('Il risultato è in fase di consegna: attendi la fine del turno e riprova.');
    if (!resumed && !liveOnly && r.s.run && (r.s.run.endedAt !== undefined || r.s.run.report?.via === 'agent_report' && !this.midTurn(r)) &&
      (from === undefined && (!source || source.kind === 'user') || source?.kind === 'chat' && (source.chatId === this.openOrchestrator()?.s.id || source.chatId === r.s.parentId))) {
      if (source?.kind === 'chat' && (source.chatId === this.openOrchestrator()?.s.id || (r.userTaskEvents?.latestSeq ?? 0) > (r.userTaskEvents?.acknowledgedSeq ?? 0))) throw new Error('Use app_assign_task for a follow-up; it checks role, project and current task version.');
      this.beginAssignment(r, text, { mode: isCorrection(text) ? 'rework' : 'continue', source: source ?? { kind: 'user' } });
    }
    // Typed consent uses the same host transition as the panel; agent mail, replay and app text never approve.
    if (!resumed && !liveOnly && from === undefined && (!source || source.kind === 'user') && r.s.plan?.phase === 'proposed'
      && !checkImages(images).length && isPlanApproval(text)) {
      return this.decidePlan(chatId, 'approve', r.s.plan.at, undefined, text, receipt);
    }
    // its parent's message (agent_answer_child, from = the parent's title) reached it: the answer it waited for
    if (from !== undefined && r.s.parentId && from === this.chats.get(r.s.parentId)?.s.title) delete r.askedParentAt;
    if (!resumed && from === undefined && (!source || source.kind === 'user')) this.userWrote(chatId, text);
    // «basta domande» typed in the chat counts like the answer (ADR 0209): plan_propose stops asking for more
    if (!resumed && from === undefined && (!source || source.kind === 'user') && r.s.plan?.phase === 'asking' && typeof text === 'string' && stopsQuestions(text)) r.s.plan = { ...r.s.plan, enough: true };
    // Flash's outcomes (ADR 0131, zero tokens): the user's question to Flash decides its last answer (a correction, the
    // same question again); the user's own message to the Orchestrator may hand one over
    if (!resumed && from === undefined && (!source || source.kind === 'user') && typeof text === 'string' && (r.s.quick || r.s.isOrchestrator)) {
      this.runs.flashEvent({ kind: r.s.quick ? 'asked' : 'handed', text, at: Date.now() });
    }
    // what the engine must know for agent_report goes to the engine only, never into the user's bubble (#158, #170)
    const hint = !resumed && !liveOnly ? this.taskHint(r, text, source) : '';
    // a new assignment from the Orchestrator: whether the user waits for it is decided again (#123)
    if (from !== undefined && !r.s.parentId && !r.s.isOrchestrator && r.s.run?.startedBy === 'orchestrator' && source?.kind === 'chat' && source.chatId === this.openOrchestrator()?.s.id) r.userWaits = this.orchestratorAnswering();
    if (!this.admission) return this.deliver(chatId, text, images, resumed, from, liveOnly, receipt, hint);
    // the user's own message never waits (ADR 0036): what waited for this chat goes first, now, then this one
    if (!resumed && from === undefined) {
      this.admission.admitNow(chatId);
      return this.deliver(chatId, text, images, resumed, from, liveOnly, receipt, hint);
    }
    // an agent's message (another chat, the Orchestrator, the app's own resume): checked now
    if (liveOnly && ((!r.session && r.s.state !== 'idle') || r.archiving || r.s.closedAt)) throw new Error('La chat non è attiva: la posta resta da leggere.');
    if (!(typeof text === 'string' && text.trim()) && !checkImages(images).length) throw new Error('Messaggio vuoto.');
    // a message between chats (mail, app_send_to_chat) to a chat still open never waits for the load either (the owner,
    // 16/10 "Tutte subito", ADR 0064: mail kept unread while the CPU was over lost the race to every new sample, for
    // hours, and reached the chat only when the user wrote): what waited for this chat goes first, then this one
    if (!resumed && !r.s.closedAt) {
      this.admission.admitNow(chatId);
      return this.deliver(chatId, text, images, resumed, from, liveOnly, receipt, hint);
    }
    // the app's own resume, or an agent reopening a closed chat (a new engine): it may wait for the load
    if (r.s.closedAt && !r.archiving) this.unarchive(r); // back on the grid now: its tile shows that it waits
    return this.gate(r, () => this.deliver(chatId, text, images, resumed, from, liveOnly, receipt, hint));
  }

  /** Agent work through the CPU queue (ADR 0036): runs now (the promise is the delivery's) or waits, and then resolves
   *  at once; a later failure lands on the chat (lastError). A chat in the middle of a turn never waits: the message
   *  joins its running work. */
  private gate(r: Rec, deliver: () => Promise<void>): Promise<void> {
    const adm = this.admission;
    // a chat mid-turn takes the message at once, unless earlier work of its own still waits (never overtaken)
    if (!adm || (this.midTurn(r) && !adm.entry(r.s.id))) return deliver();
    let now: Promise<void> | undefined;
    let late = false;
    // a chat on the app itself waits behind the work chats' (the user, 2026-10-14)
    const q = adm.request(r.s.id, r.session ? 'turn' : 'start', () => {
      const p = deliver();
      if (late) p.catch(e => this.lateFailed(r, e)); else now = p;
    }, isAppChat(r.s.title) || r.s.route?.area === 'App');
    if (!q) return now ?? Promise.resolve();
    late = true;
    log.info('chats', 'agent work queued: the machine is busy', { chat: r.s.id, data: { kind: q.kind, position: q.position, app: !!q.app, ...adm.load() } });
    return Promise.resolve();
  }

  /** A queued delivery failed when it finally ran: the chat shows it (nobody awaits that promise any more). */
  private lateFailed(r: Rec, e: unknown): void {
    log.warn('chats', 'queued message not delivered', { chat: r.s.id, cause: errText(e), hint: 'the chat shows the error; write to it to retry' });
    if (this.chats.get(r.s.id) !== r) return;
    r.s.lastError = errText(e);
    delete r.s.resumedAt;
    this.updated(r);
  }

  admitNow(chatId: string): boolean {
    this.need(chatId);
    const ok = !!this.admission?.admitNow(chatId);
    if (ok) log.info('chats', 'queued chat started now by the user', { chat: chatId });
    return ok;
  }

  queueState(): ReturnType<ChatService['queueState']> {
    const adm = this.admission;
    if (!adm) return null;
    return { ...adm.load(), enabled: this.opts.admission!.limits().enabled, waiting: adm.list().map(e => ({ chatId: e.key, kind: e.kind, position: e.position, since: e.since })) };
  }

  /** The delivery of a message (send() decided it goes now). One at a time per chat, on every engine: a later message
   *  whose steps end sooner (a faster recall, no checkpoint to take) never reaches the engine before an earlier one, so
   *  the engine reads them in the transcript's order (#127: the user's message and a child's mail at once). */
  /** The lines a role chat needs for agent_report and never saw (#170): its done-criteria, exactly as stored, once per
   *  assignment (a delegation's own prompt already lists them), and the task version after a follow-up. Engine only. */
  private taskHint(r: Rec, text: string, source?: TaskSource): string {
    const run = r.s.run;
    if (!run || r.s.isOrchestrator) return '';
    const lines: string[] = [];
    const criteria = run.taskContract?.doneWhen ?? [];
    if (criteria.length && r.criteriaTold !== run.runId) {
      r.criteriaTold = run.runId;
      if (!criteria.every(c => text.includes(`- ${c}`))) lines.push('Done when (agent_report doneWhen: one entry per line below, criterion copied exactly):', ...criteria.map(c => `- ${c}`));
    }
    if ((run.taskVersion ?? 1) > 1 && source?.kind !== 'app') lines.push(`Task version ${run.taskVersion}: include taskVersion: ${run.taskVersion} in agent_report.`);
    return lines.length ? `\n\n[${lines.join('\n')}]` : '';
  }

  private deliver(chatId: string, text: string, images?: unknown, resumed = false, from?: string, liveOnly = false, receipt?: SubmissionReceipt, hint = ''): Promise<void> {
    const run = () => this.deliverNow(chatId, text, images, resumed, from, liveOnly, receipt, hint).catch(error => { receipt?.failed(error); throw error; });
    const previous = this.deliveries.get(chatId);
    const delivery = previous ? previous.catch(() => {}).then(run) : run();
    this.deliveries.set(chatId, delivery);
    const done = () => { if (this.deliveries.get(chatId) === delivery) this.deliveries.delete(chatId); };
    void delivery.then(done, done);
    return delivery;
  }

  private async deliverNow(chatId: string, text: string, images?: unknown, resumed = false, from?: string, liveOnly = false, receipt?: SubmissionReceipt, hint = ''): Promise<void> {
    updateActivity.assertOpen();
    const r = this.need(chatId);
    const releaseDelivery = this.holdActivity(chatId);
    // where the time goes between Enter and the engine: logged as `timing: before send`
    const t0 = Date.now(), lap: Record<string, number> = {};
    try {
    // an engine released for idleness still gets its mail: the chat resumes for it (ensureSession below)
    if (liveOnly && ((!r.session && r.s.state !== 'idle') || r.archiving || r.s.closedAt)) throw new Error('La chat non è attiva: la posta resta da leggere.');
    const t = typeof text === 'string' ? text.trim() : '';
    const imgs = checkImages(images);
    if (!t && !imgs.length) throw new Error('Messaggio vuoto.');
    if (!resumed && r.s.resumedAt) { delete r.s.resumedAt; this.updated(r); }
    this.ensureHistory(r);
    const warning = r.s.routinePackage || engineOf(r.s.harness)?.kind === 'claude' ? '' : await recallWarning(t, this.opts.recall);
    if (this.quitting || this.chats.get(chatId) !== r) throw new Error('La chat non è attiva.');
    if (liveOnly && ((!r.session && r.s.state !== 'idle') || r.archiving || r.s.closedAt)) throw new Error('La chat non è attiva: la posta resta da leggere.');
    if (r.archiving) await r.archiving; // never into a session that is closing: the archive ends first, then this reopens
    this.needAgentMay(r, from); // again: the engine may have been released while the message waited in the queue
    if (r.s.closedAt) this.unarchive(r); // a message (the user's, or an agent's through app_send_to_chat) reopens it
    // a cold chat (ADR 0031): after the cache expired the message goes on in a fresh session from its note
    let lapT = Date.now();
    const cold = await this.coldSwitch(r);
    lap.coldMs = Date.now() - lapT;
    const hadEngine = !!r.session;
    lapT = Date.now();
    try {
      await this.ensureSession(r);
      lap.engineMs = Date.now() - lapT;
      if (!r.session) throw new Error(r.s.lastError ?? 'Avvio della chat non riuscito.');
      if (liveOnly && engineOf(r.s.harness)?.kind !== 'claude' && (r.session.busy || r.s.state !== 'idle')) throw new Error('La chat sta lavorando: la posta resta da leggere fino al prossimo turno.');
    } catch (e) {
      if (cold) this.coldUndo(r, cold); // the note stays for the next message
      throw e;
    }
    if (cold) this.coldDone(r, cold); // the fresh session started: the divider goes above the message
    // a message into the old session makes the note stale (a turn cut before its result would leave it "fresh")
    else if (r.coldNoteAt) { r.coldNoteAt = undefined; this.persist(); }
    const thumbs = imgs.flatMap(im => (im.thumb ? [im.thumb] : []));
    // who started the Orchestrator's turn: the user's own words (never the app's news, labelled "[…"), or the app; a
    // message into a running turn joins it, and only the user's own makes it his (#123)
    if (r.s.isOrchestrator) { const own = !from && !resumed && !!t && (!t.startsWith('[') || splitMode(t).mode !== null); if (own) r.turnFromUser = true; else if (!this.midTurn(r)) r.turnFromUser = false; }
    this.addItem(r, { kind: 'user', id: nextId('u'), at: Date.now(), text: t, ...(imgs.length ? { images: imgs.length } : {}), ...(thumbs.length ? { thumbs } : {}), ...(from ? { from: from.slice(0, 80) } : {}) }, false);
    r.activeAt = Date.now();
    if (r.jobNew) this.startJob(r, t || `[${imgs.length} immagini]`);
    const continuation = cold?.h ?? (r.continuationPending ? this.handoffs.read(r.s.id, r.continuationPending) : null);
    if (r.continuationPending && !continuation) throw new Error('Passaggio di consegne non disponibile: ripristina la nota prima di continuare.');
    const text0 = continuation ? coldPrompt({ ...r.s, ...(r.inWorktree ? { inWorktree: true } : {}) }, continuation, t) : t;
    // what the user wrote in its children since its last message rides along (shown in its transcript already)
    const notes = this.notesFor.get(chatId);
    if (notes?.length) this.notesFor.delete(chatId);
    const noted0 = notes?.length ? `${USER_NOTES_LABEL}\n${notes.join('\n')}\n\n${text0}` : text0;
    // the user put the files back before the last turn: the chat learns it with its next message
    const noted = r.undoNote ? `${r.undoNote}\n\n${noted0}` : noted0;
    r.undoNote = undefined;
    // the user's own NEW request to the Orchestrator carries the app's estimate (zero tokens), never the app's news or
    // mail, nor a short follow-up ("ok", "vai", an answer) in a conversation going on (ADR 0186)
    // the user's own messages only: an agent's mail (from) or an app note ([…) is not the user going on
    const said = r.items.filter(i => i.kind === 'user' && !i.from && !i.text.startsWith('[')), before = said.at(-2);
    const ongoing = !!before && before.at >= Date.now() - FOLLOW_UP_WINDOW_MS;
    const estimate = r.s.isOrchestrator && !from && !resumed && t && !t.startsWith('[') && newRequest(t, ongoing) ? this.requestEstimate(t) : null;
    const asked0 = [noted, estimate].filter(Boolean).join('\n\n');
    // Flash is a "btw" (ADR 0106): the user's question carries what the Orchestrator said and did since it last looked
    const lampo = r.s.quick && !from && !resumed ? this.lampoContext(r) : null;
    const body = lampo ? `${lampo.text}${asked0}` : asked0;
    // the role once per context: the Orchestrator's with the role catalog, a role chat's composed instructions; a
    // resumed session already holds it in its history, so it goes again only when the text changed or was compacted away
    const roleText = r.s.isOrchestrator ? `${orchestratorRole(r.agentInstructions || undefined, this.opts.roleCatalogBrief?.())}\n\n`
      : r.agentInstructions ? `${roleFrame(r.s.agent?.name ?? 'Chat', r.agentInstructions)}\n\n` : '';
    const roleSig = roleText ? crypto.createHash('sha256').update(roleText).digest('hex').slice(0, 16) : '';
    // a changed text is checked once per engine start (as before this, never mid-session: a catalog edit would resend it)
    const role = roleText && (!r.rolePrimed || (!r.roleChecked && r.rolePrimed.sig !== roleSig)) ? roleText : '';
    r.roleChecked = true;
    // the reply language (ADR 0120): with the role text, and once on the first turn after the user changed it
    const wantLang = this.opts.replyLang?.(), langHint = replyLangTurn(wantLang, role ? undefined : r.replyLang, !!role);
    // a spoken turn: a reply made to be heard (voice-reply.ts); a new context (role text again, another session) gets
    // the rules again. Only the spoken message itself: never mail, a resume or app text that happens to go first
    // «Modalità notte» (ADR 0191): every new context hears the user is away, and once that they are back
    const awayOn = !!this.opts.away?.(), session = r.s.sessionId ?? '';
    const told = r.awayTold === session;
    const awayHint = awayOn ? (role || !told ? `\n\n${AWAY_RULE}` : '') : r.awayTold !== undefined ? `\n\n${AWAY_BACK}` : '';
    const spoken = r.voiceText !== undefined && r.voiceText === text && from === undefined && !resumed;
    const voiceHint = spoken ? voiceReplyHint(!role && r.voiceTold === (r.s.sessionId ?? '')) : '';
    if (spoken) { r.voiceText = undefined; r.voiceTold = r.s.sessionId ?? ''; }
    // the files as they are before this turn (ADR 0103): what the user can put back with «Annulla l'ultimo turno»
    if (!this.midTurn(r)) r.turnCheckpoint = false;
    lapT = Date.now();
    if (this.opts.checkpoints?.() && !r.s.isOrchestrator && !r.s.quick && !this.midTurn(r)) await this.checkpoint(r);
    lap.checkpointMs = Date.now() - lapT;
    try {
      receipt?.beforeSubmit();
      r.session.send(`${role}${warning}${body}${hint}${langHint}${voiceHint}${awayHint}`, imgs);
      if (awayHint) { if (awayOn) r.awayTold = session; else delete r.awayTold; }
      receipt?.submitted();
      if (r.continuationPending) { r.continuationPending = undefined; this.persist(true); }
      log.info('chats', 'timing: before send', { chat: r.s.id, op: 'invoke_agent', data: { totalMs: Date.now() - t0, ...lap, engineStarted: !hadEngine, cold: !!cold, harness: r.s.harness } });
      if (langHint) { r.replyLang = wantLang; if (!role) this.persist(); }
      if (lampo) r.lampoSeen = { session: r.session, cursor: lampo.seen }; // seen only once it went
      if (role) { r.rolePrimed = { session: r.s.sessionId ?? '', sig: roleSig }; this.persist(); }
    } catch (e) {
      throw new Error(`Messaggio non inviato: ${errText(e)}`);
    }
    // queued behind a quiet note turn: the engine reports no new "running", the tile shows the work from here
    if (r.handoffTurn?.quiet && r.s.state === 'idle') { r.s.state = 'running'; this.updated(r); }
    // queued behind a hand-off turn the CLI reports no new "running": mark the work here, resumed after a restart
    if (r.handoffTurn && !r.working) { r.working = true; this.persist(); }
    if (r.s.lastError) { delete r.s.lastError; this.updated(r); }
    } finally { releaseDelivery(); }
  }

  /** Flash's start (ADR 0105, 0107): what its card says (engine, model, instructions), always under LAMPO_FRAME and
   *  LAMPO_POLICY, whatever the card holds */
  private flashAgent(req: NewChat): Pick<ResolvedRole, 'request' | 'owner' | 'instructions' | 'policy'> {
    const asked = this.opts.resolveAgent?.(req);
    // a card on an engine that is off: Flash stays on the engine it was asked on, with the card's instructions
    const card = asked && asked.request.harness !== req.harness && this.opts.engineOn?.(asked.request.harness) === false
      ? { ...asked, request: req, owner: { ...plainOwner(req.harness, req.model ?? null), name: asked.owner.name } } : asked;
    const own = card?.instructions.trim();
    return { request: { ...(card?.request ?? req), title: LAMPO_TITLE, permissionMode: 'plan' }, owner: card?.owner ?? { ...plainOwner(req.harness, req.model ?? null), name: LAMPO_TITLE },
      instructions: own ? `${LAMPO_FRAME}\n\n${own}` : LAMPO_FRAME, policy: LAMPO_POLICY };
  }

  /** Flash as its card says now (ADR 0107), before the user's question: another engine = a new Flash on it (the old one
   *  closes; the Orchestrator's conversation goes again with the question); another model = changed in place; other
   *  instructions = sent again with the next message. Mid-turn nothing changes. The id the question goes to. */
  private async flashFollow(r: Rec): Promise<string> {
    // one move at a time: a second question while Flash changes engine goes where the first one went
    if (this.flashMoving) return this.flashMoving;
    if (r.working || r.session?.busy || r.s.closedAt) return r.s.id;
    const card = this.flashAgent({ harness: r.s.harness, cwd: r.s.cwd, quick: true });
    const want = card.request.model ?? null;
    if (card.request.harness !== r.s.harness) {
      const move = this.flashMove(r, card.request.harness, want);
      this.flashMoving = move;
      try { return await move; } finally { this.flashMoving = undefined; }
    }
    if (want !== (r.s.model ?? null)) await this.set(r.s.id, { model: want ?? '' });
    const effort = card.request.effort;
    if (effort && effort !== r.s.effort && engineOf(r.s.harness)?.caps.effort) await this.set(r.s.id, { effort }).catch(e => log.warn('chats', 'Flash effort not applied', { chat: r.s.id, cause: errText(e), hint: 'it stays as it was' }));
    if (card.instructions !== r.agentInstructions) { r.agentInstructions = card.instructions; r.roleChecked = false; this.persist(); }
    if (r.s.agent && (r.s.agent.name !== card.owner.name || r.s.agent.model !== want)) { r.s.agent = { ...r.s.agent, name: card.owner.name, model: want }; this.updated(r); }
    return r.s.id;
  }

  /** Flash on its card's new engine: the old one is archived (its answers stay), then the new one opens; if it cannot
   *  open, the old one comes back and takes the question. */
  private async flashMove(r: Rec, harness: Harness, model: string | null): Promise<string> {
    await this.archive(r.s.id);
    try {
      const next = await this.create({ harness, cwd: r.s.cwd, quick: true, ...(model ? { model } : {}) });
      log.info('chats', 'Flash moved to the engine of its card', { chat: next.id, data: { from: r.s.harness, to: harness, old: r.s.id } });
      return next.id;
    } catch (e) {
      log.warn('chats', 'Flash not moved to its card\'s engine', { chat: r.s.id, cause: errText(e), hint: 'the old Flash answers' });
      if (this.chats.get(r.s.id) === r && r.s.closedAt) this.unarchive(r);
      return r.s.id;
    }
  }

  /** Flash's view of the Orchestrator's conversation (ADR 0106): what is new for its engine, read only */
  private lampoContext(r: Rec): ReturnType<typeof orchestratorContext> | null {
    const o = [...this.chats.values()].find(x => x.s.isOrchestrator && !x.s.closedAt);
    if (!o || !r.session) return null;
    this.ensureHistory(o);
    return orchestratorContext(o.items, r.lampoSeen?.session === r.session ? r.lampoSeen.cursor : null);
  }

  async set(chatId: string, patch: { model?: string; effort?: Effort; permissionMode?: PermissionMode; title?: string; workStatus?: 'assigned'|'waiting-mail'|'completed' }): Promise<ChatSummary> {
    const r = this.need(chatId);
    if (r.s.routineArchived) throw new Error('Archived routine chats are read-only.');
    const sess = r.session;
    if(patch.workStatus !== undefined){
      if(Object.keys(patch).some(key=>key!=='workStatus'))throw new Error('Aggiorna lo stato incarico separatamente dalle altre impostazioni.');
      if(!['assigned','waiting-mail','completed'].includes(patch.workStatus))throw new Error('Stato incarico non valido.');
      const previous=r.s.work;
      this.autoActivity(r);
      r.s.work={status:patch.workStatus,updatedAt:Date.now()};
      try{this.persist(true);}catch(error){r.s.work=previous;throw error;}
      if (patch.workStatus === 'completed' && r.s.run && r.s.run.endedAt === undefined) { this.endRunOf(r, 'completed'); this.persist(); }
    }
    const later: string[] = [];
    const apply = async (what: string, fn: (() => Promise<void>) | undefined): Promise<void> => {
      if (!sess || !fn) return;
      try { await fn(); } catch (e) { later.push(what); log.warn('chats', 'setting not applied live', { chat: chatId, data: { what, error: errText(e) } }); }
    };
    if (patch.title !== undefined) {
      const typed = patch.title.trim();
      if (!typed) throw new Error('Titolo vuoto.');
      const t = r.s.isOrchestrator ? typed : this.uniqueTitle(typed, chatId);
      r.s.title = t;
      await apply('title', sess ? () => sess.rename(t) : undefined);
    }
    if (patch.model !== undefined) {
      const m = patch.model.trim() || null;
      if (m && !MODEL_ID.test(m)) throw new Error(`Modello non valido: ${m}`);
      this.hook('analytics', () => this.analytics.patch(r.s, { modelObserved: null }));
      r.choice.model = m; r.s.model = m;
      const engine = engineOrThrow(r.s.harness);
      if (!engine.caps.liveModel) {
        // never live (Cursor's session/set_model writes the user's config): reopen the session with --model, same history
        if (sess && !sess.busy) await this.closeKeeping(r, sess);
        else if (sess) r.reopen = true; // after this turn
        if (sess) this.addItem(r, sysItem('modelChangeQueued', { model: m ?? '', label: engine.label, reopen: r.reopen ? 1 : 0 }, 'info'), false);
      } else await apply('model', sess ? () => sess.setModel(m) : undefined);
    }
    if (patch.effort !== undefined) {
      if (!EFFORTS.includes(patch.effort)) throw new Error(`Effort non valido: ${patch.effort}`);
      const engine = engineOrThrow(r.s.harness);
      if (!engine.caps.effort) throw new Error(`L’effort non si imposta con ${engine.label}: scegli il modello.`);
      const e = patch.effort, before = { choice: r.choice.effort, effort: r.s.effort, status: r.s.effortStatus };
      r.choice.effort = e; r.s.effort = e;
      r.s.effortStatus = selectEffort(r.s.effortStatus ?? initialEffort(engine.caps.effort, null), e);
      // an ACP model that offers no such effort refuses now, in words, and the chat keeps what it had (nothing to retry)
      if (sess && engine.kind === 'acp') {
        try { await sess.setEffort(e); } catch (err) {
          r.choice.effort = before.choice; r.s.effort = before.effort; r.s.effortStatus = before.status;
          throw err;
        }
      } else await apply('effort', sess ? () => sess.setEffort(e) : undefined);
    }
    if (patch.permissionMode !== undefined) {
      if (!MODES.includes(patch.permissionMode)) throw new Error(`Modalità permessi non valida: ${patch.permissionMode}`);
      const pm = patch.permissionMode;
      if (aboveCeiling(pm, r.policy?.ceiling ?? null)) throw new Error(`Questo Agente ha come limite la modalità «${r.policy!.ceiling}». Per alzarlo modifica l’Agente.`);
      r.choice.permissionMode = pm; r.s.permissionMode = pm;
      await apply('permissionMode', sess ? () => sess.setPermissionMode(pm) : undefined);
    }
    if (later.length) this.addItem(r, sysItem('appliedLater', { items: later.join(',') }, 'warn'), false);
    this.persist();
    log.info('chats', 'chat settings', { chat: chatId, data: { ...patch, title: patch.title ? '(changed)' : undefined } });
    this.updated(r);
    return { ...r.s };
  }

  /** The app's estimate line for a request, or null: an estimate that fails never holds the message. */
  private requestEstimate(text: string): string | null {
    try { return this.opts.requestEstimate?.(text) ?? null; } catch (e) {
      log.warn('chats', 'request estimate failed', { cause: errText(e), hint: 'the Orchestrator gets the message without it and may call task_estimate' });
      return null;
    }
  }
}
