// The real authenticated Orchestrator mount and its live guide must expose each recovery tool, never user approval.
import { expect, it, vi } from 'vitest';
import { appControlTools, type AppCtlDeps } from '../../src/main/appctl/tools';
import { ORCHESTRATOR_ROLE } from '../../src/main/agents/orchestrator-role';
function fixture() {
  let open = true;
  const run = { id: 'run', revision: 4, ownerOrchestratorId: 'owner' };
  const flow = { snapshot: () => ({ contextKey: 'brain', active: {}, versions: [], runs: [run] }), status: vi.fn(() => run) };
  const proposeReconcile = vi.fn(async () => run), writeReconciliation = vi.fn(() => ({ runId: 'run', revision: 4, operations: [] }));
  const deps = { chats: { list: () => open ? [{ id: 'owner', isOrchestrator: true }] : [] }, browser: {}, brain: { info: () => ({ brainRoot: '/brain' }), settingsSchema: () => [], settings: () => ({}) }, window: () => null, emitUi: () => {}, version: 'test', flows: { service: () => flow, snapshot: flow.snapshot, proposeReconcile, writeReconciliation } } as unknown as AppCtlDeps;
  return { deps, flow, proposeReconcile, writeReconciliation, close: () => { open = false; } };
}
it('mounts read/propose tools, discovers their current complete contract and passes authenticated owner identity', async () => {
  const s = fixture(), tools = appControlTools(s.deps, 'owner');
  const names = tools.map(t => t.name);
  expect(names).toContain('app_flow_reconciliation'); expect(names).toContain('app_flow_reconcile_propose');
  expect(names.filter(name => name.startsWith('app_flow_')).join(' ')).not.toMatch(/decide|approve|confirm/);
  const input = { contextKey: 'brain', runId: 'run', expectedRevision: 4, op: 'link-pr', requestHash: 'a'.repeat(64), outcome: 'applied', evidence: 'Verified the exact PR link.' };
  await tools.find(t => t.name === 'app_flow_reconcile_propose')!.run(input);
  const { contextKey: _, ...proposal } = input;
  expect(s.proposeReconcile).toHaveBeenCalledWith(proposal, 'owner');
  await tools.find(t => t.name === 'app_flow_reconciliation')!.run({ runId: 'run' });
  expect(s.flow.status).toHaveBeenCalledWith('run', 'owner'); expect(s.writeReconciliation).toHaveBeenCalledWith('run');
  const guide = tools.find(t => t.name === 'app_guide')!;
  for (const name of ['app_flow_reconciliation', 'app_flow_reconcile_propose']) {
    const mounted = tools.find(t => t.name === name)!;
    expect(await guide.run({ topic: name })).toContain(mounted.description);
  }
  expect(await guide.run({ topic: 'riconciliare scritture incerte' })).toContain('Sì/No');
  s.close(); expect(() => tools.find(t => t.name === 'app_flow_reconcile_propose')!.run(input)).toThrow('Authenticated');
});
it('does not expose confirmation or routine write proposals on the public app mount', () => {
  const s = fixture(); expect(appControlTools(s.deps).some(t => t.name === 'app_flow_reconcile_propose')).toBe(false);
  expect(ORCHESTRATOR_ROLE).toContain('app_flow_reconcile_propose'); expect(ORCHESTRATOR_ROLE).toContain('app_guide with an exact tool name');
});
