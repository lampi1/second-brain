// Unit tests of the deeper project maps (ADR 0316): parts inside parts up to MAP_LIMITS.depth, drawn one level at a time
// with what they talk to around them; the substance of a piece (rules, keeps, why, key files) checked and told; paths
// checked against the drawing, merged and dropped by id, pruned when a piece leaves; the tools that save and update them
// and the brief that answers a question as a path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => String(e) }));
import { checkMap, checkPaths, descendantsOf, elementText, levelOf, mergePaths, prunePaths, type ProjectMap } from '../../src/shared/project-map';
import type { ChatSummary } from '../../src/shared/contract';
import type { CallCtx } from '../../src/main/mcp/server';
import { ProjectMaps } from '../../src/main/projectmap/service';
import { ProjectMapStore } from '../../src/main/projectmap/store';
import { appProjectMapTool, chatMapTools } from '../../src/main/projectmap/tools';

const T = 1_000_000_000;
const drawing = {
  elements: [
    { id: 's', kind: 'system', name: 'Negozio' },
    { id: 'p', kind: 'part', name: 'Ordini', parent: 's', rules: ['Sconto prima dell\'IVA'], keeps: ['Ordini nel database'], why: ['Un ordine non cambia dopo «Paga»'],
      keyFiles: [{ path: 'src\\Orders\\Checkout.cs', what: 'dove nasce l\'ordine' }] },
    { id: 'q', kind: 'part', name: 'Totale', parent: 'p' },
    { id: 'r', kind: 'part', name: 'Conferma', parent: 'p' },
    { id: 'x', kind: 'external', name: 'Gateway' },
  ],
  links: [{ from: 'q', to: 'r', label: 'passa il totale' }, { from: 'r', to: 'x', label: 'addebita' }],
};
const map = (): ProjectMap => ({ project: 'n', title: 'N', version: 1, updatedAt: T, by: 'x', summary: '', corrections: [], ...checkMap(drawing, T) });

describe('parts inside parts', () => {
  it('draws each level with what it talks to around it', () => {
    const m = map();
    const inner = levelOf(m, 'p', T);
    expect(inner.nodes.map(n => [n.id, n.ctx])).toEqual(expect.arrayContaining([['q', false], ['r', false], ['x', true]]));
    expect(inner.edges.map(e => `${e.from}>${e.to}`).sort()).toEqual(['q>r', 'r>x']);
    expect(levelOf(m, 's', T).edges.map(e => `${e.from}>${e.to}`)).toEqual(['p>x']);
    expect(levelOf(m, null, T).edges.map(e => `${e.from}>${e.to}`)).toEqual(['s>x']);
    expect([...descendantsOf(m, 's')].sort()).toEqual(['p', 'q', 'r']);
  });
  it('keeps the substance, the key files with forward slashes', () => {
    const p = map().elements.find(e => e.id === 'p')!;
    expect(p).toMatchObject({ rules: ['Sconto prima dell\'IVA'], keeps: ['Ordini nel database'], keyFiles: [{ path: 'src/Orders/Checkout.cs', what: 'dove nasce l\'ordine' }] });
    const told = elementText({ ...map(), paths: [{ id: 'paga', question: 'Cosa succede quando paga?', stops: [{ on: 'q', text: 'somma' }, { on: 'r', text: 'addebita' }] }] }, 'p', T);
    for (const s of ['Regole', 'Sconto prima dell\'IVA', 'Cosa tiene e dove', 'Perché', 'File chiave', 'src/Orders/Checkout.cs', 'Cosa succede quando paga?']) expect(told).toContain(s);
  });
  it('refuses a key file outside the project', () => {
    expect(() => checkMap({ elements: [{ id: 'a', kind: 'system', name: 'A', keyFiles: [{ path: '../x', what: '' }] }] }, T)).toThrow('relative');
  });
});

describe('paths', () => {
  const ids = new Set(['q', 'r', 'x']);
  const paga = { question: 'Cosa succede quando paga?', stops: [{ on: 'q', text: 'somma', file: 'src\\Totals.cs' }, { on: 'r', text: 'salva' }, { on: 'x', text: 'addebita' }] };
  it('checks each stop against the drawing', () => {
    expect(checkPaths([paga], ids)).toEqual([{ id: 'cosa-succede-quando-paga', question: paga.question, stops: [{ on: 'q', text: 'somma', file: 'src/Totals.cs' }, { on: 'r', text: 'salva' }, { on: 'x', text: 'addebita' }] }]);
    expect(() => checkPaths([{ ...paga, stops: [{ on: 'q', text: 'a' }, { on: 'zz', text: 'b' }] }], ids)).toThrow('an element id');
    expect(() => checkPaths([{ ...paga, stops: [{ on: 'q', text: 'a' }] }], ids)).toThrow('2 to');
    expect(() => checkPaths([paga, paga], ids)).toThrow('twice');
  });
  it('merges by id, drops, prunes what left the drawing', () => {
    const [one] = checkPaths([paga], ids);
    const told = mergePaths([one!], [{ ...paga, stops: paga.stops.slice(0, 2) }], undefined, ids);
    expect(told.paths).toHaveLength(1);
    expect(told.paths[0]!.stops).toHaveLength(2);
    expect(told.did[0]).toMatch(/^~ percorso/);
    expect(mergePaths(told.paths, undefined, [one!.id], ids).paths).toEqual([]);
    expect(() => mergePaths([], undefined, ['nope'], ids)).toThrow('no path');
    expect(prunePaths([one!], new Set(['q', 'r']))[0]!.stops.map(s => s.on)).toEqual(['q', 'r']);
    expect(prunePaths([one!], new Set(['q']))).toEqual([]);
  });
});

let dir: string, maps: ProjectMaps;
const chats: ChatSummary[] = [{ id: 's1', harness: 'claude', origin: 'app', title: 'Scout · Mappa', cwd: 'C:\\repo\\shop', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'running', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [] }];
const ctx = (chatId: string) => ({ mount: 'chat', params: { chatId }, sessionId: '', signal: new AbortController().signal }) as unknown as CallCtx;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pmdepth-'));
  maps = new ProjectMaps({ store: new ProjectMapStore(() => dir), chats: () => chats, items: () => [], pending: () => [], emit: () => {}, stateFile: path.join(dir, 's.json') });
});
afterEach(() => { maps.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('tools', () => {
  it('save with paths, update them, a removed piece takes its stops', async () => {
    const t = Object.fromEntries(chatMapTools({ maps, titleOf: () => 'Scout', cwdOf: () => 'C:\\repo\\shop' }).map(x => [x.name, x]));
    const paga = { id: 'paga', question: 'Cosa succede quando paga?', stops: [{ on: 'q', text: 'somma' }, { on: 'r', text: 'salva' }, { on: 'x', text: 'addebita' }] };
    expect(JSON.parse(String(await t.project_map_save!.run({ title: 'Negozio', summary: 'prima', ...drawing, paths: [paga] }, ctx('s1'))))).toMatchObject({ ok: true, version: 1 });
    expect(maps.view('negozio')!.map.paths).toHaveLength(1);
    const reso = { id: 'reso', question: 'Come si rimborsa?', stops: [{ on: 'r', text: 'trova' }, { on: 'x', text: 'storna' }] };
    expect(JSON.parse(String(await t.project_map_update!.run({ project: 'negozio', paths: [reso], drop_paths: ['paga'] }, ctx('s1'))))).toMatchObject({ ok: true, version: 2 });
    expect(maps.view('negozio')!.map.paths!.map(p => p.id)).toEqual(['reso']);
    maps.edit('negozio', [{ op: 'remove', id: 'r' }], 'Orchestrator');
    expect(maps.view('negozio')!.map.paths ?? []).toEqual([]); // one stop left: the path goes
    expect(maps.view('negozio')!.map.elements.map(e => e.id).sort()).toEqual(['p', 'q', 's', 'x']);
  });
  it('a removed part takes its parts with it', () => {
    maps.save({ title: 'Negozio', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    maps.edit('negozio', [{ op: 'remove', id: 'p' }], 'Orchestrator');
    expect(maps.view('negozio')!.map.elements.map(e => e.id).sort()).toEqual(['s', 'x']);
  });
  it('briefs a Scout to answer a question as a path', () => {
    maps.save({ title: 'Negozio', root: 'C:\\repo\\shop', map: drawing, by: 'Scout', summary: '' });
    const tool = appProjectMapTool(maps, () => {});
    const b = tool.run({ action: 'brief', project: 'negozio', question: 'Cosa succede quando un cliente paga?' }) as { roleId: string; cwd: string; title: string; prompt: string };
    expect(b).toMatchObject({ roleId: 'scout', cwd: 'C:\\repo\\shop', title: 'Percorso · Cosa succede quando un cliente paga?' });
    expect(b.prompt).toContain('«Cosa succede quando un cliente paga?»');
    expect(b.prompt).toContain('project_map_update');
    expect(() => tool.run({ action: 'brief', question: 'x?' })).toThrow('existing map');
  });
});

describe('store', () => {
  it('reads a hand-edited file: bad substance and paths are left out, nested parts kept', () => {
    const s = new ProjectMapStore(() => dir);
    fs.mkdirSync(path.join(dir, 'projects', 'n'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'projects', 'n', 'map.json'), JSON.stringify({ version: 1, elements: [
      { id: 's', kind: 'system', name: 'S', status: 'ok' }, { id: 'p', kind: 'part', name: 'P', status: 'ok', parent: 's', rules: ['ok', 3], keyFiles: [{ path: 'a.ts', what: 'x' }, 'bad'] },
      { id: 'q', kind: 'part', name: 'Q', status: 'ok', parent: 'p' }],
    paths: [{ id: 'a', question: 'Q?', stops: [{ on: 's', text: 'a' }, { on: 'gone', text: 'b' }, { on: 'q', text: 'c' }] }, { id: 'b', question: 'R?', stops: [{ on: 'gone', text: 'x' }] }] }));
    const m = s.get('n')!;
    expect(m.elements.find(e => e.id === 'q')!.parent).toBe('p');
    expect(m.elements.find(e => e.id === 'p')).toMatchObject({ rules: ['ok'], keyFiles: [{ path: 'a.ts', what: 'x' }] });
    expect(m.paths!.map(p => [p.id, p.stops.map(x => x.on)])).toEqual([['a', ['s', 'q']]]);
  });
});
