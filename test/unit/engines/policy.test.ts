// The one rule for engines (src/main/engines/policy.ts, ADR 0046, 0352): an engine off refuses everyone; «Gli Orchestrator
// possono usare X» off refuses every agent's open or resume there; the asking chat's engine plays no part.
import { describe, expect, it } from 'vitest';
import { agentsMayOpen, engineOn, openRefusal, type EngineSwitches } from '../../../src/main/engines/policy';

const s = (o: Partial<EngineSwitches> = {}): EngineSwitches => ({
  engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true }, ...o });

describe('engine policy', () => {
  it('an engine is on only when the settings say so (absent = off: a new engine never starts by itself)', () => {
    expect(engineOn(s(), 'claude')).toBe(true);
    expect(engineOn(s(), 'kimi')).toBe(false);
    expect(engineOn(s({ engineOn: { cursor: false } }), 'cursor')).toBe(false);
  });

  it('opening still requires an enabled engine and agent launch permission', () => {
    expect(openRefusal(s(), 'cursor')).toBeNull();
    expect(openRefusal(s({ engineOn: { claude: true } }), 'cursor')).toMatch(/Cursor è spento/);
    expect(openRefusal(s({ engines: { claude: true, cursor: false } }), 'cursor')).toMatch(/Gli Orchestrator possono usare Cursor/);
    expect(agentsMayOpen(s({ engines: { claude: true, cursor: false } }), 'cursor')).toBe(false);
    expect(agentsMayOpen(s(), 'claude')).toBe(true);
  });
});
