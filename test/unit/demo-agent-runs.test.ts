// Demo agent runs (main/demo-agent-runs.ts): the same history at every start, veterans beside roles still in rodaggio,
// and a role with no runs, so the Agenti cards show every state of their level and performance.
import { describe, expect, it } from 'vitest';
import { demoAgentMetrics, demoAgentRuns } from '../../src/main/demo-agent-runs';

const NOW = Date.UTC(2026, 9, 11, 8, 30);
describe('demo agent runs', () => {
  it('is deterministic and ends every run before now', () => {
    expect(demoAgentRuns(NOW)).toEqual(demoAgentRuns(NOW));
    expect(demoAgentRuns(NOW).every(r => r.endedAt! < NOW && r.startedAt < r.endedAt!)).toBe(true);
  });
  it('shows levels, a performance for veterans and "in rodaggio" for new roles', () => {
    const by = new Map(demoAgentMetrics(NOW).map(m => [m.agentId, m.standing!]));
    expect(by.get('orchestrator')!.level).toBeGreaterThanOrEqual(5);
    expect(by.get('artisan')!.performance).toBeGreaterThan(0.5);
    expect(by.get('herald')!.performance).toBeNull();
    expect(by.has('pulse')).toBe(false);
  });
});
