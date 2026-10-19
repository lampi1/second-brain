// Main lifecycle API and read-only transport tests: identity is authoritative and main routes never proxy to brain code.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentLifecycle } from '../../../src/main/agents/lifecycle';
import { createLifecycleApi, mountLifecycleApi, type FeedbackWriter } from '../../../src/main/agents/lifecycle-api';
import { BrainApi } from '../../../src/main/brain/api';
import type { AgentRun } from '../../../src/shared/agents';
import { AGENT_FEEDBACK_REQUIRED, AGENT_FEEDBACK_SCHEMA, AGENT_LIFECYCLE_PATH, parseAgentFeedbackArgs, type AgentFeedback } from '../../../src/shared/agent-lifecycle';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const make = (withWriter = true) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lifecycle-api-')); dirs.push(dir);
  const stored: AgentFeedback[] = [], calls: { args: unknown; caller: string }[] = [];
  const service = new AgentLifecycle({ userData: dir, wake: () => false, feedback: { list: id => stored.filter(f => f.agentId === id), problem: null } });
  const runs = [1, 2].map(n => ({ runId: `r_00000000000${n}`, agentId: 'reviewer', version: 1 } as AgentRun));
  // stands in for AgentAuthoring.recordFeedback: agent/version from the run, basis decided by main
  const write: FeedbackWriter = async (args, caller) => {
    calls.push({ args, caller });
    const run = runs.find(r => r.runId === args.runId)!;
    const { notes, verdict, evidence, runId: _r, sendToRun: _s, ...detail } = args;
    const f: AgentFeedback = { id: `f${stored.length}`, at: stored.length, agentId: run.agentId, runId: run.runId, version: run.version,
      outcome: { verdict, basis: 'orchestrator-opinion', by: caller, at: 1, note: notes }, evidence, ...detail };
    stored.push(f); return f;
  };
  return { service, stored, calls, api: createLifecycleApi(service, id => runs.find(r => r.runId === id), withWriter ? write : undefined) };
};
const args = (over: Record<string, unknown> = {}) => ({ runId: 'r_000000000001', verdict: 'partial', notes: 'Missed the tests', evidence: [{ kind: 'run', ref: 'r_000000000001', at: 1 }], ...over });
it('rejects extra query fields and feedback identity/basis injection', async () => {
  const { api, calls } = make();
  expect(() => api.read({ path: '../../private' })).toThrow();
  expect(() => api.read({ agentId: '../other' })).toThrow();
  for (const extra of [{ basis: 'human' }, { agentId: 'other' }, { version: 3 }, { outcome: { basis: 'human' } }, { reason: 'x' }])
    await expect(api.feedback(args(extra), 'orchestrator')).rejects.toThrow(/unknown argument/);
  await expect(api.feedback(args({ runId: 'r_000000000999' }), 'orchestrator')).rejects.toThrow(/no agent run with id r_000000000999/);
  await expect(api.feedback({ runId: 'r_000000000001', verdict: 'partial' }, 'orchestrator')).rejects.toThrow();
  await expect(make(false).api.feedback(args(), 'orchestrator')).rejects.toThrow('Feedback store unavailable.');
  expect(calls).toHaveLength(0);
});
it('accepts the shared agent_feedback shape, writes once through the one store and proposes a repeated gap', async () => {
  const { api, calls, service } = make();
  const record = await api.feedback(args({ worked: 'Read', failed: 'Test', gap: 'instructions', gapKey: 'tests' }), 'orchestrator-1');
  expect(calls).toEqual([{ caller: 'orchestrator-1', args: { ...args(), worked: 'Read', failed: 'Test', gap: 'instructions', gapKey: 'tests' } }]);
  expect(record).toMatchObject({ agentId: 'reviewer', version: 1, outcome: { basis: 'orchestrator-opinion', note: 'Missed the tests' } });
  expect(service.proposals()).toEqual([]);
  await api.feedback(args({ runId: 'r_000000000002', gap: 'instructions', gapKey: 'Tests' }), 'orchestrator-1');
  expect(service.proposals().map(p => p.key)).toEqual(['gap:reviewer:1:instructions:tests']);
  await api.feedback(args({ runId: 'r_000000000002' }), 'orchestrator-1'); // notes only (the #49 minimum): accepted, no gap
  const first = api.read({ agentId: 'reviewer' }); expect(first.feedback).toHaveLength(3);
  first.feedback.length = 0;
  expect(api.read({ agentId: 'reviewer' }).feedback).toHaveLength(3); expect(api.read({}).feedback).toHaveLength(0);
});
it('shares one schema and one parser: required args, accepted keys and limits agree', () => {
  expect(AGENT_FEEDBACK_SCHEMA.required).toEqual([...AGENT_FEEDBACK_REQUIRED]);
  expect(AGENT_FEEDBACK_REQUIRED).toEqual(['runId', 'verdict', 'notes', 'evidence']);
  const full = args({ worked: 'a', failed: 'b', gap: 'tools', gapKey: 'k', sendToRun: false });
  expect(Object.keys(parseAgentFeedbackArgs(full)).sort()).toEqual(Object.keys(AGENT_FEEDBACK_SCHEMA.properties).sort());
  expect(parseAgentFeedbackArgs(args({ notes: '  trimmed  ' })).notes).toBe('trimmed');
  for (const bad of [{ verdict: 'great' }, { notes: '' }, { notes: 'x'.repeat(601) }, { evidence: 'none' }, { evidence: Array(21).fill({ kind: 'run', ref: 'r', at: 1 }) },
    { evidence: [{ kind: 'secret', ref: 'r', at: 1 }] }, { gap: 'other' }, { gapKey: 'k' }, { worked: 'x'.repeat(1201) }, { sendToRun: 'yes' }])
    expect(() => parseAgentFeedbackArgs(args(bad))).toThrow();
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
