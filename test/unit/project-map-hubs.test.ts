// Unit tests of the split and join points of a project map's framed groups (ADR 0335; src/shared/project-map-line.ts
// marks them, src/renderer/components/project-map/GroupHubs.tsx draws them): a point only where an arrow really passes,
// never an orphan one for a back arrow or a link to an outside box, which run along the lane.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { checkMap, levelOf, type ProjectMap } from '../../src/shared/project-map';
import { GroupHubs } from '../../src/renderer/components/project-map/GroupHubs';

const T = 1_000_000_000;
const mapOf = (drawing: unknown): ProjectMap => ({ project: 'n', title: 'N', version: 1, updatedAt: T, by: 'x', summary: '', corrections: [], ...checkMap(drawing, T) });
const hubs = (m: ProjectMap) => {
  const lv = levelOf(m, null, T);
  return [...renderToStaticMarkup(createElement(GroupHubs, { groups: lv.groups })).matchAll(/data-testid="(pm-hub-[^"]+)"/g)].map(x => x[1]);
};

describe('group hubs: drawn only where an arrow passes', () => {
  it('a group that opens the line, with a back arrow into it: only its join point', () => {
    const m = mapOf({ elements: [{ id: 'g1', kind: 'phase', name: 'G1' }, { id: 'g2', kind: 'phase', name: 'G2', par: true }, { id: 'z', kind: 'phase', name: 'Z' }],
      links: [{ from: 'z', to: 'g1', label: 'rifà' }] });
    expect(hubs(m)).toEqual(['pm-hub-join-g1']);
  });
  it('a group that closes the line, with a back arrow out of it: only its split point', () => {
    const m = mapOf({ elements: [{ id: 'a', kind: 'phase', name: 'A' }, { id: 'g1', kind: 'phase', name: 'G1' }, { id: 'g2', kind: 'phase', name: 'G2', par: true }],
      links: [{ from: 'g2', to: 'a', label: 'torna' }] });
    expect(hubs(m)).toEqual(['pm-hub-split-g1']);
  });
  it('a group alone with a link to an outside box: no point at all', () => {
    const m = mapOf({ elements: [{ id: 's', kind: 'system', name: 'S', layout: 'linear' }, { id: 'p1', kind: 'part', name: 'P1', parent: 's' }, { id: 'p2', kind: 'part', name: 'P2', parent: 's', par: true }, { id: 'x', kind: 'external', name: 'X' }],
      links: [{ from: 'p1', to: 'x', label: 'legge' }, { from: 'x', to: 'p2', label: 'scrive' }] });
    const lv = levelOf(m, 's', T);
    expect(lv.groups!.map(g => g.ids)).toEqual([['p1', 'p2']]);
    expect(lv.nodes.some(n => n.ctx)).toBe(true);
    expect(renderToStaticMarkup(createElement(GroupHubs, { groups: lv.groups }))).not.toContain('pm-hub');
  });
  it('a group in the middle: both points', () => {
    const m = mapOf({ elements: [{ id: 'a', kind: 'phase', name: 'A' }, { id: 'g1', kind: 'phase', name: 'G1' }, { id: 'g2', kind: 'phase', name: 'G2', par: true }, { id: 'z', kind: 'phase', name: 'Z' }] });
    expect(hubs(m)).toEqual(['pm-hub-split-g1', 'pm-hub-join-g1']);
  });
});
