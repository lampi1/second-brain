// Delegation between role chats (ADR 0083): the contract a parent hands a child with agent_delegate, the result the
// child returns with agent_report, the trace a child chat carries (ChatSummary.delegation) and the pure helpers both
// sides need: the checks of a contract and of a result, the child's first message (the contract only, never the
// parent's history), the message that brings a result back, and the depth of a chat in the tree. Pure: used by
// main/agents/delegation.ts (the tools), main/chats/manager.ts (the result delivery) and the renderer (the child cards).
import type { IntakeSource } from './strategy';
import { browserWriteResult, type BrowserWriteResult } from './flow-browser';
import { TOOL_CLASSES, type ToolClass, type TaskDeliveryPolicy } from './agents';
import { MODEL_TIERS, ROLE_DEFAULTS, currentRoleId, isWorkRole, type ModelTier, type WorkRoleId } from './roles';
import { AGENT_LABEL, oneLine } from './agent-label';

/** Stable provenance for task assignment; display titles never authorize lifecycle changes. */
/** phone = the user's own words from the paired phone (Telegram bridge, ADR phone bridge): the user's like a typed message
 *  everywhere except consent: typed phone text never approves a plan, a question or anything else (ownerSource). */
export type TaskSource = { kind: 'user' } | { kind: 'chat'; chatId: string } | { kind: 'app' } | { kind: 'phone' };
/** The message is the user's own (typed in the app, or from the paired phone): reopening, assignments and user notes. */
export const ownerSource = (s: TaskSource | undefined): boolean => !s || s.kind === 'user' || s.kind === 'phone';
export interface TaskAssignmentOptions {
  /** An answer verified by the host for a new root Plan. */
  intake?: IntakeSource;
  mode?: 'continue' | 'new-task' | 'rework';
  source?: TaskSource;
  expectedVersion?: number;
  expectedEventSeq?: number;
  deliveryPolicy?: TaskDeliveryPolicy;
  doneWhen?: string[];
  /** Parent plan step, zero-based; mapped before the reused child can produce a result. */
  planStep?: number;
  /** the fields the assignment's contract carried (#355), stored on the run */
  contractFields?: string[];
  /** a review chat's next round (#387): the run it reviews now; the new run keeps the review's link and verdict fields */
  reviewOf?: string;
}

export interface DelegationContract {
  /** what the child must achieve, one or two sentences */
  goal: string;
  /** what it must give back (default: its role's output) */
  output: string;
  /** checkable criteria: the child reports each one met or not, with evidence */
  doneWhen: string[];
  /** narrows the child's tools (never widens them: a class beyond the parent's is refused) */
  tools?: ToolClass[];
  /** brain skills the child may use, on top of its role's own */
  skills?: string[];
  /** the facts and sources it needs: the child does not see the parent's conversation */
  context?: string;
  /** a model tier above the role's own, up to its tierMax */
  tier?: ModelTier;
  // the hybrid contract (#355, ADR 0247): what travels with the task besides the goal and the criteria
  /** what it is for, who asks, what they will decide with the result */
  why?: string;
  /** choices already taken with the user, not to reopen */
  alreadyDecided?: string;
  inScope?: string;
  outOfScope?: string;
  /** task-only constraints: repo, branch, time, cost (the hard rules are the role frame's, never contract text) */
  constraints?: string;
  /** only when order matters, at most 5 */
  steps?: string[];
  /** the ambiguous reading that would change the work: ask the parent */
  askIf?: string;
}
/** The text fields of a contract, in the template's order (the renderer's and the storage's). */
export const CONTRACT_FIELDS = ['goal', 'why', 'alreadyDecided', 'context', 'inScope', 'outOfScope', 'constraints', 'steps', 'doneWhen', 'output', 'askIf'] as const;
export type ContractField = (typeof CONTRACT_FIELDS)[number];
export const STEPS_MAX = 5, WHY_MAX = 1500, NOTE_MAX = 2000;
export const RESULT_OUTCOMES = ['done', 'partial', 'blocked'] as const;
export type DelegationOutcome = (typeof RESULT_OUTCOMES)[number];
export interface DelegationResult {
  /** Routine browser-write outcome with read-back/screenshot evidence. */
  browserWrite?: BrowserWriteResult;
  /** Explicit assessment, accepted only from host-owned independent review runs. */
  verdict?: 'success' | 'partial' | 'fail';
  verified?: 'yes' | 'partial' | 'no';
  taskVersion?: number;
  outcome: DelegationOutcome;
  summary: string;
  output: string;
  doneWhen: { criterion: string; met: boolean; evidence?: string }[];
  /** questions for the parent the child could not settle itself */
  questions?: string[];
  /** the user wrote to the child directly and changed its goal: the child followed the user, newGoal is that goal */
  goalChangedByUser?: true;
  newGoal?: string;
  /** a correction of the result this assignment already reported (at most MAX_CORRECTIONS): it replaces the previous one */
  amends?: true;
  /** partial / blocked on a step only the user can do (#358): the app asks it in the Orchestrator at once */
  userAction?: UserAction;
}
/** What only the user can do for a stopped run (#358): turn on the VPN, a login with MFA, an Esegui command, a
 *  permission, a decision. text = what to do (at most USER_ACTION_TEXT_MAX), command = the exact command, if any. */
export const USER_ACTION_KINDS = ['vpn', 'login', 'command', 'permission', 'decision', 'other'] as const;
export interface UserAction { kind: typeof USER_ACTION_KINDS[number]; text: string; command?: string }
export const USER_ACTION_TEXT_MAX = 300, USER_ACTION_COMMAND_MAX = 2000;
/** Words of a partial / blocked report's summary that name a step only the user can do: such a report without userAction is sent
 *  back once (agents/delegation.ts), so the block never stays only in the report text (#358). */
export const USER_ONLY_BLOCKER = /(?:^|[^\p{L}\d._/-])(?:vpn|mfa|2fa|sso|login|sign[- ]in|accedi|accesso negato|access denied|permission denied|permesso negato|autenticazione|authenticat\p{L}*|credenziali|credentials|password|sudo|esegui)(?![\p{L}\d_/-]|\.\p{L})/iu;
/** What a child chat carries about its delegation (persisted with the chat; shown on its card and in the tree). */
export interface ChatDelegation {
  role: WorkRoleId;
  goal: string;
  doneWhen: string[];
  at: number;
  /** the tool classes the contract narrowed it to (absent = its role's, bounded by the parent's) */
  tools?: ToolClass[];
  /** its agent_report, once given */
  result?: { outcome: DelegationOutcome; summary: string; at: number; doneWhen?: { criterion: string; met: boolean }[]; noReport?: true; corrections?: number;
    /** #375: this assignment's «fatto» line is due or written in the brain journal (kept through corrections) */
    journaled?: true };
  /** the goal as the contract gave it, kept when the user changed it in the child's chat (goal is then the user's) */
  originalGoal?: string;
}
/** Host-generated integration evidence. A staged tree is not a merged or semantically verified result. */
export interface DelegationIntegration {
  status: 'staged' | 'conflict' | 'blocked';
  reason: string;
  checksRequired: true;
  parentUnchanged: true;
  cwd?: string;
  parentHead?: string;
  appliedChildIds?: string[];
  sources?: { chatId: string; childHead: string; baseHead: string }[];
  childHead?: string;
  baseHead?: string;
  tree?: string;
  conflicts?: string[];
  whitespace?: { command: 'git diff --cached --check'; exit: number | null; at: number; tree: string };
}

/** A delegation limit the chat hit, shown on it until it delegates again. */
export interface DelegationLimitHit { kind: 'depth' | 'parallel'; limit: number; at: number }

export const GOAL_MAX = 2000, OUTPUT_MAX = 2000, CONTEXT_MAX = 6000, CRITERION_MAX = 300, CRITERIA_MAX = 12, SUMMARY_MAX = 300, RESULT_OUTPUT_MAX = 12000, EVIDENCE_MAX = 1000;
/** corrections (agent_report amends: true) one assignment may send after its first report; the next one is refused */
export const MAX_CORRECTIONS = 2;
/** Text cut to max characters, at a word boundary when one is near, ending with the visible marker «…». */
export function capText(v: string, max: number): string {
  if (v.length <= max) return v;
  // never split a surrogate pair (an emoji): a lone half would persist as a broken character
  const end = /[\uD800-\uDBFF]/.test(v.charAt(max - 2)) ? max - 2 : max - 1;
  const prefix = v.slice(0, end), boundary = prefix.search(/\s+\S*$/);
  return `${boundary > max * 0.8 ? prefix.slice(0, boundary) : prefix.trimEnd()}…`;
}
const SKILL = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const text = (v: unknown, max: number, what: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${what}: required text.`);
  if (v.length > max) throw new Error(`${what}: at most ${max} characters (this one has ${v.length}).`);
  return v.trim();
};
const object = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what}: object required.`);
  return v as Record<string, unknown>;
};
const only = (o: Record<string, unknown>, keys: readonly string[], what: string): void => {
  const extra = Object.keys(o).find(k => !keys.includes(k));
  if (extra) throw new Error(`${what}: unknown field ${extra}.`);
};

/** A contract as the tool received it, checked strictly; `role` gives the default output. */
export function checkContract(v: unknown, role: WorkRoleId): DelegationContract {
  const o = object(v, 'contract');
  only(o, ['goal', 'output', 'doneWhen', 'tools', 'skills', 'context', 'tier', 'why', 'alreadyDecided', 'inScope', 'outOfScope', 'constraints', 'steps', 'askIf'], 'contract');
  const doneWhen = o.doneWhen;
  if (!Array.isArray(doneWhen) || !doneWhen.length || doneWhen.length > CRITERIA_MAX) throw new Error(`contract.doneWhen: 1 to ${CRITERIA_MAX} criteria.`);
  const tools = o.tools === undefined ? undefined : Array.isArray(o.tools) && o.tools.every(c => (TOOL_CLASSES as readonly unknown[]).includes(c)) ? [...new Set(o.tools as ToolClass[])] : null;
  if (tools === null) throw new Error(`contract.tools: classes among ${TOOL_CLASSES.join(', ')}.`);
  const skills = o.skills === undefined ? undefined : Array.isArray(o.skills) && o.skills.length <= 16 && o.skills.every(s => typeof s === 'string' && SKILL.test(s)) ? [...new Set(o.skills as string[])] : null;
  if (skills === null) throw new Error('contract.skills: up to 16 skill names (SKILL.md names).');
  if (o.tier !== undefined && !(MODEL_TIERS as readonly unknown[]).includes(o.tier)) throw new Error(`contract.tier: ${MODEL_TIERS.join(' | ')}.`);
  return {
    goal: text(o.goal, GOAL_MAX, 'contract.goal'),
    output: o.output === undefined ? ROLE_DEFAULTS[role].output : text(o.output, OUTPUT_MAX, 'contract.output'),
    doneWhen: doneWhen.map((c, i) => text(c, CRITERION_MAX, `contract.doneWhen[${i}]`)),
    ...(tools ? { tools } : {}), ...(skills?.length ? { skills } : {}),
    ...(o.context !== undefined ? { context: text(o.context, CONTEXT_MAX, 'contract.context') } : {}),
    ...(o.tier !== undefined ? { tier: o.tier as ModelTier } : {}),
    ...contractNotes(o, 'contract'),
  };
}

/** The optional hybrid fields of a contract (#355), checked; shared by agent_delegate, agent_assign_task and the
 *  Orchestrator's app_create_chat / app_assign_task. */
export function contractNotes(o: Record<string, unknown>, what: string): Pick<DelegationContract, 'why' | 'alreadyDecided' | 'inScope' | 'outOfScope' | 'constraints' | 'steps' | 'askIf'> {
  const out: Pick<DelegationContract, 'why' | 'alreadyDecided' | 'inScope' | 'outOfScope' | 'constraints' | 'steps' | 'askIf'> = {};
  for (const k of ['why', 'alreadyDecided', 'inScope', 'outOfScope', 'constraints', 'askIf'] as const)
    if (o[k] !== undefined) out[k] = text(o[k], k === 'why' ? WHY_MAX : NOTE_MAX, `${what}.${k}`);
  if (o.steps !== undefined) {
    if (!Array.isArray(o.steps) || !o.steps.length || o.steps.length > STEPS_MAX) throw new Error(`${what}.steps: 1 to ${STEPS_MAX} steps, only when their order matters.`);
    out.steps = o.steps.map((x, i) => text(x, CRITERION_MAX, `${what}.steps[${i}]`));
  }
  return out;
}

/** The structured contract the Orchestrator passes to app_create_chat / app_assign_task (#355): the text fields only
 *  (tools, skills and tier are the tool's own arguments there), checked like a delegation's. */
export function checkTaskContract(v: unknown): Omit<DelegationContract, 'output' | 'tools' | 'skills' | 'tier'> & { output?: string } {
  const o = object(v, 'contract');
  only(o, CONTRACT_FIELDS, 'contract');
  const doneWhen = o.doneWhen;
  if (!Array.isArray(doneWhen) || !doneWhen.length || doneWhen.length > CRITERIA_MAX) throw new Error(`contract.doneWhen: 1 to ${CRITERIA_MAX} criteria.`);
  return {
    goal: text(o.goal, GOAL_MAX, 'contract.goal'),
    doneWhen: doneWhen.map((c, i) => text(c, CRITERION_MAX, `contract.doneWhen[${i}]`)),
    ...(o.output !== undefined ? { output: text(o.output, OUTPUT_MAX, 'contract.output') } : {}),
    ...(o.context !== undefined ? { context: text(o.context, CONTEXT_MAX, 'contract.context') } : {}),
    ...contractNotes(o, 'contract'),
  };
}

/** What a contract lacks of the hybrid format, as warnings (never a refusal): the why, and a goal that is a list of steps. */
export function contractWarnings(c: Pick<DelegationContract, 'goal' | 'why'>): string[] {
  const out: string[] = [];
  if (!c.why) out.push('contract.why is missing: say what the result is for and who decides with it (the child works better knowing why).');
  if ((c.goal.match(/(?:^|\s)\d+[.)]\s/g) ?? []).length > STEPS_MAX) out.push(`contract.goal reads as more than ${STEPS_MAX} numbered steps: give one checkable outcome, and steps (max ${STEPS_MAX}) only where order matters.`);
  return out;
}

/** The fields a contract carried, in template order: stored on the run (taskContract.fields) so goal-only, hybrid and
 *  steps-only contracts can be counted later. */
export const contractFields = (c: Partial<Record<ContractField, unknown>>): ContractField[] =>
  CONTRACT_FIELDS.filter(k => { const v = c[k]; return Array.isArray(v) ? v.length > 0 : typeof v === 'string' && !!v.trim(); });

/** The contract's own lines in the template's order (#355): Goal, Why, Already decided, Context, In scope, Out of scope,
 *  Constraints, Steps, Done when, Output, Ask the parent if; empty fields are skipped. `defaultOutput`: an output equal
 *  to it is not written (the role's frame already says it). */
export function contractText(c: Partial<DelegationContract> & { goal: string }, defaultOutput?: string): string[] {
  const line = (label: string, v: string | undefined): string[] => (v && v.trim() ? [`${label}: ${v.trim()}`] : []);
  return [
    `Goal: ${c.goal}`,
    ...line('Why', c.why), ...line('Already decided', c.alreadyDecided), ...line('Context', c.context),
    ...line('In scope', c.inScope), ...line('Out of scope', c.outOfScope), ...line('Constraints', c.constraints),
    ...(c.steps?.length ? ['Steps (in this order):', ...c.steps.map((x, i) => `${i + 1}. ${x}`)] : []),
    ...(c.doneWhen?.length ? ['Done when:', ...c.doneWhen.map(d => `- ${d}`)] : []),
    ...(c.output && c.output !== defaultOutput ? line('Output', c.output) : []),
    ...line('Ask the parent if', c.askIf),
  ];
}

/** A child's agent_report, checked strictly: every criterion of its contract answered once, in any order. */
export function checkResult(v: unknown, doneWhen: readonly string[]): DelegationResult {
  const o = object(v, 'result');
  // the names agents invent for doneWhen (app logs 2026-10-20/21, #147): the error says which field to use
  const misnamed = ['criteria', 'criteriaResults'].find(k => k in o);
  if (misnamed && !('doneWhen' in o)) throw new Error(`agent_report: use doneWhen, not ${misnamed}: one { criterion, met, evidence } per criterion of your contract.`);
  only(o, ['outcome', 'summary', 'output', 'doneWhen', 'questions', 'goalChangedByUser', 'newGoal', 'taskVersion', 'verdict', 'verified', 'browserWrite', 'amends', 'userAction'], 'agent_report');
  if (o.amends !== undefined && typeof o.amends !== 'boolean') throw new Error('amends: true or false.');
  if ((o.verdict !== undefined) !== (o.verified !== undefined)) throw new Error('Review verdict and verified must be supplied together.');
  if (o.verdict !== undefined && !['success', 'partial', 'fail'].includes(o.verdict as string)) throw new Error('Invalid review verdict.');
  if (o.verified !== undefined && !['yes', 'partial', 'no'].includes(o.verified as string)) throw new Error('Invalid review verification.');
  if (o.taskVersion !== undefined && (!Number.isSafeInteger(o.taskVersion) || (o.taskVersion as number) < 1)) throw new Error('taskVersion must be a positive integer.');
  if (o.goalChangedByUser !== undefined && typeof o.goalChangedByUser !== 'boolean') throw new Error('goalChangedByUser: true or false.');
  const changed = o.goalChangedByUser === true;
  const newGoal = changed ? text(o.newGoal, GOAL_MAX, 'newGoal (the goal the user gave you)') : undefined;
  if (!changed && o.newGoal !== undefined) throw new Error('newGoal goes only with goalChangedByUser: true.');
  if (!(RESULT_OUTCOMES as readonly unknown[]).includes(o.outcome)) throw new Error(`outcome: ${RESULT_OUTCOMES.join(' | ')}.`);
  if (!Array.isArray(o.doneWhen)) throw new Error('doneWhen: one entry { criterion, met, evidence } per criterion of your contract.');
  const answers = o.doneWhen.map((x, i) => {
    const c = object(x, `doneWhen[${i}]`);
    only(c, ['criterion', 'met', 'evidence'], `doneWhen[${i}]`);
    if (typeof c.met !== 'boolean') throw new Error(`doneWhen[${i}].met: true or false.`);
    return { criterion: text(c.criterion, CRITERION_MAX, `doneWhen[${i}].criterion`), met: c.met, ...(c.evidence !== undefined ? { evidence: text(c.evidence, EVIDENCE_MAX, `doneWhen[${i}].evidence`) } : {}) };
  });
  // a goal the user changed may leave criteria of the old contract without an answer
  const missing = changed ? [] : doneWhen.filter(c => !answers.some(a => a.criterion === c));
  // the whole array to copy, not only what is missing: a second guess is one call, never two (#170)
  if (missing.length) throw new Error(`doneWhen: answer every criterion of your contract, exactly as written (missing: ${missing.map(m => `«${m}»`).join(', ')}). doneWhen must be: [${doneWhen.map(c => `{"criterion":${JSON.stringify(c)},"met":<true|false>,"evidence":"…"}`).join(', ')}]`);
  if (o.outcome === 'done' && answers.some(a => !a.met)) throw new Error('outcome "done" needs every criterion met: say "partial" or "blocked" instead.');
  const questions = o.questions === undefined ? undefined : Array.isArray(o.questions) && o.questions.length <= 8 ? o.questions.map((q, i) => text(q, 500, `questions[${i}]`)) : null;
  if (questions === null) throw new Error('questions: up to 8.');
  const browserWrite = o.browserWrite === undefined ? undefined : browserWriteResult(o.browserWrite);
  const userAction = o.userAction === undefined ? undefined : userActionOf(o.userAction);
  if (userAction && o.outcome === 'done') throw new Error('userAction goes only with outcome "partial" or "blocked": a done run needs nothing from the user.');
  // a summary over SUMMARY_MAX is cut with the marker, never refused (agents/delegation.ts keeps the full text in output)
  if (browserWrite && ((o.outcome === 'done') !== (browserWrite.outcome === 'done'))) throw new Error('browserWrite outcome must agree with agent_report outcome');
  return { ...(browserWrite ? { browserWrite } : {}), ...(o.verdict !== undefined ? { verdict: o.verdict as DelegationResult['verdict'], verified: o.verified as DelegationResult['verified'] } : {}), ...(o.taskVersion !== undefined ? { taskVersion: o.taskVersion as number } : {}), outcome: o.outcome as DelegationOutcome, summary: capText(text(o.summary, Number.MAX_SAFE_INTEGER, 'summary'), SUMMARY_MAX), output: text(o.output, RESULT_OUTPUT_MAX, 'output'), doneWhen: answers, ...(questions?.length ? { questions } : {}), ...(newGoal ? { goalChangedByUser: true as const, newGoal } : {}), ...(o.amends === true ? { amends: true as const } : {}), ...(userAction ? { userAction } : {}) };
}

function userActionOf(v: unknown): UserAction {
  const u = object(v, 'userAction');
  only(u, ['kind', 'text', 'command'], 'userAction');
  if (!(USER_ACTION_KINDS as readonly unknown[]).includes(u.kind)) throw new Error(`userAction.kind: ${USER_ACTION_KINDS.join(' | ')}.`);
  return { kind: u.kind as UserAction['kind'], text: text(u.text, USER_ACTION_TEXT_MAX, 'userAction.text (what the user must do)'),
    ...(u.command !== undefined ? { command: text(u.command, USER_ACTION_COMMAND_MAX, 'userAction.command') } : {}) };
}

/** The child's first message: who delegates and the contract (the rules on reporting and asking are its role frame's,
 *  ROLE_PREAMBLE, which goes with it). Never the parent's conversation. */
export function delegationPrompt(c: DelegationContract, at: { role: WorkRoleId; parentTitle: string; title: string; skills: readonly string[] }): string {
  return [
    `Delegated by «${at.parentTitle}» to you as ${ROLE_DEFAULTS[at.role].name}: «${at.title}».`,
    // the single renderer of a contract (#355); the role's own default output is already in its frame (catalog.ts
    // resolve): only a contract's own is written
    ...contractText(c, ROLE_DEFAULTS[at.role].output),
    ...(at.skills.length ? [`Your skills: ${at.skills.join(', ')} (load the one that fits the job the way your role's skill list says).`] : []),
    // how to report and whom to ask are in the role's frame (ROLE_PREAMBLE), sent with this message: not repeated here
    'When the output is ready, or something blocks you: agent_report as your rules say, with doneWhen: one { criterion, met, evidence } per done-criterion above, written exactly as above. Your parent does not read this chat.',
    'If the user writes to you here, follow the user; when that changes your goal, say so in agent_report with goalChangedByUser: true and newGoal.',
  ].join('\n');
}

/** JSON whose strings cannot break a line: JSON.stringify leaves NEL, U+2028 and U+2029 raw, so they are escaped too.
 * Compact (no indentation): the parent re-reads it on every later turn, and indentation is tokens with nothing in them. */
const safeJson = (v: unknown): string => JSON.stringify(v).replace(/[\u0085\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** The message that brings a child's result to its parent: the agent label, a result line (what the child wrote
 * flattened to one line, so it cannot forge a line of the app or the user), then the result as JSON (escaped). A summary
 * the line already shows whole (one line) is not repeated in the JSON; one with line breaks stays there exact. With
 * outputMax (the Orchestrator's copy), a longer output is replaced by where to read it. */
export function resultMessage(role: WorkRoleId, title: string, r: DelegationResult, opts: { outputMax?: number; correction?: number } = {}): string {
  const changed = r.goalChangedByUser ? ` (obiettivo cambiato dall'utente nella chat figlia: «${oneLine(r.newGoal ?? '')}». Non disfare ciò che l'utente le ha chiesto.)` : '';
  // a long deliverable stays in the chat that wrote it (shown there as its answer): the Orchestrator gets where it is,
  // and reads it with app_chat_items only when it needs it, instead of carrying it in every later turn
  const long = opts.outputMax !== undefined && r.output.length > opts.outputMax;
  const full = long ? { ...r, output: `(${r.output.length} caratteri, nella chat «${oneLine(title)}» come sua risposta: leggilo con app_chat_items solo se ti serve)` } : r;
  const { summary, ...rest } = full;
  const json = oneLine(summary) === summary ? rest : full;
  // a correction (agent_report amends: true) says so: it replaces the result this chat reported before
  const head = opts.correction ? `correzione ${opts.correction}/${MAX_CORRECTIONS} del risultato · ` : 'risultato · ';
  const replaces = opts.correction ? ' (sostituisce il risultato precedente di questa chat)' : '';
  return `${AGENT_LABEL}\n\n[${head}${ROLE_DEFAULTS[role].name} «${oneLine(title)}»]${replaces} ${oneLine(summary)}${changed}\n\`\`\`json\n${safeJson(json)}\n\`\`\``;
}

/** Levels above a chat: 0 for a root (no parent). A broken or cyclic chain counts as too deep. */
export function depthOf(id: string, parentOf: (id: string) => string | undefined): number {
  let depth = 0;
  const seen = new Set([id]);
  for (let p = parentOf(id); p !== undefined; p = parentOf(p)) {
    if (seen.has(p)) return Number.MAX_SAFE_INTEGER;
    seen.add(p); depth++;
  }
  return depth;
}

/** A persisted trace, read tolerantly: anything out of shape is dropped (the chat stays a plain chat). A role ADR 0100
 *  retired reads as its successor (a Judge child is a Sentinel child). */
export function readDelegation(v: unknown): ChatDelegation | null {
  const d = v as Record<string, unknown> | null;
  const role = d && typeof d === 'object' && typeof d.role === 'string' ? currentRoleId(d.role) : null;
  if (!d || typeof d !== 'object' || !isWorkRole(role) || typeof d.goal !== 'string' || !Array.isArray(d.doneWhen) || !d.doneWhen.every(x => typeof x === 'string')
    || typeof d.at !== 'number' || !Number.isFinite(d.at)) return null;
  const r = d.result as Record<string, unknown> | undefined;
  const crit = Array.isArray(r?.doneWhen) ? (r!.doneWhen as unknown[]).filter((x): x is { criterion: string; met: boolean } => !!x && typeof (x as { criterion?: unknown }).criterion === 'string' && typeof (x as { met?: unknown }).met === 'boolean')
    .slice(0, CRITERIA_MAX).map(x => ({ criterion: x.criterion.slice(0, CRITERION_MAX), met: x.met })) : [];
  const result = r && (RESULT_OUTCOMES as readonly unknown[]).includes(r.outcome) && typeof r.summary === 'string' && typeof r.at === 'number'
    ? { outcome: r.outcome as DelegationOutcome, summary: r.summary, at: r.at, ...(crit.length ? { doneWhen: crit } : {}), ...(r.noReport === true ? { noReport: true as const } : {}), ...(Number.isSafeInteger(r.corrections) && (r.corrections as number) > 0 ? { corrections: Math.min(r.corrections as number, MAX_CORRECTIONS) } : {}), ...(r.journaled === true ? { journaled: true as const } : {}) } : undefined;
  const tools = Array.isArray(d.tools) && d.tools.every(c => (TOOL_CLASSES as readonly unknown[]).includes(c)) ? d.tools as ToolClass[] : undefined;
  return { role, goal: d.goal.slice(0, GOAL_MAX), doneWhen: (d.doneWhen as string[]).slice(0, CRITERIA_MAX), at: d.at, ...(tools ? { tools } : {}), ...(result ? { result } : {}), ...(typeof d.originalGoal === 'string' ? { originalGoal: d.originalGoal.slice(0, GOAL_MAX) } : {}) };
}
