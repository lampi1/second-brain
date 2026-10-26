// Bounded routine discovery and detail transport: large definitions are paged, never dumped into an agent prompt.
import { expect, it, vi } from 'vitest';
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

it('preserves oversized match candidates, lesson cursors and dry-run commands through complete read pages', async () => {
  const values = {
    app_flow_match: { status: 'match', candidates: [{ ...version, definition: { ...definition, package: { assets: [{ content: 'a'.repeat(50000) }] } } }] },
    app_flow_outputs_since_active: { outputs: Array.from({length:3}, (_,i) => ({id:String(i),content:'lesson'.repeat(3000)})), nextOffset: 3 },
    app_flow_start_item: { flowId:'large', version:3, steps:[{stepId:'inspect',title:'Inspect',kind:'check' as const,who:'host',command:'command '.repeat(9000),prod:false,auto:true,problems:[]}], problems:['review these commands'] },
  };
  const dry = vi.fn(async (_args: unknown) => values.app_flow_start_item);
  const candidates = flowTools({ ownerId:'owner', service:() => ({snapshot:()=>snapshot, match:()=>values.app_flow_match, outputsSinceActive:()=>values.app_flow_outputs_since_active}) as unknown as FlowService, resolveBinding:()=>null, startItem:dry });
  for (const [name,value] of Object.entries(values)) {
    const tool = candidates.find(tool=>tool.name===name)!;
    const args = name==='app_flow_match' ? {text:'large'} : name==='app_flow_start_item' ? {contextKey:'brain',flowId:'large',dryRun:true} : {flowId:'large'};
    let content='', offset=0, digest:string|undefined;
    for (let n=0;n<100;n++) {
      const result=await tool.run({...args,contentOffset:offset,...(digest?{expectedDigest:digest}:{})}) as {content:string;digest:string;nextContentOffset:number|null};
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(40000);
      content+=result.content; digest=result.digest;
      if(result.nextContentOffset===null)break;
      expect(result.nextContentOffset).toBeGreaterThan(offset); offset=result.nextContentOffset;
    }
    expect(JSON.parse(content)).toEqual(name === 'app_flow_match' ? {contextKey:'brain',...value} : value);
  }
  for (const [args] of dry.mock.calls) expect(args).not.toHaveProperty('contentOffset');
});

it('rejects pagination on real starts before invoking any mutation, including stale digests', () => {
  const startItem=vi.fn();
  const start=flowTools({ownerId:'owner',service:()=>({snapshot:()=>snapshot}) as unknown as FlowService,resolveBinding:()=>null,startItem}).find(tool=>tool.name==='app_flow_start_item')!;
  for(const extra of [{contentOffset:0},{contentOffset:32000,expectedDigest:'stale'},{expectedDigest:'stale',dryRun:false}]) expect(()=>start.run({contextKey:'brain',flowId:'large',...extra})).toThrow('read-only');
  expect(startItem).not.toHaveBeenCalled();
});
