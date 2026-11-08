// The replay's cross-process milestones retain source timestamps, not the later main-process receipt time.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runtimePerformance } from '../../src/main/runtime-performance';
import { receiveHostTextTime, receiveHostTransportTime, resetHostTransportTimes, withHostTransportTimes } from '../../src/main/agent-runtime/transport-timing';

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  vi.stubEnv('SB_TEST', '1'); vi.stubEnv('SB_RUNTIME_PERF', '1'); vi.stubEnv('SB_AGENT_RUNTIME_HOST', '1');
  resetHostTransportTimes(); runtimePerformance.start();
});
afterEach(() => { runtimePerformance.stop(); resetHostTransportTimes(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it('exports the host write/text times and recalculates the affected percentiles', () => {
  runtimePerformance.begin('chat', { operationId: 'turn', sentAt: 1000 });
  runtimePerformance.runtime('chat', 'claude', false, false);
  vi.setSystemTime(1010); receiveHostTransportTime('chat', 1005);
  vi.setSystemTime(1030); receiveHostTextTime('chat', 1020);
  runtimePerformance.item('chat', 'assistant', true, false);
  runtimePerformance.ipc({}, 'chat', true);
  runtimePerformance.item('chat', 'result', false, false);
  const snapshot = withHostTransportTimes(runtimePerformance.snapshot());
  expect(snapshot.rows[0]?.marks).toMatchObject({ providerWrite: 1005, firstText: 1020, firstTextIpc: 1030 });
  expect(snapshot.groups[0]?.sendToProviderWriteMs.p99).toBe(5);
  expect(snapshot.groups[0]?.firstTextToIpcMs.p99).toBe(10);
});

it('does not present a missing host timestamp as a valid performance sample', () => {
  runtimePerformance.begin('chat', { operationId: 'turn', sentAt: 1000 });
  runtimePerformance.runtime('chat', 'claude', false, false);
  expect(withHostTransportTimes(runtimePerformance.snapshot()).rows[0]?.invalid).toBe('incomplete');
});
