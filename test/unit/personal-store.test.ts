// The personal browser's data file (personal/store.ts, ADR 0133): only web pages are kept, a broken file starts empty,
// bookmarks and sessions de-duplicate, the history stays capped and the file survives a restart.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_HISTORY, PersonalStore, keepable, parse } from '../../src/main/personal/store';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-personal-')), 'personal-browser.json');

describe('personal store', () => {
  it('keeps only http(s) pages', () => {
    expect(keepable('https://example.com/a')).toBe(true);
    expect(keepable('http://localhost:3000')).toBe(true);
    for (const u of ['about:blank', 'file:///c:/x', 'javascript:alert(1)', 'chrome://settings', 'data:text/html,x', '', 42]) expect(keepable(u)).toBe(false);
  });

  it('parses only well-formed entries', () => {
    const d = parse({ bookmarks: [{ id: 'b-1', url: 'https://a.com', title: 'A' }, { id: 'bad id!', url: 'https://b.com' }, { id: 'b-2', url: 'file:///x' }], sessions: [{ id: 's-1', name: ' Lavoro ', tabs: [{ url: 'https://a.com' }, { url: 'about:blank' }] }, { id: 's-2', name: 'Vuota', tabs: [] }], history: 'nope', lastTabs: [{ url: 'https://c.com', title: 'C' }] });
    expect(d.bookmarks.map(b => b.id)).toEqual(['b-1']);
    expect(d.sessions).toEqual([{ id: 's-1', name: 'Lavoro', at: 0, tabs: [{ url: 'https://a.com', title: 'https://a.com' }] }]);
    expect(d.history).toEqual([]);
    expect(d.lastTabs).toEqual([{ url: 'https://c.com', title: 'C' }]);
    expect(parse(null).bookmarks).toEqual([]);
  });

  it('a broken file starts empty', () => {
    const f = tmp();
    fs.writeFileSync(f, '{not json');
    expect(new PersonalStore(f).bookmarks()).toEqual([]);
  });

  it('bookmarks: one per address, newest first, web pages only', () => {
    const s = new PersonalStore(tmp());
    s.addBookmark('https://a.com', 'A');
    s.addBookmark('https://b.com', 'B');
    s.addBookmark('https://a.com', 'A nuova');
    expect(s.bookmarks().map(b => [b.url, b.title])).toEqual([['https://b.com', 'B'], ['https://a.com', 'A nuova']]);
    expect(() => s.addBookmark('javascript:alert(1)', 'x')).toThrow();
    s.removeBookmark(s.bookmarks()[0]!.id);
    expect(s.bookmarks().map(b => b.url)).toEqual(['https://a.com']);
  });

  it('sessions: named, non-empty, the same name replaces', () => {
    const s = new PersonalStore(tmp());
    expect(() => s.saveSession('', [{ url: 'https://a.com', title: 'A' }])).toThrow();
    expect(() => s.saveSession('Vuota', [{ url: 'about:blank', title: '' }])).toThrow();
    s.saveSession('Lavoro', [{ url: 'https://a.com', title: 'A' }]);
    const again = s.saveSession('lavoro', [{ url: 'https://b.com', title: 'B' }, { url: 'about:blank', title: '' }]);
    expect(s.sessions()).toHaveLength(1);
    expect(s.session(again.id)?.tabs).toEqual([{ url: 'https://b.com', title: 'B' }]);
  });

  it('history: a reload does not pile up, titles arrive later, capped, clearable', () => {
    let now = 1;
    const s = new PersonalStore(tmp(), () => now++);
    s.visit('https://a.com', '');
    s.visit('https://a.com', '');
    s.retitle('https://a.com', 'Titolo A');
    s.visit('about:blank', '');
    expect(s.history()).toEqual([{ url: 'https://a.com', title: 'Titolo A', at: 2 }]);
    for (let i = 0; i < MAX_HISTORY + 10; i++) s.visit(`https://x.com/${i}`, '');
    expect(s.history(MAX_HISTORY + 100)).toHaveLength(MAX_HISTORY);
    s.clearHistory();
    expect(s.history()).toEqual([]);
  });

  it('survives a restart', () => {
    const f = tmp();
    const s = new PersonalStore(f);
    s.addBookmark('https://a.com', 'A');
    s.saveSession('Lavoro', [{ url: 'https://a.com', title: 'A' }]);
    s.setLastTabs([{ url: 'https://b.com', title: 'B' }, { url: 'about:blank', title: '' }]);
    s.flush();
    const back = new PersonalStore(f);
    expect(back.bookmarks().map(b => b.url)).toEqual(['https://a.com']);
    expect(back.sessions().map(x => x.name)).toEqual(['Lavoro']);
    expect(back.lastTabs()).toEqual([{ url: 'https://b.com', title: 'B' }]);
  });
});
