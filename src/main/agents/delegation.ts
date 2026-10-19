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
import type { ChatSummary, Harness, NewChat } from '../../shared/contract';
import type { AgentCatalog, AgentRun } from '../../shared/agents';
import { canLaunch, isWorkRole, ROLE_DEFAULTS, WORK_ROLE_IDS, type DelegationSettings } from '../../shared/roles';
import { checkContract, checkResult, delegationPrompt, depthOf, type DelegationLimitHit, type DelegationResult } from '../../shared/delegation';
import { ORCHESTRATOR_TITLE } from '../../shared/orchestrator';
import type { McpTool } from '../mcp/server';
import { allowsClass, type AgentPolicy } from './tool-policy';
import { withinParent } from './worktrees';
import { log } from '../log';

/** What delegation needs from the chats (ChatManager). */
export interface DelegationChats {
  list(): ChatSummary[];
  create(req: NewChat, by: 'agent'): Promise<ChatSummary>;
  agentPolicy(chatId: string): AgentPolicy | null;
  reportDelegation(chatId: string, result: DelegationResult): { parentId: string; delivered: boolean };
  limitNotice(chatId: string, kind: DelegationLimitHit['kind'], limit: number): void;
  /** a message from another chat (from = its title): agent_ask_parent, agent_answer_child */
  send(chatId: string, text: string, images?: unknown, resumed?: boolean, from?: string): Promise<void>;
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
}

export const TASKS_MAX = 10;
const TITLE_MAX = 80;
const QUESTION_MAX = 1000, OPTIONS_MAX = 6, ANSWER_MAX = 4000;

const callerOf = (params: Record<string, string>): string => {
  const id = params.chatId;
  if (!id) throw new Error('This tool works only on a chat\'s own endpoint.');
  return id;
};

/** A delegated child counts against its parent's parallel limit until it reports or closes. */
export const busyChild = (c: ChatSummary): boolean => !c.closedAt && !c.delegation?.result;

export function delegationTools(d: DelegationDeps): McpTool[] {
  // slots taken by agent_delegate calls still creating their chats, per parent (checked and taken synchronously)
  const reserved = new Map<string, number>();
  const chat = (id: string) => d.chats.list().find(c => c.id === id);

  async function delegate(a: Record<string, unknown>, callerId: string): Promise<unknown> {
    const parent = chat(callerId);
    if (!parent || parent.closedAt) throw new Error('agent_delegate: your chat is not open.');
    if (parent.isOrchestrator) throw new Error('agent_delegate: the Orchestrator opens root chats with app_create_chat.');
    if (parent.agent?.source !== 'catalog' || !isWorkRole(parent.agent.id)) throw new Error('agent_delegate: only a role chat delegates (start one from Agenti).');
    if (parent.run && parent.run.endedAt !== undefined) throw new Error('agent_delegate: your assignment is over (you reported): ask your parent for a new one.');
    const catalog = d.roles(), own = catalog.profiles.find(p => p.id === parent.agent!.id);
    if (!own) throw new Error('agent_delegate: your role is not in the catalog.');
    const raw = a.tasks;
    if (!Array.isArray(raw) || !raw.length || raw.length > TASKS_MAX) throw new Error(`agent_delegate: tasks = 1 to ${TASKS_MAX} parts.`);
    // read before the limits: from here to the reservation nothing waits, so two calls cannot both take the last slot
    const trees = d.worktrees ? await d.worktrees(parent.cwd) : [];
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
    const parentPolicy = d.chats.agentPolicy(parent.id);
    // everything is checked before any chat starts: one bad part refuses the whole call
    const plans = raw.map((value, i) => {
      const t = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
      if (!t) throw new Error(`tasks[${i}]: object required.`);
      const extra = Object.keys(t).find(k => !['role', 'title', 'contract', 'cwd'].includes(k));
      if (extra) throw new Error(`tasks[${i}]: unknown field ${extra}.`);
      const role = t.role;
      if (!isWorkRole(role)) throw new Error(`tasks[${i}].role: one of ${WORK_ROLE_IDS.join(', ')}.`);
      if (!canLaunch(own.launches, role)) throw new Error(`tasks[${i}]: ${own.name} may not launch ${ROLE_DEFAULTS[role].name} (it launches ${own.launches.join(', ') || 'none'}).`);
      const profile = catalog.profiles.find(p => p.id === role);
      if (!profile) throw new Error(`tasks[${i}]: ${role} is not in the catalog.`);
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
      return { role, title, contract, cwd, profile };
    });
    reserved.set(parent.id, (reserved.get(parent.id) ?? 0) + plans.length);
    try {
      const at = Date.now();
      const settled = await Promise.allSettled(plans.map(p => d.chats.create({
        harness: p.profile.engine, cwd: p.cwd, title: p.title, roleId: p.role, parentId: parent.id, goal: p.contract.goal,
        ...(p.contract.tier ? { tier: p.contract.tier } : {}), ...(p.contract.skills ? { skills: p.contract.skills } : {}),
        ...(p.profile.independent ? { independentOf: { engine: parent.harness, model: parent.model } } : {}),
        delegation: { role: p.role, goal: p.contract.goal, doneWhen: p.contract.doneWhen, at, ...(p.contract.tools ? { tools: p.contract.tools } : {}) },
        prompt: `${d.label}\n\n${delegationPrompt(p.contract, { role: p.role, parentTitle: parent.title, title: p.title, skills: p.contract.skills ?? [] })}`,
      }, 'agent')));
      const children = settled.map((s, i) => s.status === 'fulfilled'
        ? { role: plans[i]!.role, title: s.value.title, chatId: s.value.id, harness: s.value.harness, model: s.value.model, state: s.value.queued ? 'queued' : s.value.state }
        : { role: plans[i]!.role, title: plans[i]!.title, error: s.reason instanceof Error ? s.reason.message : String(s.reason) });
      log.info('agents', 'delegated', { chat: parent.id, data: { children: children.map(c => ({ role: c.role, chatId: 'chatId' in c ? c.chatId : null })), depth } });
      return { children, note: 'Each child reports to you with agent_report (it arrives as a message); agent_children shows their state. Do not wait idle: go on with your own part.' };
    } finally {
      const left = (reserved.get(parent.id) ?? 0) - plans.length;
      if (left > 0) reserved.set(parent.id, left); else reserved.delete(parent.id);
    }
  }

  function report(a: Record<string, unknown>, callerId: string): unknown {
    const self = chat(callerId);
    if (!self?.delegation || !self.parentId) throw new Error('agent_report: only a delegated chat reports (agent_delegate started it). A root chat reports to the Orchestrator with send_to_chat.');
    const result = checkResult(a, self.delegation.doneWhen);
    const done = d.chats.reportDelegation(callerId, result);
    return { reported: true, parentId: done.parentId, delivered: done.delivered };
  }

  function children(callerId: string): unknown {
    const runs = d.runs();
    return { children: d.chats.list().filter(c => c.parentId === callerId).map(c => ({
      chatId: c.id, title: c.title, role: c.delegation?.role ?? c.agent?.id ?? null, state: c.closedAt ? 'closed' : c.state,
      ...(c.run ? { runId: c.run.runId } : {}),
      goal: c.delegation?.goal ?? null, result: c.delegation?.result ?? null, pending: c.pending,
      ...(c.run ? { costUsd: runs.find(r => r.runId === c.run!.runId)?.costUsd ?? null } : {}),
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
    const text = [`[domanda · ${role} «${self.title}» · chatId ${self.id}] ${question}`,
      ...(options.length ? [`Opzioni: ${options.map((o, i) => `${i + 1}) ${o}`).join(' · ')}`] : []), ...(why ? [`Perché: ${why}`] : []),
      `Rispondi con agent_answer_child (chatId "${self.id}", answer) da ciò che sai del compito. Se serve una persona (un permesso, un'azione irreversibile o esterna, una scelta che cambia l'obiettivo) o non lo sai, agent_answer_child con askUser: true: chiederà all'utente.`].join('\n');
    await d.chats.send(parent.id, text, undefined, false, self.title);
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
    const head = `[risposta di ${parent.agent?.name ?? 'Chat'} «${parent.title}»]`;
    const text = askUser ? `${head} Non posso deciderlo io: chiedilo all'utente (una domanda chiara, con le opzioni).${answer ? ` ${answer.slice(0, ANSWER_MAX)}` : ''}` : `${head} ${answer}`;
    await d.chats.send(child.id, text, undefined, false, parent.title);
    return { answered: child.title, askUser };
  }

  const str = { type: 'string' };
  return [{
    name: 'agent_delegate',
    description: 'Delegate parts of your task to other roles: each part starts a visible chat under yours, running the role you name (only roles your role may launch: agent_catalog). The child sees only its contract, never this conversation: write it self-contained. Several parts start at once (parallel). It never gets more permissions than you, works inside your folder, and returns one result with agent_report that reaches you as a message. Limits (depth, children running at once) are the user\'s.',
    inputSchema: { type: 'object', required: ['tasks'], additionalProperties: false, properties: {
      tasks: { type: 'array', minItems: 1, maxItems: TASKS_MAX, items: { type: 'object', required: ['role', 'title', 'contract'], additionalProperties: false, properties: {
        role: { type: 'string', enum: [...WORK_ROLE_IDS] }, title: { ...str, description: '"Area · what", e.g. "Ordini · Log degli errori"' },
        cwd: { ...str, description: 'optional absolute folder inside yours; default: your folder' },
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
    name: 'agent_report',
    description: 'Your one result for the chat that delegated you: outcome (done | partial | blocked), summary (one or two sentences), output (the deliverable), doneWhen (every criterion of your contract, exactly as written, with met and evidence), optional questions. It reaches your parent at once; call it once, at the end.',
    inputSchema: { type: 'object', required: ['outcome', 'summary', 'output', 'doneWhen'], additionalProperties: false, properties: {
      outcome: { type: 'string', enum: ['done', 'partial', 'blocked'] }, summary: str, output: str,
      doneWhen: { type: 'array', items: { type: 'object', required: ['criterion', 'met'], additionalProperties: false, properties: { criterion: str, met: { type: 'boolean' }, evidence: str } } },
      questions: { type: 'array', items: str, maxItems: 8 },
      goalChangedByUser: { type: 'boolean', description: 'true when the user wrote to you directly and changed your goal (you followed the user)' },
      newGoal: { ...str, description: 'with goalChangedByUser: the goal the user gave you' },
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
    description: 'The chats you delegated (agent_delegate): role, title, state, goal, their result once reported, open requests and cost; runId is what agent_child_feedback takes.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (_a, ctx) => JSON.stringify(children(callerOf(ctx.params))),
  }];
}
