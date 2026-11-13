// Unit tests of the hybrid brain search (src/main/search/hybrid, SPEC 23): chunks keep their file lines, typo tolerance
// (one typo from 4 letters, two from 8, transpositions), the index (incremental sync, removed files, prefix filter, BM25
// over accents and file names), the fusion of words and meaning with a fake embedder (paraphrases and the other language
// found only by meaning, exact codes by words), the words-only path without a model, vectors re-embedded only for
// changed chunks, the model download (sha256 checked, .part removed), the brain_search tool, /api/search and the Ctrl+K
// brain hits (one per file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chunkText } from '../../src/main/search/hybrid/chunk';
import { allowedTypos, editDistance, nearWords } from '../../src/main/search/hybrid/typo';
import { openStore, Store } from '../../src/main/search/hybrid/store';
import { BRAIN, Engine, queryWords, type Hit } from '../../src/main/search/hybrid/engine';
import { downloadModel, meanNorm, type Embedder } from '../../src/main/search/hybrid/embedder';
import { topK } from '../../src/main/search/hybrid/service';
import { apiSearch, brainSearchTool } from '../../src/main/search/hybrid/tool';
import { brainHitsFrom } from '../../src/main/search/service';

const tmp: string[] = [];
const mkdir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-hybrid-')); tmp.push(d); return d; };
afterEach(() => { for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

// A fake embedder: each word votes for a concept (Italian and English words of one concept share it), so texts that
// mean the same thing in other words are near, as with the real model. It counts the texts it embedded.
const CONCEPTS: Record<string, number> = {
  costi: 0, cost: 0, costs: 0, spese: 0, spesa: 0, soldi: 0, money: 0, budget: 0,
  errore: 1, errori: 1, error: 1, mistake: 1, sbaglio: 1, sbagliato: 1, bug: 1,
  deploy: 2, rilascio: 2, release: 2, pubblicare: 2,
  gatto: 3, cat: 3, animale: 3,
};
function fakeEmbedder(): Embedder & { seen: string[] } {
  const seen: string[] = [];
  return {
    id: 'fake', seen,
    embed: async (texts, mode) => texts.map(t => {
      if (mode === 'passage') seen.push(t);
      const v = new Float32Array(5);
      for (const w of queryWords(t)) { const c = CONCEPTS[w]; v[c ?? 4] = v[c ?? 4]! + (c === undefined ? 0.05 : 1); }
      return meanNorm(v, 0, 1, 5);
    }),
  };
}

function brain(files: Record<string, string>): string {
  const root = mkdir();
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
  return root;
}
const listAll = async (root: string): Promise<string[]> =>
  (fs.readdirSync(root, { recursive: true }) as string[]).map(f => f.replace(/\\/g, '/')).filter(f => fs.statSync(path.join(root, f)).isFile());
const engineOn = () => new Engine(new Store(':memory:', null), listAll);
const embedAll = async (e: Engine) => { while (await e.embedPending(4) > 0) { /* drain */ } };

describe('chunkText', () => {
  it('skips frontmatter, cuts at headings and list items, joins tiny blocks and keeps the file lines', () => {
    const text = ['---', 'title: x', '---', '# Errors', '', '- 2026-10-01 the deploy went to production without the gate, and the rollback took an hour', '- 2026-10-02 wrong branch pushed: always check git status before a push to a shared remote', '', 'A plain paragraph that is long enough to stand on its own as a chunk of text.'].join('\n');
    const chunks = chunkText(text);
    expect(chunks.map(c => c.line)).toEqual([4, 7, 9]);
    expect(chunks[0]!.text.startsWith('# Errors\n\n- 2026-10-01')).toBe(true); // the heading rides with the first item
    const lines = text.split('\n');
    for (const c of chunks) c.text.split('\n').forEach((l, i) => { if (l) expect(lines[c.line - 1 + i]).toBe(l); });
  });

  it('splits long blocks at line ends and cuts a very long line', () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i} `.padEnd(60, 'x')).join('\n');
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.text.length <= 1200)).toBe(true);
    expect(chunks[1]!.line).toBe(1 + chunks[0]!.text.split('\n').length);
    expect(chunkText('y'.repeat(3000)).map(c => c.text.length)).toEqual([1200, 1200, 600]);
  });
});

describe('typo tolerance', () => {
  it('counts a transposition as one edit and stops past the limit', () => {
    expect(editDistance('dashbord', 'dashboard', 2)).toBe(1);
    expect(editDistance('costi', 'cotsi', 1)).toBe(1);
    expect(editDistance('abc', 'xyz12', 1)).toBe(2);
  });

  it('allows none under 4 letters, one up to 7, two from 8, and returns the closest words first', () => {
    expect([3, 4, 7, 8].map(allowedTypos)).toEqual([0, 1, 1, 2]);
    expect(nearWords('cat', ['car', 'cut'])).toEqual([]);
    expect(nearWords('dashbord', ['dashboard', 'dashboards', 'keyboard'])).toEqual(['dashboard', 'dashboards']);
  });
});

describe('Engine', () => {
  it('finds by words (accents folded, file names, the last word as a prefix, typos) without a model', async () => {
    const root = brain({ 'now.md': '- La Dashboard dei costi è pronta per la revisione', 'journal/2026-10.md': '- Rilascio della versione con il Perché scritto', 'ideas.md': '- Un gatto come mascotte' });
    const e = engineOn();
    expect(await e.sync(root)).toBe(3);
    expect((await e.query('perche'))[0]?.path).toBe('journal/2026-10.md');
    expect((await e.query('journal'))[0]?.path).toBe('journal/2026-10.md');
    expect((await e.query('dashb'))[0]?.path).toBe('now.md');
    const typo = await e.query('dashbord costi');
    expect(typo[0]).toMatchObject({ path: 'now.md', line: 1, via: 'words' });
    expect(await e.query('mascotte', { prefix: `${BRAIN}journal/` })).toEqual([]);
    expect(e.status()).toMatchObject({ docs: 3, vectors: 0 });
  });

  it('re-reads only changed files, drops removed ones, and re-embeds only new chunk texts', async () => {
    const root = brain({ 'a.md': '- the first error was a wrong branch pushed to the shared remote by mistake\n\n- second idea: a cat on the dashboard, sleeping next to the cost chart', 'b.md': '- spese del mese' });
    const e = engineOn(), emb = fakeEmbedder();
    e.setEmbedder(emb);
    await e.sync(root); await embedAll(e);
    expect(emb.seen).toHaveLength(3);
    expect(await e.sync(root)).toBe(0);
    fs.appendFileSync(path.join(root, 'a.md'), '\n\n- third: a new budget line for the month, with the totals of every chat');
    fs.rmSync(path.join(root, 'b.md'));
    expect(await e.sync(root)).toBe(2);
    await embedAll(e);
    expect(emb.seen.slice(3)).toEqual(['- third: a new budget line for the month, with the totals of every chat']);
    expect(e.status()).toMatchObject({ docs: 1, chunks: 3, vectors: 3 });
    expect((await e.query('spese')).map(h => h.path)).not.toContain('b.md');
  });

  it('fuses words and meaning: a paraphrase or the other language is found by meaning, an exact code by words', async () => {
    const root = brain({
      'ai-errors.md': '- Sbaglio: ho pubblicato senza il gate locale e senza guardare la pipeline\n\n- Codice SB-4411 nel log del rilascio',
      'costs.md': '- Le spese del mese sono salite: budget da rivedere',
      'pets.md': '- Il gatto dorme sul divano tutto il giorno',
    });
    const e = engineOn();
    e.setEmbedder(fakeEmbedder());
    await e.sync(root); await embedAll(e);
    const money = await e.query('how much money');
    expect(money[0]).toMatchObject({ path: 'costs.md', via: 'meaning' });
    expect((await e.query('mistake'))[0]?.path).toBe('ai-errors.md');
    const code = await e.query('SB-4411');
    expect(code[0]).toMatchObject({ path: 'ai-errors.md', line: 3 });
    expect(code[0]!.via === 'words' || code[0]!.via === 'both').toBe(true);
    expect((await e.query('gatto divano'))[0]).toMatchObject({ path: 'pets.md', via: 'both' });
    expect(e.vectors(`${BRAIN}ai-errors.md`).map(r => r.line)).toEqual([1, 3]);
  });
});

describe('Store on disk', () => {
  it('creates its folder (a new profile has no userData/search) and keeps the index across opens', async () => {
    const file = path.join(mkdir(), 'search', 'index.db');
    const s = new Store(file, null);
    s.put({ key: 'brain:a.md', size: 1, mtimeMs: 1 }, [{ line: 1, text: 'hello world' }]);
    s.close();
    const again = new Store(file, null);
    expect(again.counts('x')).toMatchObject({ docs: 1, chunks: 1 });
    again.close();
  });
  it('rebuilds a corrupt index file instead of failing at every start (the bad file is closed, so Windows can delete it)', () => {
    const file = path.join(mkdir(), 'index.db');
    fs.writeFileSync(file, Buffer.alloc(4096, 'not a database '));
    expect(() => new Store(file, null)).toThrow(/not a database/);
    fs.rmSync(file); // EBUSY on Windows when the failed open kept the file
    fs.writeFileSync(file, Buffer.alloc(4096, 'not a database '));
    fs.writeFileSync(`${file}-wal`, 'junk');
    const s = openStore(file, null);
    s.put({ key: 'brain:a.md', size: 1, mtimeMs: 1 }, [{ line: 1, text: 'hello world' }]);
    expect(s.counts('x')).toMatchObject({ docs: 1, chunks: 1 });
    s.close();
  });
});

describe('hit line', () => {
  it('finds the query word past the twelfth word of a long line', async () => {
    const long = `${Array.from({ length: 20 }, (_, i) => `parola${i}`).join(' ')} zebra finale`;
    const root = brain({ 'a.md': `# Titolo della nota abbastanza lungo da stare da solo come blocco

- prima riga senza nulla
${long}` });
    const e = engineOn();
    await e.sync(root);
    expect((await e.query('zebra'))[0]).toMatchObject({ line: 4 });
  });
});

describe('downloadModel', () => {
  it('removes the partial file and fails on a wrong hash', async () => {
    const dir = mkdir();
    const fetchFn = (async () => new Response('not the model')) as unknown as typeof fetch;
    await expect(downloadModel(dir, () => undefined, fetchFn)).rejects.toThrow(/sha256 mismatch/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('fails on an HTTP error', async () => {
    const fetchFn = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(downloadModel(mkdir(), () => undefined, fetchFn)).rejects.toThrow(/HTTP 503/);
  });
});

describe('the outward faces', () => {
  const hit = (p: string, line: number, text: string, score = 0.03): Hit => ({ doc: `brain:${p}`, path: p, line, text, chunk: `${text}\n${'more '.repeat(100)}`, at: 5, score, via: 'both' });
  const calls: { q: string; opts: object }[] = [];
  const query = async (q: string, opts: { limit?: number; prefix?: string }) => { calls.push({ q, opts }); return [hit('a.md', 3, 'Costi del mese'), hit('a.md', 9, 'altri costi'), hit('b.md', 1, 'budget')]; };
  afterEach(() => { calls.length = 0; });

  it('brain_search: path:line, a short excerpt, a folder limit and a capped count', async () => {
    const out = JSON.parse(String(await brainSearchTool(query).run({ q: 'costi', path: '.\\journal\\', limit: 99 }, {} as never)));
    expect(calls[0]).toEqual({ q: 'costi', opts: { limit: 30, prefix: 'brain:journal/' } });
    expect(out[0]).toMatchObject({ at: 'a.md:3', line: 'Costi del mese', via: 'both' });
    expect(out[0].excerpt.length).toBeLessThanOrEqual(401);
    await expect(brainSearchTool(query).run({ q: ' x ' }, {} as never)).rejects.toThrow(/two characters/);
  });

  it('/api/search keeps the brain pages\' shape', async () => {
    expect(await apiSearch(query, new URLSearchParams('q=c'))).toEqual([]);
    expect((await apiSearch(query, new URLSearchParams('q=costi')))[0]).toEqual({ file: 'a.md', line: 3, text: 'Costi del mese', score: 0.03, via: 'both' });
  });

  it('Ctrl+K: the best hit per file with the query word marked', async () => {
    const hits = await brainHitsFrom({ query } as never)('costi');
    expect(hits?.map(h => `${h.path}:${h.line}`)).toEqual(['a.md:3', 'b.md:1']);
    expect(hits?.[0]).toMatchObject({ kind: 'brain', key: 'brain:a.md', mark: [0, 5] });
    expect(hits?.[1]?.mark).toBeNull();
  });

  it('Ctrl+K falls back to its own index (null) when the hybrid search fails or is slow', async () => {
    expect(await brainHitsFrom({ query: async () => { throw new Error('brain index not ready'); } } as never)('costi')).toBeNull();
    expect(await brainHitsFrom({ query: () => new Promise(() => undefined) } as never, 20)('costi')).toBeNull();
  });

  it('topK ranks by cosine', () => {
    const v = (...x: number[]) => meanNorm(Float32Array.from(x), 0, 1, x.length);
    expect(topK(v(1, 0), [{ id: 'a', vec: v(0, 1) }, { id: 'b', vec: v(1, 1) }, { id: 'c', vec: v(1, 0) }], 2).map(r => r.id)).toEqual(['c', 'b']);
  });
});
