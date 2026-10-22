// Agent standing (main/agents/standing.ts): the level curve over verified successes only (ADR 0100) and the performance %
// on the agent card — trust of each kind of verdict (the agent's own word weighs nothing), recency weighting, the "in
// rodaggio" threshold and the exclusions shared with the §5 metrics.
import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../../../src/shared/agents';
import { HALF_LIFE_MS, MIN_RUNS, TRUST, earnIndex, earnedVerdict, levelOf, levelStart, orchestratorDecision, standings, verdictOf, withStandings } from '../../../src/main/agents/standing';
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
    expect(s).toMatchObject({ evaluated: 6, sources: { human: 5, review: 0, receipts: 0, graded: 0, facts: 0, orchestrator: 1, chain: 0, self: 3 } });
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
    expect(s).toMatchObject({ runs: 5, wins: 4, level: 1, evaluated: 5, sources: { human: 5, review: 0, receipts: 0, graded: 0, facts: 0, orchestrator: 0, chain: 0, self: 0 } });
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
    expect(s.sources).toEqual({ human: 5, review: 0, receipts: 0, graded: 0, facts: 0, orchestrator: 0, chain: 0, self: 5 });
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

// ADR 0125 (owner, 2026-10-22: "assicurati che tutti gli agenti riescano a progredire di livello ... anche senza giudizi
// manuali"): every role earns XP from verified data with no verdict of the user. Before: only a root run the Sentinel
// sampled could be verified, so a delegated child (a Scout, Artisan, Sentinel or Herald under a Strategist or an Artisan)
// and the Sentinel's own reviews (never sampled, never judged) stayed at 0 XP forever.
describe('every role progresses without a manual verdict (ADR 0125)', () => {
  const T = NOW - 30 * 86_400_000;
  const reviewed = (verdict: 'success' | 'partial' | 'fail' = 'success', at = T + 7200_000) => ({ verdict, basis: 'reviewed-evidence' as const, at, by: 'judge-sample' });
  const report = (at: number, over: Partial<NonNullable<AgentRun['report']>> = {}): NonNullable<AgentRun['report']> => ({ at, outcome: 'done', verified: 'yes', summary: 's', via: 'agent_report', ...over });
  /** a root run the Orchestrator opened, reviewed by a sampled Sentinel that agreed: verified (no hand of the user) */
  const root = (agentId: string, verdict: 'success' | 'partial' | 'fail' = 'success') => run({ agentId, startedBy: 'orchestrator', startedAt: T, endedAt: T + 3600_000, report: report(T + 3600_000), outcome: reviewed(verdict) });
  /** a delegated child that reported every criterion met before its parent ended, with no correction */
  const child = (agentId: string, parent: AgentRun, over: Partial<AgentRun> = {}) => run({ agentId, startedBy: 'parent', parentRunId: parent.runId, startedAt: T + 600_000, endedAt: T + 1800_000,
    report: report(T + 1800_000), corrections: { tagged: 0, afterReport: 0 }, ...over });
  /** the sampled Sentinel review of `of` that gave `verdict` with verified evidence */
  const review = (of: AgentRun, verdict: 'success' | 'partial' | 'fail', at = T + 7200_000) => run({ agentId: 'sentinel', startedBy: 'app', reviewOf: of.runId, startedAt: at - 600_000, endedAt: at,
    report: report(at, { verdict, via: undefined }) });
  const wins = (runs: AgentRun[], id: string) => standings(runs, [], NOW).get(id)?.wins ?? 0;

  it('orchestrator: each run it opened that a sampled review verified is one of its verified decisions', () => {
    expect(wins([root('strategist'), root('artisan'), root('scout', 'fail')], 'orchestrator')).toBe(2);
  });
  it('strategist: its root run reviewed by the switch levels it up; its own word never does', () => {
    const s = root('strategist');
    expect(wins([s], 'strategist')).toBe(1);
    expect(wins([{ ...s, outcome: { verdict: 'success', basis: 'self-report', at: T, by: 'strategist' } }], 'strategist')).toBe(0);
  });
  it('scout: a delegated child earns the chain when its parent is verified (before: 0, never sampled)', () => {
    const s = root('strategist'), c = child('scout', s);
    expect(earnedVerdict(c, earnIndex([s, c]))).toEqual({ verdict: 'success', basis: 'chain' });
    expect(wins([s, c], 'scout')).toBe(1);
    // the same child under an unverified parent: nothing (the chain rests on an independent verdict, never on silence)
    expect(wins([{ ...s, outcome: undefined }, c], 'scout')).toBe(0);
  });
  it('artisan: the chain holds through a verified parent that is itself a verified child (Strategist → Artisan → Scout)', () => {
    const s = root('strategist'), a = child('artisan', s, { endedAt: T + 3000_000, report: report(T + 3000_000) }), sc = child('scout', a, { endedAt: T + 2000_000, report: report(T + 2000_000) });
    expect(wins([s, a, sc], 'artisan')).toBe(1);
    expect(wins([s, a, sc], 'scout')).toBe(1);
  });
  it('artisan: no chain when the child was corrected, reworked, incomplete, late, judged badly by its parent or its parent failed', () => {
    const s = root('strategist');
    const cases: Partial<AgentRun>[] = [
      { corrections: { tagged: 1, afterReport: 0 } },
      { corrections: undefined },                                                        // corrections not recorded: unknown
      { counters: { questions: 0, permissions: 0, commands: 0, reopened: 1, contextPeak: null } },
      { report: report(T + 1800_000, { verified: 'partial' }) },
      { report: report(T + 1800_000, { outcome: 'partial' }) },
      { report: report(T + 1800_000, { via: undefined }) },                              // a run-report block, not agent_report
      { report: report(T + 5000_000) },                                                  // reached the parent after it ended
      { outcome: { verdict: 'fail', basis: 'orchestrator-opinion', at: T, by: 'c_strategist' } },
      { endReason: 'closed' },
    ];
    for (const over of cases) expect(wins([s, child('artisan', s, over)], 'artisan')).toBe(0);
    const reworked = child('artisan', s), again = run({ agentId: 'artisan', reworkOf: reworked.runId, startedAt: T + 4000_000 });
    expect(wins([s, reworked, again], 'artisan')).toBe(0);
    const failed = root('strategist', 'fail');
    expect(wins([failed, child('artisan', failed)], 'artisan')).toBe(0);
  });
  it('herald: a delegated child of a verified Strategist levels up too, and a partial parent gives a partial (no XP)', () => {
    const s = root('strategist');
    expect(wins([s, child('herald', s)], 'herald')).toBe(1);
    const p = root('strategist', 'partial'), hp = child('herald', p);
    expect(earnedVerdict(hp, earnIndex([p, hp]))).toEqual({ verdict: 'partial', basis: 'chain' });
    expect(wins([p, hp], 'herald')).toBe(0);
  });
  it('sentinel: its review is judged by what happened later: the user, a second review, the facts (before: 0, never judged)', () => {
    const x = root('artisan'), r = review(x, 'success');
    // nothing happened yet: no grade, no XP (its own verdict is not evidence about itself)
    expect(earnedVerdict(r, earnIndex([x, r]))).toBeNull();
    expect(wins([x, r], 'sentinel')).toBe(0);
    // the user later agrees, is one step off, or says the opposite
    for (const [user, grade] of [['success', 'success'], ['partial', 'partial'], ['fail', 'fail']] as const) {
      const xu = { ...x, outcome: human(user, T + 86_400_000) };
      expect(earnedVerdict(r, earnIndex([xu, r]))).toEqual({ verdict: grade, basis: 'graded', by: 'human' });
    }
    // a later independent second review (an audit) agrees: the first one earns its XP; the audit itself earns none
    const audit = review(x, 'success', T + 20_000_000);
    expect(earnedVerdict(r, earnIndex([x, r, audit]))).toEqual({ verdict: 'success', basis: 'graded', by: 'audit' });
    expect(earnedVerdict(audit, earnIndex([x, r, audit]))).toBeNull();
    expect(wins([x, r, audit], 'sentinel')).toBe(1);
    expect(earnedVerdict(r, earnIndex([x, r, review(x, 'fail', T + 20_000_000)]))).toEqual({ verdict: 'fail', basis: 'graded', by: 'audit' });
    // a review that started before the first one ended is not a check of it
    expect(earnedVerdict(r, earnIndex([x, r, review(x, 'success', T + 7200_000 - 1)]))).toBeNull();
    // the facts only ever grade against: it passed a run that was then reopened
    const reopened = { ...x, counters: { ...x.counters, reopened: 1 } };
    expect(earnedVerdict(r, earnIndex([reopened, r]))).toEqual({ verdict: 'fail', basis: 'graded', by: 'facts' });
    const said = review(x, 'fail');
    expect(earnedVerdict(said, earnIndex([reopened, said]))).toBeNull();
    // an unverified review (it could not check its evidence) is never graded
    const unverified = { ...r, report: { ...r.report!, verified: 'partial' as const } };
    expect(earnedVerdict(unverified, earnIndex([{ ...x, outcome: human('success') }, unverified]))).toBeNull();
  });
  it('sentinel: a delegated Sentinel (Artisan → Sentinel) earns the chain like any child', () => {
    const a = root('artisan');
    expect(wins([a, child('sentinel', a)], 'sentinel')).toBe(1);
  });
  it('weighs the chain and the grade in the performance below the user and a review, and keeps them through a prune', () => {
    const s = root('strategist'), kids = [...Array(5)].map(() => child('scout', s));
    const st = standings([s, ...kids], [], NOW).get('scout')!;
    expect(st).toMatchObject({ wins: 5, evaluated: 5, sources: { chain: 5 } });
    expect(st.performance).toBeCloseTo(1);
    expect(TRUST.chain).toBeLessThan(TRUST.orchestrator);
    expect(TRUST.graded).toBeLessThan(TRUST.review);
    const rolled = rollUp([], kids, [s, ...kids], NOW);
    expect(rolled[0]).toMatchObject({ agentId: 'scout', ended: 5, earnedWins: 5, verdicts: { success: 0 } });
    expect(readTally(JSON.parse(JSON.stringify(rolled[0])))).toMatchObject({ earnedWins: 5 });
    expect(readTally({ ...rolled[0], earnedWins: 6 })).toBeNull(); // more than its ended runs
    expect(mergeTallies(rolled[0]!, rolled[0]!)).toMatchObject({ earnedWins: 10 });
    expect(standings([s], rolled, NOW).get('scout')).toMatchObject({ runs: 5, wins: 5 });
  });
  it('a user verdict still outranks the chain on the run itself', () => {
    const s = root('strategist'), c = child('scout', s, { outcome: human('fail') });
    expect(earnedVerdict(c, earnIndex([s, c]))).toEqual({ verdict: 'fail', basis: 'human' });
    expect(wins([s, c], 'scout')).toBe(0);
  });
});

describe('the receipts\' verdict (ADR 0130)', () => {
  const byReceipts = (verdict: 'success' | 'fail') => run({ agentId: 'artisan', outcome: { verdict, basis: 'receipts', at: NOW, by: 'receipts' } });
  it('weighs × 0.7, below the user and a review, above the Orchestrator; a review of the run outranks it', () => {
    expect(TRUST.receipts).toBe(0.7);
    expect(TRUST.receipts).toBeLessThan(TRUST.graded);
    expect(TRUST.receipts).toBeGreaterThan(TRUST.orchestrator);
    const r = byReceipts('success');
    expect(verdictOf(r)).toEqual({ source: 'receipts', verdict: 'success' });
    const review = run({ agentId: 'sentinel', reviewOf: r.runId, report: { at: NOW, outcome: 'done', verified: 'yes', summary: 's', verdict: 'fail' } });
    expect(verdictOf(r, [review])).toEqual({ source: 'review', verdict: 'fail' });
  });
  it('a success earns XP, counts as a receipts source, and lives on through a prune', () => {
    const runs = [...Array(4)].map(() => byReceipts('success')).concat(byReceipts('fail'));
    expect(earnedVerdict(runs[0]!, earnIndex(runs))).toEqual({ verdict: 'success', basis: 'receipts' });
    const st = standings(runs, [], NOW).get('artisan')!;
    expect(st).toMatchObject({ wins: 4, evaluated: 5, sources: { receipts: 5 } });
    expect(st.performance).toBeCloseTo(0.8);
    expect(rollUp([], runs, runs, NOW)[0]).toMatchObject({ earnedWins: 4 });
  });
});
