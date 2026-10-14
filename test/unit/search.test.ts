// Unit tests of the Ctrl+K full-text search (src/main/search): folding keeps offsets, every word must match, ranking
// (title > phrase > loose words, recency, how many messages), snippets with the mark, transcripts read incrementally
// (only appended lines; a rewritten file from the start), brain markdown re-read only when changed, branches from
// .git/HEAD (worktrees too), the 30-day window, and no work at all between two queries closer than 2 s.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatItem, ChatSummary } from '../../src/shared/contract';
import { fold, part, searchDocs, snippet, terms, type Doc } from '../../src/main/search/text-index';
import { gitBranch, listMarkdown, readAppended, transcriptParts } from '../../src/main/search/sources';
import { SearchService } from '../../src/main/search/service';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 13, 10);
const chatDoc = (id: string, title: string, msgs: [number, string][], extra: Partial<Doc> = {}): Doc => ({
  key: `chat:${id}`, kind: 'chat', title, titleLow: fold(title), at: NOW, parts: msgs.map(([at, t]) => part(at, t)), chatId: id, ...extra,
});

const tmp: string[] = [];
const mkdir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-search-')); tmp.push(d); return d; };
afterEach(() => { for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('fold and terms', () => {
  it('lowers, drops accents and turns separators into spaces without changing the length', () => {
    const s = 'Perché feat/Regia-Overlay_v2.md È';
    expect(fold(s)).toBe('perche feat regia overlay v2 md e');
    expect(fold(s)).toHaveLength(s.length);
    expect(fold('İstanbul')).toHaveLength('İstanbul'.length);
  });
  it('splits the query into distinct words, dropping one-letter words unless alone', () => {
    expect(terms('  Totale  d ordine totale ').words).toEqual(['totale', 'ordine']);
    expect(terms('x').words).toEqual(['x']);
    expect(terms('feat/regia').phrase).toBe('feat regia');
  });
});

describe('searchDocs', () => {
  it('needs every word, in one message', () => {
    const d = chatDoc('a', 'Fix', [[NOW, 'il totale è sbagliato'], [NOW, 'lo sconto applicato']]);
    expect(searchDocs([d], 'totale sconto', { now: NOW })).toEqual([]);
    expect(searchDocs([d], 'TOTALE sbagliato', { now: NOW })[0]).toMatchObject({ kind: 'message', chatId: 'a' });
  });

  it('a title match is a chat hit, ranked above message hits; messages give the snippet and their own date', () => {
    const docs = [chatDoc('a', 'Rimborsi QA', [[NOW - DAY, 'test case 7 sui rimborsi fallisce']]), chatDoc('b', 'Altro', [[NOW, 'parlo di rimborsi qui']])];
    const hits = searchDocs(docs, 'rimborsi', { now: NOW });
    expect(hits.map(h => [h.kind, h.chatId])).toEqual([['chat', 'a'], ['message', 'b']]);
    expect(hits[0]!.at).toBe(NOW - DAY);
    expect(hits[0]!.snippet).toContain('rimborsi');
  });

  it('a phrase beats loose words, a recent message beats an old one, more matching messages help', () => {
    const phrase = chatDoc('p', 'x', [[NOW - 20 * DAY, 'il totale ordine è giusto']]);
    const loose = chatDoc('l', 'y', [[NOW - 20 * DAY, 'ordine e poi il totale']]);
    expect(searchDocs([loose, phrase], 'totale ordine', { now: NOW }).map(h => h.chatId)).toEqual(['p', 'l']);
    const old = chatDoc('o', 'x', [[NOW - 25 * DAY, 'deploy fallito']]);
    const fresh = chatDoc('f', 'y', [[NOW - DAY, 'deploy fallito']]);
    expect(searchDocs([old, fresh], 'deploy', { now: NOW }).map(h => h.chatId)).toEqual(['f', 'o']);
    const many = chatDoc('m', 'z', [[NOW - 25 * DAY, 'deploy'], [NOW - 25 * DAY, 'deploy'], [NOW - 25 * DAY, 'deploy']]);
    const hits = searchDocs([old, many], 'deploy', { now: NOW });
    expect(hits[0]).toMatchObject({ chatId: 'm', count: 3 });
  });

  it('keeps at most perKind hits of each kind, kinds in order chat, message, branch, brain', () => {
    const docs: Doc[] = [
      { key: 'brain:a.md', kind: 'brain', title: 'a.md', titleLow: 'a md', at: NOW, parts: [part(NOW, 'riga uno\nriga due con deploy')], path: 'a.md' },
      { key: 'branch:feat/deploy', kind: 'branch', title: 'feat/deploy', titleLow: fold('feat/deploy'), at: NOW, parts: [], chatId: 'c0' },
      ...Array.from({ length: 9 }, (_, i) => chatDoc(`c${i}`, `t${i}`, [[NOW, `deploy ${i}`]])),
    ];
    const hits = searchDocs(docs, 'deploy', { now: NOW, perKind: 4 });
    expect(hits.map(h => h.kind)).toEqual(['message', 'message', 'message', 'message', 'branch', 'brain']);
    expect(hits.at(-1)).toMatchObject({ path: 'a.md', line: 2 });
  });

  it('finds a branch by its words', () => {
    const d: Doc = { key: 'branch:x', kind: 'branch', title: 'feat/regia-overlay', titleLow: fold('feat/regia-overlay'), at: NOW, parts: [] };
    expect(searchDocs([d], 'regia overlay', { now: NOW })).toHaveLength(1);
    expect(searchDocs([d], 'feat/regia', { now: NOW })).toHaveLength(1);
  });
});

describe('snippet', () => {
  it('cuts around the match, marks it, collapses whitespace and drops markdown emphasis', () => {
    const text = `${'a '.repeat(80)}il **totale**   ordine\n\nsbagliato ${'b '.repeat(120)}`;
    const at = text.indexOf('totale');
    const s = snippet(text, at, 6);
    expect(s.snippet.startsWith('…')).toBe(true);
    expect(s.snippet.endsWith('…')).toBe(true);
    expect(s.snippet.slice(s.mark[0], s.mark[1])).toBe('totale');
    expect(s.snippet).toContain('totale ordine sbagliato');
  });
  it('never cuts an emoji in half at either edge', () => {
    const text = `${'😀'.repeat(40)}x${'🎉'.repeat(80)}`;
    const s = snippet(text, text.indexOf('x'), 1);
    expect(s.snippet).not.toMatch(/\p{Cs}/u); // a lone surrogate (half of an emoji)
    expect(s.snippet.slice(s.mark[0], s.mark[1])).toBe('x');
  });
});

describe('sources', () => {
  const line = (type: 'user' | 'assistant', text: string, extra: object = {}) => JSON.stringify({ type, timestamp: new Date(NOW).toISOString(), message: { content: type === 'user' ? text : [{ type: 'text', text }] }, ...extra });

  it('transcriptParts keeps user and assistant text, drops sidechains, meta, tools and reminders', () => {
    const parts = transcriptParts([
      line('user', 'ciao <system-reminder>segreto</system-reminder>'),
      line('assistant', 'risposta'),
      line('assistant', 'agente', { isSidechain: true }),
      line('user', 'meta', { isMeta: true }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'output' }] } }),
      'not json',
    ]);
    expect(parts.map(p => p.text)).toEqual(['ciao', 'risposta']);
    expect(parts[0]!.at).toBe(NOW);
  });

  it('readAppended reads only new complete lines, nothing when unchanged, all again when the file shrank', async () => {
    const f = path.join(mkdir(), 't.jsonl');
    fs.writeFileSync(f, 'a\nb\npart');
    const r1 = await readAppended(f, null);
    expect(r1!.lines.filter(Boolean)).toEqual(['a', 'b']);
    expect(await readAppended(f, r1!.state)).toBeNull();
    fs.appendFileSync(f, 'ial\nc\n');
    const r2 = await readAppended(f, r1!.state);
    expect(r2!.lines.filter(Boolean)).toEqual(['partial', 'c']);
    expect(r2!.reset).toBe(false);
    fs.writeFileSync(f, 'z\n');
    const r3 = await readAppended(f, r2!.state);
    expect(r3!.reset).toBe(true);
    expect(r3!.lines.filter(Boolean)).toEqual(['z']);
  });

  it('listMarkdown walks markdown only, skipping hidden folders and node_modules', async () => {
    const d = mkdir();
    fs.mkdirSync(path.join(d, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(d, '.git'));
    fs.mkdirSync(path.join(d, 'node_modules', 'x'), { recursive: true });
    for (const f of ['me.md', 'rules/a.md', 'rules/b.txt', '.git/x.md', 'node_modules/x/y.md']) fs.writeFileSync(path.join(d, f), '#');
    expect((await listMarkdown(d)).map(f => f.rel).sort()).toEqual(['me.md', 'rules/a.md']);
  });

  it('gitBranch reads HEAD from a repository, a worktree (.git file) and a subfolder; detached = null', async () => {
    const d = mkdir();
    fs.mkdirSync(path.join(d, 'repo', '.git'), { recursive: true });
    fs.mkdirSync(path.join(d, 'repo', 'src', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(d, 'repo', '.git', 'HEAD'), 'ref: refs/heads/feat/ricerca\n');
    expect(await gitBranch(path.join(d, 'repo', 'src', 'deep'))).toBe('feat/ricerca');
    fs.mkdirSync(path.join(d, 'wtgit'));
    fs.writeFileSync(path.join(d, 'wtgit', 'HEAD'), 'ref: refs/heads/fix/x\n');
    fs.mkdirSync(path.join(d, 'wt'));
    fs.writeFileSync(path.join(d, 'wt', '.git'), `gitdir: ${path.join(d, 'wtgit')}\n`);
    expect(await gitBranch(path.join(d, 'wt'))).toBe('fix/x');
    fs.writeFileSync(path.join(d, 'repo', '.git', 'HEAD'), '0123456789abcdef\n');
    expect(await gitBranch(path.join(d, 'repo'))).toBeNull();
  });
});

describe('SearchService', () => {
  const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
    id, harness: 'claude', origin: 'app', title: id, cwd: 'C:\\x\\alfa', sessionId: null, model: null, effort: null, permissionMode: null, state: 'idle',
    costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: NOW, browserTabIds: [], ...p,
  });

  function setup() {
    const d = mkdir();
    const brain = path.join(d, 'brain');
    fs.mkdirSync(brain);
    fs.writeFileSync(path.join(brain, 'me.md'), '# Mario\nlavora sui rimborsi\n');
    const tr = path.join(d, 'live.jsonl');
    fs.writeFileSync(tr, `${JSON.stringify({ type: 'assistant', timestamp: new Date(NOW).toISOString(), message: { content: [{ type: 'text', text: 'trascrizione sul deploy' }] } })}\n`);
    let clock = NOW;
    const items: Record<string, ChatItem[]> = { cur: [{ kind: 'assistant', id: '1', at: NOW, text: 'cursor parla di rimborsi' }] };
    const chats = [
      chat('live', { sessionId: 's1', title: 'Deploy test' }),
      chat('cur', { harness: 'cursor', title: 'Bug SMS' }),
      chat('old', { closedAt: NOW - 40 * DAY, updatedAt: NOW - 40 * DAY }),
      chat('closed', { closedAt: NOW - DAY, updatedAt: NOW - DAY, title: 'Chiusa ieri' }),
    ];
    let lookups = 0;
    const svc = new SearchService({
      chats: () => chats, items: id => items[id] ?? [],
      transcriptOf: c => { lookups++; return c.id === 'live' ? tr : null; },
      brainRoot: () => brain, branchOf: async cwd => (cwd.endsWith('alfa') ? 'feat/rimborsi' : null), now: () => NOW, clock: () => clock,
    });
    return { svc, tr, brain, items, chats, tick: (ms: number) => { clock += ms; }, lookups: () => lookups };
  }

  it('indexes transcripts, live items, branches and brain files; closed chats in the window only', async () => {
    const { svc } = setup();
    const r = await svc.query('rimborsi');
    expect(r.hits.map(h => `${h.kind}:${h.key}`)).toEqual(['message:chat:cur', 'branch:branch:feat/rimborsi:C:\\x\\alfa', 'brain:brain:me.md']);
    expect((await svc.query('deploy')).hits.map(h => h.kind)).toContain('chat');
    expect(r.indexed).toEqual({ chats: 3, files: 1 });
    const branch = r.hits.find(h => h.kind === 'branch')!;
    expect(branch.chatId).toBe('live'); // the open chat touched last, not the closed one
  });

  it('updates incrementally: appended transcript lines and changed files, after the 2 s pause; nothing in between', async () => {
    const { svc, tr, brain, tick, lookups } = setup();
    await svc.query('deploy');
    fs.appendFileSync(tr, `${JSON.stringify({ type: 'user', timestamp: new Date(NOW).toISOString(), message: { content: 'nuova parola zebra' } })}\n`);
    fs.writeFileSync(path.join(brain, 'idee.md'), 'zebra nel brain');
    expect((await svc.query('zebra')).hits).toEqual([]); // within 2 s: no refresh at all
    const before = lookups();
    tick(2_500);
    expect((await svc.query('zebra')).hits.map(h => h.kind)).toEqual(['message']); // the file list waits 30 s
    expect(lookups()).toBe(before); // the transcript path is kept, a missing one is looked up again only after a minute
    tick(30_000);
    expect((await svc.query('zebra')).hits.map(h => h.kind)).toEqual(['message', 'brain']);
  });

  it('a query under two letters does not build the index', async () => {
    const { svc, lookups } = setup();
    expect((await svc.query(' a ')).hits).toEqual([]);
    expect(lookups()).toBe(0);
  });
});
