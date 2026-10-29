// Prediction-powered inference and the judges' agreement (src/shared/ppi.ts, ADR 0197), and their per-role reading of
// the agent runs (src/main/agents/judge-agreement.ts): the rectifier corrects a biased judge, no estimate under 5
// pairs, the interval from both variances, Cohen's kappa against hand-computed values, the Sentinel's reviews and the
// receipts as the automatic judgment, the user's verdict as the human one.
import { describe, expect, it } from 'vitest';
import { MIN_PAIRS, agreementOf, ppiMean } from '../../../src/shared/ppi';
import { roleJudges } from '../../../src/main/agents/judge-agreement';
import { runMetrics } from '../../../src/main/agents/run-metrics';
import type { AgentRun, AgentRunReceipts } from '../../../src/shared/agents';

describe('ppiMean', () => {
  it('no estimate under MIN_PAIRS pairs', () => {
    expect(MIN_PAIRS).toBe(5);
    expect(ppiMean([1, 1, 1], [{ human: 1, auto: 1 }, { human: 0, auto: 1 }, { human: 1, auto: 1 }, { human: 1, auto: 1 }])).toBeNull();
  });

  it('the rectifier removes a judge that is too kind', () => {
    // the judge says success on all 20 unlabeled runs; on the 5 pairs the user failed 2 of its successes
    const pairs = [{ human: 1, auto: 1 }, { human: 0, auto: 1 }, { human: 1, auto: 1 }, { human: 0, auto: 1 }, { human: 1, auto: 1 }];
    const e = ppiMean(Array(20).fill(1), pairs)!;
    expect(e.autoMean).toBe(1);
    expect(e.rectifier).toBeCloseTo(-0.4);
    expect(e.value).toBeCloseTo(0.6);
    // var(auto) = 0, var(diff) = 0.3 → half = 1.645·sqrt(0.3/5)
    expect(e.high - e.value).toBeCloseTo(1.645 * Math.sqrt(0.3 / 5));
    expect(e).toMatchObject({ n: 5, unlabeled: 20 });
  });

  it('with no unlabeled run it is the human mean; the interval stays within 0..1', () => {
    const e = ppiMean([], Array(6).fill({ human: 1, auto: 0 }))!;
    expect(e).toMatchObject({ value: 1, low: 1, high: 1, unlabeled: 0 });
  });
});

describe('agreementOf', () => {
  it('share and Cohen\'s kappa (hand-computed)', () => {
    // 10 pairs: 7 equal; marginals a: s6 f4, b: s5 f5 → pe = .6·.5 + .4·.5 = .5; κ = (.7 − .5)/.5 = .4
    const pairs: [string, string][] = [['s', 's'], ['s', 's'], ['s', 's'], ['s', 's'], ['s', 'f'], ['s', 'f'], ['f', 'f'], ['f', 'f'], ['f', 'f'], ['f', 's']];
    const a = agreementOf(pairs);
    expect(a).toMatchObject({ n: 10, agree: 7, share: 0.7 });
    expect(a.kappa).toBeCloseTo(0.4);
  });
  it('no pair → nothing; one category only → no kappa', () => {
    expect(agreementOf([])).toEqual({ n: 0, agree: 0, share: null, kappa: null });
    expect(agreementOf([['s', 's'], ['s', 's']])).toMatchObject({ share: 1, kappa: null });
  });
});

const NOW = Date.UTC(2026, 9, 29, 12);
let seq = 0;
const run = (over: Partial<AgentRun> = {}): AgentRun => ({ runId: `r_${String(++seq).padStart(12, '0')}`, chatId: `c_${seq}`, agentId: 'artisan', version: 1, goal: 'x',
  startedBy: 'user', startedAt: NOW - 7200_000, endedAt: NOW - 3600_000, endReason: 'completed',
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 0.1, tokens: null, ...over });
const human = (verdict: 'success' | 'partial' | 'fail') => ({ verdict, basis: 'human' as const, at: NOW, by: 'user' });
const review = (of: AgentRun, verdict: 'success' | 'partial' | 'fail') => run({ agentId: 'sentinel', reviewOf: of.runId, report: { at: NOW, outcome: 'done', verified: 'yes', summary: 's', verdict } });
const passed: AgentRunReceipts = { commands: [{ cmd: 'npm test', exit: 0, at: NOW - 4000_000, check: true }], more: 0, files: ['src/a.ts'], filesMore: 0, filesKnown: true, filesGap: false,
  testsTouched: false, codeTouched: true, lastChangeAt: NOW - 5000_000, commits: 0, prs: 0, verdict: { result: 'pass', reason: 'checks-passed', at: NOW } };

describe('roleJudges', () => {
  it('the Sentinel\'s review, else the receipts, is the automatic judgment; the user\'s verdict the human one', () => {
    const runs: AgentRun[] = [];
    // 5 runs judged by both: the Sentinel passes them all, the user fails one
    for (const v of ['success', 'success', 'success', 'success', 'fail'] as const) { const r = run({ outcome: human(v) }); runs.push(r, review(r, 'success')); }
    // 4 runs judged only by their receipts (a full report and passing checks)
    for (let i = 0; i < 4; i++) runs.push(run({ receipts: passed, report: { at: NOW, outcome: 'done', verified: 'yes', summary: 's', via: 'agent_report' } }));
    // one run nobody judged
    runs.push(run());
    const j = roleJudges(runs).get('artisan')!;
    expect(j).toMatchObject({ pairs: 5, autoOnly: 4, human: 5 });
    expect(j.ppi!.value).toBeCloseTo(0.8); // 1 + (−0.2)
    expect(j.sentinel).toMatchObject({ n: 5, agree: 4, share: 0.8 });
    // the Sentinel's own review runs are not judged as its work
    expect(roleJudges(runs).get('sentinel')).toBeUndefined();
    // and runMetrics hands it on the all-versions row only
    const m = runMetrics(runs, { now: NOW }).find(x => x.agentId === 'artisan')!;
    expect(m.all?.judges?.pairs).toBe(5);
    expect(m.versions[0]!.judges).toBeUndefined();
  });
});
