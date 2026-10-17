// Pure workspace behavior: docking preserves identities, focus/hide projects without destroying saved layout,
// resize/restore validates untrusted persisted input, new browsers join their owner without changing ownership.
import { describe, expect, it } from 'vitest';
import { balancedLayout, boundedLayout, dockPane, paneKeys, reconcileLayout, resizeSplit, restoreWorkspace, visibleLayout } from '../../src/renderer/lib/agents-layout';

describe('agents workspace topology', () => {
  it('docks each panel exactly once in all four directions and round-trips persisted layout', () => {
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const initial = balancedLayout(['chat:a', 'chat:b', 'browser:c']);
      const result = dockPane(initial, 'browser:c', 'chat:a', side);
      expect(paneKeys(result).sort()).toEqual(['browser:c', 'chat:a', 'chat:b']);
      expect(new Set(paneKeys(result)).size).toBe(3);
      const saved = JSON.parse(JSON.stringify({ version: 1, root: result }));
      expect(restoreWorkspace(saved)).toEqual(result);
    }
  });
  it('focus and browser hide do not mutate original arrangement or sizes', () => {
    const original = balancedLayout(['chat:a', 'browser:b', 'chat:c'])!;
    const before = JSON.stringify(original);
    expect(paneKeys(visibleLayout(original, new Set(['chat:a'])))).toEqual(['chat:a']);
    expect(JSON.stringify(original)).toBe(before);
    expect(paneKeys(visibleLayout(original, new Set(paneKeys(original))))).toEqual(paneKeys(original));
  });
  it('preserves an existing arrangement while adding/closing panels', () => {
    const initial = balancedLayout(['chat:a', 'chat:b']);
    const added = reconcileLayout(initial, ['chat:a', 'chat:b', 'browser:c'], { 'browser:c': 'chat:a' });
    expect(paneKeys(added)).toEqual(['chat:a', 'browser:c', 'chat:b']);
    expect(paneKeys(reconcileLayout(added, ['chat:a', 'chat:b']))).toEqual(['chat:a', 'chat:b']);
  });
  it('ignores invalid/self drop and clamps resize', () => {
    const root = balancedLayout(['chat:a', 'chat:b'])!;
    expect(dockPane(root, 'chat:a', 'chat:a', 'top')).toBe(root);
    expect(dockPane(root, 'chat:missing', 'chat:a', 'top')).toBe(root);
    if (root.kind === 'split') expect(resizeSplit(root, root.id, 20)).toMatchObject({ ratio: 0.85 });
  });
  it('preserves a visible split identity so resizing with a hidden panel updates the saved topology',()=>{
    const root=balancedLayout(['chat:a','chat:b','chat:c','chat:d'])!;
    const projected=visibleLayout(root,new Set(['chat:a','chat:c','chat:d']))!;
    if(projected.kind!=='split'||root.kind!=='split')throw Error('split expected');
    expect(projected.id).toBe(root.id);
    expect(resizeSplit(root,projected.id,0.7)).toMatchObject({ratio:0.7});
  });
  it('keeps repeated additions and docking within the restore depth boundary',()=>{
    const keys=Array.from({length:80},(_,index)=>`chat:${index}`);
    let root=reconcileLayout(balancedLayout(keys.slice(0,2)),keys)!;
    for(const key of keys.slice(1))root=boundedLayout(dockPane(root,key,keys[0]!,'right'))!;
    expect(paneKeys(restoreWorkspace({version:1,root})).sort()).toEqual([...keys].sort());
  });
  it('rejects duplicate keys, non-finite ratios, unknown formats and excessive depth', () => {
    const leaf = { kind: 'pane', key: 'chat:a' };
    expect(restoreWorkspace({ version: 3, root: leaf })).toBe(null);
    expect(restoreWorkspace({ version: 1, root: { kind: 'split', axis: 'row', ratio: 0.5, first: leaf, second: leaf } })).toBe(null);
    expect(restoreWorkspace({ version: 1, root: { kind: 'split', axis: 'row', ratio: Infinity, first: leaf, second: { ...leaf, key: 'chat:b' } } })).toBe(null);
    let deep: unknown = leaf;
    for (let i = 0; i < 40; i++) deep = { kind: 'split', axis: 'row', ratio: 0.5, first: deep, second: { ...leaf, key: `chat:${i}` } };
    expect(restoreWorkspace({ version: 1, root: deep })).toBe(null);
  });
});
