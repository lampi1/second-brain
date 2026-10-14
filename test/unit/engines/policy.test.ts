// The one rule for engines (src/main/engines/policy.ts, ADR 0046): an engine off refuses everyone; «Le Regie possono
// usare X» off refuses every agent's open or resume there, its own engine's too; across engines only with the switch on.
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

  it('across engines: own engine always, another one only with the switch on (writing too)', () => {
    expect(crossRefusal(s(), 'claude', 'cursor')).toBeNull();
    expect(crossRefusal(s({ messaging: { crossHarness: false } }), 'cursor', 'cursor')).toBeNull();
    expect(crossRefusal(s({ messaging: { crossHarness: false } }), 'claude', 'cursor')).toMatch(/Chat tra motori diversi/);
  });

  it('opening: engine on, the Regie allowed on it (whatever their own engine), then the switch across engines', () => {
    expect(openRefusal(s(), 'claude', 'cursor')).toBeNull();
    expect(openRefusal(s({ engineOn: { claude: true } }), 'claude', 'cursor')).toMatch(/Cursor è spento/);
    expect(openRefusal(s({ engines: { claude: true, cursor: false } }), 'cursor', 'cursor')).toMatch(/Le Regie possono usare Cursor/);
    expect(openRefusal(s({ messaging: { crossHarness: false } }), 'claude', 'cursor')).toMatch(/Chat tra motori diversi/);
    expect(agentsMayOpen(s({ engines: { claude: true, cursor: false } }), 'cursor')).toBe(false);
    expect(agentsMayOpen(s(), 'claude')).toBe(true);
  });
});
