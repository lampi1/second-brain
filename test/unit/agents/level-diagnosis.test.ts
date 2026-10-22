// The levels diagnostic (main/agents/level-diagnosis.ts, `npm run levels`, ADR 0131): per role, the verified successes
// by basis and why the other runs earned no XP; the Orchestrator's decisions and signals; Flash's answers; the frozen
// demo, where every role but the new ones levels up.
import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../../../src/shared/agents';
import { diagnose, diagnoseFile, formatDiagnosis } from '../../../src/main/agents/level-diagnosis';
import { emptyTally } from '../../../src/main/agents/run-metrics';
import { DEMO_NOW, demoAgentRuns, demoFlashLog } from '../../../src/main/demo-agent-runs';

const NOW = Date.UTC(2026, 9, 22, 12);
let seq = 0;
const run = (over: Partial<AgentRun> = {}): AgentRun => ({ runId: `r_${String(++seq).padStart(12, '0')}`, chatId: `c_${seq}`, agentId: 'scout', version: 1, goal: 'x',
  startedBy: 'orchestrator', startedAt: NOW - 7200_000, endedAt: NOW - 3600_000, endReason: 'completed',
  counters: { questions: 0, permissions: 0, commands: 0, reopened: 0, contextPeak: null }, costUsd: 0.1, tokens: null, ...over });
const report = { at: NOW - 3600_000, outcome: 'done' as const, verified: 'yes' as const, summary: 's', via: 'agent_report' as const };

describe('levels diagnostic', () => {
  it('says why each run earned nothing, for the role and for the Orchestrator\'s decisions', () => {
    const runs = [
      run({ outcome: { verdict: 'success', basis: 'human', at: NOW, by: 'user' }, turns: 4 }),
      run({ report }),                                                                         // its own word only
      run({ outcome: { verdict: 'success', basis: 'orchestrator-opinion', at: NOW, by: 'o' } }), // an opinion only
      run({}),                                                                                 // nothing at all
      run({ endReason: 'closed' }),
      run({ endedAt: undefined, endReason: undefined }),                                       // still open
      run({ source: 'oneshot', oneshot: { engine: 'claude', job: 'headline', fallback: false, costBasis: 'reported' } }),
    ];
    const parent = run({ agentId: 'strategist' }), child = run({ agentId: 'herald', startedBy: 'parent', parentRunId: parent.runId, report });
    const d = diagnose([...runs, parent, child], [], NOW);
    const scout = d.roles.find(r => r.agentId === 'scout')!;
    expect(scout).toMatchObject({ counted: 5, open: 1, oneshots: 1, wins: { human: 1 }, xp: 1.5, noXp: { 'self-only': 1, 'opinion-only': 1, 'no-verdict': 1, 'not-completed': 1 } });
    expect(d.roles.find(r => r.agentId === 'herald')!.noXp).toEqual({ 'chain:corrected': 1 }); // corrections never recorded on it
    const o = d.roles[0]!;
    expect(o).toMatchObject({ agentId: 'orchestrator', counted: 6, wins: { human: 1 }, signals: { redelegated: 0, reworked: 0 } });
    const text = formatDiagnosis(d);
    expect(text).toContain('only the Orchestrator\'s opinion');
    expect(text).toContain('decision signals:');
    expect(text).toMatch(/scout: Lv 1 · 1.5 XP/);
  });
  it('reads an agent-runs.json with the store\'s checks: runs out of shape are counted and left out', () => {
    const raw = { version: 1, runs: [run({ outcome: { verdict: 'success', basis: 'human', at: NOW, by: 'user' } }), { runId: 'bad' }],
      rollups: [{ ...emptyTally('scout', 1), ended: 3, verdicts: { success: 2, partial: 0, fail: 0 } }] };
    const d = diagnoseFile(JSON.parse(JSON.stringify(raw)), NOW);
    expect(d).toMatchObject({ runs: 1, invalid: 1, rollups: 1 });
    expect(d.roles.find(r => r.agentId === 'scout')).toMatchObject({ rolled: { ended: 3, wins: 2, xp: null }, standing: { wins: 3, xp: 3 } });
    expect(() => diagnoseFile({ version: 2 }, NOW)).toThrow(/agent-runs/);
  });
  it('on the frozen demo every veteran levels up, the Orchestrator above all, and Flash has its answers', () => {
    const d = diagnose(demoAgentRuns(DEMO_NOW), [], DEMO_NOW, demoFlashLog(DEMO_NOW));
    const by = new Map(d.roles.map(r => [r.agentId, r]));
    expect(by.get('orchestrator')!.standing!.level).toBeGreaterThan(by.get('artisan')!.standing!.level);
    expect(by.get('orchestrator')!.wins.receipts).toBeGreaterThan(0);  // the receipts under an opinion count now
    expect(by.get('orchestrator')!.signals!.redelegated).toBe(2);
    expect(by.get('flash')!.standing!.level).toBeGreaterThanOrEqual(2);
    expect(by.get('scout')!.wins.chain).toBeGreaterThan(0);
    expect(by.get('herald')!.standing!.performance).toBeNull();
  });
});
