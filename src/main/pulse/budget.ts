// Durable admission estimates for the two Battito jobs; unknown bills never masquerade as a held dollar cap.
import type { PulseBudget, PulseCostBasis } from '../../shared/pulse';
import { localDay } from '../jobs/scheduler';
export interface PulseRunRecord {
  id: string; job: 'pulse' | 'headline'; at: number; slot: string; engine: string | null;
  usd: number | null; basis: PulseCostBasis; result: string; digestHash: string;
}
const basisOf = (runs: PulseRunRecord[]): PulseCostBasis => runs.some(r => r.basis === 'unknown') ? 'unknown'
  : runs.some(r => r.basis === 'estimated') ? 'estimated' : 'reported';
export function budgetState(records: PulseRunRecord[], at: number, limitUsd: number): PulseBudget {
  const date = localDay(at), today = records.filter(r => localDay(r.at) === date && r.result !== 'skipped-unchanged' && r.result !== 'no-engine');
  const sum = (rs: PulseRunRecord[]) => rs.reduce((n, r) => n + (r.usd ?? 0), 0);
  const job = (id: 'pulse' | 'headline') => {
    const rows = today.filter(r => r.job === id);
    return { runs: rows.length, usd: sum(rows), limitUsd: limitUsd * (id === 'pulse' ? 0.8 : 0.2),
      maxRuns: id === 'pulse' ? 4 : 24, basis: basisOf(rows) };
  };
  return { date, runs: today.length, usd: sum(today), limitUsd, basis: basisOf(today), jobs: { pulse: job('pulse'), headline: job('headline') } };
}
export function admitRun(records: PulseRunRecord[], job: 'pulse' | 'headline', engine: string | null, at: number, limit: number, manual: boolean): boolean {
  const state = budgetState(records, at, limit), j = state.jobs[job];
  const today = records.filter(r => r.job === job && localDay(r.at) === state.date && !['skipped-unchanged', 'no-engine'].includes(r.result));
  if (j.runs >= j.maxRuns || job === 'pulse' && (manual ? today.some(r => r.slot === 'manual') : today.filter(r => r.slot !== 'manual').length >= 3)) return false;
  const prices = records.filter(r => r.job === job && r.engine === engine && r.usd !== null).slice(-5).map(r => r.usd!).sort((a, b) => a - b);
  const estimate = prices.length ? prices[Math.floor(prices.length / 2)]! : job === 'pulse' ? 0.02 : 0.005;
  return j.usd + estimate <= j.limitUsd + 1e-9 && state.usd + estimate <= limit + 1e-9;
}
