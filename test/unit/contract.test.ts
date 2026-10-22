// Typed IPC allowlists must remain unique; the agent pack import/export channels are gone (ADR 0125), the brain share stays.
import { describe, expect, it } from 'vitest';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract';

describe('contract', () => {
  it('has no agent pack import/export any more (ADR 0125); the shareable brain and the trials stay', () => {
    for (const gone of ['agents:exportPlan', 'agents:exportFix', 'agents:export', 'agents:importInspect', 'agents:importApply', 'agents:importCancel']) expect(INVOKE_CHANNELS as readonly string[]).not.toContain(gone);
    for (const channel of ['brain:share', 'agents:trialDecide']) expect(INVOKE_CHANNELS).toContain(channel);
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
