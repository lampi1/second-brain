// Agent XP and the level curve (ADR 0131). A verified success earns XP by the size of the job, read from the run
// itself with no model: its settled turns, its working time, the files its turns changed (receipts, ADR 0130) and the
// chats it delegated. Each of the four signals adds 0, 0.5 or 1 to a base of 1: a job earns 1..5 XP (a quick lookup 1,
// a typical job 2–2.5, a long delegated build 4–5). A missing signal (a run recorded before it was measured) adds
// nothing: old runs keep counting, at their floor. The curve: Lv L starts at round(6 × (L − 1)^1.6) XP, Lv 2 at 6 XP
// (about 3 typical jobs), Lv 10 at 202, Lv 20 at 667, Lv 50 at 3 037, Lv 100 (the top) at 9 358: at a typical pace of
// 10 XP a working day (about 4 verified jobs) that is a week to Lv 5, a month to Lv 10, about 4 years to Lv 100.
// Pure: used by standing.ts (the card's level), run-metrics.ts rollUp (XP kept for pruned runs) and the levels
// diagnostic (level-diagnosis.ts); pinned by test/unit/agents/xp.test.ts.
import type { AgentRun } from '../../shared/agents';

export const MAX_LEVEL = 100;
/** XP where Lv 2 starts, and the curve's exponent: levelStart(L) = round(XP_BASE × (L − 1)^XP_POWER) */
export const XP_BASE = 6;
export const XP_POWER = 1.6;
/** the bounds of one job's XP */
export const XP_MIN = 1, XP_MAX = 5;
/** a verified success pruned before XP was kept (a rollup without `xp`): its floor */
export const LEGACY_XP = XP_MIN;
/** one Flash answer that held (flash-outcomes.ts): a small share of a job */
export const FLASH_XP = 0.25;
/** a Battito (Pulse) card run that answered, with no verdict of the user on its cards (standing.ts pulseProxy) */
export const PULSE_XP = 0.25;
/** an Orchestrator decision whose Strategist plan the user approved with no change (ADR 0131) */
export const PLAN_XP = 1;

/** the signals' thresholds: [half point, full point] */
export const SIZE_BANDS = { turns: [3, 8], minutes: [10, 40], files: [3, 10], children: [1, 3] } as const;

/** XP where `level` starts (Lv 1 = 0). */
export const levelStart = (level: number): number => level <= 1 ? 0 : Math.round(XP_BASE * (level - 1) ** XP_POWER);

/** The level of `xp`, where it started, where the next one starts and the way there (0..1). */
export function levelOf(xp: number): { level: number; levelAt: number; nextAt: number | null; progress: number } {
  const n = Math.max(0, Number.isFinite(xp) ? xp : 0);
  let level = 1;
  while (level < MAX_LEVEL && levelStart(level + 1) <= n) level++;
  const levelAt = levelStart(level), nextAt = level < MAX_LEVEL ? levelStart(level + 1) : null;
  return { level, levelAt, nextAt, progress: nextAt === null ? 1 : (n - levelAt) / (nextAt - levelAt) };
}

const band = (v: number | undefined, [half, full]: readonly [number, number]): number => v === undefined ? 0 : v >= full ? 1 : v >= half ? 0.5 : 0;
/** What a job's size rests on (undefined = not recorded on that run). */
export interface JobSignals { turns?: number; minutes?: number; files?: number; children: number }
export function jobSignals(run: Pick<AgentRun, 'turns' | 'executionMs' | 'receipts'>, children: number): JobSignals {
  const rc = run.receipts;
  return {
    ...(run.turns !== undefined ? { turns: run.turns } : {}),
    ...(run.executionMs !== undefined ? { minutes: run.executionMs / 60_000 } : {}),
    ...(rc?.filesKnown ? { files: rc.files.length + rc.filesMore } : {}),
    children,
  };
}
/** A job's XP, 1..5 in half points: 1 + one point at most per signal. */
export function jobXp(s: JobSignals): number {
  const raw = XP_MIN + band(s.turns, SIZE_BANDS.turns) + band(s.minutes, SIZE_BANDS.minutes) + band(s.files, SIZE_BANDS.files) + band(s.children, SIZE_BANDS.children);
  return Math.min(XP_MAX, Math.max(XP_MIN, raw));
}
