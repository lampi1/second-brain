// Read-only tool scoping and exact selected runtime evidence; no GitHub, provider, server or personal archive access.
import { expect, it } from 'vitest';
import { parseImproveSelection } from '../../src/main/appctl/improve-evidence';
import { appControlTools, type AppCtlDeps } from '../../src/main/appctl/tools';
import { ImproveService } from '../../src/main/improve/service';
import { aggregateAgentUsage } from '../../src/main/agents/analytics';
import { loadUserContext } from '../../src/main/brain/user-context';
import type { BrainService, BrowserService, ChatService } from '../../src/main/services';
const selection = { factRefs: ['essential/work'], agentIds: [], budgetBytes: 4096 };
it('requires explicit bounded lists, rejects extras and malformed values, and never defaults to all', () => {
  expect(parseImproveSelection(selection)).toEqual(selection);
  for (const value of [{}, { ...selection, factRefs: null }, { ...selection, agentIds: ['x'.repeat(161)] }, { ...selection, budgetBytes: 1 }, { ...selection, all: true }, { ...selection, factRefs: [4] }]) expect(() => parseImproveSelection(value)).toThrow();
  expect(parseImproveSelection({ ...selection, factRefs: [] }).factRefs).toEqual([]);
});
it('advertises only on Improve and returns only selected confirmed facts with no invented analytics', async () => {
  const source = { schemaVersion: 1, id: 'essential', label: 'Synthetic reviewed memory', revision: 1, scope: 'user', facts: ['work', 'goals'].map(key => ({ id: key, key, value: 'Synthetic '+key, confirmation: 'confirmed', confirmedAt: '2026-10-17T10:00:00.000Z' })) };
  source.facts.push(...['first', 'second'].map(id => ({ id, key: 'unselected-topic', value: 'Conflicting synthetic '+id, confirmation: 'confirmed', confirmedAt: '2026-10-17T10:00:00.000Z' })));
  const context = loadUserContext(source, [], () => null);
  expect(context.conflicts).toEqual(['unselected-topic']);
  const deps: AppCtlDeps = { chats: { list: () => [] } as unknown as ChatService, browser: {} as BrowserService, brain: {} as BrainService, window: () => null, emitUi: () => {}, version: '0',
    improve: { repo: () => null, state: async () => { throw Error('Uncalled state'); } },
    improveEvidence: selected => ImproveService.prototype.evidence(context, aggregateAgentUsage([]), selected),
  };
  expect(appControlTools(deps).some(tool => tool.name === 'app_improve_evidence')).toBe(false);
  const tool = appControlTools({ ...deps, space: 'app' }).find(tool => tool.name === 'app_improve_evidence')!;
  expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  const result = await tool.run(selection);
  expect(result).toMatchObject({ publication: 'existing-human-reviewed-flow-only' });
  expect(JSON.stringify(result)).toContain('Synthetic work'); expect(JSON.stringify(result)).not.toContain('Synthetic goals');
  expect(await tool.run({ factRefs: [], agentIds: [], budgetBytes: 4096 })).toMatchObject({ text: '', bytes: 0 });
  const empty = await tool.run({ factRefs: [], agentIds: [], budgetBytes: 4096 });
  expect(empty).toMatchObject({ metadataScope: 'selected-evidence-only' });
  expect(JSON.stringify(empty)).not.toContain('unselected-topic');
  expect(Object.hasOwn(empty as object, 'conflicts')).toBe(false);
  await expect(Promise.resolve().then(() => tool.run({ ...selection, insightRefs: ['missing/idea'] }))).rejects.toThrow('unavailable');
});
