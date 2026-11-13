// The task estimates of the Grindhouse strips (ADR 0087; owner, 2026-10-19: «stime leggibili
// … e il progresso dei classificatori nelle stime»). One shared read of IPC agents:estimates for every run the chats in
// the store carry: read when mounted and after a run starts or ends. No periodic backtest while the data is unchanged. The pure part
// (the texts, the accuracy summary) is pinned by test/unit/run-estimates.test.ts; the components are in
// components/RunEstimate.tsx.
import { useEffect, useState } from 'react';
import type { ChatSummary } from '@shared/contract';
import type { EstimateAccuracy, RunEstimates, TaskEstimate } from '@shared/task-estimate';
import { formatCost, minutes } from './format';
import { sb } from '../sb';
import { app } from '../store/store';

const SOON_MS = 400, IDS_MAX = 200;

/** "~4 min" and "~0,12 $" of an estimate (null where it has no figure). */
export function estimateText(e: Pick<TaskEstimate, 'timeMs' | 'costUsd'>): { time: string | null; cost: string | null } {
  return { time: e.timeMs === null ? null : `~${minutes(e.timeMs)}`, cost: e.costUsd === null ? null : `~${formatCost(e.costUsd)}` };
}

/** The runs whose estimates the store's chats need, most recent first, and a key that changes when one starts or ends. */
export function runIdsOf(chats: readonly (ChatSummary | undefined)[]): { ids: string[]; key: string } {
  const runs = chats.flatMap(c => (c?.run ? [c.run] : [])).sort((a, b) => b.startedAt - a.startedAt).slice(0, IDS_MAX);
  return { ids: runs.map(r => r.runId), key: JSON.stringify(runs.map(r => [r.runId, r.startedAt, r.agentId, r.goal, ...(r.endedAt === undefined ? [] : [r.endedAt, r.endReason, r.executionMs, r.costUsd])])) };
}

export interface AccuracySummary { pct: number; k: number; n: number; weeks: number; specificPct: number | null; bars: { weekStart: number; pct: number | null; n: number }[] }

/** The accuracy as the UI says it: k of n estimates within ×2 (and the share), the last week's share on the most
 *  specific match, one bar per week (each with its n). No trend in points (ADR 0101). Null before any estimate could
 *  be checked. */
export function accuracySummary(a: EstimateAccuracy | undefined | null): AccuracySummary | null {
  if (!a || a.hitRate === null || !a.n) return null;
  const withData = a.points.filter(p => p.hitRate !== null);
  const last = withData[withData.length - 1];
  return {
    pct: Math.round(a.hitRate * 100), k: a.hits ?? Math.round(a.hitRate * a.n), n: a.n,
    weeks: withData.length,
    specificPct: last?.specificShare == null ? null : Math.round(last.specificShare * 100),
    bars: a.points.map(p => ({ weekStart: p.weekStart, pct: p.hitRate === null ? null : Math.round(p.hitRate * 100), n: p.n })),
  };
}

// ── the shared read ─────────────────────────────────────────────────────────────────────────────────────────────────
let cache: RunEstimates | null = null, users = 0, key = '';
let soon: ReturnType<typeof setTimeout> | null = null, unsub: (() => void) | null = null;
let chats = app.get().chats, generation = 0;
const listeners = new Set<() => void>();
const read = () => {
  const now = runIdsOf(Object.values(app.get().chats));
  key = now.key;
  const request = ++generation;
  void sb.invoke('agents:estimates', { runIds: now.ids }).then(value => { if (request === generation && users) { cache = value; listeners.forEach(f => f()); } }, () => {});
};
const onStore = () => {
  if (chats === app.get().chats) return;
  chats = app.get().chats;
  if (soon || runIdsOf(Object.values(app.get().chats)).key === key) return;
  soon = setTimeout(() => { soon = null; read(); }, SOON_MS);
};
const onVisible = () => { if (document.visibilityState === 'visible' && users) read(); };

/** Every shown run's estimate and the estimator's accuracy, shared by all strips (null until the first read). */
export function useRunEstimates(): RunEstimates | null {
  const [value, setValue] = useState(cache);
  useEffect(() => {
    const update = () => setValue(cache);
    listeners.add(update);
    if (users++ === 0) { chats = app.get().chats; read(); unsub = app.subscribe(onStore); document.addEventListener('visibilitychange', onVisible); }
    return () => {
      listeners.delete(update);
      if (--users === 0) { generation++; if (soon) clearTimeout(soon); unsub?.(); soon = null; unsub = null; document.removeEventListener('visibilitychange', onVisible); }
    };
  }, []);
  return value;
}
