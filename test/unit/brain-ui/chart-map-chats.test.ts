// Chart math (lib/chart.ts), live chat grouping (lib/chats.ts) and the map's data logic (lib/map.ts).
import { describe, expect, it } from 'vitest';
import { catColor, labelStep, moneyEntries, niceMax, niceScale, tickLabel, ticks, topN } from '../../../src/renderer/brain/lib/chart';
import { chatState, groupChats, isLive, waitsYou } from '../../../src/renderer/brain/lib/chats';
import { byLayer, centerId, defaultKinds, findNode, groupIndex, mix, nodeSize, pickView, relFile, weakPoints } from '../../../src/renderer/brain/lib/map';
import type { LiveChat, MapData } from '../../../src/renderer/brain/types';

describe('chart', () => {
  it('round axes: 0,10…50 for 45; 0,20…80 for 63; 0,2…8 for 7; 1 for nothing', () => {
    expect(ticks(45)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(ticks(63)).toEqual([0, 20, 40, 60, 80]);
    expect(ticks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceMax(0)).toBe(1);
    expect(niceScale(0.5)).toEqual({ top: 0.5, step: 0.1 });
    expect(niceMax(270)).toBe(300);
  });
  it('tick labels keep the decimals of their step', () => {
    expect(tickLabel(12.5, false, 2.5)).toBe('12,5');
    expect(tickLabel(0.25, false, 0.25)).toBe('0,25');
    expect(tickLabel(1250, true, 250)).toBe('1,25k $');
    expect(tickLabel(40, true, 10)).toBe('40 $');
    expect(ticks(12).map(v => tickLabel(v, false, niceScale(12).step))).toEqual(['0', '2,5', '5', '7,5', '10', '12,5']);
  });
  it('palette in fixed order, grey past 8', () => {
    expect(catColor(0)).toBe('var(--bx-cat-1)');
    expect(catColor(7)).toBe('var(--bx-cat-8)');
    expect(catColor(8)).toBe('var(--bx-cat-other)');
  });
  it('topN sums the rest into "altro"; labelStep thins crowded labels', () => {
    expect(topN([['a', 1], ['b', 5], ['c', 2], ['d', 1]], 2)).toEqual([['b', 5], ['c', 2], ['altro', 2]]);
    expect(labelStep(30, 600, 60)).toBe(3);
    expect(labelStep(7, 600, 60)).toBe(1);
  });
  it('moneyEntries drops zeros and the synthetic model', () => {
    expect(moneyEntries({ '<synthetic>': { usd: 3 }, a: { usd: 0 }, b: { usd: 2 }, c: { usd: 5 } })).toEqual([['c', 5], ['b', 2]]);
  });
});

const chat = (o: Partial<LiveChat>): LiveChat => ({ harness: 'Claude', title: 't', folder: '', when: '', state: 'finito', id: 'x', ageMin: 5, last: '', lastOwner: '', box: null, now: null, ...o });
describe('live chats', () => {
  it('"now" is recent: working within 2 h, waiting within a day', () => {
    expect(isLive(chat({ state: 'in corso', ageMin: 30 }))).toBe(true);
    expect(isLive(chat({ state: 'in corso', ageMin: 500 }))).toBe(false);
    expect(waitsYou(chat({ state: 'aspetta te (domanda)', ageMin: 600 }))).toBe(true);
    expect(waitsYou(chat({ state: 'aspetta te', ageMin: 2000 }))).toBe(false);
  });
  it('state labels say it in words', () => {
    expect(chatState(chat({ state: 'aspetta te (permesso)' })).label).toBe('permesso');
    expect(chatState(chat({ state: 'aspetta te (domanda)' }))).toEqual({ label: 'ti aspetta', tone: 'warn' });
    expect(chatState(chat({ state: 'fermo' })).tone).toBe('bad');
    expect(chatState(chat({ state: 'in corso', ageMin: 999 })).label).toBe("ferma da un po'");
  });
  it('groups waiting first, then working, the rest; most recent first', () => {
    const g = groupChats([chat({ id: 'a', state: 'finito' }), chat({ id: 'b', state: 'in corso', ageMin: 9 }), chat({ id: 'c', state: 'aspetta te' }), chat({ id: 'd', state: 'in corso', ageMin: 1 })]);
    expect([g.wait.map(c => c.id), g.live.map(c => c.id), g.rest.map(c => c.id)]).toEqual([['c'], ['d', 'b'], ['a']]);
  });
});

const map: MapData = {
  generated: '', root: 'C:/brains/demo', warnings: [], problems: ['un file non esiste'],
  layers: [{ id: 'persone', label: 'Persone', hint: '' }, { id: 'tool', label: 'Tool', hint: '' }],
  nodes: [{ id: 'p', layer: 'persone', kind: 'persona', label: 'Alex', degree: 6 }, { id: 'q', layer: 'persone', kind: 'persona', label: 'Colleghi', degree: 1 }, { id: 't:mem', layer: 'tool', kind: 'tool', label: 'mem.mjs', degree: 3, file: 'C:/brains/demo/ops/tools/mem.mjs' }],
  edges: [{ from: 'p', to: 't:mem', kind: 'flusso', label: 'scrive' }], flows: [{ id: 'f', title: 'F', steps: [] }],
  weak: [{ kind: 'mai usati', text: 'x', ids: ['t:mem'] }],
  simple: { nodes: [{ id: 'p', layer: 'persone', kind: 'persona', label: 'Alex', degree: 6 }, { id: 'g', layer: 'tool', kind: 'gruppo', label: 'Tool (1)', members: [{ id: 't:mem', label: 'mem.mjs' }] }], edges: [], flows: [] },
};
describe('map', () => {
  it('essential view = the brain simple graph (flows fall back to the full ones); full view otherwise', () => {
    const e = pickView(map, true);
    expect([e.essential, e.nodes.length, e.total, e.flows.length]).toEqual([true, 2, 3, 1]);
    expect(pickView(map, false).nodes.length).toBe(3);
    expect(pickView({ ...map, simple: null }, true).essential).toBe(false);
  });
  it('the center is the most connected person; sizes follow the view', () => {
    expect(centerId(map.nodes)).toBe('p');
    expect(nodeSize(map.nodes[0]!, true, 'p')).toBe(60);
    expect(nodeSize(map.simple!.nodes[1]!, true, 'p')).toBe(31);
  });
  it('weak points include the problems to verify; groups index their members', () => {
    expect(weakPoints(map).map(w => w.kind)).toEqual(['mai usati', 'da verificare']);
    expect(groupIndex(map.simple!.nodes).get('t:mem')).toBe('g');
  });
  it('relFile only for files inside the brain; findNode exact then partial', () => {
    expect(relFile('C:\\brains\\demo\\ops\\tools\\mem.mjs', 'C:/brains/demo')).toBe('ops/tools/mem.mjs');
    expect(relFile('D:/altrove/settings.json', 'C:/brains/demo')).toBeNull();
    expect(findNode(map.nodes, 'MEM')?.id).toBe('t:mem');
    expect(findNode(map.nodes, '')).toBeNull();
  });
  it('mix, default arrow kinds, nodes by layer for the 2D list', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
    expect(defaultKinds(true).esterno).toBe(false);
    expect(defaultKinds(false).esterno).toBe(true);
    expect(byLayer(pickView(map, false)).map(l => [l.id, l.nodes.map(n => n.id)])).toEqual([['persone', ['p', 'q']], ['tool', ['t:mem']]]);
  });
});
