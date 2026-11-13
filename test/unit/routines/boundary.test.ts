// Public app boundaries must remain observers: retired IPC/tool names cannot revive execution, and asking the live
// app guide must not scan routine storage. Exercise appControlTools, the actual authenticated mount's factory.
import { expect, it, vi } from 'vitest';
import { INVOKE_CHANNELS, EVENT_CHANNELS } from '../../../src/shared/contract';
import { appControlTools, type AppCtlDeps } from '../../../src/main/appctl/tools';
import { TERMINAL_ROUTINE_RULE, roleFrame } from '../../../src/main/agents/orchestrator-role';

it('exposes routine observation only on the authenticated endpoint and reads only on explicit calls', async () => {
  const snapshot = vi.fn(() => ({ runs: [] })), archive = vi.fn(() => ({ runs: [{ id: 'old', status: 'cancelled' }] }));
  const run = vi.fn(async () => ({ runId: 'live', events: [] })); let live = true;
  const deps = { chats: { list: () => live ? [{ id: 'owner', isOrchestrator: true }] : [] }, browser: {},
    brain: { info: () => ({ brainRoot: null }), settingsSchema: () => [], settings: () => ({}) }, window: () => null, emitUi: () => {}, version: 'test',
    routines: { snapshot, archive, run, has: () => false, exportForTerminal: vi.fn() } } as unknown as AppCtlDeps;
  expect(appControlTools(deps).some(t => t.name === 'app_routine_status')).toBe(false);
  const tools = appControlTools(deps, 'owner');
  await tools.find(t => t.name === 'app_guide')!.run({ topic: 'routine' });
  expect(snapshot).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled(); expect(archive).not.toHaveBeenCalled();
  expect(tools.some(t => t.name.startsWith('app_flow_'))).toBe(false);
  const status = tools.find(t => t.name === 'app_routine_status')!;
  await status.run({}); expect(snapshot).toHaveBeenCalledTimes(1);
  await status.run({ archive: true }); expect(archive).toHaveBeenCalledTimes(1);
  await status.run({ source: 'terminal', routineId: 'demo', runId: 'live' }); expect(run).toHaveBeenCalledTimes(1);
  live = false; expect(() => status.run({})).toThrow('Authenticated Orchestrator');
});
it('has no retired execution IPC or event channels and every role gets the terminal boundary', () => {
  expect(INVOKE_CHANNELS.filter(c => c.startsWith('flows:'))).toEqual([]);
  for (const removed of ['routines:startItem', 'routines:setTrigger', 'routines:cancel']) expect(INVOKE_CHANNELS).not.toContain(removed);
  expect(EVENT_CHANNELS).not.toContain('flows:changed');
  expect(roleFrame('Scout', 'Inspect the task')).toContain(TERMINAL_ROUTINE_RULE);
});
