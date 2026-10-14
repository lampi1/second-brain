// Unit tests of generative UI (ADR 0033): the catalog's schemas and caps (shared/genui.ts checkUi: clean copies, one
// clear error a model can act on, links limited to http(s) and local absolute paths), the ```sb-ui fences of question
// previews (splitUiFences), and the store behind show_ui (main/genui/artifacts.ts): where a visual goes (chat, its
// Regia, its next question with the 60 s fallback), replace by id, at most 20 per chat, persistence across a restart,
// merge into the chat's items by time, removal with the chat.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatItem, ChatSummary, PendingRequest } from '../../src/shared/contract';
import { ARTIFACT_MAX_BYTES, ARTIFACT_MAX_PER_CHAT, checkUi, describeUi, hasUiFence, safeHref, splitUiFences, textOfUi } from '../../src/shared/genui';
import { Artifacts, showUiTool, type Artifact } from '../../src/main/genui/artifacts';
import type { CallCtx } from '../../src/main/mcp/server';

const table = { columns: ['Test', 'Esito'], rows: [{ cells: ['TC 1', 'ok'], status: 'ok', link: { label: 'evidenza', href: 'C:\\qa\\tc1.png' } }, { cells: ['TC 2'] }] };

describe('checkUi: the catalog schemas', () => {
  it('accepts each component and returns a clean copy without unknown keys', () => {
    const r = checkUi('table', { ...table, extra: 1, rows: [{ ...table.rows[0], onclick: 'x' }] });
    expect(r).toEqual({ ok: true, spec: { component: 'table', props: { columns: ['Test', 'Esito'], rows: [{ cells: ['TC 1', 'ok'], status: 'ok', link: { label: 'evidenza', href: 'C:\\qa\\tc1.png' } }] } } });
    expect(checkUi('cards', { options: [{ title: 'A', pros: ['veloce'], cons: ['fragile'], effort: '1 h', risk: 'low', recommended: true }, { title: 'B' }] }).ok).toBe(true);
    expect(checkUi('board', { lanes: [{ title: 'Falliti', status: 'fail', items: [{ title: 'TC 7', detail: 'anche su master', links: [{ label: 'bug', href: 'https://tracker.example.com/bug/1' }] }] }, { title: 'Vuota', items: [] }] }).ok).toBe(true);
    expect(checkUi('diffList', { groups: [{ area: 'main', files: [{ path: 'src/main/x.ts', why: 'nuovo tool', added: 10, removed: 0 }] }] }).ok).toBe(true);
    expect(checkUi('barChart', { unit: '$', bars: [{ label: 'QA', value: 1.84 }, { label: 'Fix', value: -0.2, note: 'rimborso' }] }).ok).toBe(true);
  });

  it('names the path and what is expected on a wrong call', () => {
    expect(checkUi('pie', {})).toMatchObject({ ok: false, error: expect.stringContaining('expected one of table, cards, board, diffList, barChart') });
    expect(checkUi('table', { columns: ['a'] })).toEqual({ ok: false, error: 'table props.rows: missing' });
    expect(checkUi('table', { columns: ['a'], rows: [{ cells: ['x', 'y'] }] })).toEqual({ ok: false, error: 'table props.rows[0].cells: 2 cells for 1 columns' });
    expect(checkUi('table', { columns: ['a'], rows: [{ cells: ['x'], status: 'green' }] })).toMatchObject({ ok: false, error: expect.stringContaining('props.rows[0].status: expected one of ok, fail') });
    expect(checkUi('barChart', { bars: [{ label: 'x', value: '3' }] })).toEqual({ ok: false, error: 'barChart props.bars[0].value: expected a number, got string' });
    expect(checkUi('cards', { options: [] })).toEqual({ ok: false, error: 'cards props.options: needs at least 1 item' });
    expect(checkUi('cards', { options: [{ title: 'a', recommended: true }, { title: 'b', recommended: true }] })).toEqual({ ok: false, error: 'cards props.options: at most one option may be recommended' });
    expect(checkUi('board', { lanes: [{ title: '  ', items: [] }] })).toEqual({ ok: false, error: 'board props.lanes[0].title: empty string' });
  });

  it('caps sizes: rows, text length, the whole props', () => {
    expect(checkUi('table', { columns: ['a'], rows: Array.from({ length: 201 }, () => ({ cells: ['x'] })) })).toMatchObject({ ok: false, error: expect.stringContaining('too many items (201, max 200)') });
    expect(checkUi('table', { columns: ['a'], rows: [{ cells: ['x'.repeat(301)] }] })).toMatchObject({ ok: false, error: expect.stringContaining('too long (301 chars, max 300)') });
    const big = { columns: ['a'], rows: Array.from({ length: 150 }, () => ({ cells: ['y'.repeat(250)] })) };
    expect(JSON.stringify(big).length).toBeGreaterThan(ARTIFACT_MAX_BYTES);
    expect(checkUi('table', big)).toMatchObject({ ok: false, error: expect.stringContaining('props: too big') });
  });

  it('links: only http(s) URLs and local absolute paths', () => {
    expect(safeHref('https://tracker.example.com/bug/1')).toBe('web');
    expect(safeHref('C:\\report\\qa.md')).toBe('file');
    expect(safeHref('file:///C:/report/qa.md')).toBe('file');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '\\\\host\\share\\x', 'relative/x.md', 'file://host/share/x']) expect(safeHref(bad)).toBeNull();
    expect(checkUi('table', { columns: ['a'], rows: [{ cells: ['x'], link: { label: 'l', href: 'javascript:alert(1)' } }] })).toMatchObject({ ok: false, error: expect.stringContaining('expected an http(s) URL or an absolute local path') });
  });

  it('describeUi: a one-line text of each view', () => {
    const r = checkUi('barChart', { unit: '$', bars: [{ label: 'QA', value: 2 }] });
    expect(r.ok && describeUi(r.spec)).toBe('Grafico: QA 2$');
  });
});

describe('textOfUi: a visual as text for Copia', () => {
  const spec = (component: string, props: unknown) => { const r = checkUi(component, props); if (!r.ok) throw new Error(r.error); return r.spec; };
  it('a table becomes a markdown table with its status, empty cells and an escaped pipe', () => {
    const t = textOfUi(spec('table', { columns: ['Caso', 'Nota'], rows: [{ cells: ['TC 1', 'a | b'], status: 'ok' }, { cells: ['TC 2', ''], status: 'fail' }] }), 'QA');
    expect(t).toBe('**QA**\n\n| Stato | Caso | Nota |\n| --- | --- | --- |\n| OK | TC 1 | a \\| b |\n| Fallito | TC 2 |  |');
  });
  it('a diffList lists its paths as code, a chart its values with the unit, cards the recommended one', () => {
    expect(textOfUi(spec('diffList', { groups: [{ area: 'Calcolo', files: [{ path: 'src/a.ts', added: 2, removed: 1, why: 'fix' }] }] }))).toBe('**Calcolo**\n- `src/a.ts` +2 −1: fix');
    expect(textOfUi(spec('barChart', { unit: '$', bars: [{ label: 'Regia', value: 4.12 }] }))).toBe('- Regia: 4.12 $');
    expect(textOfUi(spec('cards', { options: [{ title: 'A', recommended: true, pros: ['piccolo'], risk: 'low' }] }))).toBe('- **A** (consigliata)\n  - + piccolo\n  - rischio basso');
  });
});

describe('splitUiFences: sb-ui fences in a question preview', () => {
  it('splits markdown and visuals, keeping their order', () => {
    const md = 'Prima:\n\n```sb-ui\n{"component":"table","title":"Esiti","props":{"columns":["a"],"rows":[{"cells":["1"]}]}}\n```\n\nPoi testo.';
    expect(hasUiFence(md)).toBe(true);
    const parts = splitUiFences(md);
    expect(parts.map(p => p.kind)).toEqual(['md', 'ui', 'md']);
    expect(parts[1]).toMatchObject({ kind: 'ui', title: 'Esiti', spec: { component: 'table' } });
  });

  it('a wrong fence stays visible with its error; other fences are plain markdown', () => {
    const parts = splitUiFences('~~~sb-ui\n{nope\n~~~\n```sb-ui\n{"component":"cards","props":{"options":[]}}\n```\n```json\n{"a":1}\n```');
    expect(parts[0]).toMatchObject({ kind: 'bad', error: expect.stringContaining('JSON non valido') });
    expect(parts[1]).toMatchObject({ kind: 'bad', error: expect.stringContaining('needs at least 1 item') });
    expect(parts[2]?.kind === 'md' && parts[2].text.trim()).toBe('```json\n{"a":1}\n```');
    expect(hasUiFence('```json\n{}\n```')).toBe(false);
  });
});

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: `Chat ${id}`, cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'running', costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});

function setup(chats: ChatSummary[], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-genui-'))) {
  const sent: { chatId: string; item: ChatItem }[] = [];
  let t = 1_000;
  const store = new Artifacts({ dir, chats: () => chats, emit: (chatId, item) => sent.push({ chatId, item }), now: () => t++, askWaitMs: 60_000 });
  return { store, sent, dir };
}
const args = (p: Record<string, unknown> = {}) => ({ title: 'Esiti QA', summary: '1 passato su 2', component: 'table', props: table, ...p });
const question = (chatId: string, id = 'q1'): PendingRequest => ({ id, chatId, type: 'question', tool: 'AskUserQuestion', title: 'Che faccio?', detail: '', input: {}, at: 0 });

describe('Artifacts: the store behind show_ui', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('target chat: an item of the calling chat, emitted and saved; a wrong call throws a clear error', () => {
    const { store, sent, dir } = setup([chat('w')]);
    expect(store.show('w', args({ id: 'qa' }))).toContain('Mostrato in questa chat: table "Esiti QA" (id qa');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ chatId: 'w', item: { kind: 'artifact', id: 'art-qa', key: 'qa', target: 'chat', ui: { component: 'table' } } });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'w.json'), 'utf8'))).toHaveLength(1);
    expect(() => store.show('w', args({ summary: '' }))).toThrow('summary: required');
    expect(() => store.show('w', args({ props: { columns: [] } }))).toThrow(/table props.columns: needs at least 1 item\. Fix the props/);
    expect(() => store.show('w', args({ target: 'popup' }))).toThrow('target: expected one of chat, regia, next-ask');
    expect(() => store.show('w', args({ id: 'a b' }))).toThrow('id: 1-40');
    expect(() => store.show('gone', args())).toThrow('no longer in the app');
  });

  it('the same id replaces the visual; at most 20 per chat, the oldest go', () => {
    const { store } = setup([chat('w')]);
    store.show('w', args({ id: 'b' }));
    const at = store.items('w')[0]!.at;
    store.show('w', args({ id: 'b', title: 'Aggiornata' }));
    expect(store.items('w').map(a => [a.title, a.at])).toEqual([['Aggiornata', at]]); // keeps its time: same place after a reload
    for (let i = 0; i < ARTIFACT_MAX_PER_CHAT + 3; i++) store.show('w', args({ id: `n${i}` }));
    const ids = store.items('w').map(a => a.key);
    expect(ids).toHaveLength(ARTIFACT_MAX_PER_CHAT);
    expect(ids[0]).toBe('n3');
  });

  it('target regia: shown in the Regia the chat answers to, with the sender; the app section uses its own Regia', () => {
    const all = [chat('r1', { isRegia: true, regiaSince: 1, title: 'Regia' }), chat('r2', { isRegia: true, regiaSince: 2, title: 'Regia · B' }), chat('w', { regiaOf: 'r2', title: 'QA · Rimborsi' }),
      chat('ar', { appRegia: true, space: 'app', title: 'Regia dell\'app' }), chat('aw', { space: 'app' })];
    const { store, sent } = setup(all);
    expect(store.show('w', args({ target: 'regia' }))).toContain('nella Regia «Regia · B»');
    expect(sent.at(-1)).toMatchObject({ chatId: 'r2', item: { from: 'QA · Rimborsi', target: 'regia' } });
    store.show('aw', args({ target: 'regia' }));
    expect(sent.at(-1)?.chatId).toBe('ar');
    // two chats of the same Regia with the same id never replace each other; the sender's folder goes along
    const w2 = chat('w2', { regiaOf: 'r2', cwd: 'C:\\repo2' });
    all.push(w2);
    store.show('w', args({ id: 'status', target: 'regia' }));
    store.show('w2', args({ id: 'status', target: 'regia' }));
    expect(store.items('r2').filter(a => a.key === 'status').map(a => [a.id, a.cwd])).toEqual([['art-w-status', 'C:\\x'], ['art-w2-status', 'C:\\repo2']]);
    store.show('r1', args({ target: 'regia' }));
    expect(sent.at(-1)).toMatchObject({ chatId: 'r1' });
    expect((sent.at(-1)?.item as Artifact).from).toBeUndefined();
  });

  it('target next-ask: waits, then attaches to the chat\'s next question; with none in 60 s it becomes a card', () => {
    vi.useFakeTimers();
    const { store, sent } = setup([chat('w'), chat('o')]);
    store.show('w', args({ id: 'a', target: 'next-ask' }));
    expect(store.items('w')[0]).toMatchObject({ waiting: true });
    store.observe('pending:added', question('o'));                     // another chat's question: not this one
    store.observe('pending:added', { ...question('w'), type: 'permission' });
    expect(store.items('w')[0]?.waiting).toBe(true);
    store.observe('pending:added', question('w', 'q7'));
    expect(store.items('w')[0]).toMatchObject({ askId: 'q7' });
    expect(store.items('w')[0]?.waiting).toBeUndefined();
    vi.advanceTimersByTime(61_000);                                   // linked: the fallback timer is gone
    expect(store.items('w')[0]?.askId).toBe('q7');

    store.show('w', args({ id: 'b', target: 'next-ask' }));
    const n = sent.length;
    vi.advanceTimersByTime(59_000);
    expect(store.items('w').find(a => a.key === 'b')?.waiting).toBe(true);
    vi.advanceTimersByTime(2_000);
    const b = store.items('w').find(a => a.key === 'b')!;
    expect(b.waiting).toBeUndefined();
    expect(b.askId).toBeUndefined();
    expect(sent.length).toBe(n + 1);                                   // the page hears it once more
    store.stop();
  });

  it('survives a restart (a still-waiting one shows as a card) and merges into the items by time', () => {
    vi.useFakeTimers();
    const first = setup([chat('w')]);
    first.store.show('w', args({ id: 'x' }));
    first.store.show('w', args({ id: 'y', target: 'next-ask' }));
    first.store.stop();
    const again = setup([chat('w')], first.dir);
    const items = again.store.items('w');
    expect(items.map(a => a.key)).toEqual(['x', 'y']);
    expect(items[1]?.waiting).toBeUndefined();
    const base: ChatItem[] = [
      { kind: 'user', id: 'u', at: 500, text: 'via' },
      { kind: 'assistant', id: 'a1', at: 1_000, text: 'ecco' },
      { kind: 'assistant', id: 'a2', at: 5_000, text: 'dopo' },
    ];
    expect(again.store.merge('w', base).map(i => i.id)).toEqual(['u', 'a1', 'art-x', 'art-y', 'a2']);
    expect(again.store.merge('none', base)).toBe(base);
  });

  it('a removed chat\'s visuals go, file included', () => {
    const { store, dir } = setup([chat('w')]);
    store.show('w', args());
    store.observe('chat:removed', { chatId: 'w' });
    expect(fs.existsSync(path.join(dir, 'w.json'))).toBe(false);
    expect(store.items('w')).toEqual([]);
  });

  it('a damaged or tampered file is ignored item by item (every visual re-checked on load)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-genui-'));
    fs.writeFileSync(path.join(dir, 'w.json'), JSON.stringify([
      { kind: 'artifact', id: 'art-ok', key: 'ok', at: 1, title: 't', summary: 's', target: 'chat', ui: { component: 'barChart', props: { bars: [{ label: 'a', value: 1 }] } } },
      { kind: 'artifact', id: 'art-bad', key: 'bad', at: 2, title: 't', summary: 's', target: 'chat', ui: { component: 'html', props: '<script>' } },
    ]));
    expect(setup([chat('w')], dir).store.items('w').map(a => a.key)).toEqual(['ok']);
    fs.writeFileSync(path.join(dir, 'w.json'), '{not json');
    expect(setup([chat('w')], dir).store.items('w')).toEqual([]);
  });

  it('show_ui: the tool knows its caller from the endpoint path', async () => {
    const { store, sent } = setup([chat('w')]);
    const tool = showUiTool(store);
    expect(tool.inputSchema).toMatchObject({ required: ['title', 'summary', 'component', 'props'] });
    const ctx = { mount: 'browser-chat', params: { chatId: 'w', token: 't' }, sessionId: '', signal: new AbortController().signal, progress: () => false } satisfies CallCtx;
    await expect(Promise.resolve(tool.run(args(), ctx))).resolves.toContain('Mostrato in questa chat');
    expect(sent[0]?.chatId).toBe('w');
  });
});
