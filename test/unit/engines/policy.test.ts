// The one rule for engines (src/main/engines/policy.ts, ADR 0046): an engine off refuses everyone; «Gli Orchestrator possono
// usare X» off refuses every agent's open or resume there, its own engine's too; cross-engine messaging is always on.
import { describe, expect, it } from 'vitest';
import { agentsMayOpen, crossRefusal, engineOn, openRefusal, type EngineSwitches } from '../../../src/main/engines/policy';

const s = (o: Partial<EngineSwitches> = {}): EngineSwitches => ({
  engineOn: { claude: true, cursor: true }, engines: { claude: true, cursor: true }, messaging: { crossHarness: true }, ...o });

describe('engine policy', () => {
  it('an engine is on only when the settings say so (absent = off: a new engine never starts by itself)', () => {
    expect(engineOn(s(), 'claude')).toBe(true);
    expect(engineOn(s(), 'kimi')).toBe(false);
    expect(engineOn(s({ engineOn: { cursor: false } }), 'cursor')).toBe(false);
  });

  it('across engines: legacy false never blocks writing', () => {
    expect(crossRefusal(s(), 'claude', 'cursor')).toBeNull();
    expect(crossRefusal(s({ messaging: { crossHarness: false } }), 'cursor', 'cursor')).toBeNull();
    expect(crossRefusal(s({ messaging: { crossHarness: false } }), 'claude', 'cursor')).toBeNull();
  });

  it('opening still requires an enabled engine and agent launch permission', () => {
    expect(openRefusal(s(), 'claude', 'cursor')).toBeNull();
    expect(openRefusal(s({ engineOn: { claude: true } }), 'claude', 'cursor')).toMatch(/Cursor è spento/);
    expect(openRefusal(s({ engines: { claude: true, cursor: false } }), 'cursor', 'cursor')).toMatch(/Gli Orchestrator possono usare Cursor/);
    expect(openRefusal(s({ messaging: { crossHarness: false } }), 'claude', 'cursor')).toBeNull();
    expect(agentsMayOpen(s({ engines: { claude: true, cursor: false } }), 'cursor')).toBe(false);
    expect(agentsMayOpen(s(), 'claude')).toBe(true);
  });
});
