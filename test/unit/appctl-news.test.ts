// The Orchestrator's newspaper tools (src/main/appctl/news.ts, ADR 0279) over the real NewsService with a fake network
// and a fake AI: it creates an edition on any subject, tries a link before adding it, adds, pauses and removes sources
// by id, name or part of the link, refreshes one edition, reads its front page, and deletes it. No network, no engine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NewsService, type NewsFetch } from '../../src/main/news/service';
import { newsTools } from '../../src/main/appctl/news';

const NOW = new Date(2026, 10, 13, 9, 0).getTime();
const TITLES = ['Prova invernale della compatta', 'Tariffe di ricarica in autostrada', 'Batterie allo stato solido consegnate', 'Colonnine: la mappa del trimestre'];
const FEED = `<rss><channel>${TITLES.map((t, i) => `<item><title>${t}</title><link>https://volt.example.org/p/${i}</link><pubDate>${new Date(NOW - (i + 1) * 3_600_000).toUTCString()}</pubDate><description>Testo.</description></item>`).join('')}</channel></rss>`;
const fetch: NewsFetch = async url => (url === 'https://volt.example.org/feed' ? { status: 200, contentType: 'application/rss+xml', text: FEED } : url === 'https://comunicati.example.org/rss' ? { status: 200, contentType: 'application/rss+xml', text: '<rss><channel></channel></rss>' } : { status: 404, contentType: 'text/html', text: '' });
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-news-tools-'));
  dirs.push(dir);
  const svc = new NewsService({ dir, now: () => NOW, fetch, noAi: () => null, lang: () => 'it', changed: () => {},
    ai: async prompt => ({ ok: true, text: JSON.stringify([...prompt.matchAll(/"id":\s*"([0-9a-f]{12})"/g)].map(m => ({ id: m[1], summary: 'Riassunto.', why: 'Conta per te.', fit: 3 }))), tokens: 1234, costUsd: 0.01 }) });
  const ui: string[] = [];
  const tools = newsTools(svc, c => ui.push(`${c.action}:${'value' in c ? String(c.value) : ''}`), () => NOW);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a tool answer is read field by field per case
  const call = async (name: string, a: Record<string, unknown> = {}) => await tools.find(t => t.name === name)!.run(a) as Record<string, any>;
  return { svc, call, ui, tools };
}

describe('the Orchestrator edits the newspaper', () => {
  it('offers four tools, only the reader read-only', () => {
    const { tools } = make();
    expect(tools.map(t => t.name)).toEqual(['app_news', 'app_news_edition', 'app_news_source', 'app_news_refresh']);
    expect(tools.filter(t => t.annotations?.readOnlyHint).map(t => t.name)).toEqual(['app_news']);
  });

  it('builds an edition from nothing: create, test, add, refresh, read', async () => {
    const { call, ui } = make();
    expect((await call('app_news')).editions).toEqual([]);
    expect((await call('app_news')).note).toMatch(/app_news_edition/);
    const made = await call('app_news_edition', { op: 'create', name: 'Auto elettriche', interest: 'Mi interessa l\'autonomia vera.', sections: [{ name: 'Prove', words: ['prova'] }, { name: 'Ricarica', words: ['ricarica', 'colonnin'] }], core: ['autonomia', 'batteri'], near: ['prova'] });
    expect(made.created).toMatchObject({ id: 'auto-elettriche', sources: 0, core: ['autonomia', 'batteri'] });
    expect(ui).toContain('page:impara/giornale');
    expect(await call('app_news_source', { op: 'test', url: 'https://volt.example.org/feed' })).toMatchObject({ ok: true, readAs: 'feed', storiesNow: 4 });
    expect(await call('app_news_source', { op: 'test', url: 'https://gone.example.org/feed' })).toMatchObject({ ok: false, error: 'HTTP 404' });
    const added = await call('app_news_source', { op: 'add', edition: 'Auto Elettriche', url: 'https://volt.example.org/feed', name: 'Volt', section: 'prove', weight: 0.9 });
    expect(added.added).toMatchObject({ name: 'Volt', section: 'prove', weight: 0.9, last: 'never read' });
    await call('app_news_source', { op: 'add', edition: 'auto-elettriche', url: 'https://comunicati.example.org/rss', name: 'Comunicati stampa', primary: false });
    const r = await call('app_news_refresh', { edition: 'auto-elettriche' });
    expect(r).toMatchObject({ refreshed: 'Auto elettriche', sourcesRead: 2, newStories: 4, summarized: 4, tokens: 1234 });
    const page = await call('app_news', { edition: 'auto-elettriche' });
    expect(page.frontPage).toHaveLength(4);
    expect(page.frontPage[0]).toMatchObject({ source: 'Volt', summary: 'Riassunto.', why: 'Conta per te.' });
    expect(page.frontPage.find((x: { title: string }) => x.title.startsWith('Colonnine')).section).toBe('ricarica');
    expect(page.sources.map((s: { name: string }) => s.name)).toEqual(['Volt', 'Comunicati stampa']);
    expect(page.sources[0].last).toMatch(/^ok .*4 stories, 4 new$/);
    expect((await call('app_news')).editions[0]).toMatchObject({ id: 'auto-elettriche', sources: 2, sourcesOn: 2, stories: 4, unreadFront: 4 });
  });

  it('removes, pauses and resumes a source by part of its name; refuses a name that fits none or two', async () => {
    const { call, svc } = make();
    await call('app_news_edition', { op: 'create', name: 'Auto' });
    await call('app_news_source', { op: 'add', edition: 'auto', url: 'https://volt.example.org/feed', name: 'Volt' });
    await call('app_news_source', { op: 'add', edition: 'auto', url: 'https://comunicati.example.org/rss', name: 'Comunicati stampa' });
    expect(await call('app_news_source', { op: 'pause', edition: 'auto', source: 'comunicati' })).toEqual({ paused: 'Comunicati stampa' });
    expect(svc.state().sources.find(s => s.name === 'Comunicati stampa')!.on).toBe(false);
    expect(await call('app_news_source', { op: 'resume', edition: 'auto', source: 'Comunicati stampa' })).toEqual({ resumed: 'Comunicati stampa' });
    await expect(call('app_news_source', { op: 'remove', edition: 'auto', source: 'example.org' })).rejects.toThrow(/fonte non trovata/);
    await expect(call('app_news_source', { op: 'remove', edition: 'auto', source: '' })).rejects.toThrow(/fonte non trovata/);
    expect(await call('app_news_source', { op: 'remove', edition: 'auto', source: 'comunicati' })).toMatchObject({ removed: 'Comunicati stampa', sourcesOn: 1 });
    await expect(call('app_news_source', { op: 'add', edition: 'auto', url: 'https://localhost/feed' })).rejects.toThrow(/https pubblico/);
    await expect(call('app_news_source', { op: 'add', edition: 'nope', url: 'https://volt.example.org/x' })).rejects.toThrow(/edizione sconosciuta/);
  });

  it('updates and deletes an edition; the ready-made one comes with its sources', async () => {
    const { call, svc } = make();
    const ai = await call('app_news_edition', { op: 'create', template: 'ai' });
    expect(ai.created.id).toBe('ai');
    expect(ai.created.sources).toBeGreaterThan(20);
    await call('app_news_edition', { op: 'create', name: 'Formula 1' });
    const up = await call('app_news_edition', { op: 'update', edition: 'formula 1', interest: 'Solo gare e regolamento.', frontPageCap: 5, sections: [{ name: 'Gare' }] });
    expect(up.updated).toMatchObject({ interest: 'Solo gare e regolamento.', frontPageCap: 5 });
    expect(up.updated.sections).toEqual([{ id: 'gare', name: 'Gare', words: ['gare'] }]);
    expect(await call('app_news_edition', { op: 'delete', edition: 'formula-1' })).toEqual({ deleted: 'Formula 1', editionsLeft: [svc.state().editions[0]!.name] });
    await expect(call('app_news_edition', { op: 'delete', edition: 'formula-1' })).rejects.toThrow(/edizione sconosciuta/);
    await expect(call('app_news_edition', { op: 'nope' })).rejects.toThrow();
  });

  it('refuses a refresh with no edition', async () => {
    const { call } = make();
    await expect(call('app_news_refresh')).rejects.toThrow(/nessuna edizione/);
  });
});
