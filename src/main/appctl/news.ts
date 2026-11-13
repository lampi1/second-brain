// The Orchestrator and the «Giornale» (ADR 0279; owner 2026-11-13: «l'orchestrator deve poter aggiungere e rimuovere
// fonti … deve essere proprio il padrone dell'app»): four tools on the Orchestrator's own endpoint, each calling the
// same NewsService methods as the page.
//   app_news           reads: the editions, or one edition's front page, sections and sources with their last reading
//   app_news_edition   creates, changes or deletes an edition (name, the user's sentence, sections, key words)
//   app_news_source    tries a link (zero tokens), adds, removes, pauses or resumes a source
//   app_news_refresh   refreshes one edition or all (the only call that spends tokens: one AI pass per edition)
// No approval and no «user turn» gate: the Orchestrator counts as the user (ADR 0275), the paper holds public links
// only, and a deleted edition or source is rebuilt in a minute. A source must be a public https link (never loopback or
// the LAN); what a source returns is public web text: the answers here carry titles and the app's own summaries only.
// Tests: test/unit/appctl-news.test.ts.
import { FRONT_NOTE, frontPage, type NewsEditionEdit, type NewsMark, type NewsRefresh, type NewsSourceEdit, type NewsSourceTest, type NewsState } from '../../shared/news';
import type { EventMap } from '../../shared/contract';

export interface NewsControl {
  state(): NewsState;
  editEdition(e: NewsEditionEdit): NewsState;
  editSources(e: NewsSourceEdit): NewsState;
  testSource(url: string): Promise<NewsSourceTest>;
  refresh(edition?: string): Promise<NewsRefresh>;
  mark(m: NewsMark): NewsState;
}
interface Tool { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }; run(a: Record<string, unknown>): Promise<object> | object }

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const words = (v: unknown) => (Array.isArray(v) ? v.filter((w): w is string => typeof w === 'string').slice(0, 80) : undefined);
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

export function newsTools(news: NewsControl, emitUi: (cmd: EventMap['ui:command']) => void, now: () => number = Date.now): Tool[] {
  /** the edition an argument names: its id, or its name in any case */
  const find = (ref: unknown) => {
    const k = str(ref, 80).toLowerCase();
    const ed = news.state().editions.find(e => e.id === k || e.name.toLowerCase() === k);
    if (!ed) throw new Error(k ? `edizione sconosciuta: «${k}». Le edizioni: ${news.state().editions.map(e => `${e.id} («${e.name}»)`).join(', ') || 'nessuna'}` : 'manca `edition` (id o nome di un\'edizione, da app_news)');
    return ed;
  };
  const sourceRow = (s: NewsState['sources'][number]) => ({ id: s.id, name: s.name, url: s.url, read: s.read, on: s.on, section: s.section || null, weight: s.weight, ...(s.status ? (s.status.ok ? { last: `ok ${day(s.status.at)}: ${s.status.found} stories, ${s.status.fresh} new` } : { last: `error ${day(s.status.at)}: ${s.status.error}` }) : { last: 'never read' }) });
  const overview = (st: NewsState) => st.editions.map(e => {
    const items = st.items.filter(i => i.edition === e.id && !i.less);
    const last = st.lastBy[e.id];
    return { id: e.id, name: e.name, interest: e.interest, sources: st.sources.filter(s => s.edition === e.id).length, sourcesOn: st.sources.filter(s => s.edition === e.id && s.on).length, stories: items.length, unreadFront: frontPage(items, e.cap, now()).front.filter(i => !i.read).length, lastRefresh: last ? day(last.at) : null };
  });
  return [{
    name: 'app_news',
    description: 'The user\'s «Giornale» (Impara → Giornale): a personal newspaper by EDITIONS, one per subject they follow (AI, electric cars, Formula 1, anything). Each edition has the user\'s sentence on what they want, its own sources (feeds, pages, GitHub releases, read at zero tokens), sections and a front page of a few best stories (' + FRONT_NOTE + '). Without `edition`: the editions (id, name, sources, unread front-page stories, last refresh), the ready-made editions on offer and the daily-refresh setting. With `edition` (id or name): its front page (title, source, date, the app\'s summary and «why it matters», link), its sections, key words and every source with its last reading or error; `open: true` also opens it on screen. Use it when the user asks «cosa c\'è di nuovo», about a story or about their sources. Change things with app_news_edition, app_news_source and app_news_refresh.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: {
      edition: { type: 'string', description: 'an edition\'s id or name; omit for the list of editions' },
      open: { type: 'boolean', description: 'also open the Giornale on screen' },
    }, required: [] },
    run: a => {
      const st = news.state();
      if (a.open === true) emitUi({ action: 'page', value: 'impara/giornale' });
      if (!str(a.edition, 80)) return { editions: overview(st), readyMade: st.templates.map(t => ({ template: t.id, name: t.name, sources: t.sources })), dailyRefresh: st.schedule.on ? `on, at ${String(st.schedule.hour).padStart(2, '0')}:00` : 'off', ...(st.noAi ? { summariesOff: st.noAi } : {}), ...(st.editions.length ? {} : { note: 'No edition yet. Create one with app_news_edition (op create), add sources with app_news_source, then app_news_refresh.' }) };
      const ed = find(a.edition);
      const items = st.items.filter(i => i.edition === ed.id && !i.less);
      const { front, more } = frontPage(items, ed.cap, now());
      const row = (i: typeof items[number]) => ({ id: i.id, title: i.title, source: i.sourceName, date: day(i.at), section: i.section || null, ...(i.summary ? { summary: i.summary } : {}), ...(i.why ? { why: i.why } : {}), ...(i.fit !== undefined ? { fit: i.fit } : {}), url: i.url, read: !!i.read, ...(i.also.length ? { alsoOn: i.also.map(x => x.name) } : {}) });
      return {
        edition: { id: ed.id, name: ed.name, interest: ed.interest, frontPageCap: ed.cap, sections: ed.sections.map(s => ({ id: s.id, name: s.name, words: s.words })), core: ed.core, near: ed.near },
        frontPage: front.map(row), otherRecent: more.length, otherTitles: more.slice(0, 15).map(i => i.title),
        sources: st.sources.filter(s => s.edition === ed.id).map(sourceRow),
        lastRefresh: st.lastBy[ed.id] ?? null,
      };
    },
  }, {
    name: 'app_news_edition',
    description: 'Create, change or delete an edition of the user\'s «Giornale». op create: `name` and `interest` (one sentence in the user\'s own words on what they want from it: the AI pass reads it to choose and explain stories), plus what you can add from knowing the subject: `sections` (2-6, each a name and the words that send a story there) and the key words `core` (the heart of the interest) and `near` (its surroundings), plain lower-case words in the languages of the sources, a stem matches its endings («batteri» matches «batteria», «batterie»); without them the app reads the words from the sentence. `template: "ai"` instead makes the ready-made «AI per chi costruisce agenti» with its chosen sources. A new edition has no sources: look for 8-12 good ones (primary sources with a feed first: the maker\'s blog, the federation, the specialist magazine; never a press-release mill), try each with app_news_source op test, add the ones that work, call app_news_refresh, then tell the user which you kept and which you left out and why. op update: `edition` plus only the fields to change (the stories follow new sections and words at once). op delete: `edition`; its sources and stories go with it, so do it only when the user asks. `frontPageCap` 3-12 (default 7): how few stories the front page holds.',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: {
      op: { type: 'string', enum: ['create', 'update', 'delete'] },
      edition: { type: 'string', description: 'update, delete: the edition\'s id or name' },
      name: { type: 'string', description: 'the edition\'s name as the user says it («Auto elettriche»), at most 60 characters' },
      interest: { type: 'string', description: 'what the user wants from it, in their words, at most 400 characters' },
      sections: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', description: 'on update: the section\'s id from app_news, to rename it and keep its sources and stories' }, name: { type: 'string' }, words: { type: 'array', items: { type: 'string' } } }, required: ['name'] }, description: 'the edition\'s sections, in order (at most 8)' },
      core: { type: 'array', items: { type: 'string' }, description: 'key words at the heart of the interest (at most 60)' },
      near: { type: 'array', items: { type: 'string' }, description: 'key words around it (at most 60)' },
      frontPageCap: { type: 'number', description: '3-12, default 7' },
      template: { type: 'string', enum: ['ai'], description: 'create: a ready-made edition instead of name and interest' },
    }, required: ['op'] },
    run: a => {
      const fields = { ...(typeof a.name === 'string' ? { name: a.name } : {}), ...(typeof a.interest === 'string' ? { interest: a.interest } : {}), ...(typeof a.frontPageCap === 'number' ? { cap: a.frontPageCap } : {}), ...(words(a.core) ? { core: words(a.core)! } : {}), ...(words(a.near) ? { near: words(a.near)! } : {}),
        ...(Array.isArray(a.sections) ? { sections: a.sections.slice(0, 12).map(x => { const r = x && typeof x === 'object' ? x as Record<string, unknown> : {}; return { ...(typeof r.id === 'string' ? { id: r.id } : {}), name: String(r.name ?? ''), ...(words(r.words) ? { words: words(r.words)! } : {}) }; }) } : {}) };
      if (a.op === 'create') {
        const before = new Set(news.state().editions.map(e => e.id));
        const st = news.editEdition({ op: 'create', ...fields, name: str(a.name, 60), ...(str(a.template, 40) ? { template: str(a.template, 40) } : {}) });
        const ed = st.editions.find(e => !before.has(e.id))!;
        emitUi({ action: 'page', value: 'impara/giornale' });
        const n = st.sources.filter(s => s.edition === ed.id).length;
        return { created: { id: ed.id, name: ed.name, sections: ed.sections.map(s => ({ id: s.id, name: s.name })), core: ed.core, near: ed.near, sources: n }, next: n ? 'Call app_news_refresh for this edition.' : 'No sources yet: try candidates with app_news_source (op test), add the good ones (op add), then app_news_refresh.' };
      }
      const ed = find(a.edition);
      if (a.op === 'update') {
        const now2 = news.editEdition({ op: 'update', id: ed.id, ...fields }).editions.find(e => e.id === ed.id)!;
        return { updated: { id: now2.id, name: now2.name, interest: now2.interest, frontPageCap: now2.cap, sections: now2.sections.map(s => ({ id: s.id, name: s.name, words: s.words })), core: now2.core, near: now2.near } };
      }
      if (a.op === 'delete') { news.editEdition({ op: 'delete', id: ed.id }); return { deleted: ed.name, editionsLeft: news.state().editions.map(e => e.name) }; }
      throw new Error('op: create, update o delete');
    },
  }, {
    name: 'app_news_source',
    description: 'The sources of an edition of the user\'s «Giornale». op test: `url` only, tries a link without adding it (zero tokens, one request): how it would be read (feed, GitHub releases, page), how many stories it holds now, the newest date and three titles, or why it cannot be read; test before adding, and prefer a site\'s feed (look for /feed, /rss, /atom.xml, /index.xml) to its page. op add: `edition` and `url` (a public https link: a feed, a blog or news page, a GitHub repository for its releases), optionally `name`, `section` (a section id: where its stories go when their words say nothing), `weight` 0.2-1 (how much the source counts: 1 the primary authority, 0.7 default, 0.4 an aggregator) and `primary: false` for an aggregator or newsletter that rewrites others. op remove / pause / resume: `source` (its id from app_news, or its name or url) and `edition`. Do what the user asks at once («togli la fonte che ripete i comunicati stampa»): find it in app_news, remove it, say what you did.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: { type: 'object', properties: {
      op: { type: 'string', enum: ['test', 'add', 'remove', 'pause', 'resume'] },
      edition: { type: 'string', description: 'the edition\'s id or name (every op but test)' },
      url: { type: 'string', description: 'test, add: the link' },
      source: { type: 'string', description: 'remove, pause, resume: the source\'s id, name or url' },
      name: { type: 'string', description: 'add: the name shown (default: the site\'s host)' },
      section: { type: 'string', description: 'add: a section id of the edition' },
      weight: { type: 'number', description: 'add: 0.2-1, default 0.7' },
      primary: { type: 'boolean', description: 'add: false for an aggregator or a newsletter that rewrites others' },
    }, required: ['op'] },
    run: async a => {
      if (a.op === 'test') {
        const r = await news.testSource(str(a.url, 2000));
        return r.ok ? { ok: true, url: r.url, readAs: r.read, storiesNow: r.found, newest: r.newest ? day(r.newest) : 'no dates on the page', sample: r.sample, ...(r.found === 0 ? { note: 'It answers but holds no story now: a quiet feed, or the wrong link.' } : {}) } : { ok: false, url: r.url, error: r.error, hint: 'Try the site\'s feed (/feed, /rss, /atom.xml, /index.xml) or another page of it.' };
      }
      const ed = find(a.edition);
      if (a.op === 'add') {
        const before = new Set(news.state().sources.map(s => s.id));
        const st = news.editSources({ op: 'add', edition: ed.id, url: str(a.url, 2000), ...(str(a.name, 60) ? { name: str(a.name, 60) } : {}), ...(str(a.section, 80) ? { section: str(a.section, 80) } : {}), ...(typeof a.weight === 'number' ? { weight: a.weight } : {}), ...(typeof a.primary === 'boolean' ? { primary: a.primary } : {}) });
        const src = st.sources.find(s => !before.has(s.id))!;
        return { added: sourceRow(src), sourcesOn: st.sources.filter(s => s.edition === ed.id && s.on).length, next: 'Its stories arrive with the next app_news_refresh.' };
      }
      const k = str(a.source, 2000).toLowerCase();
      const mine = news.state().sources.filter(s => s.edition === ed.id);
      const hit = mine.filter(s => s.id === k || s.name.toLowerCase() === k || s.url.toLowerCase() === k);
      const src = hit.length === 1 ? hit[0]! : (() => { const part = k ? mine.filter(s => s.name.toLowerCase().includes(k) || s.url.toLowerCase().includes(k)) : []; return part.length === 1 ? part[0]! : null; })();
      if (!src) throw new Error(`fonte non trovata (o più di una) per «${k}» in «${ed.name}». Le fonti: ${mine.map(s => `${s.id} («${s.name}»)`).join(', ') || 'nessuna'}`);
      if (a.op === 'remove') { const st = news.editSources({ op: 'remove', id: src.id }); return { removed: src.name, sourcesOn: st.sources.filter(s => s.edition === ed.id && s.on).length, note: 'Its stories already on the paper stay until they age out.' }; }
      if (a.op === 'pause' || a.op === 'resume') { news.editSources({ op: 'toggle', id: src.id, on: a.op === 'resume' }); return { [a.op === 'pause' ? 'paused' : 'resumed']: src.name }; }
      throw new Error('op: test, add, remove, pause o resume');
    },
  }, {
    name: 'app_news_refresh',
    description: 'Refresh the user\'s «Giornale» now: one edition (`edition`: id or name) or all. Reads every source that is on (zero tokens), merges the same story across sources, ranks the paper, then ONE AI pass per edition writes the summary and «why it matters» of its best new stories: the only cost, about 5,000-10,000 tokens per edition on the user\'s Claude. It takes up to a few minutes and returns what it brought: new stories, failed sources (their errors are in app_news), tokens and dollars. Call it after you add sources, or when the user asks for the news; not on your own on a turn that is not about the paper.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: { type: 'object', properties: { edition: { type: 'string', description: 'an edition\'s id or name; omit for all' } }, required: [] },
    run: async a => {
      const ed = str(a.edition, 80) ? find(a.edition) : null;
      if (!news.state().editions.length) throw new Error('nessuna edizione: creane una con app_news_edition');
      const r = await news.refresh(ed?.id);
      const st = news.state();
      const failed = st.sources.filter(s => s.on && (!ed || s.edition === ed.id) && s.status && !s.status.ok).map(s => ({ source: s.name, error: s.status!.error }));
      return { refreshed: ed ? ed.name : 'every edition', sourcesRead: r.sources - r.failed, newStories: r.fresh, merged: r.merged, summarized: r.summarized, tokens: r.tokens, costUsd: r.costUsd, ...(failed.length ? { failedSources: failed } : {}), ...(r.aiError ? { summariesNotWritten: r.aiError } : {}), next: 'Read the front page with app_news (edition) if the user wants to hear it.' };
    },
  }];
}
