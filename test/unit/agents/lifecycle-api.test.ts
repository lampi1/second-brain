// Main lifecycle API and read-only transport tests: identity is authoritative and main routes never proxy to brain code.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentLifecycle } from '../../../src/main/agents/lifecycle';
import { createLifecycleApi, mountLifecycleApi } from '../../../src/main/agents/lifecycle-api';
import { BrainApi } from '../../../src/main/brain/api';
import type { AgentRun } from '../../../src/shared/agents';
import { AGENT_LIFECYCLE_PATH } from '../../../src/shared/agent-lifecycle';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const make = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lifecycle-api-')); dirs.push(dir);
  const service = new AgentLifecycle({ userData: dir, wake: () => false });
  const run = { runId: 'r_000000000001', agentId: 'reviewer', version: 1 } as AgentRun;
  return { service, api: createLifecycleApi(service, id => id === run.runId ? run : undefined) };
};
it('rejects extra query fields and feedback identity/basis injection', () => {
  const { api } = make();
  expect(() => api.read({ path: '../../private' })).toThrow();
  expect(() => api.read({ agentId: '../other' })).toThrow();
  expect(() => api.feedback({ runId: 'r_000000000001', basis: 'human' })).toThrow();
  expect(() => api.feedback({ runId: 'r_000000000001', agentId: 'other' })).toThrow();
  expect(() => api.feedback({ runId: 'r_000000000999' })).toThrow();
});
it('records opinion feedback and returns detached agent-scoped data', () => {
  const { api } = make();
  api.feedback({ runId: 'r_000000000001', verdict: 'partial', worked: 'Read', failed: 'Test', gap: 'instructions', gapKey: 'tests', evidence: [{ kind: 'run', ref: 'r_000000000001', at: 1 }] });
  const first = api.read({ agentId: 'reviewer' }); expect(first.feedback[0]!.basis).toBe('orchestrator-opinion');
  first.feedback.length = 0;
  expect(api.read({ agentId: 'reviewer' }).feedback).toHaveLength(1); expect(api.read({}).feedback).toHaveLength(0);
});
it('mounts a local-only endpoint and rejects duplicate or unknown URL parameters', async () => {
  const local = new Map<string, (q: URLSearchParams) => unknown>();
  mountLifecycleApi({ serveApi: (route, fn) => { local.set(route, fn); } }, make().api);
  const handler = local.get(AGENT_LIFECYCLE_PATH)!;
  expect(() => handler(new URLSearchParams('agentId=a&agentId=b'))).toThrow();
  expect(() => handler(new URLSearchParams('apply=true'))).toThrow();
  const brain = new BrainApi(null, { exe: 'unused', env: {} }, 100, local);
  expect((await brain.get(AGENT_LIFECYCLE_PATH)).ok).toBe(true);
  const absent = new BrainApi(null, { exe: 'unused', env: {} });
  expect(await absent.get(AGENT_LIFECYCLE_PATH)).toEqual({ ok: false, error: 'Ciclo degli agenti non disponibile.' });
});
