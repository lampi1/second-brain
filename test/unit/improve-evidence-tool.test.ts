// Read-only tool scoping and exact selected runtime evidence; no GitHub, provider, server or personal archive access.
import { expect, it } from 'vitest';
import { parseImproveSelection } from '../../src/main/appctl/improve-evidence';
import { appControlTools, type AppCtlDeps } from '../../src/main/appctl/tools';
import { ImproveService } from '../../src/main/improve/service';
import { aggregateAgentUsage } from '../../src/main/agents/analytics';
import type { BrainService, BrowserService, ChatService } from '../../src/main/services';
const selection = { agentIds: [], budgetBytes: 4096 };
it('requires explicit bounded lists, rejects extras and malformed values, and never defaults to all', () => {
  expect(parseImproveSelection(selection)).toEqual(selection);
  for (const value of [{}, { ...selection, agentIds: null }, { ...selection, agentIds: ['x'.repeat(161)] }, { ...selection, budgetBytes: 1 }, { ...selection, all: true }, { ...selection, agentIds: [4] }, { ...selection, factRefs: [] }]) expect(() => parseImproveSelection(value)).toThrow();
});
it('advertises only on Improve and returns only selected evidence with no invented analytics', async () => {
  const deps: AppCtlDeps = { chats: { list: () => [] } as unknown as ChatService, browser: {} as BrowserService, brain: {} as BrainService, window: () => null, emitUi: () => {}, version: '0',
    improve: { repo: () => null, state: async () => { throw Error('Uncalled state'); } },
    improveEvidence: selected => ImproveService.prototype.evidence(aggregateAgentUsage([]), selected),
  };
  expect(appControlTools(deps).some(tool => tool.name === 'app_improve_evidence')).toBe(false);
  const tool = appControlTools({ ...deps, space: 'app' }).find(tool => tool.name === 'app_improve_evidence')!;
  expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  const empty = await tool.run(selection);
  expect(empty).toMatchObject({ text: '', bytes: 0, publication: 'existing-human-reviewed-flow-only', metadataScope: 'selected-evidence-only' });
  await expect(Promise.resolve().then(() => tool.run({ ...selection, insightRefs: ['missing/idea'] }))).rejects.toThrow('unavailable');
});
