// Offline classifier contract and calibration fixtures: fake local embeddings, the words-only fallback (model unavailable),
// Italian stopwords and stems, deadlines and errors, and agent_catalog's ranking. No model downloads or CLI runs.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentCatalog, AgentModelChoice, AgentProfile, AgentRun } from '../../src/shared/agents';
import { AgentClassifier, classifyByWords } from '../../src/main/agents/classifier';
import { AgentCatalogService } from '../../src/main/agents/catalog';
import { agentCatalogTool, discoverAgents, discoverRankedAgents, type ClassifyAgents } from '../../src/main/agents/discovery';
import { appControlTools } from '../../src/main/appctl/tools';
import type { BrainService, BrowserService, ChatService } from '../../src/main/services';
import type { AgentClassification } from '../../src/shared/agent-classifier';

type Ranked = { total: number; ranking: AgentClassification; [key: string]: unknown };

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

// Words channel in Italian (review findings): stopwords never score, single-topic requests reach the suggestion.
const it_profiles = (): AgentProfile[] => [
  { ...profile('dba', 'Prestazioni del database: query lente, indici e piani di esecuzione'), name: 'DBA' },
  { ...profile('writer', 'Scrive articoli e post per il blog'), name: 'Redattore', instructions: 'Scrivi in italiano chiaro. Controlla il tono e la lunghezza.' },
];
const scores = (r: { candidates: { id: string; score: number }[] }) => Object.fromEntries(r.candidates.map(c => [c.id, c.score]));

describe('words-only fallback (model unavailable)', () => {
  const words = () => new AgentClassifier();

  it('gives a stopword-only request no points and no suggestion ("il")', async () => {
    const result = await words().classify('il', it_profiles(), []);
    expect(result.candidates.every(c => c.score === 0)).toBe(true);
    expect(result).toMatchObject({ mode: 'words', noneCloseEnough: true, proposal: 'ask-user-to-create' });
  });

  it('suggests the database agent for "le query sul database sono lente"', async () => {
    const result = await words().classify('le query sul database sono lente', it_profiles(), []);
    expect(result.noneCloseEnough).toBe(false);
    expect(result.candidates[0]).toMatchObject({ id: 'dba', why: { field: 'purpose' } });
    expect(result.candidates[0]!.score).toBeGreaterThanOrEqual(60);
    expect(scores(result).writer).toBeLessThan(60);
  });

  it('suggests the writer for "scrivi un articolo sul blog" (scrivi/scrive, articolo/articoli)', async () => {
    const result = await words().classify('scrivi un articolo sul blog', it_profiles(), []);
    expect(result.noneCloseEnough).toBe(false);
    expect(result.candidates[0]).toMatchObject({ id: 'writer' });
    expect(result.candidates[0]!.score).toBeGreaterThanOrEqual(60);
    expect(scores(result).dba).toBe(0);
  });

  it('scores "voglio che tu controlli che il file sia quello giusto" on its topic words only', async () => {
    const long = await words().classify('voglio che tu controlli che il file sia quello giusto', it_profiles(), []);
    const topic = await words().classify('controlli file giusto', it_profiles(), []);
    expect(scores(long)).toEqual(scores(topic));
    // "che", "il", "tu", "sia", "quello", "voglio" alone are worth nothing
    expect((await words().classify('voglio che tu il sia quello', it_profiles(), [])).candidates.every(c => c.score === 0)).toBe(true);
  });

  it('does not punish a long multi-part request that clearly names a topic', async () => {
    const result = await words().classify('le query sul database sono lente da ieri, soprattutto i report mensili del cliente', it_profiles(), []);
    expect(result.candidates[0]?.id).toBe('dba');
    expect(result.candidates[0]!.score).toBeGreaterThanOrEqual(60);
    // one topic word among three scores well below the clear request; no topic word in common is never a suggestion
    expect((await words().classify('database astronomia telescopio', it_profiles(), [])).candidates[0]!.score).toBeLessThan(result.candidates[0]!.score / 2);
    expect((await words().classify('astronomia telescopio', it_profiles(), [])).noneCloseEnough).toBe(true);
  });

  it('falls back to words, without calling the embedder, for every model state but ready and for no embedder', async () => {
    for (const state of [{ state: 'missing' }, { state: 'downloading', done: 1, total: 2 }, { state: 'loading' }, { state: 'error', message: 'x' }]) {
      const model = fake();
      const result = await new AgentClassifier({ ...model, status: () => ({ ...model.status(), model: state as never }) }).classify('le query sul database sono lente', it_profiles(), []);
      expect(result.mode).toBe('words'); expect(result.candidates[0]?.id).toBe('dba');
      expect(model.embed).not.toHaveBeenCalled();
    }
    expect(await classifyByWords('le query sul database sono lente', it_profiles())).toEqual(await words().classify('le query sul database sono lente', it_profiles(), []));
  });
});

describe('semantic channel with a fake embedder', () => {
  it('answers with words within the deadline when the model hangs, and uses the late vectors next time', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const model = fake({ 'SQL specialist': 0.94 });
    const slow = vi.fn(async (texts: string[], mode: 'query' | 'passage') => { await gate; return model.embed(texts, mode); });
    const scorer = new AgentClassifier({ ...model, embed: slow }, 20);
    const profiles = [profile('database', 'SQL specialist')];
    const started = Date.now();
    expect((await scorer.classify('fix slow queries', profiles, [])).mode).toBe('words');
    expect(Date.now() - started).toBeLessThan(1000);
    // a second request while the first embedding is still running joins it: the passage is not embedded twice
    expect((await scorer.classify('fix slow queries', profiles, [])).mode).toBe('words');
    release();
    await new Promise(r => setTimeout(r, 0));
    const passages = slow.mock.calls.filter(([, m]) => m === 'passage').length;
    expect(passages).toBe(1);
    expect(await scorer.classify('fix slow queries', profiles, [])).toMatchObject({ mode: 'hybrid', candidates: [{ id: 'database', score: 83 }] });
    expect(slow.mock.calls.filter(([, m]) => m === 'passage').length).toBe(passages);
  });

  it('shares one embedding between concurrent requests', async () => {
    const model = fake({ 'SQL specialist': 0.94 }), scorer = new AgentClassifier(model);
    const profiles = [profile('database', 'SQL specialist'), profile('writer', 'Editorial work')];
    const [a, b] = await Promise.all([scorer.classify('fix slow queries', profiles, []), scorer.classify('fix slow queries', profiles, [])]);
    expect(a).toEqual(b);
    expect(a.mode).toBe('hybrid');
    expect(model.embed.mock.calls.flatMap(([t]) => t).filter(t => t === 'SQL specialist')).toHaveLength(1);
  });

  it('recovers after an embedder error or a dimension mismatch: nothing broken is cached', async () => {
    const model = fake({ 'SQL specialist': 0.94 });
    let mode: 'throw' | 'mismatch' | 'ok' = 'throw';
    const embed = vi.fn(async (texts: string[], m: 'query' | 'passage') => {
      if (mode === 'throw') throw Error('search worker did not answer embed in time');
      if (mode === 'mismatch' && m === 'passage') return texts.map(() => new Float32Array([1, 0, 0]));
      return model.embed(texts, m);
    });
    const scorer = new AgentClassifier({ ...model, embed }), profiles = [profile('database', 'SQL specialist')];
    expect((await scorer.classify('fix slow queries', profiles, [])).mode).toBe('words');
    mode = 'mismatch';
    expect((await scorer.classify('another request', profiles, [])).mode).toBe('words');
    mode = 'ok';
    expect(await new AgentClassifier({ ...model, embed }).classify('fix slow queries', profiles, [])).toMatchObject({ mode: 'hybrid', candidates: [{ id: 'database', score: 83 }] });
  });

  it('keeps a stable ranking: input order does not matter, ties sort by id, internal agents are excluded', async () => {
    const profiles = [profile('zeta', 'report mensili'), profile('alfa', 'report mensili'), profile('beta', 'database'), { ...profile('default-pulse', 'report mensili'), routable: false }];
    const one = await new AgentClassifier().classify('report mensili', profiles, []);
    const two = await new AgentClassifier().classify('report mensili', [...profiles].reverse(), []);
    expect(one).toEqual(two);
    expect(one.candidates.map(c => c.id)).toEqual(['alfa', 'zeta', 'beta']);
    expect(one.candidates[0]!.score).toBe(one.candidates[1]!.score);
  });

  it('rejects empty, blank, non-text and over-long requests', async () => {
    for (const request of ['', '   ', 3, 'x'.repeat(2001)]) {
      await expect(new AgentClassifier().classify(request as string, it_profiles(), [])).rejects.toThrow(/1–2000/);
    }
  });
});

describe('agent_catalog ranking', () => {
  const catalogModels = (authenticated: boolean): AgentModelChoice[] => [{ engine: 'codex', label: 'Codex', enabled: true, trusted: true, installed: true, authenticated, effort: true, models: [{ id: 'm', name: 'M' }], source: 'unknown', defaultModel: true, modelSelectable: true, modelReason: null }];

  it('ranks the same catalog snapshot it lists, before and after the starters are seeded', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-classifier-'));
    try {
      let models = catalogModels(false);
      const service = new AgentCatalogService({ userData: dir, models: () => models });
      const source = vi.fn(() => service.list());
      const classify = vi.fn<ClassifyAgents>((request, catalog) => new AgentClassifier().classify(request, catalog!.profiles, []));
      // unseeded: nothing to rank, no suggestion, creation still only on the user's request
      const empty = await discoverRankedAgents(source, { request: 'scrivi un articolo' }, classify) as Ranked;
      expect(empty).toMatchObject({ total: 0, ranking: { candidates: [], noneCloseEnough: true, proposal: 'ask-user-to-create' } });
      expect(source).toHaveBeenCalledTimes(1);
      // an engine logs in: the starters arrive, and the ranking covers exactly the routable listed agents
      models = catalogModels(true);
      source.mockClear();
      const seeded = await discoverRankedAgents(source, { request: 'scrivi un articolo' }, classify) as Ranked;
      expect(source).toHaveBeenCalledTimes(1);
      const listed = service.list().profiles.filter(p => p.routable !== false).map(p => p.id).sort();
      expect(listed.length).toBeGreaterThan(1);
      expect(seeded.total).toBe(listed.length);
      expect(seeded.ranking.candidates.map(c => c.id).sort()).toEqual(listed);
      expect(classify.mock.calls.at(-1)![1]).toBe(source.mock.results[0]!.value);
      const target = service.list().profiles[0]!;
      const top = await discoverRankedAgents(() => service.list(), { request: target.purpose }, classify) as Ranked;
      expect(top.ranking.candidates[0]!.id).toBe(target.id);
      // without a request the result is the plain page, unchanged
      expect(await discoverRankedAgents(() => service.list(), {}, classify)).toEqual(discoverAgents(() => service.list(), {}));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('ranks by words when no classifier is wired (demo) and is async on the app-control mount', async () => {
    const profiles = it_profiles();
    const source = () => ({ profiles, models: [], problem: null } as unknown as AgentCatalog);
    const plain = await discoverRankedAgents(source, { request: 'le query sul database sono lente' }) as Ranked;
    expect(plain.ranking.mode).toBe('words'); expect(plain.ranking.candidates[0]!.id).toBe('dba');
    const chats = { list: () => [] } as unknown as ChatService;
    const deps = { chats, browser: {} as BrowserService, brain: {} as BrainService, agents: source, window: () => null, emitUi: () => {}, version: '0' };
    const classifyAgents = vi.fn<ClassifyAgents>(request => classifyByWords(request, profiles));
    const tool = appControlTools({ ...deps, classifyAgents }).find(t => t.name === 'agent_catalog')!;
    const out = tool.run({ request: 'scrivi un articolo sul blog' });
    expect(out).toBeInstanceOf(Promise);
    const ranked = await out as Ranked;
    expect(ranked).toMatchObject({ permissionsGranted: false, trust: 'untrusted-declarations' });
    expect(ranked.ranking.candidates[0]!.id).toBe('writer');
    expect(classifyAgents).toHaveBeenCalledTimes(1);
    await expect(Promise.resolve(tool.run({ request: '' }))).rejects.toThrow();
    expect(classifyAgents).toHaveBeenCalledTimes(1);
  });
});
