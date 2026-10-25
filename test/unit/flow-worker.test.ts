// The host routine factory honors existing routing policies and opens an idle role task before runtime binding.
import { afterEach, expect, it, vi } from 'vitest';
import { createFlowWorker } from '../../src/main/flows/worker';
import { openRefusal } from '../../src/main/engines/policy';
import type { FlowWorkerRequest } from '../../src/main/flows/runtime';
vi.mock('../../src/main/engines/policy', () => ({ openRefusal: vi.fn(() => null) }));
afterEach(() => vi.clearAllMocks());
function fixture() {
  const create = vi.fn(async request => ({ id: 'worker', ...request }));
  const resolve = vi.fn(request => ({ request: { ...request, harness: 'codex', model: 'fixture-model' }, tier: 'top' }));
  const route = vi.fn(input => ({ harness: input.agent.harness, model: input.agent.model, route: { agent: input.agent } }));
  const settings = { orchestratorChats: { harness: 'claude' }, engines: { codex: true }, engineOn: { codex: true } };
  const ports = { create, catalog: { resolve, list: () => ({ profiles: [{ id: 'sentinel', activeVersion: 3, name: 'Sentinel', tierMax: 'top' }] }) },
    brain: { settings: () => settings, route }, chats: () => [{ id: 'owner', isOrchestrator: true, harness: 'claude' }] };
  return { create, resolve, route, settings, make: createFlowWorker(ports as unknown as Parameters<typeof createFlowWorker>[0]) };
}
const request: FlowWorkerRequest = { flowRunId: 'routine', stepId: 'review', ownerId: 'owner', roleId: 'sentinel', tier: 'top',
  workspace: '/synthetic/repo', title: 'Independent review', goal: 'Review the fixture', doneWhen: ['review evidence'], reviewOf: 'previous-run' };
it('pins catalog version, model tier, workspace and review identity without starting a prompt', async () => {
  const f = fixture(); await f.make(request);
  expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ roleId: 'sentinel', roleVersion: 3, tier: 'top', cwd: request.workspace,
    reviewOf: request.reviewOf, doneWhen: request.doneWhen, deliveryPolicy: 'display', harness: 'codex', model: 'fixture-model' }), undefined, { runId: request.flowRunId, stepId: request.stepId });
  expect(f.create.mock.calls[0]![0].prompt).toBeUndefined();
  expect(openRefusal).toHaveBeenCalledWith(f.settings, 'claude', 'codex');
});
it('refuses a forbidden engine before creating a worker', async () => {
  const f = fixture(); vi.mocked(openRefusal).mockReturnValueOnce('Engine permission withdrawn');
  await expect(f.make(request)).rejects.toThrow('Engine permission withdrawn'); expect(f.create).not.toHaveBeenCalled();
});
it('keeps an explicit report contract for evidence lists larger than launch criteria allow', async () => {
  const f = fixture(); await f.make({ ...request, doneWhen: Array.from({ length: 20 }, (_, i) => `evidence ${i}`) });
  expect(f.create.mock.calls[0]![0].doneWhen).toEqual([]);
});

it('uses frozen package prompt/model without consulting mutable role routing', async () => {
  const f = fixture(); f.resolve.mockImplementation(() => { throw new Error('Ambient role routing must not run'); });
  await f.make({ ...request, packageDigest: 'a'.repeat(64), agentPrompt: 'Approved exact prompt', engine: 'codex', model: 'pinned-model', effort: 'high' });
  expect(f.resolve).not.toHaveBeenCalled(); expect(f.route).not.toHaveBeenCalled();
  expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ harness: 'codex', model: 'pinned-model', effort: 'high' }), { digest: 'a'.repeat(64), instructions: 'Approved exact prompt' }, { runId: request.flowRunId, stepId: request.stepId });
});
