// Unit tests of main/projectmap/service.ts (ADR 0271): save makes versions (new name → slug, existing name → next
// version), update confirms statuses and binds the calling chat, a correction is kept, an agent editing a file an element
// was read from is bound to it and marks the element changed (so it reads «da verificare») until a status confirms it,
// the agents show with their state and steps, a removed chat leaves the map, and the page hears it (debounced).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => String(e) }));
import type { ChatItem, ChatSummary, PendingRequest } from '../../src/shared/contract';
import { ProjectMaps } from '../../src/main/projectmap/service';
import { ProjectMapStore } from '../../src/main/projectmap/store';

const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: p.id, cwd: 'C:\\repo\\shop', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'running', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
});
const drawing = {
  elements: [
    { id: 'web', kind: 'system', name: 'Web', status: 'ok', evidence: ['src/'] },
    { id: 'cart', kind: 'part', name: 'Carrello', parent: 'web', status: 'ok', evidence: ['src/cart/'] },
    { id: 'pay', kind: 'external', name: 'Pagamenti' },
  ],
  links: [{ from: 'cart', to: 'pay', label: 'addebita' }],
};

let dir: string, now: number, chats: ChatSummary[], items: Record<string, ChatItem[]>, pending: PendingRequest[], emitted: string[];
const make = () => new ProjectMaps({ store: new ProjectMapStore(() => dir), chats: () => chats, items: id => items[id] ?? [], pending: () => pending,
  emit: p => emitted.push(p), stateFile: path.join(dir, 'state.json'), now: () => now, debounceMs: 10 });

beforeEach(() => {
  vi.useFakeTimers();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pmaps-'));
  now = 1_000_000; chats = [chat({ id: 'a1', title: 'Artisan · Carrello' })]; items = {}; pending = []; emitted = [];
});
afterEach(() => { vi.useRealTimers(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('ProjectMaps', () => {
  it('saves a new map under a slug, then the next version under its name', () => {
    const m = make();
    expect(m.save({ title: 'Negozio Web', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' })).toMatchObject({ project: 'negozio-web', version: 1, summary: 'prima mappa' });
    expect(m.save({ project: 'Negozio Web', map: drawing, by: 'Scout', summary: 'ridisegnata' })).toMatchObject({ project: 'negozio-web', version: 2, root: 'C:\\repo\\shop' });
    expect(m.resolve('negozio web')).toBe('negozio-web');
    expect(() => m.save({ map: drawing, by: 'x', summary: '' })).toThrow('project or title');
    vi.advanceTimersByTime(20);
    expect(emitted).toEqual(['negozio-web']);
  });

  it('update: confirms statuses, binds the chat; correct: keeps the correction', () => {
    const m = make();
    m.save({ title: 'shop', map: drawing, by: 'Scout', summary: '' });
    now += 5000;
    const r = m.update('shop', { changes: [{ id: 'cart', status: 'work', note: 'sconto' }], workingOn: ['cart'], chatId: 'a1', by: 'Artisan' });
    expect(r.touched).toEqual(['cart']);
    expect(r.map).toMatchObject({ version: 2, summary: 'stato di cart' });
    expect(m.agents('shop')).toMatchObject([{ chatId: 'a1', mark: 'run', elements: ['cart'] }]);
    expect(() => m.update('shop', { workingOn: ['nope'], chatId: 'a1', by: 'x' })).toThrow('no element nope');
    expect(() => m.update('shop', { workingOn: ['cart'], by: 'x' })).toThrow('only a chat');
    expect(() => m.update('missing', { changes: [], by: 'x' })).toThrow('nessuna mappa');
    expect(m.correct('shop', '  il carrello  è di un altro team ')).toMatchObject({ version: 3, corrections: ['il carrello è di un altro team'], by: 'utente' });
    expect(m.save({ project: 'shop', map: drawing, by: 'Scout', summary: 'v4' }).corrections).toEqual(['il carrello è di un altro team']);
  });

  it('an agent editing an element\'s file is bound to it and marks it changed until confirmed', () => {
    const m = make();
    m.save({ title: 'shop', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    now += 1000;
    m.observe('chat:item', { chatId: 'a1', item: { kind: 'tool', id: 't1', at: now, name: 'Edit', summary: 'Edit', input: { file_path: 'C:\\repo\\shop\\src\\cart\\total.ts' }, status: 'ok' } });
    expect(m.view('shop')!.changed).toEqual({ cart: now });
    expect(m.agents('shop')[0]!.elements).toEqual(['cart']);
    // a relative path from the chat's folder, and a file outside every map: nothing more
    m.observe('chat:item', { chatId: 'a1', item: { kind: 'tool', id: 't2', at: now, name: 'Write', summary: 'Write', input: { file_path: 'README.md' }, status: 'ok' } });
    m.observe('chat:item', { chatId: 'a1', item: { kind: 'tool', id: 't3', at: now, name: 'Read', summary: 'Read', input: { file_path: 'src/cart/x.ts' }, status: 'ok' } });
    expect(m.view('shop')!.changed).toEqual({ cart: now });
    now += 1000;
    m.update('shop', { changes: [{ id: 'cart', status: 'ok' }], by: 'Artisan' });
    expect(m.view('shop')!.changed).toEqual({});
  });

  it('shows the agents with their state and steps; a removed chat leaves; the state survives a restart', () => {
    const m = make();
    m.save({ title: 'shop', map: drawing, by: 'Scout', summary: '' });
    items.a1 = [{ kind: 'tool', id: 't', at: now, name: 'TodoWrite', summary: '', status: 'ok', input: { todos: [{ status: 'completed', content: 'leggi' }, { status: 'in_progress', content: 'scrivi il fix' }, { status: 'pending', content: 'test' }] } }];
    pending = [{ id: 'q', chatId: 'a1', type: 'question', tool: 'AskUserQuestion', title: 'Arrotondo per riga o sul totale?', detail: '', input: {}, at: now } as PendingRequest];
    m.update('shop', { workingOn: ['cart'], chatId: 'a1', by: 'Artisan' });
    expect(m.agents('shop')[0]).toMatchObject({ mark: 'wait', done: 1, total: 3, now: 'scrivi il fix' });
    expect(m.agents('shop')[0]!.ask).toContain('Arrotondo');
    m.stop();
    expect(make().agents('shop')).toHaveLength(1);
    m.observe('chat:removed', { chatId: 'a1' });
    expect(m.agents('shop')).toEqual([]);
  });
});
