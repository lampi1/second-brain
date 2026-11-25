// The one tool for plans (ADR 0359): `plans`, on the Orchestrator's own endpoint (all of it) and on a Strategist's chat endpoint
// (it reads every plan, edits its own, and only proposes on the others: it says it to the Orchestrator, which edits). It replaces
// app_project_map, project_map_read, project_map_save and project_map_update. Actions: list · search · read · create · edit ·
// replan · merge · split · project · approve · keep · start · stop · resume · archive · delete · restore · compare. Deleting
// sends a plan to the trash and it comes back with restore; only the user deletes for good, never this tool. The user's own
// decisions (approve, keep, start, stop) stay the Orchestrator's, with the same authority as app_resolve_question on a plan.
// Used by appctl/tools.ts and wiring.ts; pinned by test/unit/plans/tools.test.ts.
import { planText, type PlanAction, type PlanFull } from '@shared/plan';
import type { StepOp } from '@shared/plan-edit';
import type { Plans, PlanChange } from './service';

export const PLAN_TOOL_ACTIONS = ['list', 'search', 'read', 'create', 'edit', 'replan', 'merge', 'split', 'project', 'approve', 'keep', 'start', 'stop', 'resume', 'archive', 'delete', 'restore', 'compare'] as const;
export type PlanToolAction = (typeof PLAN_TOOL_ACTIONS)[number];
/** Who calls: the Orchestrator (everything), or a Strategist (its own plan, and reading). */
export type PlanCaller = { kind: 'orchestrator' } | { kind: 'strategist'; chatId: string };

export const PLAN_TOOL_TEXT = 'The user\'s plans (ADR 0359): every job and idea is one plan, kept by the app. list (what waits for the user first; trash: true = the trash) | search (query: words in titles, goals, steps) | read (plan: id or exact title; full text with steps, proofs, what each waits for, decisions) | create (title, idea, goal, why, project, constraints, links: written down, no chat starts) | edit (plan + set {title, idea, goal, why, project, constraints, links} and/or add / remove by name {constraints, links} and/or steps: operations add | set | move | remove | cancel | done (with proof) | import; nothing you do not name changes; every save is a version) | replan (text) | merge (plan, other: the other goes to the trash, nothing is lost) | split (plan, numbers, title) | project (plan, project: another project name) | approve | keep | start | stop | resume | archive | delete (to the trash, restore brings it back) | restore | compare (plan, version, other version: what changed). A step is «fatto» only with its proof (what ran, what was read or seen); a step you finish yourself: edit with steps [{op: "done", step, proof}]. Closing a plan or losing a chat never changes a step. Resume goes to the chat that works, never to a second Strategist. Only the user deletes for good.';

export const PLAN_TOOL_PROPS = {
  action: { type: 'string', enum: [...PLAN_TOOL_ACTIONS] },
  plan: { type: 'string', description: 'the plan: its id (pl_…) or its exact title' },
  other: { type: 'string', description: 'merge: the plan taken in; compare: the other version number' },
  query: { type: 'string', description: 'list, search: words to look for' },
  archived: { type: 'boolean', description: 'list: the archived ones' },
  trash: { type: 'boolean', description: 'list: the trash' },
  title: { type: 'string' }, idea: { type: 'string' }, goal: { type: 'string' }, why: { type: 'string' }, project: { type: 'string' },
  text: { type: 'string', description: 'replan: what to change' },
  set: { type: 'object', description: 'edit: fields to set (title, idea, goal, why, project, constraints[], links[]); null empties a text' },
  add: { type: 'object', description: 'edit: constraints[] and links[] {kind file|link|plan|chat, ref, label?} to add' },
  remove: { type: 'object', description: 'edit: constraints[] (the exact lines) and links[] (the refs) to take away' },
  steps: { type: 'array', description: 'edit: step operations {op: add|set|move|remove|cancel|done, step (number or id), title, detail, role, preset, after[] (numbers), touches[], minutes, to, at, proof}', items: { type: 'object' } },
  constraints: { type: 'array', items: { type: 'string' } }, links: { type: 'array', items: { type: 'object' } },
  numbers: { type: 'array', items: { type: 'integer' }, description: 'split: the numbers of the steps that go to the new plan' },
  version: { type: 'integer', description: 'compare: a version number' },
  cwd: { type: 'string', description: 'resume, start: another existing absolute folder for its Strategist' },
} as const;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);

function planOf(plans: Plans, v: unknown): string {
  const name = text(v);
  if (!name) throw new Error('plan: the plan\'s id (list) or its exact title');
  if (plans.get(name)) return name;
  const named = [...plans.list(), ...plans.list({ archived: true })].filter(m => m.title.toLowerCase() === name.toLowerCase());
  if (named.length === 1) return named[0]!.id;
  throw new Error(named.length ? `plan: ${named.length} plans are called «${name}»: use the id` : `plan: no plan «${name}» (list)`);
}

/** What changed between two versions of a plan, in words. */
export function compareText(a: PlanFull, b: PlanFull): string {
  const out: string[] = [`Version ${a.record.version} → ${b.record.version}`];
  for (const f of ['title', 'goal', 'why', 'idea', 'project'] as const) if ((a.record[f] ?? '') !== (b.record[f] ?? '')) out.push(`${f}: «${a.record[f] ?? ''}» → «${b.record[f] ?? ''}»`);
  const sa = new Map(a.steps.map(s => [s.id, s])), sb = new Map(b.steps.map(s => [s.id, s]));
  for (const s of b.steps) {
    const o = sa.get(s.id);
    if (!o) out.push(`+ step ${s.n} «${s.title}»`);
    else if (o.state !== s.state) out.push(`step ${s.n} «${s.title}»: ${o.state} → ${s.state}`);
    else if (o.title !== s.title) out.push(`step ${s.n}: «${o.title}» → «${s.title}»`);
  }
  for (const s of a.steps) if (!sb.has(s.id)) out.push(`- step ${s.n} «${s.title}»`);
  for (const c of b.record.constraints) if (!a.record.constraints.includes(c)) out.push(`+ constraint: ${c}`);
  for (const c of a.record.constraints) if (!b.record.constraints.includes(c)) out.push(`- constraint: ${c}`);
  return out.length > 1 ? out.join('\n') : `${out[0]}: nothing changed in the words and steps.`;
}

export async function planAction(plans: Plans, who: PlanCaller, a: Record<string, unknown>): Promise<unknown> {
  const action = text(a.action) as PlanToolAction;
  if (!(PLAN_TOOL_ACTIONS as readonly string[]).includes(action)) throw new Error(`action: ${PLAN_TOOL_ACTIONS.join(' | ')}`);
  const by = who.kind === 'orchestrator' ? 'Orchestrator' : 'Strategist';
  if (action === 'list') return { plans: plans.list({ ...(a.archived === true ? { archived: true } : {}), ...(a.trash === true ? { trash: true } : {}), ...(text(a.query) ? { query: text(a.query) } : {}) }) };
  if (action === 'search') {
    if (!text(a.query)) throw new Error('query: the words to look for');
    return { plans: plans.list({ query: text(a.query) }) };
  }
  if (action === 'create') {
    const m = plans.idea({ title: text(a.title), idea: text(a.idea), goal: text(a.goal), why: text(a.why), project: text(a.project), ...(list(a.constraints) ? { constraints: list(a.constraints)! } : {}), ...(Array.isArray(a.links) ? { links: a.links as never } : {}) }, by);
    return { ok: true, plan: m.id, state: m.state };
  }
  const id = planOf(plans, a.plan);
  if (action === 'read') return planText(plans.view(id)!);
  if (action === 'compare') {
    const v1 = Number(a.version), v2 = a.other === undefined ? plans.get(id)!.version : Number(a.other);
    const x = plans.view(id, v1), y = plans.view(id, v2);
    if (!x || !y) throw new Error('version: two versions of this plan (read shows the current one)');
    return compareText(x, y);
  }
  // what changes a plan: the Orchestrator everywhere; a Strategist only on its own plan, and never the user's decisions
  const own = who.kind === 'strategist' && plans.get(id)?.owner?.chatId === who.chatId;
  if (who.kind === 'strategist') {
    if (['approve', 'keep', 'start', 'stop', 'resume', 'archive', 'delete', 'restore'].includes(action)) throw new Error(`${action}: the user decides that, through the Orchestrator.`);
    if (!own) throw new Error('This plan is not yours: you only read it. Say what you would change to the Orchestrator (send_to_chat), which edits it.');
  }
  if (action === 'edit' || action === 'project') {
    const change: PlanChange = action === 'project'
      ? { set: { project: text(a.project) } }
      : { ...(a.set && typeof a.set === 'object' ? { set: a.set as never } : {}), ...(a.add && typeof a.add === 'object' ? { add: a.add as never } : {}), ...(a.remove && typeof a.remove === 'object' ? { remove: a.remove as never } : {}), ...(Array.isArray(a.steps) ? { steps: a.steps as StepOp[] } : {}) };
    if (action === 'project' && !text(a.project)) throw new Error('project: the project name');
    if (!change.set && !change.add && !change.remove && !change.steps) throw new Error('edit: set, add, remove or steps');
    const m = await plans.change(id, change, by);
    return { ok: true, plan: m.id, version: m.version };
  }
  if (action === 'merge') { const m = await plans.merge(id, planOf(plans, a.other), by); return { ok: true, plan: m.id, version: m.version }; }
  if (action === 'split') { const m = await plans.split(id, (Array.isArray(a.numbers) ? a.numbers : []).map(Number), text(a.title) || 'Piano diviso', by); return { ok: true, plan: m.id }; }
  const at = plans.get(id)?.plan?.at;
  const m = await plans.act(id, action as PlanAction, { ...(at !== undefined ? { at } : {}), ...(text(a.text) ? { text: text(a.text) } : {}), ...(text(a.cwd) ? { cwd: text(a.cwd) } : {}) }, by);
  return { ok: true, plan: m.id, state: m.state, ...(m.owner ? { chatId: m.owner.chatId } : {}) };
}
