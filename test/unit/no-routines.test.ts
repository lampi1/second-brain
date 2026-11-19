// The app has no routine section and no scheduled requests (ADR 0325): no channel, no event and no tool of either may
// come back by accident. The terminal engine in packages/routine-runtime is not the app.
import { expect, it } from 'vitest';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../../src/shared/contract';
import { TOOL_CATALOG } from '../../src/main/appctl/tool-catalog';

it('no routine or schedule channel is in the contract', () => {
  expect([...INVOKE_CHANNELS, ...EVENT_CHANNELS].filter(c => /^(routines|schedules|flows):/.test(c))).toEqual([]);
});

it('no routine or schedule tool is in the catalog', () => {
  expect(Object.keys(TOOL_CATALOG).filter(name => /^app_(routine|schedule|flow)/.test(name))).toEqual([]);
});
