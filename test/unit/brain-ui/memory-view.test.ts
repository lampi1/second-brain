// The Memoria page's view helpers (src/renderer/lib/memory-view.ts): which curious facts show and in what order, the
// date chip of a memory line, short week labels, skill verdict tones, the clean-install check and brain file paths.
import { describe, expect, it } from 'vitest';
import type { MemoryStats } from '../../../src/shared/brain-model';
import { brainFile, lineParts, memoryEmpty, memoryFacts, shortDay, total, verdictTone } from '../../../src/renderer/lib/memory-view';

const empty = (): MemoryStats => ({
  at: 0, weeks: ['2026-10-12', '2026-10-19'], totals: { files: 0, entries: 0, agents: 2, agentsWithMemory: 0, shared: 0, runs: 0 },
  perAgent: [{ agentId: 'scout', name: 'Scout', file: 'agents/scout/memory.md', exists: false, entries: 0, recalls: 0, lastAt: null }],
  growth: [], topRecalled: [], stale: [], staleDays: 30, duplicates: 0, oldest: null, busiestDay: null,
  errors: { total: 0, last30: 0, prev30: 0, weekly: [0, 0], groups: [], byAgent: [], weekday: [0, 0, 0, 0, 0, 0, 0], topWord: null, items: [] },
  skills: [],
});

describe('memoryFacts', () => {
  it('says nothing on a clean brain', () => {
    expect(memoryFacts(empty())).toEqual([]);
    expect(memoryEmpty(empty())).toBe(true);
    expect(memoryEmpty(undefined)).toBe(true);
  });
  it('puts the recurring error first and only shows facts the numbers support', () => {
    const s = empty();
    s.totals.entries = 6; s.totals.runs = 4;
    s.errors = { ...s.errors, total: 5, last30: 3, prev30: 1, weekday: [3, 1, 0, 1, 0, 0, 0], topWord: { word: 'nodo', n: 3 },
      groups: [{ key: 'w:0', label: 'Avviso generico', count: 3, agents: ['Scout'], first: '2026-10-01', last: '2026-10-18', trend: [1, 2], sample: 'x', rule: null }] };
    s.perAgent = [{ agentId: 'scout', name: 'Scout', file: 'agents/scout/memory.md', exists: true, entries: 4, recalls: 3, lastAt: 1 },
      { agentId: 'judge', name: 'Judge', file: 'agents/judge/memory.md', exists: false, entries: 0, recalls: 0, lastAt: null }];
    s.topRecalled = [{ text: 'UTC', owner: 'Scout', file: 'agents/scout/memory.md', date: '2026-10-01', recalls: 3 }];
    s.skills = [{ name: 'a', rel: null, uses: 0, known: 0, ok: 0, success: null, lastUse: null, usedBy: 0, verdict: 'unused' }];
    const f = memoryFacts(s, 20);
    expect(f[0]).toMatchObject({ id: 'repeat', params: { n: 3, label: 'Avviso generico' }, file: 'ai-errors.md' });
    expect(f.map(x => x.id)).toEqual(['repeat', 'mostRecalled', 'longest', 'unusedSkills', 'weekday', 'topWord', 'errorsTrend', 'silent']);
    expect(f.find(x => x.id === 'weekday')!.params.day).toBe(0);
    expect(memoryFacts(s).length).toBe(6);
  });
});

describe('small helpers', () => {
  it('splits the date chip from a memory line', () => {
    expect(lineParts('2026-10-07 · Il nodo scrive in **UTC**')).toEqual({ date: '2026-10-07', text: 'Il nodo scrive in **UTC**' });
    expect(lineParts('Senza data')).toEqual({ date: null, text: 'Senza data' });
  });
  it('formats weeks, tones, sums and brain paths', () => {
    expect(shortDay('2026-10-05', 'it-IT')).toBe('5 ott');
    expect(verdictTone('useful')).toBe('good');
    expect(verdictTone('weak')).toBe('bad');
    expect(verdictTone('unused')).toBe('warn');
    expect(verdictTone('new')).toBe('neutral');
    expect(total([1, 2, 3])).toBe(6);
    expect(brainFile('C:\\brain', 'agents/scout/memory.md')).toBe('C:\\brain\\agents\\scout\\memory.md');
    expect(brainFile('/home/u/brain/', 'ai-errors.md')).toBe('/home/u/brain/ai-errors.md');
    expect(brainFile(null, 'now.md')).toBe('now.md');
  });
});
