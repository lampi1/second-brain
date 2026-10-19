// Typed IPC allowlists must remain unique and include the reviewed agent-pack capabilities.
import { describe, expect, it } from 'vitest';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract';

describe('contract', () => {
  it('exposes the reviewed agent-pack flows through the typed allowlist', () => {
    for (const channel of ['agents:exportPlan', 'agents:exportFix', 'agents:export', 'agents:importInspect', 'agents:importApply', 'agents:importCancel', 'agents:trialDecide']) expect(INVOKE_CHANNELS).toContain(channel);
  });
  it('serves the brain model (ADR 0077) and no longer the procedures or the learned-rule approvals', () => {
    for (const channel of ['brainmodel:state', 'brainmodel:maintain', 'brainmodel:rollback', 'brainmodel:link', 'classifiers:state']) expect(INVOKE_CHANNELS).toContain(channel);
    expect(EVENT_CHANNELS).toContain('brainmodel:changed');
    for (const gone of ['agents:learnList', 'agents:learnDecide', 'procedures:changed']) expect([...INVOKE_CHANNELS, ...EVENT_CHANNELS] as string[]).not.toContain(gone);
  });
  it('channel lists have no duplicates and use the area:verb form', () => {
    for (const list of [INVOKE_CHANNELS, EVENT_CHANNELS]) {
      expect(new Set(list).size).toBe(list.length);
      for (const c of list) expect(c).toMatch(/^[a-z]+(:[a-zA-Z]+)?$/);
    }
  });
});
