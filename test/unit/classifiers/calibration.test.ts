// Threshold calibration of the agent classifier (src/main/agents/classifier-calibration.ts): which runs count (confirmed
// successes of a routable specialist, per channel), the split-conformal quantile, the pending rule, and the store that
// changes only on a decision (apply, dismiss, reset) and survives a restart.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentProfile, AgentRun } from '../../../src/shared/agents';
import { AgentClassifier } from '../../../src/main/agents/classifier';
import { ClassifierTuning, calibrate, conformalLower } from '../../../src/main/agents/classifier-calibration';

const profile = (id: string, extra: Partial<AgentProfile> = {}) => ({ id, name: id, purpose: id, instructions: '', manifest: {}, status: 'active', activeVersion: 1, ...extra } as AgentProfile);
const PROFILES = [profile('dba'), profile('writer'), profile('default-general'), profile('pulse', { routable: false })];
let seq = 0;
function run(score: number | null, o: { agentId?: string; mode?: 'hybrid' | 'words'; verdict?: 'success' | 'fail'; basis?: 'human' | 'reviewed-evidence' | 'self-report'; rank?: number } = {}): AgentRun {
  const agentId = o.agentId ?? 'dba';
  return { agentId, version: 1, runId: `r_${++seq}`, goal: 'x', endedAt: 1,
    routing: { at: 0, agentId, version: 1, mode: o.mode ?? 'hybrid', score, rank: score === null ? null : o.rank ?? 1 },
    outcome: { verdict: o.verdict ?? 'success', basis: o.basis ?? 'human', at: 1, by: 'user' } } as AgentRun;
}
const many = (scores: number[], o: Parameters<typeof run>[1] = {}) => scores.map(s => run(s, o));

describe('conformal lower bound', () => {
  it('takes the ⌊α(n+1)⌋-th smallest score, at least the smallest', () => {
    expect(conformalLower([])).toBeNull();
    expect(conformalLower([50, 40, 90])).toBe(40);
    // n = 19, α = 0.1: ⌊2⌋ = the 2nd smallest
    expect(conformalLower([10, 20, ...Array(17).fill(80)])).toBe(20);
    expect(conformalLower(Array.from({ length: 29 }, (_, i) => i + 1), 0.2)).toBe(6);
  });
});

describe('calibrate', () => {
  it('counts only confirmed successes of routable specialists scored by this channel; unranked = 0', () => {
    const runs = [...many(Array(20).fill(80)), run(null), run(70, { mode: 'words' }), run(10, { verdict: 'fail' }), run(10, { basis: 'self-report' }),
      run(10, { agentId: 'default-general' }), run(10, { agentId: 'pulse' }), run(10, { agentId: 'gone' })];
    const c = calibrate('hybrid', runs, PROFILES);
    expect(c).toMatchObject({ mode: 'hybrid', n: 21, threshold: 60, defaultThreshold: 60, approved: null });
    expect(c.suggested).toBe(80);
    expect(c.coverageNow).toBeCloseTo(20 / 21);
    expect(calibrate('words', runs, PROFILES).n).toBe(1);
  });
  it('suggests nothing below the minimum; pending only when far enough and not dismissed', () => {
    expect(calibrate('hybrid', many(Array(19).fill(90)), PROFILES)).toMatchObject({ suggested: null, pending: false, n: 19 });
    const runs = many([...Array(18).fill(70), 44, 45]);
    expect(calibrate('hybrid', runs, PROFILES)).toMatchObject({ suggested: 45, pending: true, coverageNow: 0.9, coverageSuggested: 0.95 });
    expect(calibrate('hybrid', runs, PROFILES, { dismissed: 45 }).pending).toBe(false);
    expect(calibrate('hybrid', runs, PROFILES, { approved: 48 })).toMatchObject({ threshold: 48, pending: false });
    expect(calibrate('hybrid', runs, PROFILES).rank1).toBe(1);
  });
});

describe('ClassifierTuning', () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-cls-')), 'agent-classifier.json');
  it('applies, survives a restart, resets; a dismissal must name the suggestion in force', () => {
    const file = tmp(), runs = many([...Array(18).fill(70), 44, 45]);
    const t = new ClassifierTuning(file, () => ({ runs, profiles: PROFILES }));
    expect(t.thresholds()).toEqual({ hybrid: 60, words: 20 });
    expect(() => t.decide({ mode: 'hybrid', decision: 'dismiss', value: 50 })).toThrow(/changed/);
    t.decide({ mode: 'hybrid', decision: 'apply', value: 45 });
    expect(new ClassifierTuning(file, () => ({ runs, profiles: PROFILES })).thresholds().hybrid).toBe(45);
    t.decide({ mode: 'hybrid', decision: 'reset' });
    expect(t.thresholds().hybrid).toBe(60);
    t.decide({ mode: 'hybrid', decision: 'dismiss', value: 45 });
    expect(t.read()[0]!.pending).toBe(false);
    expect(() => t.decide({ mode: 'nope' as never, decision: 'reset' })).toThrow(/mode/);
    expect(() => t.decide({ mode: 'words', decision: 'apply', value: 0 })).toThrow(/value/);
  });
  it('a broken file means defaults; the classifier uses the threshold in force for its channel', async () => {
    const file = tmp(); fs.writeFileSync(file, '{oops');
    const t = new ClassifierTuning(file, () => ({ runs: [], profiles: [] }));
    expect(t.thresholds()).toEqual({ hybrid: 60, words: 20 });
    const strict = new AgentClassifier(undefined, 10, () => ({ hybrid: 60, words: 99 }));
    const r = await strict.classify('dba', [profile('dba')], []);
    expect(r).toMatchObject({ mode: 'words', threshold: 99, noneCloseEnough: true });
  });
});
