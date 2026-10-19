// The task estimates of the Grindhouse strips and the Orchestrator's plan (ADR 0087; owner, 2026-10-19: «stime leggibili
// … e il progresso dei classificatori nelle stime»). One shared read of IPC agents:estimates for every run the chats in
// the store carry: refreshed every minute while something shows it, and soon after a run starts or ends. The pure part
// (the texts, the plan rows, the accuracy summary) is pinned by test/unit/run-estimates.test.ts; the components are in
// components/RunEstimate.tsx.
import { useEffect, useState } from 'react';
import type { ChatSummary } from '@shared/contract';
import type { EstimateAccuracy, RunEstimates, RunEstimateView, TaskEstimate } from '@shared/task-estimate';
import { formatCost, minutes } from './format';
import { sb } from '../sb';
import { app } from '../store/store';

const REFRESH_MS = 60_000, SOON_MS = 400, IDS_MAX = 200;

/** "~4 min" and "~0,12 $" of an estimate (null where it has no figure). */
export function estimateText(e: Pick<TaskEstimate, 'timeMs' | 'costUsd'>): { time: string | null; cost: string | null } {
  return { time: e.timeMs === null ? null : `~${minutes(e.timeMs)}`, cost: e.costUsd === null ? null : `~${formatCost(e.costUsd)}` };
}

/** The runs whose estimates the store's chats need, most recent first, and a key that changes when one starts or ends. */
export function runIdsOf(chats: readonly (ChatSummary | undefined)[]): { ids: string[]; key: string } {
  const runs = chats.flatMap(c => (c?.run ? [c.run] : [])).sort((a, b) => b.startedAt - a.startedAt).slice(0, IDS_MAX);
  return { ids: runs.map(r => r.runId), key: runs.map(r => `${r.runId}:${r.endedAt ?? ''}`).join(',') };
}

export interface PlanRow { chat: ChatSummary; view: RunEstimateView | null; ended: boolean }
export interface Plan { rows: PlanRow[]; timeMs: number; costUsd: number; estimated: number; quick: number }

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** The Orchestrator's plan: the agent runs it started today, newest first, with their estimates and the sum of them. */
export function planOf(chats: readonly (ChatSummary | undefined)[], views: RunEstimates['runs'] | undefined, now: number): Plan {
  const rows = chats.filter((c): c is ChatSummary => !!c?.run && c.run.startedBy === 'orchestrator' && sameDay(c.run.startedAt, now))
    .sort((a, b) => b.run!.startedAt - a.run!.startedAt)
    .map(chat => ({ chat, view: views?.[chat.run!.runId] ?? null, ended: chat.run!.endedAt !== undefined }));
  let timeMs = 0, costUsd = 0, estimated = 0, quick = 0;
  for (const r of rows) {
    const e = r.view?.estimate;
    if (!e) continue;
    estimated++;
    timeMs += e.timeMs ?? 0; costUsd += e.costUsd ?? 0;
    if (e.quick && e.path !== 'tree') quick++;
  }
  return { rows, timeMs, costUsd, estimated, quick };
}

export interface AccuracySummary { pct: number; n: number; trendPts: number | null; weeks: number; specificPct: number | null; bars: { weekStart: number; pct: number | null; n: number }[] }

/** The accuracy as the UI says it: the share that held, the change in points over the weeks with data, the last week's
 *  share on the most specific match, one bar per week. Null before any estimate could be checked. */
export function accuracySummary(a: EstimateAccuracy | undefined | null): AccuracySummary | null {
  if (!a || a.hitRate === null || !a.n) return null;
  const withData = a.points.filter(p => p.hitRate !== null);
  const last = withData[withData.length - 1];
  return {
    pct: Math.round(a.hitRate * 100), n: a.n,
    trendPts: a.trend === null ? null : Math.round(a.trend * 100),
    weeks: withData.length,
    specificPct: last?.specificShare == null ? null : Math.round(last.specificShare * 100),
    bars: a.points.map(p => ({ weekStart: p.weekStart, pct: p.hitRate === null ? null : Math.round(p.hitRate * 100), n: p.n })),
  };
}

// ── the shared read ─────────────────────────────────────────────────────────────────────────────────────────────────
let cache: RunEstimates | null = null, users = 0, key = '';
let timer: ReturnType<typeof setInterval> | null = null, soon: ReturnType<typeof setTimeout> | null = null, unsub: (() => void) | null = null;
const listeners = new Set<() => void>();
const read = () => {
  const now = runIdsOf(Object.values(app.get().chats));
  key = now.key;
  void sb.invoke('agents:estimates', { runIds: now.ids }).then(value => { cache = value; listeners.forEach(f => f()); }, () => {});
};
const onStore = () => {
  if (soon || runIdsOf(Object.values(app.get().chats)).key === key) return;
  soon = setTimeout(() => { soon = null; read(); }, SOON_MS);
};

/** Every shown run's estimate and the estimator's accuracy, shared by all strips (null until the first read). */
export function useRunEstimates(): RunEstimates | null {
  const [value, setValue] = useState(cache);
  useEffect(() => {
    const update = () => setValue(cache);
    listeners.add(update);
    if (users++ === 0) { read(); timer = setInterval(read, REFRESH_MS); unsub = app.subscribe(onStore); }
    return () => {
      listeners.delete(update);
      if (--users === 0) { if (timer) clearInterval(timer); if (soon) clearTimeout(soon); unsub?.(); timer = soon = null; unsub = null; }
    };
  }, []);
  return value;
}
