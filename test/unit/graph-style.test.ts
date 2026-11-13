// Dense graph regressions: overview labels exist and neighbourhood priority stays bounded.
import { describe, expect, it } from 'vitest';
import { labelCandidates, nodeStyle } from '../../src/renderer/dashboard/graph-style';

describe('brain graph presentation', () => {
  const nodes = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }));
  const edges = nodes.slice(1).map(n => ({ from: '0', to: n.id }));
  it('shows the connected hub before interaction instead of an unlabelled cloud', () => {
    const labels = labelCandidates(nodes, edges, null);
    expect(labels).toHaveLength(8);
    expect(labels[0]?.id).toBe('0');
    expect(labelCandidates([...nodes].reverse(), edges, null)).toEqual(labels);
  });
  it('keeps a selected leaf and its hub first', () => {
    expect(labelCandidates(nodes, edges, '99').slice(0, 2).map(n => n.id)).toEqual(['99', '0']);
    expect(labelCandidates(nodes.slice(0, 3), edges, null)).toHaveLength(3);
  });
  it('distinguishes kinds by colour and size, with a safe unknown fallback', () => {
    const styles = ['note', 'area', 'agent', 'skill', 'rule'].map(kind => nodeStyle(kind));
    expect(new Set(styles.map(s => s.color)).size).toBe(5);
    expect(new Set(styles.map(s => s.radius)).size).toBe(5);
    expect(nodeStyle('unknown')).toEqual(nodeStyle('note'));
  });
});
