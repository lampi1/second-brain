// Context filtering and path boundaries for Battito placements; no filesystem access or model calls.
import { describe, expect, it } from 'vitest';
import type { PulseCard } from '../../src/shared/pulse';
import { contextCards, filePulsePlace } from '../../src/renderer/lib/pulse-context';

const card = (type: PulseCard['type'], state: PulseCard['state'] = 'new'): PulseCard => ({
  id: type, type, state, title: type, body: '', why: '', refs: [], places: ['search', 'agent:a'],
  runId: '', engine: null, source: 'builtin', createdAt: 1, expiresAt: 999, key: type,
});
describe('contextual cards', () => {
  it('limits search to two connections or curiosities, excluding resolved cards', () => {
    expect(contextCards([card('idea'), card('curiosita', 'saved'), card('collegamento'), card('curiosita'), card('collegamento')], 'search').map(c => c.type))
      .toEqual(['collegamento', 'curiosita']);
  });
  it('requires the exact place and retains all types on agent pages', () => {
    expect(contextCards([card('idea')], 'agent:b')).toEqual([]);
    expect(contextCards([card('idea')], 'agent:a')).toHaveLength(1);
  });
});
describe('file place', () => {
  it('converts a resolved Windows brain path to a relative place', () => {
    expect(filePulsePlace('C:\\Brain\\notes\\one.md', 'c:\\brain')).toBe('file:notes/one.md');
    expect(filePulsePlace('/brain/a.md', '/brain/')).toBe('file:a.md');
  });
  it('rejects outside paths, sibling prefixes, traversal and ambiguous paths', () => {
    for (const path of ['C:/Brain-other/a.md', 'D:/Brain/a.md', 'C:/Brain/../a.md', '../a.md', '/else/a.md', '//server/share/a.md', 'notes//a.md', 'C:relative.md']) {
      expect(filePulsePlace(path, 'C:/Brain')).toBeNull();
    }
    expect(filePulsePlace('C:/Brain/a.md', null)).toBeNull();
  });
});
