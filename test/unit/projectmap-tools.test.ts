// Unit tests of main/projectmap/tools.ts (ADR 0271): an agent draws a map (root defaults to its folder, by = its title),
// reads it as text, says what it works on and updates statuses; the Orchestrator lists, reads, opens the Mappa page on
// it (or on a system inside it), gets the brief for a Scout that draws it, and stores the user's correction.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => String(e) }));
import type { ChatSummary } from '../../src/shared/contract';
import type { CallCtx } from '../../src/main/mcp/server';
import { ProjectMaps } from '../../src/main/projectmap/service';
import { ProjectMapStore } from '../../src/main/projectmap/store';
import { appProjectMapTool, chatMapTools } from '../../src/main/projectmap/tools';

let dir: string, maps: ProjectMaps;
const chats: ChatSummary[] = [{ id: 's1', harness: 'claude', origin: 'app', title: 'Scout · Mappa', cwd: 'C:\\repo\\shop', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'running', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [] }];
const ctx = (chatId: string) => ({ mount: 'chat', params: { chatId }, sessionId: '', signal: new AbortController().signal }) as unknown as CallCtx;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pmtools-'));
  maps = new ProjectMaps({ store: new ProjectMapStore(() => dir), chats: () => chats, items: () => [], pending: () => [], emit: () => {}, stateFile: path.join(dir, 's.json') });
});
afterEach(() => { maps.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('chat tools', () => {
  it('draw, read, work on, update', async () => {
    const t = Object.fromEntries(chatMapTools({ maps, titleOf: id => chats.find(c => c.id === id)?.title ?? null, cwdOf: id => chats.find(c => c.id === id)?.cwd ?? null }).map(x => [x.name, x]));
    const saved = JSON.parse(String(await t.project_map_save!.run({ title: 'Negozio', summary: 'prima', elements: [{ id: 'web', kind: 'system', name: 'Web', status: 'ok' }, { id: 'pay', kind: 'external', name: 'Pagamenti' }], links: [{ from: 'web', to: 'pay', label: 'addebita' }] }, ctx('s1'))));
    expect(saved).toMatchObject({ ok: true, project: 'negozio', version: 1, root: 'C:\\repo\\shop' });
    expect(maps.view('negozio')!.map.by).toBe('Scout · Mappa');
    expect(JSON.parse(String(await t.project_map_read!.run({}, ctx('s1'))))).toMatchObject({ projects: [{ project: 'negozio' }] });
    expect(String(await t.project_map_read!.run({ project: 'Negozio' }, ctx('s1')))).toContain('- web · system · Web — funziona');
    expect(JSON.parse(String(await t.project_map_update!.run({ project: 'negozio', working_on: ['web'], changes: [{ id: 'web--pay', status: 'blocked', actor: 'user' }] }, ctx('s1'))))).toMatchObject({ ok: true, version: 2, changed: ['web--pay'] });
    expect(maps.agents('negozio')).toMatchObject([{ chatId: 's1', elements: ['web'] }]);
    await expect(async () => t.project_map_update!.run({ project: 'negozio' }, ctx('s1'))).rejects.toThrow('at least one');
    await expect(async () => t.project_map_read!.run({ project: 'altro' }, ctx('s1'))).rejects.toThrow('nessuna mappa «altro»');
  });
});

describe('app_project_map', () => {
  it('lists, reads, opens, briefs, corrects', () => {
    maps.save({ title: 'Negozio', root: 'C:\\repo\\shop', map: { elements: [{ id: 'web', kind: 'system', name: 'Web' }, { id: 'cart', kind: 'part', name: 'Carrello', parent: 'web' }] }, by: 'Scout', summary: '' });
    const ui: unknown[] = [];
    const tool = appProjectMapTool(maps, cmd => ui.push(cmd));
    expect(tool.run({ action: 'list' })).toMatchObject({ projects: [{ project: 'negozio' }] });
    expect(tool.run({ action: 'read', project: 'negozio' })).toContain('Mappa «Negozio»');
    expect(tool.run({ action: 'open', project: 'negozio', element: 'web' })).toBe('ok');
    expect(ui).toEqual([{ action: 'maps', value: 'negozio/web' }]);
    expect(tool.run({ action: 'open' })).toBe('ok');
    expect(ui[1]).toEqual({ action: 'maps', value: '' });
    expect(() => tool.run({ action: 'open', project: 'negozio', element: 'nope' })).toThrow('no «nope»');
    expect(tool.run({ action: 'brief', title: 'Gestionale', root: 'C:\\repo\\erp' })).toMatchObject({ roleId: 'scout', cwd: 'C:\\repo\\erp', title: 'Mappa · Gestionale' });
    expect((tool.run({ action: 'brief', project: 'negozio' }) as { prompt: string }).prompt).toContain('Ridisegna la mappa del progetto «Negozio»');
    expect(() => tool.run({ action: 'brief', title: 'X' })).toThrow('title and root');
    expect(tool.run({ action: 'correct', project: 'negozio', text: 'il carrello è nuovo' })).toMatchObject({ ok: true, corrections: 1 });
  });
});
