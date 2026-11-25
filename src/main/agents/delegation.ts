// Direct parent-to-child delegation between role chats (ADR 0083), on every chat's own MCP endpoint
// (/mcp/chat/:chatId/:token; the caller is the token's chat, never an argument), pre-approved on Claude, Codex and
// Cursor (chats/app-tool-approval.ts): agent_delegate starts 1..n visible child chats at once, each running a role the
// caller's role may launch, with a self-contained contract (the child never sees the parent's conversation);
// agent_report is the child's one result, delivered to its parent as a message; agent_children lists the caller's
// children with their state, results and open questions. A child's question, its engine's own panel or agent_ask_parent,
// climbs the ladder one level at a time (ADR 0344, chats/manager-ladder.ts): its parent answers it with
// agent_answer_child from what it knows or passes it up with askUser, and only what no agent may or can decide reaches
// the user. What holds whoever asks: permissions only go down (a contract asking for a
// tool class beyond the parent's is refused, and the child's policy is narrowed by the parent's, chats/manager.ts; contract.tools only chooses its folder, ADR 0355), the
// depth limit of Impostazioni → Ruoli e deleghe is checked and a refusal shows in the parent's chat. A child's folder
// is any existing one, its parent's never limits it (ADR 0358), and it works in that folder itself unless the caller asks a
// copy; the folder is no permission. Only the Orchestrator and the Strategist delegate (2026-11-23; the Orchestrator through
// app_create_chat): any other role is refused whatever its saved launches say, and a parallel group of an approved plan
// starts in one agent_delegate call (shared/strategy.ts parallelSplit). There is no limit on children at once (the owner,
// 2026-11-23): the Strategist checks the real resources when it plans. A child may run on another engine only when the
// user allows chats across engines. Used by wiring.ts.
import { successorIn } from '../../shared/role-tools';
import { heldQuestions, openQuestions } from '../../shared/question-ladder';
import type { ChatSummary, Effort, Harness, NewChat } from '../../shared/contract';
import type { AgentCatalog, AgentRun, UserTaskEvents } from '../../shared/agents';
import { canLaunch, isDelegatorRole, isWorkRole, launchGap, ROLE_DEFAULTS, WORK_ROLE_IDS, type DelegationSettings } from '../../shared/roles';
import { CRITERION_MAX, EVIDENCE_MAX, MAX_CORRECTIONS, RESULT_OUTPUT_MAX, SUMMARY_MAX, USER_ACTION_COMMAND_MAX, USER_ACTION_KINDS, USER_ACTION_TEXT_MAX, USER_ONLY_BLOCKER, capText, checkContract, checkResult, contractFields, contractWarnings, delegationPrompt, depthOf, type DelegationResult, type DelegationIntegration, type TaskAssignmentOptions } from '../../shared/delegation';
import { ORCHESTRATOR_TITLE } from '../../shared/orchestrator';
import { delegationGate, stepGate, stepIndex, type StrategyPlan } from '../../shared/strategy';
import type { McpTool } from '../mcp/server';
import { callerOf } from '../mcp/caller';
import { ToolRefusal } from '../mcp/refusal';
import { allowsClass, within, type AgentPolicy } from './tool-policy';
import { folderProblem, sameFolder } from './worktrees';
import { childReviewers, DELTA_REVIEW, type ReviewWorld } from './one-review';
import { gapLines, skillGaps } from './skill-needs';
import type { SkillToolsSource } from './discovery';
import { PRESET_SCHEMA } from './preset-schema';
import { USER_ASKED, presetAskOf, runPresetOf, stepAsk, type Delegator, type PresetAsk, type PresetChoice } from '../../shared/model-presets';
import { log } from '../log';
import { checkMemoryWorth } from '../rules/memory-worth';
import { closeRefusal, descendantIds } from '../chats/close-rules';
import { unreadInstructions } from '../../shared/user-events';
import { pickLines } from '../../shared/model-levels';

/** With agent_assign_task's userInstructions: what the parent does with the user's entries it had not seen. */
const USER_INSTRUCTIONS_NOTE = 'The user wrote or answered these in the child since your last assignment; the child already has them and they are not repeated in its prompt. Check your new contract agrees with them; where it does not, correct the child with a new assignment or ask the user.';

/** What delegation needs from the chats (ChatManager). */
export interface DelegationChats {
  list(): ChatSummary[];
  assignTask?(chatId: string, prompt: string, options: TaskAssignmentOptions): Promise<void>;
  /** the same task in another folder or on another engine: a linked chat (ADR 0357, 0358) */
  assignElsewhere?(chatId: string, prompt: string, options: TaskAssignmentOptions, to: { cwd?: string; place?: 'here' | 'copy'; on?: { harness: Harness; model: string | null; effort: Effort | null; route?: string } }): Promise<ChatSummary>;
  /** a reused child's model and effort for its next task's preset (ADR 0336, ChatManager.set); absent = a preset change is refused */
  set?(chatId: string, patch: { model?: string; effort?: Effort }): Promise<unknown>;
  userEvents?(chatId: string, afterSeq?: number): UserTaskEvents;
  create(req: NewChat, by: 'agent'): Promise<ChatSummary>;
  agentPolicy(chatId: string): AgentPolicy | null;
  reportDelegation(chatId: string, result: DelegationResult): { parentId: string; delivered: boolean };
  /** a root role chat the Orchestrator opened reports to it (issue #93); absent = refused as before */
  reportRoot?(chatId: string, result: DelegationResult): { orchestratorId: string | null; delivered: boolean };
  /** the depth limit refused a delegation (the only delegation limit) */
  limitNotice(chatId: string, kind: 'depth', limit: number): void;
  /** a message from another chat (from = its title) */
  send(chatId: string, text: string, images?: unknown, resumed?: boolean, from?: string): Promise<void>;
  /** when the chat last produced anything (a transcript item, a state change, a send): the stall check (stalledMin) */
  lastEventAt?(chatId: string): number | undefined;
  /** a Strategist's plan with the user (ADR 0108): no delegation before the user's ok; a part names its step */
  planOf?(chatId: string): StrategyPlan | null;
  planDelegated?(chatId: string, i: number, chatIds: string[]): void;
  /** a child's question on the ladder (ADR 0344): who got it, and the holder's answer or askUser = one level up */
  ladderAsk(chatId: string, ask: { question: string; options: string[]; why?: string }): { asked: string };
  ladderReply(callerId: string, a: { chatId: string; requestId?: string; answer?: string; why?: string; askUser?: boolean }): Promise<{ answered: string; askUser: boolean }>;
  /** a NEW chat that goes on from this one's hand-off (ChatManager.continueChat): a reused child whose engine cannot run
   *  now goes on, with its new assignment, on the level's engine (ADR 0352); absent = such a reuse is refused */
  continueChat?(chatId: string, opts: { allowStart?: boolean; ask?: false; promptPrefix?: string; on?: { harness: Harness; model: string | null; effort: Effort | null }; assignment?: { goal: string; doneWhen: string[] } }): Promise<ChatSummary>;
  /** closes a chat and cancels its tree (ChatManager.close, ADR 0217): agent_close_child; absent = the tool refuses */
  close?(chatId: string, by?: 'user' | 'agent'): Promise<void>;
}
export interface DelegationDeps {
  chats: DelegationChats;
  roles: () => AgentCatalog;
  settings: () => DelegationSettings;
  /** why an agent may not open or wake a chat on `to` (engines/policy.ts openRefusal), null = it may; the asking
   *  chat's own engine plays no part (ADR 0352) */
  engineRefusal: (to: Harness) => string | null;
  /** an engine order (everybody's or the role's own) decides where this role starts (ADR 0357); absent = none */
  ordered?: (roleId: string) => boolean;
  /** the label every agent-written first message starts with (appctl AGENT_LABEL) */
  label: string;
  /** Host-owned staging only: no parent checkout mutation, branch merge, push or arbitrary command. */
  integrateMany?: (parent: ChatSummary, children: ChatSummary[]) => Promise<DelegationIntegration>;
  integrate?: (parent: ChatSummary, child: ChatSummary) => Promise<DelegationIntegration>;
  /** the child works in a copy made for it (DelegateWorktrees.isolated); one that works in place has nothing to integrate */
  isolated?: (child: ChatSummary) => boolean;
  runs: () => readonly AgentRun[];
  /** the brain's skills with their tools: a part whose skill needs tools its role lacks is said in the answer (#93) */
  skillTools?: SkillToolsSource;
  /** notes one line as a lesson for the role's own skill, for Maintenance (skills/lessons.ts, #365, ADR 0257):
   *  agent_report's `remember`;
   *  absent = the field is refused */
  remember?: (roleId: string, line: string, chat: ChatSummary) => void;
  /** the preset a delegation of a role would get (catalog.presetChoice, ADR 0336);
   *  absent = Base, no ceiling (tests) */
  presetChoice?: (roleId: string, ask: PresetAsk, delegator?: Delegator) => PresetChoice;
  /** reads again, before a pick, the engines that look stopped without a valid reading (ADR 0354; shared, a few s at most) */
  creditFresh?: () => Promise<void>;
  /** the clock (tests) */
  now?: () => number;
}

export const TASKS_MAX = 10;
const TITLE_MAX = 80;
const QUESTION_MAX = 1000, OPTIONS_MAX = 6, REMEMBER_MAX = 1, REMEMBER_LINE = 300;

/** An app-owned independent review run (the Judge's sample, ADR 0100): the only report that carries verdict / verified. */
export function independentReview(c: ChatSummary | undefined): boolean {
  return !!c?.run?.reviewOf && c.run.startedBy === 'app' && ['sentinel', 'judge'].includes(c.run.agentId) && !c.parentId && !c.delegation && !c.isOrchestrator;
}

/** agent_report's schema without the review-only fields: what every other chat sees. */
export function withoutReviewFields(schema: Record<string, unknown>): Record<string, unknown> {
  const { verdict: _v, verified: _w, ...properties } = schema.properties as Record<string, unknown>;
  return { ...schema, properties };
}

/** A delegated child is busy until it reports or closes (stalled children, agent_children). */
export const busyChild = (c: ChatSummary): boolean => !c.closedAt && !c.delegation?.result;

/** Minutes a delegated child has been stalled, or null: it is still busy (not reported, not closed), working (starting or
 *  running, nothing waiting on the user) and produced no event for `stallMin` minutes (Impostazioni → Ruoli e deleghe →
 *  "Ferma dopo"). agent_children reports it to the parent as `stalled`. */
export function stalledMin(c: ChatSummary, lastEventAt: number, now: number, stallMin: number): number | null {
  if (!busyChild(c) || (c.state !== 'running' && c.state !== 'starting') || c.pending > 0 || heldQuestions(c.questions).length) return null;
  const quiet = now - lastEventAt;
  return quiet >= stallMin * 60_000 ? Math.floor(quiet / 60_000) : null;
}

/** What a partial / blocked report naming a user-only step without userAction gets back, once per run (#358). */
export const USER_ACTION_REFUSAL = 'agent_report not sent yet: it names a step only the user can do (VPN, login or MFA, an Esegui command, a permission). Add userAction { kind: vpn | login | command | permission | decision | other, text: what the user must do, command?: the exact command } so the app asks the user at once in the Orchestrator, then send the same report again. Without userAction it is accepted the next time.';

/** place of a tool call: here (in the folder itself) or copy (a new isolated worktree), absent = here. Throws. */
export function placeOf(v: unknown, where: string): 'here' | 'copy' | undefined {
  if (v === undefined || v === null) return undefined;
  if (v !== 'here' && v !== 'copy') throw new Error(`${where}: here (in the folder itself, the default) or copy (a new isolated worktree).`);
  return v;
}
export const PLACE_SCHEMA = { type: 'string', enum: ['here', 'copy'], description: 'here (the default) = works in cwd itself, e.g. a slot already booked: nothing is copied, its uncommitted changes are only told. copy = a new isolated worktree of that folder\'s repository (clean and committed), only when you really want one' };

export function delegationTools(d: DelegationDeps): McpTool[] {
  /** the runs already sent back once for a missing userAction (#358): the second identical call goes through */
  const askedUserAction = new Set<string>();
  const chat = (id: string) => d.chats.list().find(c => c.id === id);
  /** what the one-review rule reads (#387, one-review.ts) */
  const reviewWorld = (): ReviewWorld => ({ chats: d.chats.list(), runs: d.runs() });

  const assigning = new Set<string>();
  function activeParent(callerId: string, tool: string): ChatSummary {
    const parent = chat(callerId);
    const resume = parent?.parentId ? 'ask your parent with agent_ask_parent for a new assignment of this same chat (agent_assign_task)' : 'ask with agent_ask_parent: the Orchestrator assigns this same chat again (app_assign_task)';
    if (!parent || parent.closedAt || parent.state === 'closed') throw new Error(`${tool}: your chat is not open; ${resume}.`);
    if (parent.isOrchestrator || parent.agent?.source !== 'catalog' || !isWorkRole(parent.agent.id)) throw new Error(`${tool}: only a role chat delegates or assigns children.`);
    if (parent.run?.endedAt !== undefined || parent.run?.report?.via === 'agent_report' || parent.delegation?.result || parent.work?.status === 'completed') throw new Error(`${tool}: your assignment is over; ${resume}.`);
    return parent;
  }

  async function delegate(a: Record<string, unknown>, callerId: string): Promise<unknown> {
    const parent = activeParent(callerId, 'agent_delegate');
    if (parent.isOrchestrator) throw new Error('agent_delegate: the Orchestrator opens root chats with app_create_chat.');
    if (parent.agent?.source !== 'catalog' || !isWorkRole(parent.agent.id)) throw new Error('agent_delegate: only a role chat delegates (start one from Agenti).');
    if (parent.run && parent.run.endedAt !== undefined) throw new Error('agent_delegate: your assignment is over (you reported): ask your parent for a new one.');
    const catalog = d.roles(), own = catalog.profiles.find(p => p.id === parent.agent!.id);
    if (!own) throw new Error('agent_delegate: your role is not in the catalog.');
    // only the Orchestrator and the Strategist delegate (2026-11-23), whatever an older roles.json says
    if (!isDelegatorRole(own.id)) throw new Error(`agent_delegate refused: ${own.name} does not delegate (only the Orchestrator and the Strategist do). Do your own part; put a part for another role in your agent_report as a ready contract (role, goal, done-criteria): your parent launches it.`);
    // the ceiling of every part's preset (ADR 0336): the model this chat runs on, else its card's
    const delegator: Delegator = { role: own.id, model: parent.model || own.model || null };
    const raw = a.tasks;
    if (!Array.isArray(raw) || !raw.length || raw.length > TASKS_MAX) throw new Error(`agent_delegate: tasks = 1 to ${TASKS_MAX} parts.`);
    const limits = d.settings(), all = d.chats.list();
    const parentOf = (id: string) => all.find(c => c.id === id)?.parentId;
    const depth = depthOf(parent.id, parentOf) + 1;
    if (depth > limits.maxDepth) {
      d.chats.limitNotice(parent.id, 'depth', limits.maxDepth);
      throw new Error(`agent_delegate refused: depth limit ${limits.maxDepth} reached (Settings → Roles and delegation). Do this part yourself or report it to your parent.`);
    }
    // a Strategist that planned with the user delegates only once the user approved the plan (its strip, ADR 0108)
    const plan = d.chats.planOf?.(parent.id) ?? null;
    const gate = delegationGate(plan, 'agent_delegate');
    if (gate) throw new Error(gate);
    const parentPolicy = d.chats.agentPolicy(parent.id);
    // everything is checked before any chat starts: one bad part refuses the whole call
    await d.creditFresh?.();
    const plans = raw.map((value, i) => {
      const t = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
      if (!t) throw new Error(`tasks[${i}]: object required.`);
      const extra = Object.keys(t).find(k => !['role', 'title', 'contract', 'cwd', 'place', 'step', 'freshReview', 'preset', 'presetWhy', 'taskKind', 'reviewOf'].includes(k));
      if (extra) throw new Error(`tasks[${i}]: unknown field ${extra}.`);
      const role = t.role;
      if (!isWorkRole(role)) throw new Error(`tasks[${i}].role: one of ${WORK_ROLE_IDS.join(', ')}.`);
      if (!canLaunch(own.id, own.launches, role)) throw new Error(`tasks[${i}]: ${own.name} may not launch ${ROLE_DEFAULTS[role].name} (it launches ${own.launches.join(', ') || 'none'}). Put this part in your report as a ready contract (role, goal, done-criteria): your parent launches it.`);
      const profile = catalog.profiles.find(p => p.id === role);
      if (!profile) throw new Error(`tasks[${i}]: ${role} is not in the catalog.`);
      // a child is narrowed by its parent: a role that needs a class the parent lacks (read-only ones aside) could not
      // do its job, so the parent reports that work and the Orchestrator starts it as a root chat (ADR 0083)
      const gap = launchGap(profile.tools?.allow ?? [], parentPolicy?.tools ? parentPolicy.tools.allow : null);
      if (gap.length) throw new Error(`tasks[${i}]: ${profile.name} needs ${gap.join(', ')}, which you do not have, so under you it could not do its job. Put this part in your report as a ready contract (role, goal, done-criteria): the Orchestrator starts it.`);
      const title = typeof t.title === 'string' ? t.title.trim() : '';
      if (!title || title.length > TITLE_MAX) throw new Error(`tasks[${i}].title: 1 to ${TITLE_MAX} characters ("Area · what").`);
      if (title.toLowerCase() === ORCHESTRATOR_TITLE.toLowerCase()) throw new Error(`tasks[${i}].title: «${title}» is reserved for the Orchestrator.`);
      const contract = checkContract(t.contract, role);
      const beyond = (contract.tools ?? []).filter(c => !allowsClass(parentPolicy, c));
      if (beyond.length) throw new Error(`tasks[${i}].contract.tools refused: ${beyond.join(', ')} goes beyond your own permissions (a child never gets more than its parent).`);
      const outside = (contract.tools ?? []).filter(c => !(profile.tools?.allow ?? []).includes(c));
      if (outside.length) throw new Error(`tasks[${i}].contract.tools: ${outside.join(', ')} is not among ${profile.name}'s tools; contract.tools names what the part needs, among them.`);
      const cwd = typeof t.cwd === 'string' && t.cwd.trim() ? t.cwd.trim() : parent.cwd;
      const place = placeOf(t.place, `tasks[${i}].place`);
      if (t.freshReview !== undefined && typeof t.freshReview !== 'boolean') throw new Error(`tasks[${i}].freshReview: true or false.`);
      // the run this Sentinel reviews (2026-11-23, as app_create_chat's reviewOf): one of your direct children's runs
      if (t.reviewOf !== undefined && (role !== 'sentinel' || typeof t.reviewOf !== 'string' || !t.reviewOf.trim())) throw new Error(`tasks[${i}].reviewOf: only a sentinel task takes it, the runId of the run it reviews (agent_children).`);
      const reviewOf = typeof t.reviewOf === 'string' ? t.reviewOf.trim() : undefined;
      if (reviewOf && !d.runs().some(r => r.runId === reviewOf && all.some(c => c.id === r.chatId && c.parentId === parent.id))) throw new Error(`tasks[${i}].reviewOf: ${reviewOf} is not a run of one of your children; agent_children shows each child's runId.`);
      // one review chat per piece of work (#387, ADR 0309): a Sentinel of yours that already reported on this task
      // re-reviews its fix; a new one would review everything again
      const reviewed = role === 'sentinel' && t.freshReview !== true ? childReviewers(reviewWorld(), parent, cwd) : [];
      if (reviewed.length) throw new Error(`tasks[${i}]: one review chat per piece of work. Your Sentinel ${reviewed.slice(0, 3).map(c => `«${c.title}» (chatId ${c.id})`).join(', ')} already reviewed this task: re-review the fix there with agent_assign_task { chatId, roleId: "sentinel", cwd: "${reviewed[0]!.cwd}", mode: "continue", contract } naming only the fix delta (what changed since its review). A fresh Sentinel only when the user asked for one, it checks a part none of them covers, or agent_assign_task refuses that chat (engine, settings, permissions): then add freshReview true to this part.`);
      // any existing folder (ADR 0358): whoever opens the chat decides where
      const noFolder = within(parent.cwd, cwd) ? null : folderProblem(cwd); // its own folder: checked at create
      if (noFolder) throw new Error(`tasks[${i}].cwd: ${noFolder}`);
      if (t.step !== undefined && !plan) throw new Error(`tasks[${i}].step: only a plan approved by the user has steps; leave it out.`);
      const step = t.step !== undefined && plan ? stepIndex(plan, t.step, `tasks[${i}].step`) : null;
      // the preset of the role's card (ADR 0336): one of its three, why in one line, never above your own model; a part
      // that names none takes its plan step's (ADR 0346). The card's model for it is read now, when the part starts
      const ask = stepAsk(presetAskOf(t, `tasks[${i}]`), step === null ? undefined : plan!.steps[step]!.preset);
      const cap = d.presetChoice?.(role, ask, delegator) ?? null;
      // the engine its level starts on now (ADR 0347: the first model of the level that is on and has room); none = every
      // engine of that level is off or refused to agents
      // (none usable: the start itself refuses, with each model and why)
      const engine = cap?.engine ?? profile.engine;
      const refused = d.engineRefusal(engine);
      if (refused) throw new Error(`tasks[${i}]: ${profile.name} would start on ${engine}: ${refused}`);
      const presetFields = { ...(ask.preset ? { preset: ask.preset } : {}), ...(ask.presetWhy ? { presetWhy: ask.presetWhy } : {}), ...(ask.taskKind ? { taskKind: ask.taskKind } : {}), delegator };
      return { role, title, contract, cwd, place, profile, step, cap, presetFields, reviewOf, engine };
    });
    // a step starts only when what it waits for ended, and every step that can start now starts in this one call (ADR 0359)
    const split = plan && (plan.phase === 'running' || plan.phase === 'done') ? stepGate(plan, plans.flatMap(p => p.step === null ? [] : [p.step])) : null;
    if (split) throw new Error(split);
    {
      const at = Date.now();
      const settled = await Promise.allSettled(plans.map(p => d.chats.create({
        harness: p.engine, cwd: p.cwd, ...(p.place ? { place: p.place } : {}), title: p.title, roleId: p.role, parentId: parent.id, goal: p.contract.goal,
        ...p.presetFields, ...(p.contract.skills ? { skills: p.contract.skills } : {}), ...(p.reviewOf ? { reviewOf: p.reviewOf } : {}),
        delegation: { role: p.role, goal: p.contract.goal, doneWhen: p.contract.doneWhen, at, ...(p.contract.tools ? { tools: p.contract.tools } : {}) },
        contractFields: contractFields(p.contract),
        prompt: `${d.label}\n\n${delegationPrompt(p.contract, { role: p.role, parentTitle: parent.title, title: p.title, skills: p.contract.skills ?? [] })}`,
      }, 'agent')));
      const known = d.skillTools ? new Map(d.skillTools().map(x => [x.name, x.tools])) : null;
      // a skill whose tools the child lacks (its own policy, already narrowed by yours)
      const warnings = (i: number, chatId: string): { warnings?: string[] } => {
        const p = plans[i]!, lines = [...(d.chats.list().find(c => c.id === chatId)?.folderNotes ?? []), ...(p.cap?.warnings ?? []), ...(known ? gapLines(p.profile.name, skillGaps([...new Set([...p.profile.skills, ...(p.contract.skills ?? [])])], n => known.get(n), d.chats.agentPolicy(chatId))) : []), ...contractWarnings(p.contract)];
        return lines.length ? { warnings: lines } : {};
      };
      // the preset the chat really started on (its run's record), else the guards'
      const presetOf = (i: number, c: ChatSummary) => c.run?.presetChoice?.preset ?? plans[i]!.cap?.preset;
      const children = settled.map((s, i) => s.status === 'fulfilled'
        ? { role: plans[i]!.role, title: s.value.title, chatId: s.value.id, cwd: s.value.cwd, ...(s.value.place ? { place: s.value.place } : {}), harness: s.value.harness, model: s.value.model, ...(s.value.run?.presetChoice?.route ? { engineWhy: s.value.run.presetChoice.route } : {}), ...(presetOf(i, s.value) ? { preset: presetOf(i, s.value) } : {}), ...(s.value.pick ? { pick: pickLines(s.value.pick, Date.now()) } : {}), state: s.value.queued ? 'queued' : s.value.state, ...warnings(i, s.value.id) }
        : { role: plans[i]!.role, title: plans[i]!.title, error: s.reason instanceof Error ? s.reason.message : String(s.reason) });
      // each step of the plan with its started children: the strip shows it under way
      const steps = new Map<number, string[]>();
      settled.forEach((x, i) => { const st = plans[i]!.step; if (x.status === 'fulfilled' && st !== null) steps.set(st, [...steps.get(st) ?? [], x.value.id]); });
      for (const [i, ids] of steps) d.chats.planDelegated?.(parent.id, i, ids);
      log.info('agents', 'delegated', { chat: parent.id, data: { children: children.map(c => ({ role: c.role, chatId: 'chatId' in c ? c.chatId : null })), depth } });
      return { children, note: 'Each child reports to you with agent_report (it arrives as a message); agent_children shows their state. Do not wait idle: go on with your own part.' };
    }
  }

  /** A parent reuses its own child of the same role and folder, on any engine (ADR 0352). A card changed since the child
   *  started does not stop it: the child takes the card's current instructions, tools and permissions, never wider than
   *  the parent's (ChatManager.assignTask). It stays on its engine while that engine can run; when it cannot, the work
   *  goes on by itself in a new child on the level's engine, from the hand-off (continueChat). */
  async function assignChild(a: Record<string, unknown>, callerId: string): Promise<unknown> {
    const parent = activeParent(callerId, 'agent_assign_task');
    if (!d.chats.assignTask || !d.chats.userEvents) throw new Error('agent_assign_task is unavailable.');
    const extra = Object.keys(a).find(k => !['chatId', 'roleId', 'cwd', 'place', 'mode', 'expectedVersion', 'expectedEventSeq', 'contract', 'step', 'preset', 'presetWhy', 'taskKind'].includes(k));
    if (extra) throw new Error(`agent_assign_task: unknown field ${extra}.`);
    // a child that went on in another chat (an engine change): the task goes to the one that works now (ADR 0356)
    const child = typeof a.chatId === 'string' ? successorIn(d.chats.list(), a.chatId) : undefined;
    if (!child || child.parentId !== callerId || !child.delegation || !child.run || child.isOrchestrator) throw new Error('agent_assign_task: chatId must be one of YOUR direct children (agent_children).');
    if (assigning.has(child.id)) throw new Error('agent_assign_task: this child already has an assignment in progress.');
    // a Sentinel child is continued as any other (#387, ADR 0309): after a fix it reviews only the delta
    if (!isWorkRole(a.roleId) || child.agent?.source !== 'catalog' || child.agent.id !== a.roleId || child.delegation.role !== a.roleId) throw new Error('Role mismatch: delegate a fresh chat.');
    const catalog = d.roles(), own = catalog.profiles.find(p => p.id === parent.agent!.id), profile = catalog.profiles.find(p => p.id === a.roleId);
    if (!own || !canLaunch(own.id, own.launches, a.roleId)) throw new Error(own && !isDelegatorRole(own.id) ? `agent_assign_task refused: ${own.name} does not delegate (only the Orchestrator and the Strategist do); put the work in your agent_report as a ready contract.` : 'Your current role may not launch this child role.');
    if (!profile) throw new Error(`agent_assign_task: role ${String(a.roleId).slice(0, 40)} is not in the catalog any more; delegate a current role.`);
    // its own folder (omitted), or any other existing one: there the task goes on in a linked chat (ADR 0358)
    if (a.cwd !== undefined && typeof a.cwd !== 'string') throw new Error('agent_assign_task: cwd = an absolute folder.');
    const cwd = typeof a.cwd === 'string' && a.cwd.trim() ? a.cwd.trim() : child.cwd, place = placeOf(a.place, 'place');
    const noFolder = within(parent.cwd, cwd) ? null : folderProblem(cwd);
    if (noFolder) throw new Error(`agent_assign_task: ${noFolder}`);
    const moved = !sameFolder(cwd, child.cwd) || place === 'copy' && child.place !== 'copy';
    // expectedVersion and expectedEventSeq are optional (cloudroom P6): honoured when given, else the current version
    if (!['continue', 'new-task', 'rework'].includes(String(a.mode)) || (a.expectedVersion !== undefined && (!Number.isSafeInteger(a.expectedVersion) || Number(a.expectedVersion) < 1))) throw new Error('Invalid assignment mode/version.');
    if (a.expectedEventSeq !== undefined && (!Number.isSafeInteger(a.expectedEventSeq) || Number(a.expectedEventSeq) < 0)) throw new Error('Invalid user event cursor.');
    const contractRaw = a.contract;
    if (!contractRaw || typeof contractRaw !== 'object' || Array.isArray(contractRaw) || Object.keys(contractRaw).some(k => !['goal', 'output', 'context', 'doneWhen', 'why', 'alreadyDecided', 'inScope', 'outOfScope', 'constraints', 'steps', 'askIf'].includes(k))) throw new Error('Reuse contract allows only goal, output, context, doneWhen and the hybrid fields (why, alreadyDecided, inScope, outOfScope, constraints, steps, askIf); tools and skills require a fresh chat.');
    const contract = checkContract(contractRaw, a.roleId);
    // the preset of this task (ADR 0336): as agent_delegate's, missing = its plan step's (ADR 0346), else Base; the child
    // switches to it when it runs on another model or effort (it runs on its role's engine: checked above)
    const steps = a.step === undefined ? undefined : d.chats.planOf?.(parent.id)?.steps;
    const ask = stepAsk(presetAskOf(a, ''), steps && Number.isInteger(a.step) ? steps[Number(a.step) - 1]?.preset : undefined);
    const preset = d.presetChoice?.(a.roleId, ask, { role: own.id, model: parent.model || own.model || null }) ?? null;
    // where the level starts now (ADR 0347; absent = the card's own engine). The order on the card is a preference: the
    // child stays on its own engine while that one can run, and goes to the level's only when its own cannot (ADR 0352)
    const levelEngine = (preset?.engine ?? profile.engine) as Harness;
    const blocked = d.engineRefusal(child.harness);
    const move = blocked ? levelEngine : null;
    if (move && (move === child.harness || d.engineRefusal(move))) throw new Error(`agent_assign_task: ${blocked}${move !== child.harness ? `, and ${profile.name}'s level starts on ${move}: ${d.engineRefusal(move)}` : ''}. The child goes on once one of its role's engines is on and allowed (Impostazioni → Motori).`);
    // a preset without effort is the engine's default: a child left on another effort goes back to it (null). A
    // preset on another engine than the child's names no model of its own: the child keeps its model there
    const sameEngine = levelEngine === child.harness;
    // with an engine order (ADR 0357) a reuse follows it: a level that starts on another engine now goes on in a linked
    // chat there (a chat never changes engine in place); never off a model the user asked for that work, nor onto a spent plan
    const follows = !sameEngine && !!d.ordered?.(a.roleId) && !preset?.allOut && !child.run.presetChoice?.route?.endsWith(USER_ASKED) && !d.engineRefusal(levelEngine);
    const on = preset && (follows || moved && (move || sameEngine)) ? { harness: levelEngine, model: preset.model, effort: preset.effort ?? null, ...(preset.route ? { route: preset.route } : {}) } : undefined;
    if ((moved || on) && !d.chats.assignElsewhere) throw new Error('agent_assign_task: this child cannot change folder or engine here; delegate a fresh chat.');
    const switchTo = !move && !moved && preset && sameEngine && ((preset.model ?? null) !== (child.model ?? null) || (preset.effort ?? null) !== (child.effort ?? null)) ? preset : null;
    const presetWarnings = [...(preset?.warnings ?? []), ...(switchTo ? [`the child switches to preset ${switchTo.preset} (${switchTo.model ?? 'the engine default'}${switchTo.effort ? `, effort ${switchTo.effort}` : ''}) from ${child.model ?? 'the engine default'}${child.effort ? `, effort ${child.effort}` : ''}`] : []),
      ...(on && on.harness !== child.harness ? [`goes on in a linked chat on ${on.harness}: ${on.route ?? 'the engine its level starts on now'}`] : moved ? [`goes on in a linked chat in ${cwd}`] : []),
      ...(!move && !on && !sameEngine && preset ? [`${profile.name}'s level ${preset.preset} now starts on ${levelEngine}; this child stays on ${child.harness}, which can still run, with its own model`] : [])];
    const parentPolicy = d.chats.agentPolicy(parent.id);
    if (launchGap(profile.tools?.allow ?? [], parentPolicy?.tools?.allow ?? null).length) throw new Error('Child role needs permissions your current policy does not allow.');
    const plan = d.chats.planOf?.(parent.id) ?? null;
    const gate = delegationGate(plan, 'agent_assign_task');
    if (gate) throw new Error(gate);
    if (a.step !== undefined && !plan) throw new Error('step requires a plan approved by the user.');
    if (plan && a.step === undefined) throw new Error('Name the approved plan step for this reused child.');
    const step = a.step !== undefined && plan ? stepIndex(plan, a.step, 'step') : null;
    const limits = d.settings(), all = d.chats.list();
    if (depthOf(parent.id, id => all.find(c => c.id === id)?.parentId) + 1 > limits.maxDepth) {
      d.chats.limitNotice(parent.id, 'depth', limits.maxDepth); throw new Error('Delegation depth limit reached.');
    }
    // ChatManager checks the version again; the user's entries in the child you have not seen come back here, readable
    // (the child already has them: they are not repeated in its prompt)
    const userInstructions = unreadInstructions(d.chats.userEvents(child.id));
    const version = a.expectedVersion === undefined ? child.run.taskVersion ?? 1 : Number(a.expectedVersion);
    if (version !== (child.run.taskVersion ?? 1)) throw new Error('Task version changed; refresh agent_children.');
    assigning.add(child.id);
    try {
      // its next round on the work it already reviewed: only the delta (a new task is reviewed whole)
      const delta = a.roleId === 'sentinel' && a.mode !== 'new-task' && !!child.delegation.result ? `${DELTA_REVIEW}\n\n` : '';
      const prompt = `${d.label}\n\n${delta}${delegationPrompt(contract, { role: a.roleId, parentTitle: parent.title, title: child.title, skills: [] })}`;
      if (move && !moved) {
        // the child's engine cannot run now: a new child of the same role goes on with this task on the level's engine,
        // from the app's own hand-off note, under you, in the same folder; the old one owes you nothing more
        if (!d.chats.continueChat) throw new Error(`agent_assign_task: ${blocked}; moving the child to another engine is unavailable here.`);
        const next = await d.chats.continueChat(child.id, { allowStart: false, ask: false, on: { harness: move, model: preset?.model ?? null, effort: preset?.effort ?? null },
          assignment: { goal: contract.goal, doneWhen: contract.doneWhen }, promptPrefix: `La chat «${child.title}» girava su ${child.harness}, che ora non può partire (${blocked}): l’app continua il suo lavoro qui, su ${move}, dal suo passaggio di consegne qui sotto.\n\n${prompt}` });
        if (step !== null) d.chats.planDelegated?.(parent.id, step, [next.id]);
        const warned = [...presetWarnings, ...contractWarnings(contract)];
        return { chatId: next.id, continuedFrom: child.id, harness: next.harness, note: [`${child.harness} cannot run now (${blocked}): the task goes on in «${next.title}» on ${move}, from «${child.title}»'s hand-off; use this chatId from now on.`, ...(userInstructions.length ? [USER_INSTRUCTIONS_NOTE] : [])].join(' '), ...(preset ? { preset: preset.preset } : {}), ...(userInstructions.length ? { userInstructions } : {}), ...(warned.length ? { warnings: warned } : {}) };
      }
      // the switch itself happens inside assignTask, after its guards (busy, queued, version, held result)
      const options: TaskAssignmentOptions = { mode: a.mode as 'continue' | 'new-task' | 'rework', expectedVersion: version, ...(a.expectedEventSeq !== undefined ? { expectedEventSeq: Number(a.expectedEventSeq) } : {}), doneWhen: contract.doneWhen, contractFields: contractFields(contract), ...(step !== null ? { planStep: step } : {}), source: { kind: 'chat', chatId: parent.id },
          ...(preset ? { preset: { choice: runPresetOf(preset), model: preset.model, ...(switchTo ? { switchTo: { model: switchTo.model ?? '', effort: switchTo.effort ?? null } } : {}) } } : {}) };
      const linked = moved || on ? await d.chats.assignElsewhere!(child.id, prompt, options, { ...(moved ? { cwd, ...(place ? { place } : {}) } : {}), ...(on ? { on } : {}) }) : null;
      if (!linked) await d.chats.assignTask(child.id, prompt, options);
      const assigned = chat(linked?.id ?? child.id);
      const warned = [...(linked?.folderNotes ?? []), ...presetWarnings, ...contractWarnings(contract)];
      return { chatId: linked?.id ?? child.id, ...(linked ? { continuedFrom: child.id, cwd: linked.cwd, harness: linked.harness } : {}), taskId: assigned?.run?.taskId, taskVersion: assigned?.run?.taskVersion, runId: assigned?.run?.runId, ...(preset ? { preset: preset.preset } : {}), ...(userInstructions.length ? { userInstructions, note: USER_INSTRUCTIONS_NOTE } : {}), ...(warned.length ? { warnings: warned } : {}) };
    } finally {
      assigning.delete(child.id);
    }
  }

  /** agent_close_child: a parent closes one of its own descendants with app_close_chat's rules (chats/close-rules.ts) */
  async function closeChild(a: Record<string, unknown>, callerId: string): Promise<unknown> {
    // an open role chat whose assignment is still live: a parent that reported cannot close its tree on a late wake
    const parent = activeParent(callerId, 'agent_close_child');
    if (!d.chats.close) throw new Error('agent_close_child is unavailable.');
    const all = d.chats.list(), id = typeof a.chatId === 'string' ? a.chatId : '';
    const child = all.find(c => c.id === id);
    if (!child || !descendantIds(parent.id, all).has(id)) throw new Error('agent_close_child: chatId must be one of YOUR children or their descendants (agent_children).');
    if (child.closedAt) return { closed: child.title, already: true };
    const refused = closeRefusal(child, all);
    if (refused) throw new Error(`agent_close_child: ${refused}`);
    await d.chats.close(id, 'agent');
    log.info('agents', 'parent closed a child', { chat: parent.id, data: { child: id, state: child.state } });
    return { closed: child.title };
  }

  function taskEvents(a: Record<string, unknown>, callerId: string): UserTaskEvents {
    activeParent(callerId, 'agent_task_events');
    const child = typeof a.chatId === 'string' ? chat(a.chatId) : undefined;
    if (!child || child.parentId !== callerId || !d.chats.userEvents) throw new Error('agent_task_events: chatId must be one of YOUR direct children.');
    // Always return the complete ledger: a parent must see the user's instructions before a follow-up.
    return d.chats.userEvents(child.id, 0);
  }

  /** agent_report's `remember`: ONE short line for the reporting chat's role skill, checked before the report and written
   *  once it is accepted (a refused report writes nothing, so a retry does not count twice). One, not three (owner,
   *  2026-11-13, «meno lezioni inutili»): in four days 242 runs noted 447 lines, two a run on average, no line ever
   *  noted twice, about one skill change per Maintenance. Further lines are left out with a warning, never a refusal. */
  function rememberLines(a: Record<string, unknown>, self: ChatSummary | undefined, warnings: string[]): (() => number) {
    if (a.remember === undefined) return () => 0;
    // The lesson is one line of text. A bare string is that line; of a list only the first entry counts, the others
    // are left out with a warning and never checked; line breaks become spaces. None of these refuses the report.
    const given: unknown[] = typeof a.remember === 'string' ? [a.remember] : Array.isArray(a.remember) ? a.remember : [null];
    if (given.length > REMEMBER_MAX) warnings.push(`remember: only the first line was noted (one line per report); ${given.length - REMEMBER_MAX} left out.`);
    const first = given[0];
    if (typeof first !== 'string' || !first.trim()) {
      if (given.length) warnings.push('remember: not noted, it must be one line of text. The report itself is accepted: do not send it again for this.');
      return () => 0;
    }
    const lines = [first.replace(/[\x00-\x1f\x7f]+/g, ' ').trim()];
    // a line over REMEMBER_LINE is cut with the marker «…», never refused (P8)
    lines.forEach((line, i) => { if (line.length > REMEMBER_LINE) { lines[i] = capText(line, REMEMBER_LINE); warnings.push(`remember line ${i + 1} cut to ${REMEMBER_LINE} characters (marker …).`); } });
    // the worth gate (ADR 0129): a line tied to one case is left out with its reason, and the report goes through. It
    // was a refusal: 51 reports sent again whole in a month of the owner's chats for a line nobody had asked for.
    const worth = lines.filter(line => {
      try { checkMemoryWorth('setup', 'note', line); return true; }
      catch (e) { warnings.push(`remember: line not noted (${e instanceof Error ? e.message : String(e)}) The report itself is accepted: do not send it again for this.`); return false; }
    });
    if (!worth.length) return () => 0;
    const roleId = self?.agent?.source === 'catalog' ? self.agent.id : null;
    if (!roleId || !d.remember) { warnings.push('remember: not noted, it works only in a role chat with a brain.'); return () => 0; }
    // the report is already delivered when this runs: a failed write is logged, never turned into a refused report
    return () => {
      let written = 0;
      try { for (const line of worth) { d.remember!(roleId, line, self!); written++; } }
      catch (e) { log.warn('agents', 'role lessons not proposed', { chat: self!.id, data: { role: roleId, written }, cause: e instanceof Error ? e.message : String(e), hint: 'Check that a brain folder is chosen and writable' }); return written; }
      log.info('agents', 'role lessons proposed', { chat: self!.id, data: { role: roleId, lines: written } });
      return written;
    };
  }

  /** The report's shape against the contract. A report the check sends back (a criterion not answered, «done» with one
   *  not met, a wrong field) is the agent's own mistake: it reads the reason and reports again. A ToolRefusal, so the
   *  app's log keeps it at info and Manutenzione does not file it as an app bug (#439). */
  const checked = (a: Record<string, unknown>, doneWhen: readonly string[]) => {
    // only what the check itself says (plain Errors): a TypeError is a bug of the app and stays a failed tool
    try { return checkResult(a, doneWhen); } catch (e) { throw e instanceof Error && e.constructor === Error ? new ToolRefusal(e.message) : e; }
  };

  function report(all: Record<string, unknown>, callerId: string): unknown {
    const self = chat(callerId);
    // `remember` is the role memory's, not the result's: the result keeps its exact shape (shared/delegation.ts checkResult)
    const warnings: string[] = [];
    const { remember: _remember, ...a } = all, write = rememberLines(all, self, warnings);
    // Small cosmetic overflows must not require another model turn. Full evidence stays in output/doneWhen;
    // neither outcome nor the host's completion criteria are repaired or relaxed.
    // A longer summary is cut with the marker «…», never refused; its full text stays in output (P8, cloudroom comms).
    // A longer output is cut the same way: a refusal made the agent write the whole result again (33 times in a month
    // of the owner's chats). The marker shows the parent that text is missing; the agent can amend with a shorter one.
    if (typeof a.output === 'string' && a.output.length > RESULT_OUTPUT_MAX) {
      const full = a.output.length, cut = capText(a.output, RESULT_OUTPUT_MAX);
      a.output = cut;
      warnings.push(`output cut to ${RESULT_OUTPUT_MAX} characters (marker …): its last ${full - (cut.length - 1)} were left out. Only if they matter, report once more with amends: true and a shorter output.`);
    }
    if (typeof a.summary === 'string' && a.summary.trim().length > SUMMARY_MAX) {
      const full = a.summary.trim();
      a.summary = capText(full, SUMMARY_MAX);
      const tail = `\n\nSintesi completa: ${full}`;
      if (typeof a.output !== 'string' || a.output.includes(full)) warnings.push(`summary cut to ${SUMMARY_MAX} characters (marker …); its full text is in output.`);
      else if (a.output.length + tail.length <= RESULT_OUTPUT_MAX) { a.output += tail; warnings.push(`summary cut to ${SUMMARY_MAX} characters (marker …); its full text is in output.`); }
      else if (a.output.length <= RESULT_OUTPUT_MAX && tail.length <= RESULT_OUTPUT_MAX / 2) {
        // no room left: the output's tail makes room (marker …), so the full summary is never lost
        const head = capText(a.output, RESULT_OUTPUT_MAX - tail.length);
        warnings.push(`summary cut to ${SUMMARY_MAX} characters (marker …); its full text is at the end of output, whose last ${a.output.length - (head.length - 1)} characters were cut to make room (marker …).`);
        a.output = head + tail;
      } else warnings.push(`summary cut to ${SUMMARY_MAX} characters (marker …); its full text was too long to keep in output: put what matters in output.`);
    }
    // Agents commonly attach top-level evidence. It is not canonical verification; explicitly discard it, never
    // merge it into doneWhen or a review verdict. Other unknown keys still report likely misspellings.
    if (Object.hasOwn(a, 'evidence')) { delete a.evidence; warnings.push('Ignored top-level evidence; put evidence in doneWhen entries or output.'); }
    // a block only the user can lift never stays only in the report text (#358): sent back once to name it in userAction
    const runKey = `${callerId}:${self?.run?.runId ?? ''}`;
    if ((a.outcome === 'partial' || a.outcome === 'blocked') && a.userAction === undefined && !askedUserAction.has(runKey)
      && typeof a.summary === 'string' && USER_ONLY_BLOCKER.test(a.summary)) { // the summary's words, never code or logs in output
      askedUserAction.add(runKey);
      throw new ToolRefusal(USER_ACTION_REFUSAL);
    }
    const review = independentReview(self);
    if ((a.verdict !== undefined || a.verified !== undefined) && review && (self?.closedAt || self?.run?.endedAt !== undefined)) throw new Error('Review fields require an active app-owned independent reviewer run.');
    // any other chat never had the fields in its schema (reportSchema); one sent anyway (an engine that listed tools
    // before the chat was known) is dropped, not a refused report (#183)
    if (!review && (a.verdict !== undefined || a.verified !== undefined)) {
      log.info('agents', 'review fields dropped from a non-review report', { chat: callerId });
      delete a.verdict; delete a.verified;
    }
    if (review && (a.verdict === undefined || a.verified === undefined)) throw new Error('Independent reviews require explicit verdict and verified fields.');
    // Root contracts are host-owned. Direct-user and explicit app replay roots retain their results locally.
    if (self && !self.delegation && !self.parentId && !self.isOrchestrator && self.run && (self.run.startedBy === 'orchestrator' || self.run.startedBy === 'user' || self.run.taskContract?.reportExpected) && d.chats.reportRoot) {
      const done = d.chats.reportRoot(callerId, checked(a, self.run.taskContract?.doneWhen ?? [])), remembered = write();
      return { reported: true, to: self.run.startedBy === 'app' ? 'this-chat' : 'orchestrator', delivered: done.delivered, ...(warnings.length ? { warnings } : {}), ...(remembered ? { remembered } : {}), ...(done.delivered ? {} : { note: 'The canonical result is retained on its run; pending delivery retries.' }) };
    }
    if (!self?.delegation || !self.parentId) throw new Error('agent_report: only a chat the Orchestrator or a parent started reports with it (agent_delegate or app_create_chat). Answer in this chat instead.');
    const result = checked(a, self.delegation.doneWhen);
    const done = d.chats.reportDelegation(callerId, result), remembered = write();
    return { reported: true, parentId: done.parentId, delivered: done.delivered, ...(warnings.length ? { warnings } : {}), ...(remembered ? { remembered } : {}) };
  }

  function children(callerId: string): unknown {
    const runs = d.runs(), now = d.now?.() ?? Date.now(), stallMin = d.settings().stallMin;
    const quiet = (c: ChatSummary) => stalledMin(c, Math.max(d.chats.lastEventAt?.(c.id) ?? 0, c.updatedAt), now, stallMin);
    return { children: d.chats.list().filter(c => c.parentId === callerId).map(c => ({
      chatId: c.id, title: c.title, role: c.delegation?.role ?? c.agent?.id ?? null, state: c.closedAt ? 'closed' : c.state,
      ...(c.run?.endCause ? { endCause: c.run.endCause } : {}),
      cwd: c.cwd, ...(c.userEvents ? { userEvents: c.userEvents } : {}),
      ...(c.run ? { runId: c.run.runId, taskId: c.run.taskId ?? c.run.runId, taskVersion: c.run.taskVersion ?? 1 } : {}),
      goal: c.delegation?.goal ?? null, result: c.delegation?.result ?? null, pending: c.pending,
      // its open questions: yours to answer where holder is your chat id (agent_answer_child, requestId = id)
      ...((qs => qs.length ? { questions: qs.map(q => ({ id: q.id, asks: q.asks, level: q.level, holder: q.holder ?? null, since: q.levelAt })) } : {})(openQuestions(c.questions))),
      ...(c.run ? { costUsd: runs.find(r => r.runId === c.run!.runId)?.costUsd ?? null } : {}),
      ...((m => m === null ? {} : { stalled: true, quietMin: m })(quiet(c))),
      // how its model was picked (ADR 0354): the models of its level passed over, each with why
      ...(c.pick ? { pick: pickLines(c.pick, now) } : {}),
      ...(c.creditMoved ? { moved: `da ${c.creditMoved.from} a ${c.creditMoved.to}, livello ${c.creditMoved.level}: ${c.creditMoved.why}` } : {}),
      // out of credits (ADR 0346, 0354): it moves by itself to the next model of its level with room, or waits for one
      ...(c.creditWait && !c.closedAt ? { waitsOn: 'credits', creditWait: { model: c.creditWait.model, since: c.creditWait.at, ...(c.creditWait.waiting ? { allOut: c.creditWait.waiting.out, firstBack: c.creditWait.waiting.first } : {}), ...(c.creditWait.next ? { movesAt: c.creditWait.next.at, to: c.creditWait.next.card } : {}) } } : {}),
    })) };
  }

  async function integrateChildren(a: Record<string, unknown>, callerId: string, many = false): Promise<DelegationIntegration> {
    const parent = structuredClone(activeParent(callerId, many ? 'agent_integrate_children' : 'agent_integrate_child'));
    const ids = many ? a.chatIds : [a.chatId];
    if (Object.keys(a).some(k => k !== (many ? 'chatIds' : 'chatId')) || !Array.isArray(ids) || !ids.length || ids.length > TASKS_MAX || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('Integration requires 1 to 10 distinct IDs of YOUR direct children.');
    const selected = ids.map(id => chat(id as string));
    if (selected.some(c => !c || c.parentId !== callerId)) throw new Error('Integration requires IDs of YOUR direct children.');
    const children = structuredClone(selected as ChatSummary[]), policy = structuredClone(d.chats.agentPolicy(parent.id));
    if (parent.permissionMode === 'plan' || policy?.ceiling === 'plan' || (policy?.tools && !policy.tools.allow.some(c => c === 'edit' || c === 'shell'))) throw new Error('Your current permissions do not allow staging repository changes.');
    // a child that worked in place left its commits in its folder: never applied a second time (ADR 0358)
    const inPlace = d.isolated ? children.filter(c => !d.isolated!(c)) : [];
    if (inPlace.length) {
      const named = inPlace.map(c => `${c.id} (${c.cwd})`).join(', ');
      return { status: 'blocked', reason: `Nothing to integrate for ${named}: it worked in place, its commits are already in that folder.${inPlace.length < children.length ? ' Integrate the others in a call of their own.' : ''}`, checksRequired: true, parentUnchanged: true };
    }
    if ((many && !d.integrateMany) || (!many && !d.integrate)) throw new Error('Safe isolated integration is unavailable.');
    if (children.some(c => assigning.has(c.id))) throw new Error('A selected child has an assignment or integration in progress.');
    children.forEach(c => assigning.add(c.id));
    try {
      const result = many ? await d.integrateMany!(structuredClone(parent), structuredClone(children)) : await d.integrate!(structuredClone(parent), structuredClone(children[0]!));
      let current: ChatSummary;
      try { current = activeParent(callerId, 'agent_integrate_children'); }
      catch { return { ...result, status: 'blocked', reason: 'The parent assignment ended while staging; do not use this stale integration result.' }; }
      if (!current || current.closedAt || current.cwd !== parent.cwd || current.permissionMode !== parent.permissionMode || JSON.stringify(d.chats.agentPolicy(parent.id)) !== JSON.stringify(policy)
        || current.run?.runId !== parent.run?.runId || current.run?.taskVersion !== parent.run?.taskVersion || current.run?.endedAt !== parent.run?.endedAt
        || children.some(c => { const now = chat(c.id); return !now || now.cwd !== c.cwd || now.run?.runId !== c.run?.runId || now.run?.taskVersion !== c.run?.taskVersion; })) return { ...result, status: 'blocked', reason: 'An assignment changed while staging; do not use this stale integration result.' };
      return result;
    }
    finally { children.forEach(c => assigning.delete(c.id)); }
  }

  function askParent(a: Record<string, unknown>, callerId: string): unknown {
    const self = chat(callerId);
    if (!self?.delegation || !self.parentId) throw new Error('agent_ask_parent: only a delegated chat has a parent to ask; ask the user instead.');
    if (self.delegation.result) throw new Error('agent_ask_parent: you reported already.');
    const question = typeof a.question === 'string' ? a.question.trim() : '';
    if (!question || question.length > QUESTION_MAX) throw new Error(`agent_ask_parent: question = 1 to ${QUESTION_MAX} characters.`);
    const options = a.options === undefined ? [] : Array.isArray(a.options) && a.options.length <= OPTIONS_MAX && a.options.every(o => typeof o === 'string' && o.trim() && o.length <= 200) ? (a.options as string[]).map(o => o.trim()) : null;
    if (!options) throw new Error(`agent_ask_parent: options = up to ${OPTIONS_MAX} short texts.`);
    const why = typeof a.why === 'string' ? a.why.trim().slice(0, 500) : '';
    const { asked } = d.chats.ladderAsk(callerId, { question, options, ...(why ? { why } : {}) });
    log.info('agents', 'child asked up the ladder', { chat: callerId, data: { options: options.length } });
    return { asked, note: 'The answer reaches you as a message, also when it is the user\'s. Go on with what does not depend on it; do not ask the same thing again meanwhile.' };
  }

  async function answerChild(a: Record<string, unknown>, callerId: string): Promise<unknown> {
    const childId = typeof a.chatId === 'string' ? a.chatId : '';
    if (!chat(callerId) || !chat(childId)) throw new Error('agent_answer_child: chatId must be the chat of a question that waits for you (agent_children).');
    const text = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v.trim() : undefined;
    const answer = text(a.answer), why = text(a.why), requestId = text(a.requestId);
    return d.chats.ladderReply(callerId, { chatId: childId, ...(requestId ? { requestId } : {}), ...(answer ? { answer } : {}), ...(why ? { why } : {}), ...(a.askUser === true ? { askUser: true } : {}) });
  }

  const str = { type: 'string' };
  const reportSchema: Record<string, unknown> = { type: 'object', required: ['outcome', 'summary', 'output', 'doneWhen'], additionalProperties: false, properties: {
      outcome: { type: 'string', enum: ['done', 'partial', 'blocked'], description: 'done only when every doneWhen entry has met: true; else partial or blocked' }, summary: { ...str, description: `one or two sentences, up to ${SUMMARY_MAX} characters (a longer one is cut with …)` }, output: { ...str, description: `the result, up to ${RESULT_OUTPUT_MAX} characters (a longer one is cut with …): long material goes in a file, its path here` },
      amends: { type: 'boolean', description: `true only to correct the result you already reported for this assignment: the new version replaces it and reaches the same reader, marked as a correction; at most ${MAX_CORRECTIONS} corrections` },
      verdict: { type: 'string', enum: ['success', 'partial', 'fail'], description: 'Only app-owned independent reviews: assessment of the reviewed work, separate from completion of your review.' },
      verified: { type: 'string', enum: ['yes', 'partial', 'no'], description: 'Only with verdict: yes only when you independently checked the evidence; never inferred from completing the review.' },
      taskVersion: { type: 'integer', minimum: 1, description: 'Current task version supplied with the assignment; required after a follow-up. Stale reports are refused.' },
      doneWhen: { type: 'array', description: 'one entry per criterion of your contract, written exactly as in the contract (the field is doneWhen, never criteria)', items: { type: 'object', required: ['criterion', 'met'], additionalProperties: false, properties: { criterion: { ...str, maxLength: CRITERION_MAX }, met: { type: 'boolean' }, evidence: { ...str, maxLength: EVIDENCE_MAX } } } },
      questions: { type: 'array', items: { ...str, maxLength: 500 }, maxItems: 8 },
      userAction: { type: 'object', required: ['kind', 'text'], additionalProperties: false, description: 'only with outcome partial or blocked, when the next step is one only the user can do (turn on the VPN, a login with MFA, an Esegui command, a permission, a decision): the app asks the user at once in the Orchestrator and, on Sì, tells your parent to resume. Never leave such a block only in the report text. Never for what the Orchestrator, your parent or another chat must do (that goes in summary and questions): a userAction shows your chat as waiting for the user until he acts.',
        properties: { kind: { type: 'string', enum: [...USER_ACTION_KINDS] }, text: { ...str, maxLength: USER_ACTION_TEXT_MAX, description: 'what the user must do, in the user\'s language' }, command: { ...str, maxLength: USER_ACTION_COMMAND_MAX, description: 'the exact command to run, if any' } } },
      goalChangedByUser: { type: 'boolean', description: 'true when the user wrote to you directly and changed your goal (you followed the user)' },
      newGoal: { ...str, description: 'with goalChangedByUser: the goal the user gave you' },
      remember: { type: 'array', items: str, description: 'Usually left out: most runs teach nothing a future run needs. ONE short line (at most 300 characters, a longer one is cut with …), only when this run cost you a wrong turn or a search that the line would spare the next run of your role: it is noted as a lesson for YOUR role skill (read in full at every start of your role) and read by the next Maintenance, which changes the skill only when really needed. General, reusable knowledge (a procedure, a convention, a how-to, where things are kept). Generalize a specific finding first (no URLs with ports, ticket / PR / commit ids, user paths, dates, branch names): a case-specific line is left out. Never the task result, never what you did' },
    } };
  return [{
    name: 'agent_delegate',
    description: 'Delegate the parts of your task to other roles: each part starts a visible chat under yours, running the role you name (only roles your role may launch: agent_catalog). The child sees only its contract, never this conversation: write it self-contained. Several parts start at once (parallel): a parallel group of your approved plan goes in one call. It never gets more permissions than you, works in the folder you name (cwd: any existing one: the brain, any repository, worktree or slot; place: here by default, copy only to get an isolated worktree), and returns one result with agent_report that reaches you as a message. The depth limit is the user\'s. A Sentinel reviewing a child\'s work: reviewOf = that child\'s runId. One review chat per piece of work: once a Sentinel of yours reported on this task, a new Sentinel is refused; re-review the fix in that chat with agent_assign_task (only the fix delta). Each part runs on its role\'s card: preset picks one of its three (omitted = its plan step\'s preset, else base); the model is the one the card has now.',
    inputSchema: { type: 'object', required: ['tasks'], additionalProperties: false, properties: {
      tasks: { type: 'array', minItems: 1, maxItems: TASKS_MAX, items: { type: 'object', required: ['role', 'title', 'contract'], additionalProperties: false, properties: {
        role: { type: 'string', enum: [...WORK_ROLE_IDS] }, title: { ...str, description: '"Area · what", e.g. "Ordini · Log degli errori"' },
        cwd: { ...str, description: 'optional absolute folder the part works in: yours (the default) or any other existing one. It gives no permission' }, place: PLACE_SCHEMA,
        step: { type: 'integer', minimum: 1, description: 'with a plan approved by the user (plan_propose): the step number this part does' },
        ...PRESET_SCHEMA,
        freshReview: { type: 'boolean', description: 'only for role sentinel: open a fresh one although a Sentinel of yours already reviewed this task; only when the user asked for it or it checks a part none of them covers' },
        reviewOf: { ...str, description: 'only for role sentinel: the runId of your child\'s run it reviews (agent_children)' },
        contract: { type: 'object', required: ['goal', 'doneWhen'], additionalProperties: false, properties: {
          goal: { ...str, description: 'the wanted outcome, one checkable sentence' }, output: { ...str, description: 'what to give back; default: the role\'s output' },
          doneWhen: { type: 'array', items: str, minItems: 1, maxItems: 12, description: 'checkable criteria, each with the expected evidence' },
          why: { ...str, description: 'what the result is for, who asks, what they will decide with it' },
          alreadyDecided: { ...str, description: 'choices already taken with the user: not to reopen' },
          inScope: str, outOfScope: { ...str, description: 'explicit non-goals' },
          constraints: { ...str, description: 'task-only constraints: repo, branch, time, cost' },
          steps: { type: 'array', items: str, minItems: 1, maxItems: 5, description: 'only when order matters' },
          askIf: { ...str, description: 'the ambiguous reading that would change the work: ask the parent' },
          context: { ...str, description: 'facts, sources and constraints the child needs' },
          tools: { type: 'array', items: str, description: 'optional: the tool classes the part needs (read, shell-read, web, browser-read = it shares the folder; omitted or one that writes = its own worktree). It only chooses the folder: it does not limit what the child may run, so it never makes it ask for a read. A class beyond yours or the role\'s is refused. A database write, a production release and a cloud write wait for the user whatever it says' },
          skills: { type: 'array', items: str, description: 'brain skills it may use (their SKILL.md names)' },
        } },
      } } },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => JSON.stringify(await delegate(a, callerOf(ctx.params))),
  }, {
    name: 'agent_assign_task',
    description: 'Continue YOUR direct child in the same role with a separate task run. The user\'s messages and answers in that chat you have not seen come back to you readable (userInstructions): the child already has them, so they are not repeated in its prompt; account for them, and correct the child or ask the user where your contract disagrees. expectedVersion (taskVersion from agent_children) and expectedEventSeq are optional and honoured when given. Refused only while the child works or has queued work. Any engine: a child active, stopped or closed by itself resumes with its history on its own engine (ADR 0352). Keeps the session and skills; the child takes its card\'s current tools and permissions, never wider than yours, so a changed card or level is no reason for a fresh child. Another folder (cwd, place), or the engine the user\'s order starts the role on now, goes on in a linked chat (the answer\'s chatId). When the child\'s engine cannot run now, the task goes on by itself in a new child of the role on the level\'s engine, from the hand-off: use the answer\'s chatId (continuedFrom = the old one). A Sentinel that reviewed this task is continued here after a fix (mode continue): it reviews only the fix delta. Use rework only for explicit corrections. With an approved plan, step is required. preset: one of the role card\'s three; omitted preset = its plan step\'s, else base. Closed parents must first receive a new assignment from their own parent or Orchestrator.',
    inputSchema: { type: 'object', required: ['chatId', 'roleId', 'mode', 'contract'],additionalProperties: false, properties: {
      chatId: str, roleId: { type: 'string', enum: [...WORK_ROLE_IDS] }, cwd: { ...str, description: 'optional: omitted = the child\'s own folder; another existing one = the task goes on in a linked chat there, with the child\'s context, plan step and history; nothing of the old folder is moved' }, place: PLACE_SCHEMA,
      mode: { type: 'string', enum: ['continue', 'new-task', 'rework'] },
      expectedVersion: { type: 'integer', minimum: 1 }, expectedEventSeq: { type: 'integer', minimum: 0 },
      step: { type: 'integer', minimum: 1 },
      ...PRESET_SCHEMA,
      contract: { type: 'object', required: ['goal', 'doneWhen'], additionalProperties: false, properties: {
        goal: str, output: str, context: str, doneWhen: { type: 'array', items: str, minItems: 1, maxItems: 12 },
        why: { ...str, description: 'what the result is for, who asks, what they will decide with it' },
        alreadyDecided: { ...str, description: 'choices already taken with the user: not to reopen' },
        inScope: str, outOfScope: { ...str, description: 'explicit non-goals' },
        constraints: { ...str, description: 'task-only constraints: repo, branch, time, cost' },
        steps: { type: 'array', items: str, minItems: 1, maxItems: 5, description: 'only when order matters' },
        askIf: { ...str, description: 'the ambiguous reading that would change the work: ask the parent' },
      } },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => JSON.stringify(await assignChild(a, callerOf(ctx.params))),
  }, {
    name: 'agent_integrate_child',
    description: 'Stage one finished direct child’s committed changes in a fresh detached worktree. Never changes your checkout, merges a branch or pushes. A child that works in another repository is staged in that repository. Returns pinned heads (parentHead = the head of the checkout it is staged from), staging cwd and a whitespace-only check; repository tests and independent review are still required. Dirty sources and missing host isolation are blocked.',
    inputSchema: { type: 'object', required: ['chatId'], additionalProperties: false, properties: { chatId: str } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => JSON.stringify(await integrateChildren(a, callerOf(ctx.params))),
  }, {
    name: 'agent_integrate_children',
    description: 'Combine 1 to 10 finished direct children’s committed changes into one fresh detached staging worktree. Uses host-owned allocations and pinned commits; reports conflicts and a whitespace-only receipt. One repository per call: children that work in another repository are staged there, in a call of their own. Run repository checks and independent review on the returned union tree. Never merges branches, changes your checkout or pushes.',
    inputSchema: { type: 'object', required: ['chatIds'], additionalProperties: false, properties: { chatIds: { type: 'array', items: str, minItems: 1, maxItems: TASKS_MAX, uniqueItems: true } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => JSON.stringify(await integrateChildren(a, callerOf(ctx.params), true)),
  }, {
    name: 'agent_task_events',
    description: 'Read the complete ordered user instruction ledger for YOUR direct child. Optional before agent_assign_task, which returns the unread ones itself; no model turn is started.',
    inputSchema: { type: 'object', required: ['chatId'], additionalProperties: false, properties: { chatId: str } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (a, ctx) => JSON.stringify(taskEvents(a, callerOf(ctx.params))),
  }, {
    name: 'agent_report',
    description: 'Your one result for the chat that started you (your parent, or the Orchestrator for a chat it opened): outcome (done | partial | blocked), summary (one or two sentences), output (the deliverable), doneWhen (every criterion of your contract, exactly as written, with met and evidence), optional questions, optional userAction (outcome partial or blocked because only the user can act: VPN, login/MFA, an Esegui command, a permission, a decision; never only in the text), optional remember (lines noted for your role skill). It reaches your parent at once; call it once, at the end; to correct a result already given, call it again with amends: true (at most 2 corrections). The app shows output in your chat as your answer: do not write it in the chat too.',
    inputSchema: reportSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    // verdict / verified only where the report check accepts them: an app-owned independent review (#183); an engine
    // not yet owned by a chat (a warm one) sees them all, as before
    inputSchemaFor: params => { const self = params.chatId ? chat(params.chatId) : undefined; return !self || independentReview(self) ? reportSchema : withoutReviewFields(reportSchema); },
    run: (a, ctx) => JSON.stringify(report(a, callerOf(ctx.params))),
  }, {
    name: 'agent_ask_parent',
    description: 'Ask the chat that started you for a missing fact or a choice, while you go on with the rest; the answer comes as a message. When you can not go on without it, ask in your own question panel instead: the app gives it to the same chat first. Either way it climbs one level at a time (your parent, the Orchestrator, the user), so never ask the user yourself; reuse decisions already in the contract.',
    inputSchema: { type: 'object', required: ['question'], additionalProperties: false, properties: {
      question: str, options: { type: 'array', items: str, maxItems: OPTIONS_MAX }, why: { ...str, description: 'what depends on it' },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (a, ctx) => JSON.stringify(askParent(a, callerOf(ctx.params))),
  }, {
    name: 'agent_answer_child',
    description: 'Answer a question of a delegated chat that waits for you (its question panel or agent_ask_parent: chatId and requestId from the message, or agent_children), only when the request, the user\'s recorded decisions, the brain or the code settle it: why = that source. Your answer is never the user\'s consent. askUser: true when you do not know, or it changes the goal, what colleagues, QA or customers do, or cannot be undone: it goes one level up (the Orchestrator, then the user), you ask nobody. The chat waits; after 10 silent minutes it goes up by itself.',
    inputSchema: { type: 'object', required: ['chatId'], additionalProperties: false, properties: { chatId: str, requestId: { ...str, description: 'which question, when the chat has more than one open' }, answer: str, why: { ...str, description: 'where the answer comes from; with askUser, why you can not decide it' }, askUser: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => JSON.stringify(await answerChild(a, callerOf(ctx.params))),
  }, {
    name: 'agent_close_child',
    description: 'Close one of YOUR delegated chats (a child or a descendant of it), e.g. a stalled one or one whose part is no longer needed: its engine stops and its own delegation tree closes with it (ADR 0217); the transcript stays. Refused while it or an open descendant waits for the user (a question or a permission is his). Never your parent, a sibling or another tree.',
    inputSchema: { type: 'object', required: ['chatId'], additionalProperties: false, properties: { chatId: str } },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: async (a, ctx) => JSON.stringify(await closeChild(a, callerOf(ctx.params))),
  }, {
    name: 'agent_children',
    description: 'The chats you delegated (agent_delegate): role, title, state, goal, their result once reported, open requests and cost. endCause on a closed child says why its task ended before it was completed: user (the user closed it), auto (the app archived it), parent (closed with the chat above it), no-report (it ended with no agent_report). stalled: true (with quietMin) = a working child silent for longer than the user\'s "Ferma dopo" limit: nudge it with a message or close it. waitsOn: "credits" = its model ran out of credits: it is not failed; the app moves it by itself, from where it was, to the first model with room of the same level (creditWait.movesAt/to), or, when the whole level is out (creditWait.allOut), waits and moves as soon as one is free (firstBack); do not delegate its part again, do not ask another preset for it and do not close it: go on with what does not depend on it. pick = the models of its level passed over at its start and why; moved = its last move.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (_a, ctx) => JSON.stringify(children(callerOf(ctx.params))),
  }];
}
