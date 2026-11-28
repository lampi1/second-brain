// How a plan follows its owner chat (ADR 0342), pure: which chats own a job, which job a chat is on now, the map as
// the chat's present state makes it (plan, stopped, finished), and the one line that says what changed in a version.
// Used by plans/service.ts; pinned by test/unit/plans/service.test.ts.
import type { ChatSummary } from '@shared/contract';
import { STRATEGY_FLOW, type StrategyPlan } from '@shared/strategy';
import { PLAN_LIMITS, planStateOf, type Plan, type PlanState, type PlanStopBy } from '@shared/plan';

const one = (s: string, max: number): string => s.replace(/\s+/g, ' ').trim().slice(0, max);

const FLOW_HEAD = STRATEGY_FLOW.split('\n')[0]!;

/** A root chat whose work is a job: a Strategist's, or any with a plan. A delegated chat's work is a step of its parent's. */
export const ownsJob = (c: ChatSummary): boolean => !c.isOrchestrator && !c.parentId && !c.plan?.handed && (!!c.plan || c.agent?.source === 'catalog' && c.agent.id === 'strategist');
/** The job the chat is on (a new task in the same chat is another job); 'chat' until its first run is known. */
export const taskOf = (c: ChatSummary): string => c.run?.taskId ?? c.run?.runId ?? 'chat';
export const titleOf = (c: ChatSummary): string => one(c.title, PLAN_LIMITS.title) || 'Lavoro';
/** The request in words, as the map's idea, without the app's own instructions under it. */
export const requestOf = (c: ChatSummary): string | undefined => (c.run?.goal ?? '').split(FLOW_HEAD)[0]!.trim().slice(0, PLAN_LIMITS.idea) || undefined;

/** The chat said the job is over: its plan is done, or (no plan) it gave its report. */
function over(c: ChatSummary): boolean {
  if (c.plan) return c.plan.phase === 'done';
  return c.run?.report?.via === 'agent_report' && c.run.report.outcome !== 'blocked';
}

/** The steps of an earlier chat stay on the map while its new chat has none yet; what was under way there is not. */
function planFrom(m: Plan, c: ChatSummary): StrategyPlan | undefined {
  if (!c.plan) return m.plan ? structuredClone(m.plan) : undefined;
  const plan = structuredClone(c.plan);
  if (plan.steps.length || plan.phase === 'done' || !m.past?.length || !m.plan?.steps.length) return plan;
  return { ...plan, steps: m.plan.steps.map(({ drop: _d, ...s }) => structuredClone(s)) };
}

/** The map as its owner chat makes it now. `now` dates what is new; dead = the chat's engine died and did not come back. */
export function follow(m: Plan, c: ChatSummary, now: number, dead = false): Plan {
  const { stopped: was, finishedAt, seenAt, archivedAt, plan: _p, ...rest } = m;
  const plan = planFrom(m, c);
  const base = { ...rest, title: m.titled ? m.title : titleOf(c), ...(plan ? { plan } : {}) };
  // finished stays finished whatever happens to its chat; a job that went on again is open again
  if (over(c)) return settle({ ...base, finishedAt: finishedAt ?? now, ...(seenAt !== undefined ? { seenAt } : {}), ...(archivedAt !== undefined ? { archivedAt } : {}) });
  // the app closes a chat only once its turn is over and nothing waits: with no plan the job ended there
  if (c.closedAt && c.closedBy !== 'user' && !plan) return settle({ ...base, finishedAt: finishedAt ?? c.closedAt, ...(seenAt !== undefined ? { seenAt } : {}), ...(archivedAt !== undefined ? { archivedAt } : {}) });
  const wentOn = !!c.plan && archivedAt !== undefined && c.plan.at > archivedAt && ['proposed', 'approved', 'running'].includes(c.plan.phase);
  const stopped = stopOf(c, was, now, dead);
  return settle({ ...base, ...(stopped ? { stopped } : {}), ...(archivedAt !== undefined && finishedAt === undefined && !wentOn ? { archivedAt } : {}) });
}

function stopOf(c: ChatSummary, was: Plan['stopped'], now: number, dead: boolean): Plan['stopped'] {
  if (c.plan?.stopped) return was?.by === 'user' ? was : { at: now, by: 'user' };
  // a plan that waits for the user, or for its start, does not need its chat open: closed by the app it stays as it is
  const waits = c.plan?.phase === 'proposed' || c.plan?.phase === 'approved';
  if (c.closedAt && (c.closedBy === 'user' || !waits)) return was ?? { at: c.closedAt, by: 'closed' };
  if (dead && !waits) return was ?? { at: now, by: 'closed' };
  if (!was || was.by === 'closed' || was.by === 'gone') return undefined;
  // a job with no plan has only the map to say it is stopped, until its chat works again
  if (was.by === 'user' && (c.plan || c.state === 'running' && (c.workSince ?? 0) > was.at)) return undefined;
  return was;
}

export const settle = (m: Omit<Plan, 'state'> & { state?: PlanState }): Plan => ({ ...m, state: planStateOf(m) });

/** The map of a chat that is not in the app any more, or that moved to another job: stopped, never removed. */
export function left(m: Plan, by: PlanStopBy, now: number): Plan {
  if (m.state === 'finished' || m.state === 'archived' || m.stopped && m.stopped.by !== 'closed') return m;
  return settle({ ...m, stopped: { at: now, by } });
}

const STATE_LINE: Record<PlanState, string> = {
  idea: 'Idea', toApprove: 'Piano da approvare', planned: 'Approvata, tenuta per dopo', running: 'In corso', stopped: 'Ferma', finished: 'Finita', archived: 'Archiviata',
};
const STOP_LINE: Record<PlanStopBy, string> = { user: 'fermata da te', closed: 'chat chiusa', gone: 'chat non più nell’app', replaced: 'la chat è passata a un altro lavoro' };
const STEP_LINE = { todo: 'da fare', now: 'in corso', blocked: 'bloccato', partial: 'fatto in parte', done: 'fatto', cancelled: 'annullato', check: 'da verificare' } as const;

/** Where a map stands, in words. */
export const stateLine = (m: Pick<Plan, 'state' | 'stopped'>): string => (m.state === 'stopped' && m.stopped ? `Ferma: ${STOP_LINE[m.stopped.by]}` : STATE_LINE[m.state]);

/** What a version changed, one line. */
export function summaryOf(prev: Plan | null, next: Plan): string {
  const cut = (s: string) => one(s, PLAN_LIMITS.summary);
  if (!prev) return next.owner ? 'Lavoro iniziato' : 'Idea scritta';
  if (prev.state !== next.state) {
    return prev.state === 'archived' ? `Riaperta · ${stateLine(next)}` : stateLine(next);
  }
  if (prev.owner?.chatId !== next.owner?.chatId) return 'Passata a un’altra chat';
  if (prev.title !== next.title) return cut(`Titolo: ${next.title}`);
  const a = prev.plan, b = next.plan;
  if (a && b) {
    if (a.phase !== b.phase) return b.phase === 'revising' ? 'Piano in revisione' : b.phase === 'proposed' ? 'Piano proposto' : STATE_LINE[next.state];
    if (a.steps.length < b.steps.length) return cut(`Passo in più: ${b.steps[b.steps.length - 1]!.title}`);
    const i = b.steps.findIndex((s, k) => a.steps[k]?.state !== s.state);
    if (i >= 0) return cut(`Passo ${i + 1} ${STEP_LINE[b.steps[i]!.state]}: ${b.steps[i]!.title}`);
    if (a.clarified.length < b.clarified.length) return 'Una risposta in più';
  }
  return !a && b ? 'Piano iniziato' : 'Aggiornata';
}
