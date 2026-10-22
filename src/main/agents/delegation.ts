// Direct parent-to-child delegation between role chats (ADR 0083), on every chat's own MCP endpoint
// (/mcp/chat/:chatId/:token; the caller is the token's chat, never an argument), pre-approved on Claude, Codex and
// Cursor (chats/app-tool-approval.ts): agent_delegate starts 1..n visible child chats at once, each running a role the
// caller's role may launch, with a self-contained contract (the child never sees the parent's conversation);
// agent_report is the child's one result, delivered to its parent as a message; agent_children lists the caller's
// children with their state and results. Questions go to the parent first (agent_ask_parent: a child's ambiguity reaches
// its parent as a message, answered with agent_answer_child from what the parent knows, or sent on to the user with
// askUser); only what needs a person (a permission, an irreversible or external action, a choice that changes the goal,
// what the parent could not answer) is asked of the user. What holds whoever asks: permissions only go down (a contract asking for a
// tool class beyond the parent's is refused, and the child's policy is narrowed by the parent's, chats/manager.ts), the
// child's folder stays inside the parent's, the depth and parallel limits of Impostazioni → Ruoli e deleghe are checked
// with the slots reserved synchronously (two calls at once cannot both pass the last slot) and a refusal shows in the
// parent's chat. A child may run on another engine only when the user allows chats across engines. Used by wiring.ts.
import path from 'node:path';
import type { ChatSummary, Harness, NewChat } from '../../shared/contract';
import type { AgentCatalog, AgentRun, UserTaskEvents } from '../../shared/agents';
import { canLaunch, isWorkRole, launchGap, ROLE_DEFAULTS, WORK_ROLE_IDS, type DelegationSettings } from '../../shared/roles';
import { oneLine } from '../../shared/agent-label';
import { CRITERION_MAX, EVIDENCE_MAX, RESULT_OUTPUT_MAX, SUMMARY_MAX, checkContract, checkResult, delegationPrompt, depthOf, type DelegationLimitHit, type DelegationResult, type TaskAssignmentOptions } from '../../shared/delegation';
import { ORCHESTRATOR_TITLE } from '../../shared/orchestrator';
import { delegationGate, stepIndex, type StrategyPlan } from '../../shared/strategy';
import type { McpTool } from '../mcp/server';
import { allowsClass, belowParent, type AgentPolicy } from './tool-policy';
import { withinParent } from './worktrees';
import { gapLines, skillGaps } from './skill-needs';
import type { SkillToolsSource } from './discovery';
import { log } from '../log';
import { memoryWorth, specificHint } from '../rules/memory-worth';

/** What delegation needs from the chats (ChatManager). */
export interface DelegationChats {
  list(): ChatSummary[];
  assignTask?(chatId: string, prompt: string, options: TaskAssignmentOptions): Promise<void>;
  userEvents?(chatId: string, afterSeq?: number): UserTaskEvents;
  create(req: NewChat, by: 'agent'): Promise<ChatSummary>;
  agentPolicy(chatId: string): AgentPolicy | null;
  reportDelegation(chatId: string, result: DelegationResult): { parentId: string; delivered: boolean };
  /** a root role chat the Orchestrator opened reports to it (issue #93); absent = refused as before */
  reportRoot?(chatId: string, result: DelegationResult): { orchestratorId: string | null; delivered: boolean };
  limitNotice(chatId: string, kind: DelegationLimitHit['kind'], limit: number): void;
  /** a message from another chat (from = its title): agent_ask_parent, agent_answer_child */
  send(chatId: string, text: string, images?: unknown, resumed?: boolean, from?: string): Promise<void>;
  /** when the chat last produced anything (a transcript item, a state change, a send): the stall check (stalledMin) */
  lastEventAt?(chatId: string): number | undefined;
  /** a Strategist's plan with the user (ADR 0108): no delegation before the user's ok; a part names its step */
  planOf?(chatId: string): StrategyPlan | null;
  planDelegated?(chatId: string, i: number, chatIds: string[]): void;
  /** the child now waits for its parent's answer, not on its own report (#152) */
  askedParent?(chatId: string): void;
}
export interface DelegationDeps {
  chats: DelegationChats;
  roles: () => AgentCatalog;
  settings: () => DelegationSettings;
  /** why a chat on `from` may not open one on `to` (engines/policy.ts openRefusal), null = it may */
  engineRefusal: (from: Harness, to: Harness) => string | null;
  /** the label every agent-written first message starts with (appctl AGENT_LABEL) */
  label: string;
  /** the git worktrees of the repository at a folder (agents/worktrees.ts); a child may work in one of its parent's */
  worktrees?: (cwd: string) => Promise<string[]>;
  runs: () => readonly AgentRun[];
  /** the brain's skills with their tools: a part whose skill needs tools its role lacks is said in the answer (#93) */
  skillTools?: SkillToolsSource;
  /** adds one line to a role's own memory (agents/<id>/memory.md, rules/memory.ts writeAgentMemory): agent_report's
   *  `remember`; absent = the field is refused */
  remember?: (roleId: string, line: string, chat: ChatSummary) => void;
  /** the clock (tests) */
  now?: () => number;
}

export const TASKS_MAX = 10;
const TITLE_MAX = 80;
const QUESTION_MAX = 1000, OPTIONS_MAX = 6, ANSWER_MAX = 4000, REMEMBER_MAX = 3, REMEMBER_LINE = 300;

const callerOf = (params: Record<string, string>): string => {
  const id = params.chatId;
  if (!id) throw new Error('This tool works only on a chat\'s own endpoint.');
  return id;
};

/** A delegated child counts against its parent's parallel limit until it reports or closes. */
export const busyChild = (c: ChatSummary): boolean => !c.closedAt && !c.delegation?.result;

/** Minutes a delegated child has been stalled, or null: it is still busy (not reported, not closed), working (starting or
 *  running, nothing waiting on the user) and produced no event for `stallMin` minutes (Impostazioni → Ruoli e deleghe →
 *  "Ferma dopo"). agent_children reports it to the parent as `stalled`. */
export function stalledMin(c: ChatSummary, lastEventAt: number, now: number, stallMin: number): number | null {
  if (!busyChild(c) || (c.state !== 'running' && c.state !== 'starting') || c.pending > 0) return null;
  const quiet = now - lastEventAt;
  return quiet >= stallMin * 60_000 ? Math.floor(quiet / 60_000) : null;
}

export function delegationTools(d: DelegationDeps): McpTool[] {
  // slots taken by agent_delegate calls still creating their chats, per parent (checked and taken synchronously)
  const reserved = new Map<string, number>();
  const chat = (id: string) => d.chats.list().find(c => c.id === id);

  const assigning = new Set<string>();
  function activeParent(callerId: string, tool: string): ChatSummary {
    const parent = chat(callerId);
    const resume = parent?.parentId ? 'tell the user to request continuation of this same chat from your parent, which can use agent_assign_task' : 'tell the user to request continuation of this same chat in the Orchestrator, which can use app_assign_task';
    if (!parent || parent.closedAt || parent.state === 'closed') throw new Error(`${tool}: your chat is not open; ${resume}.`);
    if (parent.isOrchestrator || parent.agent?.source !== 'catalog' || !isWorkRole(parent.agent.id)) throw new Error(`${tool}: only a role chat delegates or assigns children.`);
    if (parent.run?.endedAt !== undefined || parent.run?.report?.via === 'agent_report' || parent.delegation?.result || parent.work?.status === 'completed') throw new Error(`${tool}: your assignment is over; ${resume}.`);
    return parent;
  }

  async function delegate(a: Record<string, unknown>, callerId: string): Promise<unknown> {
    let parent = activeParent(callerId, 'agent_delegate');
    if (parent.isOrchestrator) throw new Error('agent_delegate: the Orchestrator opens root chats with app_create_chat.');
    if (parent.agent?.source !== 'catalog' || !isWorkRole(parent.agent.id)) throw new Error('agent_delegate: only a role chat delegates (start one from Agenti).');
    if (parent.run && parent.run.endedAt !== undefined) throw new Error('agent_delegate: your assignment is over (you reported): ask your parent for a new one.');
    const catalog = d.roles(), own = catalog.profiles.find(p => p.id === parent.agent!.id);
    if (!own) throw new Error('agent_delegate: your role is not in the catalog.');
    const raw = a.tasks;
    if (!Array.isArray(raw) || !raw.length || raw.length > TASKS_MAX) throw new Error(`agent_delegate: tasks = 1 to ${TASKS_MAX} parts.`);
    // read before the limits: from here to the reservation nothing waits, so two calls cannot both take the last slot
    const parentCwd = parent.cwd, parentRunId = parent.run?.runId;
    const trees = d.worktrees ? await d.worktrees(parentCwd) : [];
    parent = activeParent(callerId, 'agent_delegate');
    if (parent.cwd !== parentCwd || parent.run?.runId !== parentRunId) throw new Error('Parent assignment or project changed; discard this stale delegation request.');
    const limits = d.settings(), all = d.chats.list();
    const parentOf = (id: string) => all.find(c => c.id === id)?.parentId;
    const depth = depthOf(parent.id, parentOf) + 1;
    if (depth > limits.maxDepth) {
      d.chats.limitNotice(parent.id, 'depth', limits.maxDepth);
      throw new Error(`agent_delegate refused: depth limit ${limits.maxDepth} reached (Settings → Roles and delegation). Do this part yourself or report it to your parent.`);
    }
    const running = all.filter(c => c.parentId === parent.id && busyChild(c)).length + (reserved.get(parent.id) ?? 0);
    if (running + raw.length > limits.maxParallel) {
      d.chats.limitNotice(parent.id, 'parallel', limits.maxParallel);
      throw new Error(`agent_delegate refused: ${running} of ${limits.maxParallel} children already running, ${raw.length} more asked (Settings → Roles and delegation). Wait for a result, then delegate again.`);
    }
    // a Strategist that planned with the user delegates only once the user approved the plan (its strip, ADR 0108)
    const plan = d.chats.planOf?.(parent.id) ?? null;
    const gate = delegationGate(plan, 'agent_delegate');
    if (gate) throw new Error(gate);
    const parentPolicy = d.chats.agentPolicy(parent.id);
    // everything is checked before any chat starts: one bad part refuses the whole call
    const plans = raw.map((value, i) => {
      const t = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
      if (!t) throw new Error(`tasks[${i}]: object required.`);
      const extra = Object.keys(t).find(k => !['role', 'title', 'contract', 'cwd', 'step'].includes(k));
      if (extra) throw new Error(`tasks[${i}]: unknown field ${extra}.`);
      const role = t.role;
      if (!isWorkRole(role)) throw new Error(`tasks[${i}].role: one of ${WORK_ROLE_IDS.join(', ')}.`);
      if (!canLaunch(own.launches, role)) throw new Error(`tasks[${i}]: ${own.name} may not launch ${ROLE_DEFAULTS[role].name} (it launches ${own.launches.join(', ') || 'none'}). Put this part in your report as a ready contract (role, goal, done-criteria): the Orchestrator starts it.`);
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
      if (outside.length) throw new Error(`tasks[${i}].contract.tools: ${outside.join(', ')} is not among ${profile.name}'s tools; contract.tools only narrows them.`);
      const cwd = typeof t.cwd === 'string' && t.cwd.trim() ? t.cwd.trim() : parent.cwd;
      if (!withinParent(parent.cwd, cwd, trees)) throw new Error(`tasks[${i}].cwd: a folder inside yours (${parent.cwd}) or one of your repository's worktrees; a child never leaves its parent's repository.`);
      const refused = d.engineRefusal(parent.harness, profile.engine);
      if (refused) throw new Error(`tasks[${i}]: ${profile.name} runs on ${profile.engine}: ${refused}`);
      if (t.step !== undefined && !plan) throw new Error(`tasks[${i}].step: only a plan approved by the user has steps; leave it out.`);
      const step = t.step !== undefined && plan ? stepIndex(plan, t.step, `tasks[${i}].step`) : null;
      return { role, title, contract, cwd, profile, step };
    });
    reserved.set(parent.id, (reserved.get(parent.id) ?? 0) + plans.length);
    try {
      const at = Date.now();
      const settled = await Promise.allSettled(plans.map(p => d.chats.create({
        harness: p.profile.engine, cwd: p.cwd, title: p.title, roleId: p.role, parentId: parent.id, goal: p.contract.goal,
        ...(p.contract.tier ? { tier: p.contract.tier } : {}), ...(p.contract.skills ? { skills: p.contract.skills } : {}),
        delegation: { role: p.role, goal: p.contract.goal, doneWhen: p.contract.doneWhen, at, ...(p.contract.tools ? { tools: p.contract.tools } : {}) },
        prompt: `${d.label}\n\n${delegationPrompt(p.contract, { role: p.role, parentTitle: parent.title, title: p.title, skills: p.contract.skills ?? [] })}`,
      }, 'agent')));
      const known = d.skillTools ? new Map(d.skillTools().map(x => [x.name, x.tools])) : null;
      // a skill whose tools the child lacks (its own policy, already narrowed by yours)
      const warnings = (i: number, chatId: string): { warnings?: string[] } => {
        const p = plans[i]!, lines = known ? gapLines(p.profile.name, skillGaps([...new Set([...p.profile.skills, ...(p.contract.skills ?? [])])], n => known.get(n), d.chats.agentPolicy(chatId))) : [];
        return lines.length ? { warnings: lines } : {};
      };
      const children = settled.map((s, i) => s.status === 'fulfilled'
        ? { role: plans[i]!.role, title: s.value.title, chatId: s.value.id, harness: s.value.harness, model: s.value.model, state: s.value.queued ? 'queued' : s.value.state, ...warnings(i, s.value.id) }
        : { role: plans[i]!.role, title: plans[i]!.title, error: s.reason instanceof Error ? s.reason.message : String(s.reason) });
      // each step of the plan with its started children: the strip shows it under way
      const steps = new Map<number, string[]>();
      settled.forEach((x, i) => { const st = plans[i]!.step; if (x.status === 'fulfilled' && st !== null) steps.set(st, [...steps.get(st) ?? [], x.value.id]); });
      for (const [i, ids] of steps) d.chats.planDelegated?.(parent.id, i, ids);
      log.info('agents', 'delegated', { chat: parent.id, data: { children: children.map(c => ({ role: c.role, chatId: 'chatId' in c ? c.chatId : null })), depth } });
      return { children, note: 'Each child reports to you with agent_report (it arrives as a message); agent_children shows their state. Do not wait idle: go on with your own part.' };
    } finally {
      const left = (reserved.get(parent.id) ?? 0) - plans.length;
      if (left > 0) reserved.set(parent.id, left); else reserved.delete(parent.id);
    }
  }

  /** A parent reuses only its own compatible child; policy changes require a fresh session. */
  async function assignChild(a: Record<string, unknown>, callerId: string): Promise<unknown> {
    const initial = activeParent(callerId, 'agent_assign_task'), initialCwd = initial.cwd, initialRunId = initial.run?.runId;
    if (!d.chats.assignTask || !d.chats.userEvents) throw new Error('agent_assign_task is unavailable.');
    const extra = Object.keys(a).find(k => !['chatId', 'roleId', 'cwd', 'mode', 'expectedVersion', 'expectedEventSeq', 'contract', 'step'].includes(k));
    if (extra) throw new Error(`agent_assign_task: unknown field ${extra}.`);
    const trees = d.worktrees ? await d.worktrees(initialCwd) : [];
    const parent = activeParent(callerId, 'agent_assign_task'), child = typeof a.chatId === 'string' ? chat(a.chatId) : undefined;
    if (parent.cwd !== initialCwd || parent.run?.runId !== initialRunId) throw new Error('Parent assignment or project changed; discard this stale assignment request.');
    if (!child || child.parentId !== callerId || !child.delegation || !child.run || child.isOrchestrator) throw new Error('agent_assign_task: chatId must be one of YOUR direct children (agent_children).');
    if (assigning.has(child.id)) throw new Error('agent_assign_task: this child already has an assignment in progress.');
    if (!isWorkRole(a.roleId) || a.roleId === 'sentinel' || child.agent?.source !== 'catalog' || child.agent.id !== a.roleId || child.delegation.role !== a.roleId) throw new Error('Role mismatch or independent Sentinel review: delegate a fresh chat.');
    const catalog = d.roles(), own = catalog.profiles.find(p => p.id === parent.agent!.id), profile = catalog.profiles.find(p => p.id === a.roleId);
    if (!own || !canLaunch(own.launches, a.roleId)) throw new Error('Your current role may not launch this child role.');
    if (!profile || profile.activeVersion !== child.agent.version || profile.engine !== child.harness) throw new Error('Role configuration changed: delegate a fresh chat.');
    if (typeof a.cwd !== 'string' || !path.isAbsolute(a.cwd) || path.resolve(a.cwd) !== path.resolve(child.cwd) || !withinParent(parent.cwd, child.cwd, trees)) throw new Error('Project mismatch: reuse only the same folder inside your scope or repository worktree.');
    if (!['continue', 'new-task', 'rework'].includes(String(a.mode)) || !Number.isSafeInteger(a.expectedVersion) || Number(a.expectedVersion) < 1) throw new Error('Invalid assignment mode/version.');
    if (!Number.isSafeInteger(a.expectedEventSeq) || Number(a.expectedEventSeq) < 0) throw new Error('Read agent_task_events and provide expectedEventSeq.');
    const contractRaw = a.contract;
    if (!contractRaw || typeof contractRaw !== 'object' || Array.isArray(contractRaw) || Object.keys(contractRaw).some(k => !['goal', 'output', 'context', 'doneWhen'].includes(k))) throw new Error('Reuse contract allows only goal, output, context and doneWhen; tools, skills and tier require a fresh chat.');
    const contract = checkContract(contractRaw, a.roleId);
    const parentPolicy = d.chats.agentPolicy(parent.id), childPolicy = d.chats.agentPolicy(child.id);
    if (launchGap(profile.tools?.allow ?? [], parentPolicy?.tools?.allow ?? null).length) throw new Error('Child role needs permissions your current policy does not allow.');
    const normalized = (policy: AgentPolicy | null) => JSON.stringify({ ceiling: policy?.ceiling ?? null, tools: policy?.tools ? { allow: [...policy.tools.allow].sort(), mcp: policy.tools.mcp ? [...policy.tools.mcp].sort() : null } : null });
    if (normalized(childPolicy) !== normalized(belowParent(childPolicy, parentPolicy, parent.permissionMode))) throw new Error('Child permissions exceed your current policy or mode: delegate a fresh narrowed chat.');
    const refused = d.engineRefusal(parent.harness, child.harness);
    if (refused) throw new Error(`agent_assign_task: ${refused}`);
    if (child.harness !== parent.harness && (child.closedAt || !['running', 'waiting', 'idle'].includes(child.state))) throw new Error('A stopped engine of another kind requires the user.');
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
    const running = all.filter(c => c.parentId === parent.id && c.id !== child.id && busyChild(c)).length + (reserved.get(parent.id) ?? 0);
    if (running + 1 > limits.maxParallel) {
      d.chats.limitNotice(parent.id, 'parallel', limits.maxParallel); throw new Error('Delegation parallel limit reached; wait for a child result.');
    }
    // Validate cursors again in ChatManager, immediately before it mutates the task ledger.
    const events = d.chats.userEvents(child.id);
    if (a.expectedEventSeq !== events.latestSeq) throw new Error(`Read agent_task_events and pass expectedEventSeq ${events.latestSeq}.`);
    if (a.expectedVersion !== (child.run.taskVersion ?? 1)) throw new Error('Task version changed; refresh agent_children.');
    reserved.set(parent.id, (reserved.get(parent.id) ?? 0) + 1); assigning.add(child.id);
    try {
      const prompt = `${d.label}\n\n${delegationPrompt(contract, { role: a.roleId, parentTitle: parent.title, title: child.title, skills: [] })}`;
      await d.chats.assignTask(child.id, prompt, { mode: a.mode as 'continue' | 'new-task' | 'rework', expectedVersion: Number(a.expectedVersion), expectedEventSeq: Number(a.expectedEventSeq), doneWhen: contract.doneWhen, ...(step !== null ? { planStep: step } : {}), source: { kind: 'chat', chatId: parent.id } });
      const assigned = chat(child.id);
      return { chatId: child.id, taskId: assigned?.run?.taskId, taskVersion: assigned?.run?.taskVersion, runId: assigned?.run?.runId };
    } finally {
      assigning.delete(child.id);
      const left = (reserved.get(parent.id) ?? 0) - 1;
      if (left > 0) reserved.set(parent.id, left); else reserved.delete(parent.id);
    }
  }

  function taskEvents(a: Record<string, unknown>, callerId: string): UserTaskEvents {
    activeParent(callerId, 'agent_task_events');
    const child = typeof a.chatId === 'string' ? chat(a.chatId) : undefined;
    if (!child || child.parentId !== callerId || !d.chats.userEvents) throw new Error('agent_task_events: chatId must be one of YOUR direct children.');
    // Always return the complete ledger: a parent must see the user's instructions before a follow-up.
    return d.chats.userEvents(child.id, 0);
  }

  /** agent_report's `remember`: up to 3 short lines for the reporting chat's role memory, checked before the report and
   *  written once it is accepted (a refused report writes nothing, so a retry does not count twice) */
  function rememberLines(a: Record<string, unknown>, self: ChatSummary | undefined): (() => number) {
    if (a.remember === undefined) return () => 0;
    const lines = Array.isArray(a.remember) && a.remember.length <= REMEMBER_MAX && a.remember.every(l => typeof l === 'string' && l.trim() && l.length <= REMEMBER_LINE && !/[\x00-\x1f\x7f]/.test(l))
      ? (a.remember as string[]).map(l => l.trim()) : null;
    if (!lines) throw new Error(`agent_report: remember = up to ${REMEMBER_MAX} single lines of at most ${REMEMBER_LINE} characters.`);
    if (!lines.length) return () => 0;
    // the worth gate (ADR 0129) before the report is accepted: the agent generalizes the line or leaves it out
    lines.forEach((line, i) => { const w = memoryWorth('setup', 'note', line); if (w.specific) throw new Error(`agent_report: remember line ${i + 1}: ${specificHint(w)}`); });
    const roleId = self?.agent?.source === 'catalog' ? self.agent.id : null;
    if (!roleId || !d.remember) throw new Error('agent_report: remember works only in a role chat with a brain; leave it out.');
    // the report is already delivered when this runs: a failed write is logged, never turned into a refused report
    return () => {
      let written = 0;
      try { for (const line of lines) { d.remember!(roleId, line, self!); written++; } }
      catch (e) { log.warn('agents', 'role memory not written', { chat: self!.id, data: { role: roleId, written }, cause: e instanceof Error ? e.message : String(e), hint: 'Check that a brain folder is chosen and writable' }); return written; }
      log.info('agents', 'role memory written', { chat: self!.id, data: { role: roleId, lines: written } });
      return written;
    };
  }

  function report(all: Record<string, unknown>, callerId: string): unknown {
    const self = chat(callerId);
    // `remember` is the role memory's, not the result's: the result keeps its exact shape (shared/delegation.ts checkResult)
    const { remember: _remember, ...a } = all, write = rememberLines(all, self);
    const review = !!self?.run?.reviewOf && self.run.startedBy === 'app' && ['sentinel', 'judge'].includes(self.run.agentId) && !self.parentId && !self.delegation && !self.isOrchestrator;
    if ((a.verdict !== undefined || a.verified !== undefined) && (!review || self?.closedAt || self?.run?.endedAt !== undefined)) throw new Error('Review fields require an active app-owned independent reviewer run.');
    if (review && (a.verdict === undefined || a.verified === undefined)) throw new Error('Independent reviews require explicit verdict and verified fields.');
    // Root contracts are host-owned. Direct-user and explicit app replay roots retain their results locally.
    if (self && !self.delegation && !self.parentId && !self.isOrchestrator && self.run && (self.run.startedBy === 'orchestrator' || self.run.startedBy === 'user' || self.run.taskContract?.reportExpected) && d.chats.reportRoot) {
      const done = d.chats.reportRoot(callerId, checkResult(a, self.run.taskContract?.doneWhen ?? [])), remembered = write();
      return { reported: true, to: self.run.startedBy === 'orchestrator' ? 'orchestrator' : 'this-chat', delivered: done.delivered, ...(remembered ? { remembered } : {}), ...(done.delivered ? {} : { note: 'The canonical result is retained on its run; pending delivery retries.' }) };
    }
    if (!self?.delegation || !self.parentId) throw new Error('agent_report: only a chat the Orchestrator or a parent started reports with it (agent_delegate or app_create_chat). Answer in this chat instead.');
    const result = checkResult(a, self.delegation.doneWhen);
    const done = d.chats.reportDelegation(callerId, result), remembered = write();
    return { reported: true, parentId: done.parentId, delivered: done.delivered, ...(remembered ? { remembered } : {}) };
  }

  function children(callerId: string): unknown {
    const runs = d.runs(), now = d.now?.() ?? Date.now(), stallMin = d.settings().stallMin;
    const quiet = (c: ChatSummary) => stalledMin(c, Math.max(d.chats.lastEventAt?.(c.id) ?? 0, c.updatedAt), now, stallMin);
    return { children: d.chats.list().filter(c => c.parentId === callerId).map(c => ({
      chatId: c.id, title: c.title, role: c.delegation?.role ?? c.agent?.id ?? null, state: c.closedAt ? 'closed' : c.state,
      cwd: c.cwd, ...(c.userEvents ? { userEvents: c.userEvents } : {}),
      ...(c.run ? { runId: c.run.runId, taskId: c.run.taskId ?? c.run.runId, taskVersion: c.run.taskVersion ?? 1 } : {}),
      goal: c.delegation?.goal ?? null, result: c.delegation?.result ?? null, pending: c.pending,
      ...(c.run ? { costUsd: runs.find(r => r.runId === c.run!.runId)?.costUsd ?? null } : {}),
      ...((m => m === null ? {} : { stalled: true, quietMin: m })(quiet(c))),
    })) };
  }

  async function askParent(a: Record<string, unknown>, callerId: string): Promise<unknown> {
    const self = chat(callerId);
    if (!self?.delegation || !self.parentId) throw new Error('agent_ask_parent: only a delegated chat has a parent to ask; ask the user instead.');
    if (self.delegation.result) throw new Error('agent_ask_parent: you reported already.');
    const parent = chat(self.parentId);
    if (!parent || parent.closedAt) throw new Error('agent_ask_parent: your parent chat is closed: ask the user.');
    const question = typeof a.question === 'string' ? a.question.trim() : '';
    if (!question || question.length > QUESTION_MAX) throw new Error(`agent_ask_parent: question = 1 to ${QUESTION_MAX} characters.`);
    const options = a.options === undefined ? [] : Array.isArray(a.options) && a.options.length <= OPTIONS_MAX && a.options.every(o => typeof o === 'string' && o.trim() && o.length <= 200) ? (a.options as string[]).map(o => o.trim()) : null;
    if (!options) throw new Error(`agent_ask_parent: options = up to ${OPTIONS_MAX} short texts.`);
    const why = typeof a.why === 'string' ? a.why.trim().slice(0, 500) : '';
    const role = ROLE_DEFAULTS[self.delegation.role].name;
    // the label first, and what the child wrote flattened to one line: it cannot forge a line of the app or the user
    const text = [d.label, '', `[domanda · ${role} «${oneLine(self.title)}» · chatId ${self.id}] ${oneLine(question)}`,
      ...(options.length ? [`Opzioni: ${options.map((o, i) => `${i + 1}) ${oneLine(o)}`).join(' · ')}`] : []), ...(why ? [`Perché: ${oneLine(why)}`] : []),
      `Rispondi con agent_answer_child (chatId "${self.id}", answer) da ciò che sai del compito. Se serve una persona (un permesso, un'azione irreversibile o esterna, una scelta che cambia l'obiettivo) o non lo sai, agent_answer_child con askUser: true: chiederà all'utente.`].join('\n');
    await d.chats.send(parent.id, text, undefined, false, self.title);
    d.chats.askedParent?.(callerId);
    log.info('agents', 'child asked its parent', { chat: callerId, data: { parent: parent.id, options: options.length } });
    return { asked: parent.title, note: 'Your parent answers with a message (agent_answer_child). Go on with what does not depend on it; do not ask the user the same thing meanwhile.' };
  }

  async function answerChild(a: Record<string, unknown>, callerId: string): Promise<unknown> {
    const parent = chat(callerId);
    const childId = typeof a.chatId === 'string' ? a.chatId : '';
    const child = chat(childId);
    if (!parent || !child || child.parentId !== callerId) throw new Error('agent_answer_child: chatId must be one of YOUR delegated chats (agent_children).');
    if (child.closedAt || child.delegation?.result) throw new Error('agent_answer_child: that chat is closed or reported already.');
    const askUser = a.askUser === true;
    const answer = typeof a.answer === 'string' ? a.answer.trim() : '';
    if (!askUser && (!answer || answer.length > ANSWER_MAX)) throw new Error(`agent_answer_child: answer = 1 to ${ANSWER_MAX} characters, or askUser: true.`);
    // labelled and flattened like the question: the parent is an agent too, never the user nor the app
    const head = `${d.label}\n\n[risposta di ${oneLine(parent.agent?.name ?? 'Chat')} «${oneLine(parent.title)}»]`;
    const said = oneLine(answer.slice(0, ANSWER_MAX));
    const text = askUser ? `${head} Non posso deciderlo io: chiedilo all'utente (una domanda chiara, con le opzioni).${said ? ` ${said}` : ''}` : `${head} ${said}`;
    await d.chats.send(child.id, text, undefined, false, parent.title);
    return { answered: child.title, askUser };
  }

  const str = { type: 'string' };
  return [{
    name: 'agent_delegate',
    description: 'Delegate parts of your task to other roles, only when it has several independent parts: a quick single-part task you do yourself (a child costs more tokens and time than it saves; task_estimate on the Orchestrator says which). each part starts a visible chat under yours, running the role you name (only roles your role may launch: agent_catalog). The child sees only its contract, never this conversation: write it self-contained. Several parts start at once (parallel). It never gets more permissions than you, works inside your folder, and returns one result with agent_report that reaches you as a message. Limits (depth, children running at once) are the user\'s.',
    inputSchema: { type: 'object', required: ['tasks'], additionalProperties: false, properties: {
      tasks: { type: 'array', minItems: 1, maxItems: TASKS_MAX, items: { type: 'object', required: ['role', 'title', 'contract'], additionalProperties: false, properties: {
        role: { type: 'string', enum: [...WORK_ROLE_IDS] }, title: { ...str, description: '"Area · what", e.g. "Ordini · Log degli errori"' },
        cwd: { ...str, description: 'optional absolute folder inside yours; default: your folder' },
        step: { type: 'integer', minimum: 1, description: 'with a plan approved by the user (plan_propose): the step number this part does' },
        contract: { type: 'object', required: ['goal', 'doneWhen'], additionalProperties: false, properties: {
          goal: str, output: { ...str, description: 'what to give back; default: the role\'s output' },
          doneWhen: { type: 'array', items: str, minItems: 1, maxItems: 12, description: 'checkable criteria' },
          context: { ...str, description: 'facts, sources and constraints the child needs' },
          tools: { type: 'array', items: str, description: 'optional: narrows the role\'s tool classes' },
          skills: { type: 'array', items: str, description: 'brain skills it may use (skills_suggest)' },
          tier: { type: 'string', enum: ['light', 'mid', 'top'] },
        } },
      } } },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => JSON.stringify(await delegate(a, callerOf(ctx.params))),
  }, {
    name: 'agent_assign_task',
    description: 'Continue YOUR direct child in the same role and project with a separate task run. Read agent_task_events first and pass its latestSeq plus taskVersion from agent_children. Keeps the session, tools and skills; changed role settings or Sentinel reviews require a fresh child. Use rework only for explicit corrections. With an approved plan, step is required. Closed parents must first receive a new assignment from their own parent or Orchestrator.',
    inputSchema: { type: 'object', required: ['chatId', 'roleId', 'cwd', 'mode', 'expectedVersion', 'expectedEventSeq', 'contract'], additionalProperties: false, properties: {
      chatId: str, roleId: { type: 'string', enum: [...WORK_ROLE_IDS] }, cwd: str,
      mode: { type: 'string', enum: ['continue', 'new-task', 'rework'] },
      expectedVersion: { type: 'integer', minimum: 1 }, expectedEventSeq: { type: 'integer', minimum: 0 },
      step: { type: 'integer', minimum: 1 },
      contract: { type: 'object', required: ['goal', 'doneWhen'], additionalProperties: false, properties: {
        goal: str, output: str, context: str, doneWhen: { type: 'array', items: str, minItems: 1, maxItems: 12 },
      } },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => JSON.stringify(await assignChild(a, callerOf(ctx.params))),
  }, {
    name: 'agent_task_events',
    description: 'Read the complete ordered user instruction ledger for YOUR direct child before reassigning it. Pass latestSeq as expectedEventSeq to agent_assign_task; no model turn is started.',
    inputSchema: { type: 'object', required: ['chatId'], additionalProperties: false, properties: { chatId: str } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (a, ctx) => JSON.stringify(taskEvents(a, callerOf(ctx.params))),
  }, {
    name: 'agent_report',
    description: 'Your one result for the chat that started you (your parent, or the Orchestrator for a chat it opened): outcome (done | partial | blocked), summary (one or two sentences), output (the deliverable), doneWhen (every criterion of your contract, exactly as written, with met and evidence), optional questions, optional remember (lines for your role\'s memory). It reaches your parent at once; call it once, at the end. The app shows output in your chat as your answer: do not write it in the chat too.',
    inputSchema: { type: 'object', required: ['outcome', 'summary', 'output', 'doneWhen'], additionalProperties: false, properties: {
      outcome: { type: 'string', enum: ['done', 'partial', 'blocked'] }, summary: { ...str, maxLength: SUMMARY_MAX }, output: { ...str, maxLength: RESULT_OUTPUT_MAX },
      verdict: { type: 'string', enum: ['success', 'partial', 'fail'], description: 'Only app-owned independent reviews: assessment of the reviewed work, separate from completion of your review.' },
      verified: { type: 'string', enum: ['yes', 'partial', 'no'], description: 'Only with verdict: yes only when you independently checked the evidence; never inferred from completing the review.' },
      taskVersion: { type: 'integer', minimum: 1, description: 'Current task version supplied with the assignment; required after a follow-up. Stale reports are refused.' },
      doneWhen: { type: 'array', description: 'one entry per criterion of your contract, written exactly as in the contract (the field is doneWhen, never criteria)', items: { type: 'object', required: ['criterion', 'met'], additionalProperties: false, properties: { criterion: { ...str, maxLength: CRITERION_MAX }, met: { type: 'boolean' }, evidence: { ...str, maxLength: EVIDENCE_MAX } } } },
      questions: { type: 'array', items: { ...str, maxLength: 500 }, maxItems: 8 },
      goalChangedByUser: { type: 'boolean', description: 'true when the user wrote to you directly and changed your goal (you followed the user)' },
      newGoal: { ...str, description: 'with goalChangedByUser: the goal the user gave you' },
      remember: { type: 'array', items: { ...str, maxLength: REMEMBER_LINE }, maxItems: REMEMBER_MAX, description: 'optional, up to 3 short lines for YOUR role\'s memory (read at every launch of your role): general, reusable knowledge a future run would otherwise rediscover or ask again (a procedure, a convention, a how-to, where things are kept). Generalize a specific finding first (no URLs with ports, ticket / PR / commit ids, user paths, dates, branch names): a case-specific line refuses the report. Never the task result' },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (a, ctx) => JSON.stringify(report(a, callerOf(ctx.params))),
  }, {
    name: 'agent_ask_parent',
    description: 'Ask the chat that delegated you, before the user: an ambiguity of your contract (which file, which option, what "done" means here). It reaches your parent as a message; the answer comes back as a message. Ask the user directly only for a permission, an irreversible or external action, a choice that changes the goal, or what your parent sent on to the user.',
    inputSchema: { type: 'object', required: ['question'], additionalProperties: false, properties: {
      question: str, options: { type: 'array', items: str, maxItems: OPTIONS_MAX }, why: { ...str, description: 'what depends on it' },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => JSON.stringify(await askParent(a, callerOf(ctx.params))),
  }, {
    name: 'agent_answer_child',
    description: 'Answer a question one of YOUR delegated chats asked you with agent_ask_parent (chatId from the question), from what you know of the task. askUser: true when it needs a person (a permission, an irreversible or external action, a choice that changes the goal) or you do not know: the child then asks the user.',
    inputSchema: { type: 'object', required: ['chatId'], additionalProperties: false, properties: { chatId: str, answer: str, askUser: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, ctx) => JSON.stringify(await answerChild(a, callerOf(ctx.params))),
  }, {
    name: 'agent_children',
    description: 'The chats you delegated (agent_delegate): role, title, state, goal, their result once reported, open requests and cost; runId is what agent_child_feedback takes. stalled: true (with quietMin) = a working child silent for longer than the user\'s "Ferma dopo" limit: nudge it with a message or close it.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (_a, ctx) => JSON.stringify(children(callerOf(ctx.params))),
  }];
}
