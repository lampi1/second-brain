// Delegation between role chats (ADR 0083): the contract a parent hands a child with agent_delegate, the result the
// child returns with agent_report, the trace a child chat carries (ChatSummary.delegation) and the pure helpers both
// sides need: the checks of a contract and of a result, the child's first message (the contract only, never the
// parent's history), the message that brings a result back, and the depth of a chat in the tree. Pure: used by
// main/agents/delegation.ts (the tools), main/chats/manager.ts (the result delivery) and the renderer (the child cards).
import { TOOL_CLASSES, type ToolClass } from './agents';
import { MODEL_TIERS, ROLE_DEFAULTS, isWorkRole, type ModelTier, type WorkRoleId } from './roles';
import { AGENT_LABEL, oneLine } from './agent-label';

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
}
export const RESULT_OUTCOMES = ['done', 'partial', 'blocked'] as const;
export type DelegationOutcome = (typeof RESULT_OUTCOMES)[number];
export interface DelegationResult {
  outcome: DelegationOutcome;
  summary: string;
  output: string;
  doneWhen: { criterion: string; met: boolean; evidence?: string }[];
  /** questions for the parent the child could not settle itself */
  questions?: string[];
  /** the user wrote to the child directly and changed its goal: the child followed the user, newGoal is that goal */
  goalChangedByUser?: true;
  newGoal?: string;
}
/** What a child chat carries about its delegation (persisted with the chat; shown on its card and in the tree). */
export interface ChatDelegation {
  role: WorkRoleId;
  goal: string;
  doneWhen: string[];
  at: number;
  /** the tool classes the contract narrowed it to (absent = its role's, bounded by the parent's) */
  tools?: ToolClass[];
  /** its agent_report, once given */
  result?: { outcome: DelegationOutcome; summary: string; at: number; doneWhen?: { criterion: string; met: boolean }[] };
  /** the goal as the contract gave it, kept when the user changed it in the child's chat (goal is then the user's) */
  originalGoal?: string;
}
/** A delegation limit the chat hit, shown on it until it delegates again. */
export interface DelegationLimitHit { kind: 'depth' | 'parallel'; limit: number; at: number }

export const GOAL_MAX = 2000, OUTPUT_MAX = 2000, CONTEXT_MAX = 6000, CRITERION_MAX = 300, CRITERIA_MAX = 12, SUMMARY_MAX = 300, RESULT_OUTPUT_MAX = 12000;
const SKILL = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const text = (v: unknown, max: number, what: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${what}: required text.`);
  if (v.length > max) throw new Error(`${what}: at most ${max} characters.`);
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
  only(o, ['goal', 'output', 'doneWhen', 'tools', 'skills', 'context', 'tier'], 'contract');
  const doneWhen = o.doneWhen;
  if (!Array.isArray(doneWhen) || !doneWhen.length || doneWhen.length > CRITERIA_MAX) throw new Error(`contract.doneWhen: 1 to ${CRITERIA_MAX} criteria.`);
  const tools = o.tools === undefined ? undefined : Array.isArray(o.tools) && o.tools.every(c => (TOOL_CLASSES as readonly unknown[]).includes(c)) ? [...new Set(o.tools as ToolClass[])] : null;
  if (tools === null) throw new Error(`contract.tools: classes among ${TOOL_CLASSES.join(', ')}.`);
  const skills = o.skills === undefined ? undefined : Array.isArray(o.skills) && o.skills.length <= 16 && o.skills.every(s => typeof s === 'string' && SKILL.test(s)) ? [...new Set(o.skills as string[])] : null;
  if (skills === null) throw new Error('contract.skills: up to 16 skill names (skills_suggest).');
  if (o.tier !== undefined && !(MODEL_TIERS as readonly unknown[]).includes(o.tier)) throw new Error(`contract.tier: ${MODEL_TIERS.join(' | ')}.`);
  return {
    goal: text(o.goal, GOAL_MAX, 'contract.goal'),
    output: o.output === undefined ? ROLE_DEFAULTS[role].output : text(o.output, OUTPUT_MAX, 'contract.output'),
    doneWhen: doneWhen.map((c, i) => text(c, CRITERION_MAX, `contract.doneWhen[${i}]`)),
    ...(tools ? { tools } : {}), ...(skills?.length ? { skills } : {}),
    ...(o.context !== undefined ? { context: text(o.context, CONTEXT_MAX, 'contract.context') } : {}),
    ...(o.tier !== undefined ? { tier: o.tier as ModelTier } : {}),
  };
}

/** A child's agent_report, checked strictly: every criterion of its contract answered once, in any order. */
export function checkResult(v: unknown, doneWhen: readonly string[]): DelegationResult {
  const o = object(v, 'result');
  only(o, ['outcome', 'summary', 'output', 'doneWhen', 'questions', 'goalChangedByUser', 'newGoal'], 'agent_report');
  if (o.goalChangedByUser !== undefined && typeof o.goalChangedByUser !== 'boolean') throw new Error('goalChangedByUser: true or false.');
  const changed = o.goalChangedByUser === true;
  const newGoal = changed ? text(o.newGoal, GOAL_MAX, 'newGoal (the goal the user gave you)') : undefined;
  if (!changed && o.newGoal !== undefined) throw new Error('newGoal goes only with goalChangedByUser: true.');
  if (!(RESULT_OUTCOMES as readonly unknown[]).includes(o.outcome)) throw new Error(`outcome: ${RESULT_OUTCOMES.join(' | ')}.`);
  if (!Array.isArray(o.doneWhen)) throw new Error('doneWhen: one entry per criterion of your contract.');
  const answers = o.doneWhen.map((x, i) => {
    const c = object(x, `doneWhen[${i}]`);
    only(c, ['criterion', 'met', 'evidence'], `doneWhen[${i}]`);
    if (typeof c.met !== 'boolean') throw new Error(`doneWhen[${i}].met: true or false.`);
    return { criterion: text(c.criterion, CRITERION_MAX, `doneWhen[${i}].criterion`), met: c.met, ...(c.evidence !== undefined ? { evidence: text(c.evidence, 1000, `doneWhen[${i}].evidence`) } : {}) };
  });
  // a goal the user changed may leave criteria of the old contract without an answer
  const missing = changed ? [] : doneWhen.filter(c => !answers.some(a => a.criterion === c));
  if (missing.length) throw new Error(`doneWhen: answer every criterion of your contract, exactly as written (missing: ${missing.map(m => `«${m}»`).join(', ')}).`);
  if (o.outcome === 'done' && answers.some(a => !a.met)) throw new Error('outcome "done" needs every criterion met: say "partial" or "blocked" instead.');
  const questions = o.questions === undefined ? undefined : Array.isArray(o.questions) && o.questions.length <= 8 ? o.questions.map((q, i) => text(q, 500, `questions[${i}]`)) : null;
  if (questions === null) throw new Error('questions: up to 8.');
  return { outcome: o.outcome as DelegationOutcome, summary: text(o.summary, SUMMARY_MAX, 'summary'), output: text(o.output, RESULT_OUTPUT_MAX, 'output'), doneWhen: answers, ...(questions?.length ? { questions } : {}), ...(newGoal ? { goalChangedByUser: true as const, newGoal } : {}) };
}

/** The child's first message: who delegates, the contract, how to report. Never the parent's conversation. */
export function delegationPrompt(c: DelegationContract, at: { role: WorkRoleId; parentTitle: string; title: string; skills: readonly string[] }): string {
  return [
    `Delegated by «${at.parentTitle}» to you as ${ROLE_DEFAULTS[at.role].name}: «${at.title}».`,
    `Goal: ${c.goal}`,
    ...(c.context ? [`Context: ${c.context}`] : []),
    `Output: ${c.output}`,
    'Done when:', ...c.doneWhen.map(d => `- ${d}`),
    ...(at.skills.length ? [`Your skills: ${at.skills.join(', ')}.`] : []),
    'When the output is ready, or something blocks you, call agent_report once (outcome, summary, output, each done-criterion above with met and evidence). Your parent receives it; it does not read this chat.',
    'An ambiguity in this contract goes to your parent first: agent_ask_parent (it answers from what it knows). Ask the user only for a permission, an irreversible or external action, a choice that changes the goal, or what your parent could not answer.',
    'If the user writes to you here, follow the user; when that changes your goal, say so in agent_report with goalChangedByUser: true and newGoal.',
  ].join('\n');
}

/** JSON whose strings cannot break a line: JSON.stringify leaves NEL, U+2028 and U+2029 raw, so they are escaped too. */
const safeJson = (v: unknown): string => JSON.stringify(v, null, 2).replace(/[\u0085\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** The message that brings a child's result to its parent: the agent label, a result line (what the child wrote
 * flattened to one line, so it cannot forge a line of the app or the user), then the result as JSON (escaped). */
export function resultMessage(role: WorkRoleId, title: string, r: DelegationResult): string {
  const changed = r.goalChangedByUser ? ` (obiettivo cambiato dall'utente nella chat figlia: «${oneLine(r.newGoal ?? '')}». Non disfare ciò che l'utente le ha chiesto.)` : '';
  return `${AGENT_LABEL}\n\n[risultato · ${ROLE_DEFAULTS[role].name} «${oneLine(title)}»] ${oneLine(r.summary)}${changed}\n\`\`\`json\n${safeJson(r)}\n\`\`\``;
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

/** A persisted trace, read tolerantly: anything out of shape is dropped (the chat stays a plain chat). */
export function readDelegation(v: unknown): ChatDelegation | null {
  const d = v as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || !isWorkRole(d.role) || typeof d.goal !== 'string' || !Array.isArray(d.doneWhen) || !d.doneWhen.every(x => typeof x === 'string')
    || typeof d.at !== 'number' || !Number.isFinite(d.at)) return null;
  const r = d.result as Record<string, unknown> | undefined;
  const crit = Array.isArray(r?.doneWhen) ? (r!.doneWhen as unknown[]).filter((x): x is { criterion: string; met: boolean } => !!x && typeof (x as { criterion?: unknown }).criterion === 'string' && typeof (x as { met?: unknown }).met === 'boolean')
    .slice(0, CRITERIA_MAX).map(x => ({ criterion: x.criterion.slice(0, CRITERION_MAX), met: x.met })) : [];
  const result = r && (RESULT_OUTCOMES as readonly unknown[]).includes(r.outcome) && typeof r.summary === 'string' && typeof r.at === 'number'
    ? { outcome: r.outcome as DelegationOutcome, summary: r.summary, at: r.at, ...(crit.length ? { doneWhen: crit } : {}) } : undefined;
  const tools = Array.isArray(d.tools) && d.tools.every(c => (TOOL_CLASSES as readonly unknown[]).includes(c)) ? d.tools as ToolClass[] : undefined;
  return { role: d.role, goal: d.goal.slice(0, GOAL_MAX), doneWhen: (d.doneWhen as string[]).slice(0, CRITERIA_MAX), at: d.at, ...(tools ? { tools } : {}), ...(result ? { result } : {}), ...(typeof d.originalGoal === 'string' ? { originalGoal: d.originalGoal.slice(0, GOAL_MAX) } : {}) };
}
