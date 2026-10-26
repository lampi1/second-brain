// Bounded routine discovery and detail transport: large definitions are paged, never dumped into an agent prompt.
import { expect, it } from 'vitest';
import { capFlowResult, detailPage } from '../../src/main/flows/tool-output';
import { flowTools } from '../../src/main/flows/tools';
import { automationTools } from '../../src/main/flows/automation-tools';
import type { FlowService } from '../../src/main/flows/service';
import type { FlowAutomationService } from '../../src/main/flows/automation';
const definition = { id: 'large', title: 'Large routine', steps: [{ id: 'step', title: 'Inspect', instructions: 'Evidence\n'.repeat(50000) }] };
const version = { definition, version: 3, draftRevision: 7, digest: 'digest', activatedAt: 1 };
const snapshot = { contextKey: 'brain', drafts: [], versions: [version], active: { large: 3 }, runs: [{ id: 'mine', flowId: 'large', flowVersion: 3, ownerOrchestratorId: 'owner', status: 'active', revision: 2, currentStep: 0, steps: [{ stepId: 'step', status: 'running' }] }, { id: 'foreign', flowId: 'large', ownerOrchestratorId: 'other', steps: [] }] };
const tools = () => flowTools({ ownerId: 'owner', service: () => ({ snapshot: () => snapshot }) as unknown as FlowService, resolveBinding: () => null });
it('defaults to compact discovery with active versions and owned current steps, no full prompts', async () => {
  const out = await tools().find(t => t.name === 'app_flow_list')!.run({}) as Record<string, unknown>;
  expect(JSON.stringify(out).length).toBeLessThanOrEqual(40000); expect(JSON.stringify(out)).not.toContain('foreign'); expect(JSON.stringify(out)).not.toContain('Evidence');
  expect(out).toMatchObject({ contextKey: 'brain', flows: [{ id: 'large', title: 'Large routine', activeVersion: 3 }], runs: [{ id: 'mine', currentStep: { id: 'step', status: 'running' } }] });
});
it('roundtrips one large definition in capped, digest-pinned content pages', async () => {
  const tool = tools().find(t => t.name === 'app_flow_list')!; let offset = 0, content = '', digest: string | undefined;
  for (let n = 0; n < 150; n++) {
    const out = await tool.run({ section: 'definition', flowId: 'large', version: 3, contentOffset: offset, ...(digest ? { expectedDigest: digest } : {}) }) as { content: string; digest: string; nextContentOffset: number | null; truncated: boolean; note?: string };
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(40000); content += out.content; digest = out.digest;
    if (out.nextContentOffset === null) break; expect(out.nextContentOffset).toBeGreaterThan(offset); expect(out.note).toContain('contentOffset'); offset = out.nextContentOffset;
  }
  expect(JSON.parse(content)).toEqual(version);
  await expect(Promise.resolve().then(() => tool.run({ section: 'definition', flowId: 'large', expectedDigest: 'stale' }))).rejects.toThrow('changed');
});
it('filters rules to the caller by default; other owners require explicit discovery and their events stay private', async () => {
  const config = { flowId: 'large', flowVersion: 3, inputs: { huge: 'x'.repeat(200000) }, trigger: { kind: 'interval' } };
  const rules = ['owner', 'other'].map((ownerOrchestratorId, i) => ({ id: `rule-${i}`, config, ownerOrchestratorId, revision: 4, status: 'enabled' }));
  const service = { snapshot: () => ({ revision: 1, paused: false, background: false, rules, events: [{ id: 'own-event', ruleId: 'rule-0' }, { id: 'private-event', ruleId: 'rule-1' }] }) };
  const list = automationTools({ ownerId: 'owner', contextKey: () => 'brain', service: () => service as unknown as FlowAutomationService }).find(t => t.name === 'app_flow_auto_list')!;
  const own = await list.run({}); expect(JSON.stringify(own)).not.toContain('rule-1'); expect(JSON.stringify(own).length).toBeLessThanOrEqual(40000);
  const all = await list.run({ allOwners: true }); expect(JSON.stringify(all)).toContain('rule-1'); expect(JSON.stringify(all)).not.toContain('private-event');
  const detail = await list.run({ ruleId: 'rule-0', detail: true }) as { truncated: boolean; nextContentOffset: number }; expect(detail.truncated).toBe(true); expect(detail.nextContentOffset).toBeGreaterThan(0); expect(JSON.stringify(detail).length).toBeLessThanOrEqual(40000);
});
it('pages list summaries and refuses invalid offsets before returning data', async () => {
  const list = tools().find(t => t.name === 'app_flow_list')!;
  expect(await list.run({ offset: 1, limit: 1 })).toMatchObject({ flows: [], runs: [] });
  await expect(Promise.resolve().then(() => list.run({ offset: -1 }))).rejects.toThrow();
  await expect(Promise.resolve().then(() => list.run({ section: 'run', runId: 'foreign' }))).rejects.toThrow(/owned|available/);
});

it('caps escaped detail text and both synchronous and asynchronous large receipts', async () => {
  const huge = { definition: { id: 'large' }, revision: 7, prompt: '\u0000'.repeat(50000) };
  for (const out of [capFlowResult(huge), await capFlowResult(Promise.resolve(huge)), detailPage(huge, {}, 'brain')]) {
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(40000); expect(out).toMatchObject({ truncated: true });
  }
  expect(capFlowResult(huge)).toMatchObject({ flowId: 'large', revision: 7, note: expect.stringContaining('contentOffset') });
});
