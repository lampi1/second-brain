// Agent XP and the level curve (main/agents/xp.ts, ADR 0131): a job's XP from its size (turns, working time, files
// changed, delegated chats), bounded 1..5, a missing signal adding nothing; the curve quick at first (Lv 2 after about 3
// typical jobs) and long at the top (Lv 100 after years of real use).
import { describe, expect, it } from 'vitest';
import { FLASH_XP, MAX_LEVEL, XP_MAX, XP_MIN, jobSignals, jobXp, levelOf, levelStart } from '../../../src/main/agents/xp';
import type { AgentRun } from '../../../src/shared/agents';

const receipts = (files: number): NonNullable<AgentRun['receipts']> => ({ commands: [], more: 0, files: Array.from({ length: Math.min(files, 15) }, (_, i) => `f${i}.ts`), filesMore: Math.max(0, files - 15),
  filesKnown: true, filesGap: false, testsTouched: false, codeTouched: true, lastChangeAt: null, commits: 0, prs: 0 });

describe('job XP', () => {
  it('is 1 for a quick job and 5 for a long delegated build, in half points', () => {
    expect(jobXp({ children: 0 })).toBe(XP_MIN);
    expect(jobXp({ turns: 1, minutes: 2, files: 0, children: 0 })).toBe(1);
    expect(jobXp({ turns: 3, minutes: 10, files: 3, children: 0 })).toBe(2.5);   // a typical job
    expect(jobXp({ turns: 8, minutes: 40, files: 10, children: 3 })).toBe(XP_MAX);
    expect(jobXp({ turns: 80, minutes: 900, files: 400, children: 30 })).toBe(XP_MAX); // bounded
  });
  it('reads the signals from the run; a signal not recorded adds nothing (old runs keep their floor)', () => {
    expect(jobSignals({ turns: 5, executionMs: 20 * 60_000, receipts: receipts(12) }, 2)).toEqual({ turns: 5, minutes: 20, files: 12, children: 2 });
    expect(jobSignals({}, 0)).toEqual({ children: 0 });
    expect(jobSignals({ receipts: { ...receipts(12), filesKnown: false } }, 0)).toEqual({ children: 0 }); // files not known
    expect(jobXp(jobSignals({ turns: 5, executionMs: 20 * 60_000, receipts: receipts(12) }, 2))).toBe(3.5);
  });
});

describe('level curve', () => {
  it('Lv 2 after about 3 typical jobs, Lv 10 after about a month, Lv 100 after years at a typical pace', () => {
    expect(levelStart(2)).toBe(6);
    expect(levelOf(3 * 2).level).toBe(2);               // three jobs of 2 XP
    expect(levelOf(2 * 2.5).level).toBe(1);             // two typical jobs are not enough
    const perDay = 10, workDays = 220;                  // about 4 verified jobs of 2.5 XP a working day
    expect(levelStart(5) / perDay).toBeLessThanOrEqual(7);
    expect(levelStart(10) / perDay).toBeGreaterThan(15);
    expect(levelStart(10) / perDay).toBeLessThan(25);
    expect(levelStart(MAX_LEVEL) / perDay / workDays).toBeGreaterThan(4);
    expect(levelStart(MAX_LEVEL) / perDay / workDays).toBeLessThan(5);
  });
  it('rises at every level and tops at Lv 100', () => {
    for (let l = 2; l <= MAX_LEVEL; l++) expect(levelStart(l)).toBeGreaterThan(levelStart(l - 1));
    expect(levelOf(levelStart(MAX_LEVEL))).toMatchObject({ level: MAX_LEVEL, nextAt: null, progress: 1 });
    expect(levelOf(levelStart(MAX_LEVEL) - 0.5)).toMatchObject({ level: MAX_LEVEL - 1 });
    expect(levelOf(-3)).toMatchObject({ level: 1 });
    expect(levelOf(Number.NaN)).toMatchObject({ level: 1 });
  });
  it('a Flash answer is a small share of a job', () => {
    expect(FLASH_XP).toBeLessThan(XP_MIN);
    expect(FLASH_XP).toBeGreaterThan(0);
  });
});
