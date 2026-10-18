// Typed IPC allowlists must remain unique and include the reviewed agent-pack capabilities.
import { describe, expect, it } from 'vitest';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract';

describe('contract', () => {
  it('exposes the reviewed agent-pack flows through the typed allowlist', () => {
    for (const channel of ['agents:exportPlan', 'agents:exportFix', 'agents:export', 'agents:importInspect', 'agents:importApply', 'agents:importCancel', 'agents:learnList', 'agents:learnDecide', 'agents:trialDecide', 'agents:keep', 'agents:retire']) expect(INVOKE_CHANNELS).toContain(channel);
  });
  it('channel lists have no duplicates and use the area:verb form', () => {
    for (const list of [INVOKE_CHANNELS, EVENT_CHANNELS]) {
      expect(new Set(list).size).toBe(list.length);
      for (const c of list) expect(c).toMatch(/^[a-z]+(:[a-zA-Z]+)?$/);
    }
  });
});
