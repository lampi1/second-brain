// Offline classifier contract and calibration fixtures: fake local embeddings, no model downloads or CLI runs.
import { describe, expect, it, vi } from 'vitest';
import type { AgentCatalog, AgentProfile, AgentRun } from '../../src/shared/agents';
import { AgentClassifier } from '../../src/main/agents/classifier';
import { agentCatalogTool } from '../../src/main/agents/discovery';

const profile = (id: string, purpose = ''): AgentProfile => ({ id, name: id, purpose, instructions: '', manifest: {}, status: 'active', activeVersion: 1 } as AgentProfile);
const run = (patch: Partial<AgentRun> = {}): AgentRun => ({ agentId: 'writer', version: 1, runId: 'r_123456789abc', goal: 'repair database indexes', endedAt: 2, endReason: 'completed', ...patch } as AgentRun);
const vector = (cos: number) => new Float32Array([cos, Math.sqrt(1 - cos * cos)]);
function fake(similarities: Record<string, number> = {}) {
  return {
    status: () => ({ model: { state: 'ready' as const }, docs: 0, chunks: 0, vectors: 0, vec: false }),
    embed: vi.fn(async (texts: string[], mode: 'query' | 'passage') => texts.map(t => mode === 'query' ? vector(1) : vector(similarities[t] ?? 0.7))),
  };
}

describe('local agent classifier', () => {
  it('ranks semantic matches, retains exact names and gives bounded field explanations', async () => {
    const model = fake({ 'SQL specialist': 0.94 });
    const scorer = new AgentClassifier(model);
    const profiles = [profile('writer', 'Editorial work'), profile('database', 'SQL specialist')];
    const result = await scorer.classify('fix slow queries', profiles, []);
    expect(result).toMatchObject({ mode: 'hybrid', noneCloseEnough: false, candidates: [{ id: 'database', score: 83, why: { field: 'purpose' } }, { id: 'writer' }] });
    expect((await scorer.classify('writer', profiles, [])).candidates[0]?.id).toBe('writer');
  });

  it('boosts with completed or done-and-verified past runs, excluding open, old-version and failed runs', async () => {
    const scorer = new AgentClassifier();
    const profiles = [profile('writer'), profile('database', 'database')];
    expect((await scorer.classify('repair database indexes', profiles, [run()])).candidates[0]).toMatchObject({ id: 'writer', why: { field: 'pastRun', runId: 'r_123456789abc' } });
    const verified = run({ endReason: 'closed', report: { ok: true, at: 2, outcome: 'done', verified: 'yes', summary: 'private result' } });
    expect((await scorer.classify('repair database indexes', profiles, [verified])).candidates[0]?.id).toBe('writer');
    const confirmed = run({ endReason: 'closed', outcome: { verdict: 'success', basis: 'human', at: 3, by: 'user' } });
    expect((await scorer.classify('repair database indexes', profiles, [confirmed])).candidates[0]?.id).toBe('writer');
    for (const r of [run({ endedAt: undefined }), run({ version: 2 }), run({ endReason: 'closed' }), run({ outcome: { verdict: 'fail', basis: 'human', at: 3, by: 'user' } })]) {
      expect((await scorer.classify('repair database indexes', profiles, [r])).candidates[0]?.id).toBe('database');
    }
  });

  it('calibrates a conservative boundary against labeled synthetic semantic pairs', async () => {
    // E5's high background similarity is modeled explicitly, rather than treating raw cosine as confidence.
    for (const [similarity, accepted] of [[0.7, false], [0.8, false], [0.85, false], [0.87, true], [0.94, true]] as const) {
      const result = await new AgentClassifier(fake({ specialist: similarity })).classify('unseen paraphrase', [profile('specialist')], []);
      expect(result.noneCloseEnough).toBe(!accepted);
      expect(result.proposal).toBe(accepted ? null : 'ask-user-to-create');
    }
    expect((await new AgentClassifier().classify('unrelated astronomy', [profile('writer')], [])).proposal).toBe('ask-user-to-create');
    expect((await new AgentClassifier().classify('anything', [], [])).noneCloseEnough).toBe(true);
  });

  it('marks words fallback for missing, null, throwing or malformed embedders and retries', async () => {
    const model = fake();
    const scorer = new AgentClassifier({ ...model, status: () => ({ ...model.status(), model: { state: 'missing' } }) });
    expect((await scorer.classify('writer', [profile('writer')], [])).mode).toBe('words');
    expect(model.embed).not.toHaveBeenCalled();
    for (const embed of [vi.fn(async () => null), vi.fn(async () => { throw Error('offline'); }), vi.fn(async () => [new Float32Array([NaN])])]) {
      expect((await new AgentClassifier({ ...model, embed }).classify('writer', [profile('writer')], [])).mode).toBe('words');
    }
  });

  it('caches vectors by text and mode, invalidating edited text without re-embedding unchanged fields', async () => {
    const model = fake(), scorer = new AgentClassifier(model), p = profile('writer', 'draft prose');
    await scorer.classify('writer', [p], []);
    const count = model.embed.mock.calls.length;
    await scorer.classify('writer', [p], []);
    expect(model.embed).toHaveBeenCalledTimes(count);
    await scorer.classify('writer', [{ ...p, purpose: 'new purpose' }], []);
    expect(model.embed).toHaveBeenLastCalledWith(['new purpose'], 'passage');
    expect(model.embed.mock.calls.some(([t, m]) => t.includes('writer') && m === 'query')).toBe(true);
    expect(model.embed.mock.calls.some(([t, m]) => t.includes('writer') && m === 'passage')).toBe(true);
  });

  it('validates requests and preserves discovery trust, pagination and private text boundaries', async () => {
    const profiles = Array.from({ length: 6 }, (_, i) => profile(`agent${i}`));
    profiles[5]!.instructions = 'PRIVATE instructions';
    const source = () => ({ profiles, models: [], problem: null } as unknown as AgentCatalog);
    const scorer = new AgentClassifier();
    const tool = agentCatalogTool(source, request => scorer.classify(request, profiles, []));
    const ctx = { mount: 'test', params: {}, sessionId: '', signal: new AbortController().signal, progress: () => false };
    const output = JSON.parse(await tool.run({ request: 'PRIVATE instructions' }, ctx) as string);
    expect(output).toMatchObject({ trust: 'untrusted-declarations', permissionsGranted: false, nextOffset: 4 });
    expect(output.ranking.candidates[0]).toMatchObject({ id: 'agent5', why: { field: 'instructions' } });
    expect(JSON.stringify(output)).not.toContain('PRIVATE');
    for (const request of ['', ' ', 3, 'x'.repeat(2001)]) await expect(tool.run({ request }, ctx)).rejects.toThrow();
    await expect(tool.run({ request: 'writer', unexpected: true }, ctx)).rejects.toThrow();
  });
});
