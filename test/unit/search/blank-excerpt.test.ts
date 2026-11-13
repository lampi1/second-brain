// Hybrid search excerpts (regression of PR #12): a hit whose chunk holds none of the query words (a meaning hit, a
// typo-widened word, a file-name match) points at the first text line under a short heading, never at the blank line
// chunkText keeps after it, so Ctrl+K, /api/search and brain_search never show an empty snippet.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Engine, queryWords } from '../../../src/main/search/hybrid/engine';
import { meanNorm, type Embedder } from '../../../src/main/search/hybrid/embedder';
import { Store } from '../../../src/main/search/hybrid/store';

const AXIS: Record<string, number> = { costi: 0, spese: 0, money: 0, budget: 0 };
const embedder: Embedder = {
  id: 'fake',
  embed: async texts => texts.map(t => {
    const v = new Float32Array(3);
    for (const w of queryWords(t)) v[AXIS[w] ?? 2] = v[AXIS[w] ?? 2]! + (AXIS[w] === undefined ? 0.05 : 1);
    return meanNorm(v, 0, 1, 3);
  }),
};

async function engineWith(text: string): Promise<Engine> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pr12-blank-'));
  fs.writeFileSync(path.join(root, 'now.md'), text);
  const e = new Engine(new Store(':memory:', null), async () => ['now.md']);
  e.setEmbedder(embedder);
  await e.sync(root);
  while (await e.embedPending(4) > 0) { /* drain */ }
  fs.rmSync(root, { recursive: true, force: true });
  return e;
}

describe('the line and excerpt of a hit without the query words', () => {
  it('a meaning hit points at the text under the heading, not at the blank line', async () => {
    const e = await engineWith('# Costi\n\nLe spese del mese sono salite per via delle licenze nuove\n');
    const [hit] = await e.query('money');
    expect(hit?.via).toBe('meaning');
    expect({ line: hit?.line, text: hit?.text }).toEqual({ line: 3, text: 'Le spese del mese sono salite per via delle licenze nuove' });
  });

  it('a typo-widened hit points at the text under the heading, not at the blank line', async () => {
    const e = await engineWith('# Dashboard\n\nPronta per la revisione di venerdì con il team\n');
    e.setEmbedder(null); // words only
    const [hit] = await e.query('dashbord');
    expect({ line: hit?.line, text: hit?.text }).toEqual({ line: 3, text: 'Pronta per la revisione di venerdì con il team' });
  });
});
