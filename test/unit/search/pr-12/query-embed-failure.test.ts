// Proves (PR #12, hybrid search): a failure of the model while embedding the query makes Engine.query reject instead of
// answering from BM25 (ADR 0068 / hybrid/service.ts: "until then, or if it fails, results come from BM25 only"). Only
// the background pump turns a broken model off; the query path awaits embedder.embed unguarded, so with a model that
// fails at run time every search fails: brain_search returns an error to the agent and /api/search, Ctrl+K drop to the
// substring search even though the words index is fine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../../../src/main/search/hybrid/engine';
import type { Embedder } from '../../../../src/main/search/hybrid/embedder';
import { Store } from '../../../../src/main/search/hybrid/store';

describe('query when the model fails at run time', () => {
  it('still returns the words (BM25) hits', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pr12-embfail-'));
    fs.writeFileSync(path.join(root, 'ai-errors.md'), '- 2026-10-01 ERR_TOKEN_EXPIRED: the deploy token expired during the release\n');
    const e = new Engine(new Store(':memory:', null), async () => ['ai-errors.md']);
    await e.sync(root);
    fs.rmSync(root, { recursive: true, force: true });
    const broken: Embedder = { id: 'broken', embed: async () => { throw new Error('onnxruntime: Non-zero status code returned while running node'); } };
    e.setEmbedder(broken);
    let hits: unknown;
    try { hits = (await e.query('ERR_TOKEN_EXPIRED')).map(h => h.path); } catch (err) { hits = `query rejected: ${(err as Error).message}`; }
    expect(hits).toEqual(['ai-errors.md']);
  });
});
