// Unit tests of the themes of ai-errors.md and ideas.md (SPEC 23 b, src/main/search/hybrid/themes.ts): average-linkage
// clustering, one entry per dated error line or idea section, the growing flag (share of the last 7 days vs the 7
// before, only with a baseline), labels from the theme's distinctive words, duplicates (not two lines of one chunk, not
// ideas left on the chunks' vector), the newest-entries cap, HybridSearch.themes (not ready without the model or a sync,
// batched embedding, the kept result), /api/themes allowed, and the renderer's normThemes guard.
import { describe, expect, it } from 'vitest';
import { cluster, themesOf } from '../../src/main/search/hybrid/themes';
import { HybridSearch } from '../../src/main/search/hybrid/service';
import { API_PATHS } from '../../src/main/brain/api';
import { normThemes } from '../../src/shared/themes';

const DIM = 32;
/** A unit vector on `axis`, pushed `off` towards a private axis `own`: two such vectors on one axis score 1/(1+off²). */
function vec(axis: number, own?: number, off = 0.35): Float32Array {
  const v = new Float32Array(DIM);
  v[axis] = 1;
  if (own !== undefined) v[own] = off;
  const n = Math.hypot(...v);
  return v.map(x => x / n);
}
let nextLine = 1;
const row = (text: string, v: Float32Array) => ({ id: nextLine, doc: 'brain:ai-errors.md', line: nextLine += 10, text, at: 0, v });
const err = (day: string, area: string, kind: string, said: string, v: Float32Array) =>
  row(`- ${day} 10:00 · claude · ${area} · ${kind} · detto: ${said} · vero: ${said} corretto`, v);

describe('cluster', () => {
  it('joins groups whose average similarity reaches the threshold and leaves the rest alone', () => {
    const vs = [vec(0, 10), vec(0, 11), vec(0, 12), vec(1, 13), vec(1, 14), vec(2)];
    const groups = cluster(vs, 0.88).map(g => g.sort((a, b) => a - b)).sort((a, b) => a[0]! - b[0]!);
    expect(groups).toEqual([[0, 1, 2], [3, 4], [5]]);
    expect(cluster(vs, 0.95)).toHaveLength(6);
  });
});

describe('themesOf (errors)', () => {
  const rows = [
    err('2026-10-17', 'costi', 'stale-data', 'costi giornalieri zero', vec(0, 10)),
    err('2026-10-16', 'costi', 'stale-data', 'costi cursor mancanti', vec(0, 11)),
    err('2026-10-15', 'costi', 'wrong-number', 'costi stimati doppi', vec(0, 12)),
    err('2026-09-01', 'deploy', 'guess', 'deploy release fatto', vec(1, 13)),
    err('2026-09-02', 'deploy', 'guess', 'deploy pipeline verde', vec(1, 14)),
    err('2026-09-03', 'deploy', 'guess', 'deploy tag mancante', vec(1, 15)),
    err('2026-09-04', 'deploy', 'guess', 'deploy versione vecchia', vec(1, 16)),
    err('2026-10-01', 'altro', 'typo', 'nome sbagliato', vec(2)),
    // the week before has a baseline: five unrelated singletons
    ...[25, 26, 27, 28, 29].map((axis, i) => err(`2026-10-0${5 + i}`, 'varie', 'nota', `voce ${axis}`, vec(axis))),
  ];

  it('groups by meaning, drops singletons, puts the growing theme first and labels by distinctive words', async () => {
    const t = await themesOf('errors', rows, '2026-10-17');
    expect(t).toMatchObject({ kind: 'errors', ready: true, entries: 13 });
    expect(t.themes).toHaveLength(2);
    const [costs, deploy] = t.themes;
    expect(costs).toMatchObject({ recent: 3, before: 0, growing: true });
    expect(costs!.label).toContain('costi');
    expect(costs!.entries.map(e => e.day)).toEqual(['2026-10-17', '2026-10-16', '2026-10-15']);
    expect(costs!.entries[0]!.text).toMatch(/^claude · costi · stale-data · detto: costi giornalieri zero/);
    expect(deploy).toMatchObject({ recent: 0, growing: false });
    expect(deploy!.entries).toHaveLength(4);
    expect(deploy!.label).toContain('deploy');
    expect(t.duplicates).toEqual([]);
  });

  it('flags nothing without a baseline the week before (a new brain: everything is recent)', async () => {
    const t = await themesOf('errors', rows.slice(0, 8), '2026-10-17');
    expect(t.themes.map(x => x.growing)).toEqual([false, false]);
    expect(t.themes[0]!.entries).toHaveLength(4);
  });

  it('is not growing when its share of the week before was as large', async () => {
    const older = ['2026-10-08', '2026-10-09', '2026-10-10'].map((d, i) => err(d, 'costi', 'stale-data', 'costi vecchi', vec(0, 20 + i)));
    // this week also has five other entries: costs are 3 of 8 now, 3 of 8 the week before
    const busy = [17, 18, 19, 30, 31].map((axis, i) => err(`2026-10-1${2 + i}`, 'varie', 'nota', `altra ${axis}`, vec(axis)));
    const t = await themesOf('errors', [...rows, ...older, ...busy], '2026-10-17');
    expect(t.themes.find(x => x.label.includes('costi'))).toMatchObject({ recent: 3, before: 3, growing: false });
    // without the five, costs are all of this week: a larger share, growing
    expect((await themesOf('errors', [...rows, ...older], '2026-10-17')).themes[0]).toMatchObject({ recent: 3, before: 3, growing: true });
  });

  it('flags two entries saying the same thing, not two lines of one chunk', async () => {
    const shared = vec(3);
    const t = await themesOf('errors', [
      err('2026-10-17', 'chat', 'wrong-claim', 'chat chiusa', vec(4, 20, 0.05)),
      err('2026-10-10', 'chat', 'wrong-claim', 'chat chiusa davvero', vec(4, 21, 0.05)),
      row('- 2026-10-12 09:00 · a · x · y · detto: uno\n- 2026-10-12 09:05 · a · x · y · detto: due', shared),
    ], '2026-10-17');
    expect(t.entries).toBe(4);
    expect(t.duplicates).toHaveLength(1);
    expect(t.duplicates[0]!.a.day).toBe('2026-10-17');
    expect(t.duplicates[0]!.b.day).toBe('2026-10-10');
    expect(t.duplicates[0]!.score).toBeGreaterThan(0.99);
  });

  it('clusters only the newest 600 entries', async () => {
    const many = Array.from({ length: 700 }, (_, i) => {
      const v = new Float32Array(DIM).map((_, j) => Math.sin(i * 7.3 + j * 1.7));
      return err(`2026-${String(1 + Math.floor(i / 70)).padStart(2, '0')}-10`, 'a', 'b', `voce ${i}`, v.map(x => x / Math.hypot(...v)));
    });
    const t = await themesOf('errors', many, '2026-10-17', { join: 2, duplicate: 2 });
    expect(t.entries).toBe(600);
  });
});

describe('themesOf (ideas)', () => {
  // as in the real file, the template makes every chunk look alike: one shared chunk vector for all
  const same = vec(6);
  const idea = (text: string) => ({ ...row(text, same), doc: 'brain:ideas.md' });
  const rows = [
    idea('# Idee\n\nIntro'),
    idea('## 2026-10-16 · [app] · Tema scuro automatico · `nuova`\n- **Idea:** tema scuro serale'),
    idea('- **Perché:** occhi stanchi la sera\n- **Fonte:** Brother'),
    idea('## 2026-10-15 · Tema scuro per orario · `nuova`\n- **Idea:** tema scuro dopo cena\n- **Fonte:** Brother\n## 2026-09-01 · [brain] · Database · `fatta`'),
    idea('- **Idea:** connessioni salvate in sola lettura'),
  ];
  // the embed hook: the dark-theme ideas near each other, the database one apart
  const embed = async (texts: string[]) => texts.map((t, i) => (/scuro/.test(t) ? vec(0, 10 + i) : vec(1)));

  it('takes one entry per dated section (two in one chunk too) and embeds its title and idea', async () => {
    const seen: string[] = [];
    const t = await themesOf('ideas', rows, '2026-10-17', { embed: async texts => { seen.push(...texts); return embed(texts); } });
    expect(t.entries).toBe(3);
    expect(seen).toEqual(['Tema scuro automatico. tema scuro serale', 'Tema scuro per orario. tema scuro dopo cena', 'Database. connessioni salvate in sola lettura']);
    expect(t.themes).toHaveLength(1);
    expect(t.themes[0]!.entries.map(e => e.text)).toEqual(['Tema scuro automatico', 'Tema scuro per orario']);
    expect(t.themes[0]!.label).toContain('scuro');
    expect(t.duplicates).toEqual([]);
  });

  it('flags two ideas with the same text, even when the embedder hands back one shared vector', async () => {
    const shared = vec(0);
    const twice = [...rows, idea('## 2026-10-17 · Tema scuro automatico · `nuova`\n- **Idea:** tema scuro serale')];
    const t = await themesOf('ideas', twice, '2026-10-17', { embed: async texts => texts.map((x, i) => (/serale/.test(x) ? shared : vec(1, 10 + i))) });
    expect(t.duplicates).toHaveLength(1);
    expect([t.duplicates[0]!.a.day, t.duplicates[0]!.b.day]).toEqual(['2026-10-17', '2026-10-16']);
  });

  it('keeps the chunk vectors when the embed hook fails', async () => {
    const t = await themesOf('ideas', rows, '2026-10-17', { embed: () => Promise.reject(new Error('no model')) });
    expect(t.entries).toBe(3);
    expect(t.themes[0]!.entries).toHaveLength(3);
    expect(t.duplicates).toEqual([]); // the shared chunk vector says nothing about two ideas
  });
});

describe('HybridSearch.themes', () => {
  const ideaRows = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, doc: 'brain:ideas.md', line: i * 3 + 1, text: `## 2026-10-1${i % 10} · Idea ${i} · \`aperta\`
- **Idea:** cosa ${i}`, v: vec(6) }));
  class Fake extends HybridSearch {
    batches: number[] = []; vectorCalls = 0; syncOk = true; root: string | null = 'C:/brain';
    constructor(ready: boolean) {
      super({ dir: '', brainRoot: () => this.root, workerFile: '', download: false });
      (this as unknown as { last: { model: { state: string } } }).last.model.state = ready ? 'ready' : 'missing';
    }
    override sync() { (this as unknown as { syncedRoot: string | null }).syncedRoot = this.syncOk ? this.root : null; return Promise.resolve(this.syncOk); }
    override vectors() { this.vectorCalls++; return Promise.resolve(ideaRows); }
    override embed(texts: string[]) { this.batches.push(texts.length); return Promise.resolve(texts.map((_, i) => vec(i % DIM))); }
  }

  it('is not ready while the model is missing, or when the brain does not sync', async () => {
    const notReady = { kind: 'errors', ready: false, entries: 0, themes: [], duplicates: [] };
    expect(await new Fake(false).themes('errors')).toEqual(notReady);
    const h = new Fake(true);
    h.syncOk = false;
    expect(await h.themes('errors')).toEqual(notReady);
    expect(h.vectorCalls).toBe(0);
  });

  it('embeds the ideas in small batches, once, and keeps the result until the chunks change', async () => {
    const h = new Fake(true);
    const first = await h.themes('ideas', Date.parse('2026-10-17T10:00:00Z'));
    expect(first).toMatchObject({ ready: true, entries: 20 });
    expect(h.batches).toEqual([16, 4]);
    expect(await h.themes('ideas', Date.parse('2026-10-17T11:00:00Z'))).toBe(first);
    ideaRows[0] = { ...ideaRows[0]!, text: `${ideaRows[0]!.text} e altro` };
    const next = await h.themes('ideas', Date.parse('2026-10-17T11:00:00Z'));
    expect(next).not.toBe(first);
    expect(h.batches).toEqual([16, 4, 1]);
  });
});

describe('the outward faces', () => {
  it('/api/themes is an allowed brain API path', () => {
    expect(API_PATHS.has('/api/themes')).toBe(true);
  });

  it('normThemes keeps a good answer and turns garbage into an empty, not-ready one', () => {
    const good = { kind: 'ideas', ready: true, entries: 2, themes: [{ label: 'x', entries: [{ line: 3, text: 't', day: '2026-10-17' }], recent: 1, before: 0, growing: false }], duplicates: [{ a: { line: 3, text: 't', day: null }, b: { line: 9, text: 'u', day: null }, score: 0.97 }] };
    expect(normThemes(good)).toEqual(good);
    expect(normThemes('oops')).toEqual({ kind: 'errors', ready: false, entries: 0, themes: [], duplicates: [] });
    expect(normThemes({ ready: true, themes: [{ entries: 'no' }] }).themes[0]).toEqual({ label: '', entries: [], recent: 0, before: 0, growing: false });
  });
});
