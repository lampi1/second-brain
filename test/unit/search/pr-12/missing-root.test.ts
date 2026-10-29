// Proves (PR #12, hybrid search): a brain folder that is briefly unreachable (a network or OneDrive folder offline, a USB
// disk, a folder being replaced) is synced as an empty brain: brainFiles' git call fails (no cwd), the fallback walk finds
// nothing, Engine.sync removes every document, and the next idle pump prunes every vector. When the folder is back, every
// chunk of the brain is embedded again (ADR 0094: minutes of background CPU), and meanwhile the search finds nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Engine, queryWords } from '../../../../src/main/search/hybrid/engine';
import { meanNorm, type Embedder } from '../../../../src/main/search/hybrid/embedder';
import { Store } from '../../../../src/main/search/hybrid/store';

function countingEmbedder(): Embedder & { passages: number } {
  const e = {
    id: 'fake', passages: 0,
    embed: async (texts: string[], mode: 'query' | 'passage') => {
      if (mode === 'passage') e.passages += texts.length;
      return texts.map(t => { const v = new Float32Array(4); for (const w of queryWords(t)) v[w.length % 4] = v[w.length % 4]! + 1; return meanNorm(v, 0, 1, 4); });
    },
  };
  return e;
}

describe('a brain folder that is briefly missing', () => {
  it('keeps the index (and its vectors) instead of treating the folder as empty', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pr12-missing-'));
    const root = path.join(base, 'brain');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'now.md'), '- the release of friday waits for the review of the budget\n');
    fs.writeFileSync(path.join(root, 'ideas.md'), '- a dashboard of the monthly costs of every chat and engine\n');
    const emb = countingEmbedder();
    const e = new Engine(new Store(':memory:', null)); // the real brainFiles
    e.setEmbedder(emb);
    try {
      await e.sync(root);
      while (await e.embedPending(8) > 0) { /* drain */ }
      expect(emb.passages).toBe(2);

      fs.renameSync(root, `${root}-away`); // offline for a moment
      await expect(e.sync(root)).rejects.toThrow();
      await e.embedPending(8); // the worker's pump after a sync that changed something
      fs.renameSync(`${root}-away`, root); // back
      await e.sync(root);
      while (await e.embedPending(8) > 0) { /* drain */ }

      expect({ docs: e.status().docs, reEmbedded: emb.passages - 2 }, 'the whole brain was dropped and embedded again').toEqual({ docs: 2, reEmbedded: 0 });
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});
