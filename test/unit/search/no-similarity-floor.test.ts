// Hybrid search relevance (regression of PR #12): the meaning half has a similarity floor, so a query that shares
// nothing with the brain (no word matches, vector orthogonal to every chunk) returns no hit: Ctrl+K's "Nel brain" group
// stays empty, /api/search returns nothing for nonsense and brain_search can answer "not found".
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Engine, queryWords } from '../../../src/main/search/hybrid/engine';
import { meanNorm, type Embedder } from '../../../src/main/search/hybrid/embedder';
import { Store } from '../../../src/main/search/hybrid/store';
import { brainHitsFrom } from '../../../src/main/search/service';

// concept words → their own axis; any other word → axis 4
const AXIS: Record<string, number> = { costi: 0, spese: 0, soldi: 0, errore: 1, sbaglio: 1, rilascio: 2, deploy: 2 };
const embedder: Embedder = {
  id: 'fake',
  embed: async texts => texts.map(t => {
    const v = new Float32Array(5);
    for (const w of queryWords(t)) v[AXIS[w] ?? 4] = v[AXIS[w] ?? 4]! + 1;
    return meanNorm(v, 0, 1, 5);
  }),
};

async function engine(): Promise<Engine> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pr12-floor-'));
  fs.writeFileSync(path.join(root, 'costs.md'), '- costi spese soldi\n');
  fs.writeFileSync(path.join(root, 'errors.md'), '- errore sbaglio errore\n');
  fs.writeFileSync(path.join(root, 'release.md'), '- rilascio deploy rilascio\n');
  const e = new Engine(new Store(':memory:', null), async () => ['costs.md', 'errors.md', 'release.md']);
  e.setEmbedder(embedder);
  await e.sync(root);
  while (await e.embedPending(4) > 0) { /* drain */ }
  fs.rmSync(root, { recursive: true, force: true });
  return e;
}

describe('meaning hits without a similarity floor', () => {
  it('returns nothing for a query unrelated to every note (no word, cosine 0)', async () => {
    const e = await engine();
    const hits = await e.query('kubernetes');
    expect(hits.map(h => `${h.path} via ${h.via} score ${h.score}`), 'unrelated notes returned as meaning hits').toEqual([]);
  });

  it('Ctrl+K shows no brain file for an unrelated query', async () => {
    const e = await engine();
    const hits = await brainHitsFrom({ query: (q, o) => e.query(q, o) })('kubernetes');
    expect(hits?.map(h => h.path), 'Ctrl+K "Nel brain" filled with unrelated files').toEqual([]);
  });
});
