// The Classificatori page's data (ADR 0077), read-only: how the app's automatic choices work today. Model routing: the
// table in force (task kind → engine, model, effort, why), its change history, and per row the measured results of the
// chats it routed (runs, verified success rate, average cost per chat) from the improvement loop's ledger
// (<brain>/ops/state/improve/outcomes.jsonl, predictions joined with their actuals and the verdicts of the agent runs of
// the same chats). Agent choice: for recent runs, the agent the words classifier ranks first for the goal now, and the
// one actually used with its score at start (AgentRun.routing). Quality over time: success and cost per route and per
// classifier channel, by week; a row without runs says so (null values), never zero. Nothing here writes: changes go
// through the routing save and the maintenance jobs, logged with their rollback. Used by brainmodel/service.ts;
// unit tests: test/unit/brainmodel/classifiers.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../shared/agents';
import type { ClassifierChoice, ClassifierRoute, ClassifiersState, RouteResult } from '../../shared/brain-model';
import type { RoutingInfo, RoutingRow } from '../../shared/contract';

interface Prediction { id: string; at: number; kind: string; area: string; harness: string; model: string | null; source: string }
interface Actual { usd: number }
export interface ClassifierInputs {
  root: string | null;
  routing: RoutingInfo;
  runs: AgentRun[];
  profiles: AgentProfile[];
  /** the agent ranked first for a goal now (words channel), with its score; null = none passes the threshold */
  top(goal: string): Promise<{ id: string; score: number } | null>;
}

/** The ledger's routing predictions of the app's chats (one per chat) and their latest actuals. */
export function readLedger(root: string | null): { predictions: Prediction[]; actuals: Map<string, Actual> } {
  const predictions = new Map<string, Prediction>(), actuals = new Map<string, Actual>();
  if (!root) return { predictions: [], actuals };
  let text = '';
  try { const f = path.join(root, 'ops', 'state', 'improve', 'outcomes.jsonl'); if (fs.statSync(f).size <= 32 * 1024 * 1024) text = fs.readFileSync(f, 'utf8'); } catch { /* no ledger yet */ }
  for (const line of text.split('\n')) {
    if (!line.includes('"routing"')) continue;
    try {
      const j = JSON.parse(line) as { id?: unknown; at?: unknown; domain?: unknown; item?: { kind?: string; area?: string; harness?: string; model?: string | null }; predicted?: { value?: { source?: string } }; actual?: { usd?: number } };
      if (j.domain !== 'routing' || typeof j.id !== 'string' || !j.id.startsWith('app:')) continue;
      if (j.predicted && j.item && !predictions.has(j.id)) predictions.set(j.id, { id: j.id, at: Number(j.at) || 0, kind: String(j.item.kind ?? 'altro'), area: String(j.item.area ?? ''), harness: String(j.item.harness ?? ''), model: j.item.model ?? null, source: String(j.predicted.value?.source ?? 'table') });
      if (j.actual && Number.isFinite(j.actual.usd)) actuals.set(j.id, { usd: Number(j.actual.usd) });
    } catch { /* a torn line */ }
  }
  return { predictions: [...predictions.values()], actuals };
}

const areas = (r: RoutingRow): string[] => (r.area === undefined ? [] : Array.isArray(r.area) ? r.area : [r.area]);
/** The row of `routes` a prediction was decided by (same rule as routing.match: the first row of its kind and area). */
export function rowOf(routes: RoutingRow[], p: Pick<Prediction, 'kind' | 'area'>): number {
  const exact = routes.findIndex(r => r.kind === p.kind && (!areas(r).length || areas(r).includes(p.area)));
  return exact >= 0 ? exact : routes.findIndex(r => r.kind === '*' && (!areas(r).length || areas(r).includes(p.area)));
}
const verified = (r: AgentRun | undefined) => !!r?.outcome && (r.outcome.basis === 'human' || r.outcome.basis === 'reviewed-evidence') && r.outcome.verdict !== 'unknown';
function result(ids: string[], actuals: Map<string, Actual>, runByChat: Map<string, AgentRun>): RouteResult {
  const runs = ids.map(id => runByChat.get(id.slice(4))).filter(verified) as AgentRun[];
  const costs = ids.map(id => actuals.get(id)?.usd).filter((x): x is number => typeof x === 'number');
  return { runs: ids.length, success: { value: runs.length ? runs.filter(r => r.outcome!.verdict === 'success').length / runs.length : null, n: runs.length },
    avgCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null };
}
/** ISO week label "2026-W42" of a time. */
export function weekOf(ms: number): string {
  const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = d.getUTCFullYear(), w = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86400e3 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
const lastWeeks = (now: number, n: number) => Array.from({ length: n }, (_, i) => weekOf(now - (n - 1 - i) * 7 * 86400e3));

export async function classifiersState(i: ClassifierInputs, now = Date.now()): Promise<ClassifiersState> {
  const table = i.routing.table, routes = table?.routes ?? [];
  const { predictions, actuals } = readLedger(i.root);
  const runByChat = new Map(i.runs.map(r => [r.chatId, r]));
  const perRow = routes.map(() => [] as string[]);
  for (const p of predictions) { if (p.source !== 'table') continue; const k = rowOf(routes, p); if (k >= 0) perRow[k]!.push(p.id); }
  const rows: ClassifierRoute[] = routes.map((r, k) => ({ kind: r.kind, area: areas(r).join(', ') || null, harness: r.harness, model: r.model, effort: r.effort, why: r.why, result: result(perRow[k]!, actuals, runByChat) }));
  // agent choice: the latest runs with a routing snapshot
  const name = (id: string) => i.profiles.find(p => p.id === id)?.name ?? id;
  const recent = i.runs.filter(r => r.routing && r.goal.trim()).sort((a, b) => b.startedAt - a.startedAt).slice(0, 15);
  const choices: ClassifierChoice[] = [];
  for (const r of recent) {
    const top = await i.top(r.goal).catch(() => null);
    choices.push({ at: r.startedAt, chatId: r.chatId, goal: r.goal.slice(0, 240), suggested: top ? { id: top.id, name: name(top.id), score: Math.round(top.score) } : null,
      used: { id: r.agentId, name: name(r.agentId), score: r.routing!.score === null ? null : Math.round(r.routing!.score), rank: r.routing!.rank, mode: r.routing!.mode } });
  }
  // quality by week: per route (its predictions) and per classifier channel (the runs routed with it)
  const weeks = lastWeeks(now, 6);
  const quality: ClassifiersState['quality'] = rows.map((row, k) => ({ key: `route:${k}`, label: `${row.kind}${row.area ? ` · ${row.area}` : ''} → ${row.model}`,
    weeks: weeks.map(w => { const ids = perRow[k]!.filter(id => weekOf(predictions.find(p => p.id === id)!.at) === w), res = result(ids, actuals, runByChat); return { week: w, runs: res.runs, success: res.success.value, avgCostUsd: res.avgCostUsd }; }) }));
  for (const mode of ['words', 'hybrid'] as const) {
    const runs = i.runs.filter(r => r.routing?.mode === mode);
    quality.push({ key: `agent:${mode}`, label: mode === 'words' ? 'Scelta agente · parole' : 'Scelta agente · ibrido', weeks: weeks.map(w => {
      const inWeek = runs.filter(r => weekOf(r.startedAt) === w), ok = inWeek.filter(verified), costs = inWeek.map(r => r.costUsd).filter((x): x is number => typeof x === 'number');
      return { week: w, runs: inWeek.length, success: ok.length ? ok.filter(r => r.outcome!.verdict === 'success').length / ok.length : null, avgCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null };
    }) });
  }
  return {
    routing: { version: table?.version ?? null, appliedAt: table?.appliedAt ?? null, by: table?.by ?? null, routes: rows, error: i.routing.error },
    history: i.routing.history.map(h => ({ at: h.at, from: h.from, to: h.to, by: h.by, reason: h.reason, evidence: h.evidence })),
    choices, quality,
  };
}
