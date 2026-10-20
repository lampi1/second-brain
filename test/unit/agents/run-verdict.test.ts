// The facts' verdict on a role run (src/shared/run-verdict.ts, ADR 0100): a success needs an agent_report done with
// every criterion met, no correction and no rework within 7 days (provisional until then); a blocked report or a rework
// within 7 days is a failure; the user's verdict (or a verified review) always wins; the §5 success rate, the trials'
// cohorts and the tier suggestions count it as verified evidence.
import { describe, expect, it } from 'vitest';
import type { AgentProfile, AgentRun } from '../../../src/shared/agents';
import { FACTS_SETTLE_MS, factsVerdict, reworkStartsOf, verifiedVerdict } from '../../../src/shared/run-verdict';
import { runMetrics } from '../../../src/main/agents/run-metrics';
import { suggestTiers } from '../../../src/main/agents/suggestions';

const DAY = 86_400_000, END = Date.UTC(2026, 9, 1), LATER = END + 8 * DAY;
let n = 0;
const run = (over: Partial<AgentRun> = {}): AgentRun => ({ runId: `r_${(++n).toString(16).padStart(12, '0')}`, chatId: `c${n}`, agentId: 'artisan', version: 1, goal: 'g',
  startedBy: 'orchestrator', startedAt: END - 3600_000, endedAt: END, endReason: 'completed', counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null },
  costUsd: 1, tokens: null, corrections: { tagged: 0, afterReport: 0 },
  report: { at: END, outcome: 'done', verified: 'yes', summary: 's', via: 'agent_report' }, ...over });

describe('factsVerdict', () => {
  it('a clean agent_report is provisional for 7 days, then a success', () => {
    expect(factsVerdict(run(), [], END + DAY)).toBe('provisional');
    expect(factsVerdict(run(), [], END + FACTS_SETTLE_MS - 1)).toBe('provisional');
    expect(factsVerdict(run(), [], END + FACTS_SETTLE_MS)).toBe('success');
  });
  it('needs every criterion met, agent_report, no correction; otherwise unknown', () => {
    expect(factsVerdict(run({ report: { at: END, outcome: 'done', verified: 'partial', summary: 's', via: 'agent_report' } }), [], LATER)).toBe('unknown');
    expect(factsVerdict(run({ report: { at: END, outcome: 'done', verified: 'yes', summary: 's' } }), [], LATER)).toBe('unknown'); // a run-report block: self-claimed
    expect(factsVerdict(run({ report: { at: END, outcome: 'partial', verified: 'yes', summary: 's', via: 'agent_report' } }), [], LATER)).toBe('unknown');
    expect(factsVerdict(run({ corrections: { tagged: 1, afterReport: 0 } }), [], LATER)).toBe('unknown');
    expect(factsVerdict(run({ corrections: undefined }), [], LATER)).toBe('unknown'); // not counted then: unknown, never zero
    expect(factsVerdict(run({ report: undefined }), [], LATER)).toBe('unknown');
    expect(factsVerdict(run({ endedAt: undefined, endReason: undefined }), [], LATER)).toBe('unknown');
  });
  it('a blocked report or a rework within 7 days is a failure, at once; a rework after that changes nothing', () => {
    expect(factsVerdict(run({ report: { at: END, outcome: 'blocked', verified: 'no', summary: 's' } }), [], END + DAY)).toBe('fail');
    expect(factsVerdict(run(), [END + 2 * DAY], END + 3 * DAY)).toBe('fail');
    expect(factsVerdict(run({ counters: { questions: 0, permissions: 0, commands: 0, reopened: 1, contextPeak: null } }), [], END + DAY)).toBe('fail');
    expect(factsVerdict(run(), [END + 9 * DAY], END + 10 * DAY)).toBe('success');
  });
});

describe('verifiedVerdict', () => {
  it('the user wins, then a verified review, then the settled facts; an opinion or the agent\'s word is none', () => {
    const blocked = { report: { at: END, outcome: 'blocked', verified: 'no', summary: 's' } } as const;
    expect(verifiedVerdict(run({ ...blocked, outcome: { verdict: 'success', basis: 'human', at: END, by: 'user' } }), [], LATER)).toEqual({ verdict: 'success', basis: 'human' });
    expect(verifiedVerdict(run({ outcome: { verdict: 'partial', basis: 'reviewed-evidence', at: END, by: 'judge-sample' } }), [], LATER)).toEqual({ verdict: 'partial', basis: 'reviewed-evidence' });
    expect(verifiedVerdict(run({ outcome: { verdict: 'fail', basis: 'orchestrator-opinion', at: END, by: 'o' } }), [], LATER)).toEqual({ verdict: 'success', basis: 'facts' });
    expect(verifiedVerdict(run({ outcome: { verdict: 'unknown', basis: 'human', at: END, by: 'user' } }), [], LATER)).toEqual({ verdict: 'success', basis: 'facts' });
    expect(verifiedVerdict(run(), [], END + DAY)).toBeNull(); // provisional
    expect(verifiedVerdict(run(blocked), [], END + DAY)).toEqual({ verdict: 'fail', basis: 'facts' });
  });
  it('reworkStartsOf follows reworkOf and continuedFrom', () => {
    const a = run(), b = run({ reworkOf: a.runId, startedAt: END + DAY }), c = run({ continuedFrom: a.runId, startedAt: END + 2 * DAY });
    expect(reworkStartsOf([a, b, c]).get(a.runId)).toEqual([END + DAY, END + 2 * DAY]);
  });
});

describe('the facts as verified evidence', () => {
  it('the success rate counts settled facts, never provisional ones', () => {
    const settled = [run(), run(), run({ report: { at: END, outcome: 'blocked', verified: 'no', summary: 's' } })];
    const fresh = run({ endedAt: LATER - DAY, startedAt: LATER - DAY - 1000 });
    const m = runMetrics([...settled, fresh], { now: LATER })[0]!.all!;
    expect(m.successRate).toMatchObject({ n: 3, value: 2 / 3 });
    expect(runMetrics(settled, { now: END + DAY })[0]!.all!.successRate.n).toBe(1); // only the blocked one is settled
  });
  it('a tier suggestion rests on facts too', () => {
    const role = { id: 'artisan', name: 'Artisan', scope: 'role', tier: 'mid', trial: undefined } as unknown as AgentProfile;
    const tagged = (tier: 'mid' | 'top', ok: boolean): AgentRun => run({ tier, tags: { skills: [], app: null, repo: null }, endedAt: LATER - 9 * DAY, startedAt: LATER - 9 * DAY - 1000,
      ...(ok ? {} : { report: { at: END, outcome: 'blocked', verified: 'no', summary: 's' } }) });
    const runs = [...Array.from({ length: 5 }, (_, i) => tagged('mid', i < 2)), ...Array.from({ length: 5 }, () => tagged('top', true))];
    expect(suggestTiers({ roles: [role], runs }, LATER)).toMatchObject([{ kind: 'tier', tier: 'top', agentIds: ['artisan'] }]);
  });
});
