// Agent standing (main/agents/standing.ts): the level curve over verified successes only (ADR 0100) and the performance %
// on the agent card — trust of each kind of verdict (the agent's own word weighs nothing), recency weighting, the "in
// rodaggio" threshold and the exclusions shared with the §5 metrics.
import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../../../src/shared/agents';
import { HALF_LIFE_MS, MIN_RUNS, levelOf, levelStart, orchestratorDecision, standings, verdictOf, withStandings } from '../../../src/main/agents/standing';
import { emptyTally, mergeTallies, rollUp } from '../../../src/main/agents/run-metrics';
import { readTally } from '../../../src/main/agents/runs';

const NOW = Date.UTC(2026, 9, 19, 12);
let seq = 0;
const run = (over: Partial<AgentRun> = {}): AgentRun => ({ runId: `r_${String(++seq).padStart(12, '0')}`, chatId: `c_${seq}`, agentId: 'scout', version: 1, goal: 'x',
  startedBy: 'user', startedAt: NOW - 7200_000, endedAt: NOW - 3600_000, endReason: 'completed',
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 0.1, tokens: null, ...over });
const human = (verdict: 'success' | 'partial' | 'fail', at = NOW) => ({ verdict, basis: 'human' as const, at, by: 'user' });

describe('level', () => {
  it('follows the curve 0, 5, 15, 30, 50 with progress to the next level', () => {
    expect([1, 2, 3, 4, 5].map(levelStart)).toEqual([0, 5, 15, 30, 50]);
    expect(levelOf(0)).toEqual({ level: 1, levelAt: 0, nextAt: 5, progress: 0 });
    expect(levelOf(4)).toMatchObject({ level: 1, progress: 0.8 });
    expect(levelOf(5)).toMatchObject({ level: 2, levelAt: 5, nextAt: 15, progress: 0 });
    expect(levelOf(20)).toMatchObject({ level: 3, levelAt: 15, nextAt: 30 });
    expect(levelOf(20).progress).toBeCloseTo(1 / 3);
  });
  it('stops at the top level', () => {
    expect(levelOf(1e9)).toMatchObject({ level: 50, nextAt: null, progress: 1 });
  });
});

describe('verdictOf', () => {
  it('prefers the user, then a review, then the facts, then the Orchestrator, then the agent itself', () => {
    const r = run({ outcome: { verdict: 'fail', basis: 'orchestrator-opinion', at: NOW, by: 'o' }, report: { at: NOW, outcome: 'done', verified: 'yes', summary: 's' } });
    const review = run({ agentId: 'sentinel', reviewOf: r.runId, report: { at: NOW, outcome: 'done', verified: 'yes', summary: 's', verdict: 'partial' } });
    expect(verdictOf(r, [review])).toEqual({ source: 'review', verdict: 'partial' });
    expect(verdictOf(r, [{ ...review, report: { ...review.report!, verified: 'no' } }])).toEqual({ source: 'orchestrator', verdict: 'fail' });
    expect(verdictOf({ ...r, outcome: { verdict: 'fail', basis: 'reviewed-evidence', at: NOW, by: 'judge-sample' } }, [])).toEqual({ source: 'review', verdict: 'fail' });
    expect(verdictOf(r)).toEqual({ source: 'orchestrator', verdict: 'fail' });
    expect(verdictOf({ ...r, outcome: human('success') }, [review])).toEqual({ source: 'human', verdict: 'success' });
    expect(verdictOf({ ...r, outcome: undefined })).toEqual({ source: 'self', verdict: 'success' });
    expect(verdictOf(run({ outcome: { verdict: 'unknown', basis: 'human', at: NOW, by: 'u' } }))).toBeNull();
  });
});

describe('standings', () => {
  it('stays "in rodaggio" (null) below the minimum of judged runs', () => {
    const runs = Array.from({ length: MIN_RUNS - 1 }, () => run({ outcome: human('success') }));
    const s = standings([...runs, run(), run()], [], NOW).get('scout')!;
    expect(s).toMatchObject({ runs: MIN_RUNS + 1, wins: MIN_RUNS - 1, level: 1, performance: null, evaluated: MIN_RUNS - 1, minRuns: MIN_RUNS });
  });
  it('weights verdicts by trust: the agent\'s own word weighs nothing, and is not counted as judged', () => {
    const runs = [
      ...Array.from({ length: 5 }, () => run({ outcome: human('success') })),
      run({ outcome: { verdict: 'fail', basis: 'self-report', at: NOW, by: 'scout' } }),
      run({ report: { at: NOW, outcome: 'blocked', verified: 'no', summary: 's' } }), // a blocked report: a fact, not a self-report
      run({ report: { at: NOW, outcome: 'partial', verified: 'partial', summary: 's' } }),
      run({ outcome: { verdict: 'partial', basis: 'orchestrator-opinion', at: NOW, by: 'o' } }),
    ];
    const s = standings(runs, [], NOW + 3600_000).get('scout')!;
    // 5 × 1 + fact fail 0 + opinion 0.6 × 0.5, over 5 + 1 + 0.6 (same age for all)
    expect(s.performance).toBeCloseTo((5 + 0.3) / 5.6);
    expect(s).toMatchObject({ evaluated: 6, sources: { human: 5, review: 0, facts: 0, orchestrator: 1, self: 3 } });
  });
  it('levels up only on verified successes: never on failed, unverified, provisional or self-reported runs (ADR 0100)', () => {
    const clean = (endedAt: number) => run({ endedAt, startedAt: endedAt - 1000, corrections: { tagged: 0, afterReport: 0 }, report: { at: endedAt, outcome: 'done', verified: 'yes', summary: 's', via: 'agent_report' } });
    const runs = [
      ...Array.from({ length: 3 }, () => run({ outcome: human('success') })),
      ...Array.from({ length: 2 }, () => clean(NOW - 8 * 86_400_000)),                    // settled facts
      clean(NOW - 86_400_000),                                                           // provisional: not yet
      run({ outcome: human('fail') }), run({ outcome: human('partial') }),
      run({ outcome: { verdict: 'success', basis: 'orchestrator-opinion', at: NOW, by: 'o' } }),
      run({ outcome: { verdict: 'success', basis: 'self-report', at: NOW, by: 'scout' } }),
      ...Array.from({ length: 20 }, () => run()),                                          // ended without a verdict
    ];
    const s = standings(runs, [], NOW).get('scout')!;
    expect(s).toMatchObject({ runs: 30, wins: 3, level: 1, levelAt: 0, nextAt: 5 });
    // a rework within the 7 days turns a settled success into a failure, and it leaves the level
    const reworked = clean(NOW - 9 * 86_400_000), again = run({ reworkOf: reworked.runId, startedAt: NOW - 8 * 86_400_000 });
    expect(standings([reworked, again], [], NOW).get('scout')!.wins).toBe(0);
  });
  it('weights verdicts by recency: a 30-day-old fail weighs half of a fresh success', () => {
    const fresh = Array.from({ length: 4 }, () => run({ endedAt: NOW, outcome: human('success') }));
    const old = run({ endedAt: NOW - HALF_LIFE_MS, outcome: human('fail') });
    expect(standings([...fresh, old], [], NOW).get('scout')!.performance).toBeCloseTo(4 / 4.5);
  });
  it('counts rolled-up verified successes for the level, open and headline runs for nothing', () => {
    const t = { ...emptyTally('scout', 1), ended: 12, verdicts: { success: 6, partial: 1, fail: 2 } };
    const s = standings([run({ endedAt: undefined }), run({ oneshot: { engine: 'claude', job: 'headline', fallback: false, costBasis: 'reported' } }), run({ outcome: human('success') })], [t], NOW).get('scout')!;
    expect(s).toMatchObject({ runs: 13, wins: 7, level: 2 });
    expect(standings([run({ endedAt: undefined })], [], NOW).has('scout')).toBe(false);
  });
});

describe('the Orchestrator\'s standing (issue #112, ADR 0097)', () => {
  it('counts each ended root run it opened as one of its decisions, rated with that run\'s verdict', () => {
    const mine = [...Array(5)].map((_, i) => run({ agentId: i % 2 ? 'artisan' : 'scout', startedBy: 'orchestrator', outcome: human(i < 4 ? 'success' : 'fail') }));
    const others = [
      run({ startedBy: 'user', outcome: human('fail') }),                               // the user's own chat
      run({ startedBy: 'parent', parentRunId: 'r_999999999999', agentId: 'scout' }),     // a delegated child
      run({ startedBy: 'orchestrator', source: 'oneshot', agentId: 'pulse' }),           // a one-shot job
      run({ startedBy: 'orchestrator', endedAt: undefined }),                            // still open
    ];
    const s = standings([...mine, ...others], [], NOW).get('orchestrator')!;
    expect(s).toMatchObject({ runs: 5, wins: 4, level: 1, evaluated: 5, sources: { human: 5, review: 0, facts: 0, orchestrator: 0, self: 0 } });
    expect(s.performance).toBeCloseTo(0.8);
    // the run still counts for its own role too
    expect(standings(mine, [], NOW).get('scout')!.runs).toBe(3);
    expect(orchestratorDecision(others[2]!)).toBe(false);
  });
  it('weighs its own verdicts on runs it opened as its own word (self) on its standing, not as Orchestrator trust', () => {
    const opinion = (verdict: 'success' | 'fail') => ({ verdict, basis: 'orchestrator-opinion' as const, at: NOW, by: 'o' });
    const mine = [...Array(5)].map(() => run({ startedBy: 'orchestrator', outcome: opinion('success') }));
    const judged = [...Array(5)].map(() => run({ startedBy: 'orchestrator', outcome: human('fail') }));
    const s = standings([...mine, ...judged], [], NOW).get('orchestrator')!;
    expect(s.sources).toEqual({ human: 5, review: 0, facts: 0, orchestrator: 0, self: 5 });
    expect(s).toMatchObject({ performance: 0, evaluated: 5, wins: 0 }); // its own word weighs nothing: only the 5 failures count
    // the role it rated keeps the Orchestrator's trust for that verdict
    expect(standings(mine, [], NOW).get('scout')!.sources.orchestrator).toBe(5);
  });
  it('keeps its decisions when the runs are pruned into the rollups', () => {
    const mine = [...Array(4)].map((_, i) => run({ startedBy: 'orchestrator', ...(i < 3 ? { outcome: human('success') } : {}) }));
    const own = run({ startedBy: 'user' });
    const rolled = rollUp([], [...mine, own], [...mine, own], NOW);
    expect(rolled).toHaveLength(1);
    expect(rolled[0]).toMatchObject({ ended: 5, decisions: 4, decisionWins: 3 });
    expect(readTally(JSON.parse(JSON.stringify(rolled[0])))).toMatchObject({ decisions: 4, decisionWins: 3 });
    expect(readTally({ ...rolled[0], decisions: -1 })).toBeNull();
    expect(readTally({ ...rolled[0], decisionWins: 5 })).toBeNull(); // more wins than decisions
    expect(mergeTallies(rolled[0]!, rolled[0]!)).toMatchObject({ decisions: 8, decisionWins: 6 });
    const kept = run({ startedBy: 'orchestrator', outcome: human('success') });
    expect(standings([kept], rolled, NOW).get('orchestrator')).toMatchObject({ runs: 5, wins: 4 });
    expect(standings([kept], rolled, NOW).get('scout')).toMatchObject({ runs: 6, wins: 4 });
  });
  it('gives the Orchestrator a card entry even without metrics of its own', () => {
    const list = withStandings([], standings([run({ startedBy: 'orchestrator' })], [], NOW));
    expect(list.map(m => m.agentId)).toEqual(['orchestrator', 'scout']);
    expect(list[0]).toMatchObject({ versions: [], all: null, open: 0, standing: { runs: 1, level: 1 } });
  });
});
