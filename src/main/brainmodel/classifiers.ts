// The Classificatori page's data (ADR 0077), read-only: how the app's automatic choices work today. Model routing: the
// table in force (task kind → engine, model, effort, why), its change history, and per row the measured results of the
// chats it routed (runs, verified success rate, average cost per chat) from the improvement loop's ledger
// (<brain>/ops/state/improve/outcomes.jsonl, predictions joined with their actuals and the verdicts of the agent runs of
// the same chats). Skill choice: for recent role runs, the skills skills_suggest ranks for the goal now against the
// skills the launch actually gave (AgentRun.tags.skills). Per kind of work: the known outcomes (routing:get's
// kindStats); per source: how many chats the table, the role (ADR 0083) or a default chose the model of. Quality over
// time: success and cost per route, by week; a row without runs says so (null values), never zero. "Verified" = the
// user's or a reviewed verdict, from the agent run or from the ledger (a run in both counts once; ADR 0095); the
// brain's proxy outcomes are known but unverified and never enter it. Nothing here writes: changes go
// through the routing save and the maintenance jobs, logged with their rollback. Used by brainmodel/service.ts;
// unit tests: test/unit/brainmodel/classifiers.test.ts. The grid's cards (classifier-cards.ts) also read the ledger's
// known outcomes and the job ledger (userData/jobs.jsonl, the cost ledger's kinds).
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { ClassifierChoice, ClassifierRoute, ClassifiersState, RouteResult } from '../../shared/brain-model';
import type { RoutingInfo, RoutingRow } from '../../shared/contract';
import { foldOutcome, type LedgerOutcome } from '../brain/routing';
import { classifierCards, verifiedOf, type JobRow, type Launch } from './classifier-cards';

interface Prediction { id: string; at: number; kind: string; area: string; harness: string; model: string | null; source: string }
interface Actual { usd: number }
export interface ClassifierInputs {
  root: string | null;
  routing: RoutingInfo;
  runs: AgentRun[];
  profiles: AgentProfile[];
  /** the skill names skills_suggest ranks for a goal now, best first */
  suggest(goal: string): Promise<string[]>;
  /** the job ledger's rows (kind and cost of each chat), for the cost-ledger kind card; absent = none */
  jobs?: () => JobRow[];
}

/** userData/jobs.jsonl (brain/estimates.ts FileJobStore: the last line of an id wins) as the cards need it. */
export function readJobs(file: string): JobRow[] {
  let text = '';
  try { if (fs.statSync(file).size <= 32 * 1024 * 1024) text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const byId = new Map<string, JobRow>();
  for (const l of text.split(/\r?\n/)) {
    if (!l.trim()) continue;
    try {
      const j = JSON.parse(l) as { id?: unknown; at?: unknown; kind?: unknown; actual?: { usd?: unknown } | null };
      if (typeof j.id === 'string' && typeof j.kind === 'string') byId.set(j.id, { at: Number(j.at) || 0, kind: j.kind, usd: typeof j.actual?.usd === 'number' ? j.actual.usd : null });
    } catch { /* a torn line */ }
  }
  return [...byId.values()];
}

/** The ledger's routing predictions of the app's chats (one per chat), their latest actuals and their known outcomes
 *  (later line wins, a measured line never undoes one, an unverified one never replaces a verified one: foldOutcome). */
export function readLedger(root: string | null): { predictions: Prediction[]; actuals: Map<string, Actual>; outcomes: Map<string, LedgerOutcome> } {
  const predictions = new Map<string, Prediction>(), actuals = new Map<string, Actual>(), outcomes = new Map<string, LedgerOutcome>();
  if (!root) return { predictions: [], actuals, outcomes };
  let text = '';
  try { const f = path.join(root, 'ops', 'state', 'improve', 'outcomes.jsonl'); if (fs.statSync(f).size <= 32 * 1024 * 1024) text = fs.readFileSync(f, 'utf8'); } catch { /* no ledger yet */ }
  for (const line of text.split('\n')) {
    if (!line.includes('"app:')) continue;
    try {
      const j = JSON.parse(line) as { id?: unknown; at?: unknown; domain?: unknown; item?: { kind?: string; area?: string; harness?: string; model?: string | null }; predicted?: { value?: { source?: string } }; actual?: { usd?: number }; outcome?: unknown };
      // an app: id is a routing line; the brain's settlement may leave the domain out
      if ((j.domain !== 'routing' && j.domain !== undefined) || typeof j.id !== 'string' || !j.id.startsWith('app:')) continue;
      if (j.predicted && j.item && !predictions.has(j.id)) predictions.set(j.id, { id: j.id, at: Number(j.at) || 0, kind: String(j.item.kind ?? 'altro'), area: String(j.item.area ?? ''), harness: String(j.item.harness ?? ''), model: j.item.model ?? null, source: String(j.predicted.value?.source ?? 'table') });
      if (j.actual && Number.isFinite(j.actual.usd)) actuals.set(j.id, { usd: Number(j.actual.usd) });
      if (j.outcome) foldOutcome(outcomes, j.id, j.outcome);
    } catch { /* a torn line */ }
  }
  return { predictions: [...predictions.values()], actuals, outcomes };
}

const areas = (r: RoutingRow): string[] => (r.area === undefined ? [] : Array.isArray(r.area) ? r.area : [r.area]);
/** The row of `routes` a prediction was decided by (same rule as routing.match: the first row of its kind and area). */
export function rowOf(routes: RoutingRow[], p: Pick<Prediction, 'kind' | 'area'>): number {
  const exact = routes.findIndex(r => r.kind === p.kind && (!areas(r).length || areas(r).includes(p.area)));
  return exact >= 0 ? exact : routes.findIndex(r => r.kind === '*' && (!areas(r).length || areas(r).includes(p.area)));
}
function result(ids: string[], actuals: Map<string, Actual>, runByChat: Map<string, AgentRun>, outcomes: Map<string, LedgerOutcome>): RouteResult {
  const known = ids.map(id => verifiedOf(id, runByChat, outcomes)).filter((x): x is boolean => x !== null);
  const costs = ids.map(id => actuals.get(id)?.usd).filter((x): x is number => typeof x === 'number');
  return { runs: ids.length, success: { value: known.length ? known.filter(Boolean).length / known.length : null, n: known.length },
    avgCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null };
}
/** ISO week label "2026-W42" of a time. */
export function weekOf(ms: number): string {
  const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = d.getUTCFullYear(), w = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86400e3 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
/** whoever delegates passes the suggestions scoring at least this (shared/skill-suggest.ts, the Guida) */
const SKILL_CUT = 60;
const lastWeeks = (now: number, n: number) => Array.from({ length: n }, (_, i) => weekOf(now - (n - 1 - i) * 7 * 86400e3));

export async function classifiersState(i: ClassifierInputs, now = Date.now()): Promise<ClassifiersState> {
  const table = i.routing.table, routes = table?.routes ?? [];
  const { predictions, actuals, outcomes } = readLedger(i.root);
  const runByChat = new Map([...i.runs].sort((a, b) => b.startedAt - a.startedAt).map(r => [r.chatId, r]));
  const perRow = routes.map(() => [] as string[]);
  for (const p of predictions) { if (p.source !== 'table') continue; const k = rowOf(routes, p); if (k >= 0) perRow[k]!.push(p.id); }
  const rows: ClassifierRoute[] = routes.map((r, k) => ({ kind: r.kind, area: areas(r).join(', ') || null, harness: r.harness, model: r.model, effort: r.effort, why: r.why, result: result(perRow[k]!, actuals, runByChat, outcomes) }));
  // skill choice: the latest role runs with their launch's skills
  const name = (id: string) => i.profiles.find(p => p.id === id)?.name ?? id;
  // the latest 40 role launches feed the skills card; the page's list shows the 15 newest
  const recent = i.runs.filter(r => r.skillSuggestions && r.goal.trim()).sort((a, b) => b.startedAt - a.startedAt).slice(0, 40);
  const choices: ClassifierChoice[] = [], launches: Launch[] = [];
  for (const r of recent) {
    const { suggested, used } = r.skillSuggestions!;
    launches.push({ runId: r.runId, at: r.startedAt, chatId: r.chatId, agentId: r.agentId, suggested: suggested.slice(0, 5), used: [...used] });
    if (choices.length < 15) choices.push({ at: r.startedAt, chatId: r.chatId, goal: r.goal.slice(0, 240), role: { id: r.agentId, name: name(r.agentId) }, suggested: suggested.slice(0, 5), used: [...used] });
  }
  // quality by week: per route (its predictions)
  const weeks = lastWeeks(now, 6);
  const quality: ClassifiersState['quality'] = rows.map((row, k) => ({ key: `route:${k}`, label: `${row.kind}${row.area ? ` · ${row.area}` : ''} → ${row.model}`,
    weeks: weeks.map(w => { const ids = perRow[k]!.filter(id => weekOf(predictions.find(p => p.id === id)!.at) === w), res = result(ids, actuals, runByChat, outcomes); return { week: w, runs: res.runs, success: res.success.value, avgCostUsd: res.avgCostUsd }; }) }));
  return {
    routing: { version: table?.version ?? null, appliedAt: table?.appliedAt ?? null, by: table?.by ?? null, routes: rows, error: i.routing.error },
    history: i.routing.history.map(h => ({ at: h.at, from: h.from, to: h.to, by: h.by, reason: h.reason, evidence: h.evidence })),
    choices, quality,
    cards: classifierCards({ now, predictions, actuals, outcomes, runs: i.runs, launches, jobs: (() => { try { return i.jobs?.() ?? []; } catch { return []; } })(), skillThreshold: SKILL_CUT }),
    kinds: Object.entries(i.routing.kindStats ?? {}).flatMap(([kind, v]) => (v ? [{ kind, chats: v.chats, known: v.known, ok: v.ok }] : [])).sort((a, b) => b.chats - a.chats || a.kind.localeCompare(b.kind)),
    sources: [...predictions.reduce((m, p) => m.set(p.source, (m.get(p.source) ?? 0) + 1), new Map<string, number>())].map(([source, chats]) => ({ source, chats })).sort((a, b) => b.chats - a.chats),
  };
}
