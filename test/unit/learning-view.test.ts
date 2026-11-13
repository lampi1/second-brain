// The evidence layer's view (lib/learning-view.ts and components/brain-model/LearningPage.tsx, ADR 0109): a claim as one
// line (difference with its 90% interval and verdict, «in raccolta k/n», a baseline too short to judge, an undone change),
// where it is measured, a role's weekly points; the page renders the counter, the «Da guardare» panel for a change that
// made things worse, a curve per role with the changes as marks and the list, in Italian and English.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrainChange, BrainModelState, ChangeClaim } from '../../src/shared/brain-model';
const state: { current: BrainModelState | null } = { current: null };
vi.mock('../../src/renderer/store/brain-model', () => ({
  useBrainModel: () => ({ state: state.current, error: null, busy: false }),
  brainModel: { use: (sel: (s: { state: BrainModelState | null }) => unknown) => sel({ state: state.current }), get: () => ({ state: state.current }) },
  rollbackChange: vi.fn(), runMaintenance: vi.fn(),
}));
vi.mock('../../src/renderer/store/ui', () => ({ toast: vi.fn(), ui: { use: () => null } }));
import { claimLine, curve, num, scopeLine } from '../../src/renderer/lib/learning-view';
import { LearningPage } from '../../src/renderer/components/brain-model/LearningPage';
import { setLang } from '../../src/renderer/i18n';

afterEach(() => { setLang('it'); state.current = null; });
const claim = (p: Partial<ChangeClaim> = {}): ChangeClaim => ({ hypothesis: 'fewer', metric: 'corrections', scope: ['artisan'], skill: null,
  before: { n: 40, judged: 40, mean: 0.8 }, after: { n: 23, judged: 20, mean: 0.4 }, need: 40, diff: { low: -0.7, high: -0.1 }, verdict: 'aiuta', ...p });
const names = new Map([['artisan', 'Artisan'], ['scout', 'Scout']]);

describe('claim line', () => {
  it('says the difference, the interval, the baseline and the verdict', () => {
    expect(claimLine(claim())).toBe('−0,4 correzioni per esecuzione su 20 (IC 90% da −0,7 a −0,1) · prima 0,8 su 40 · aiuta');
    expect(claimLine(claim({ verdict: 'raccolta', diff: { low: -0.5, high: 0.2 } }))).toMatch(/· in raccolta, prossima tappa a 40$/);
    setLang('en');
    expect(claimLine(claim())).toBe('−0.4 corrections per run over 20 (90% CI −0.7 to −0.1) · before 0.8 over 40 · helps');
  });
  it('says how far the runs are, a baseline too short to judge, an undone change', () => {
    expect(claimLine(claim({ verdict: 'raccolta', diff: null, after: { n: 7, judged: 0, mean: 0 }, need: 20 }))).toBe('in raccolta 7/20');
    expect(claimLine(claim({ verdict: 'raccolta', diff: null, before: { n: 12, judged: 0, mean: 1 } }))).toMatch(/^Prima del cambiamento solo 12 esecuzioni/);
    expect(claimLine(claim({ verdict: 'annullato', diff: null, before: { n: 3, judged: 0, mean: 1 } }))).toBe('annullata prima di un verdetto');
  });
  it('names the scope and the skill, and rounds with a real minus', () => {
    expect(scopeLine(claim({ scope: ['artisan', 'scout'], skill: 'note' }), names)).toBe('misurata su Artisan, Scout, solo le esecuzioni che caricano «note»');
    expect(scopeLine(claim({ scope: [] }), names)).toBe('misurata su tutti i ruoli');
    expect([num(-0.04, true), num(0.25, true), num(-1.26)]).toEqual(['+0,0', '+0,3', '−1,3']);
  });
  it('leaves weeks without runs out of the curve', () => {
    expect(curve({ id: 'a', name: 'A', changes: [], weeks: [{ start: 1, runs: 2, corrections: 1 }, { start: 2, runs: 0, corrections: 0 }, { start: 3, runs: 4, corrections: 4 }] }))
      .toEqual([{ i: 0, mean: 0.5, runs: 2, start: 1 }, { i: 2, mean: 1, runs: 4, start: 3 }]);
  });
});

describe('Apprendimento page', () => {
  const W = 7 * 86_400_000, from = Date.parse('2026-07-29T00:00:00Z');
  const base = { job: 'corrections' as const, kind: 'agent' as const, action: 'update' as const, target: 'artisan', reason: 'Tre correzioni simili', evidence: [], canRollback: true };
  const changes: BrainChange[] = [
    { ...base, id: 'w', at: from + 3 * W, summary: 'Artisan: verifica i test prima di riportare', claim: claim({ verdict: 'peggiora', diff: { low: 0.2, high: 0.9 }, after: { n: 22, judged: 20, mean: 1.3 } }) },
    { ...base, id: 'h', at: from + 5 * W, summary: 'Regola sui nomi dei branch', kind: 'rule', claim: claim({ scope: [] }) },
  ];
  const page = (): BrainModelState => ({ root: '/b', agents: [{ id: 'artisan', name: 'Artisan', role: '', skills: [], memory: null }], skills: [], rules: [], memory: [], changes, migration: null, lastRun: null,
    learning: { counts: { aiuta: 1, 'nessun-effetto': 0, raccolta: 0, peggiora: 1, annullato: 0 }, from, week: W,
      roles: [{ id: 'artisan', name: 'Artisan', weeks: Array.from({ length: 12 }, (_, i) => ({ start: from + i * W, runs: i % 3 ? 4 : 0, corrections: i < 6 ? 4 : 2 })), changes: changes.map(c => ({ id: c.id, at: c.at, verdict: c.claim!.verdict, summary: c.summary })) },
        { id: 'herald', name: 'Herald', weeks: Array.from({ length: 12 }, (_, i) => ({ start: from + i * W, runs: 0, corrections: 0 })), changes: [] }] } });
  it('renders the counter, the change that made things worse with its Annulla, a curve per role with marks, and the list', () => {
    state.current = page();
    const html = renderToStaticMarkup(createElement(LearningPage));
    expect(html).toContain('data-testid="learning-page"'); // its title is the Memoria hub's tab now (ADR 0122)
    expect(html).not.toContain('<h1');
    expect(html).toMatch(/data-testid="lr-k-aiuta"[\s\S]*?>1<\/button>/);
    expect(html).toMatch(/data-testid="lr-worse"[\s\S]*Artisan: verifica i test prima di riportare[\s\S]*data-testid="bm-undo"/);
    expect(html).toContain('data-testid="lr-curve-artisan"');
    expect(html).not.toContain('lr-curve-herald'); // no runs and no changes: not drawn
    expect((html.match(/class="lr-mark"/g) ?? []).length).toBe(2);
    expect(html).toContain('misurata su tutti i ruoli');
    expect(html).toContain('Cambiamenti vicini nel tempo condividono le stesse esecuzioni');
  });
  it('says how few lessons the agents proposed, and that their evidence is never causal (ADR 0186)', () => {
    state.current = page();
    expect(renderToStaticMarkup(createElement(LearningPage))).not.toContain('data-testid="lr-lessons"'); // not read: nothing said
    state.current = { ...page(), learning: { ...page().learning!, lessons: { proposed: 1, approved: 0, discarded: 0, waiting: 1 } } };
    let html = renderToStaticMarkup(createElement(LearningPage));
    expect(html).toContain('1 proposta: 0 applicate, 0 scartate, 1 in attesa. Sono troppo poche');
    expect(html).toContain('non sono mai causali');
    state.current = { ...page(), learning: { ...page().learning!, lessons: { proposed: 0, approved: 0, discarded: 0, waiting: 0 } } };
    html = renderToStaticMarkup(createElement(LearningPage));
    expect(html).toContain('data-testid="lr-lessons-none"');
    expect(html).toContain('Nessun dato');
    setLang('en');
    expect(renderToStaticMarkup(createElement(LearningPage))).toContain('never causal');
  });
  it('says so when the learning data could not be computed, instead of a blank page', () => {
    state.current = { ...page(), learning: undefined };
    expect(renderToStaticMarkup(createElement(LearningPage))).toContain('data-testid="lr-unavailable"');
  });
  it('says what will appear on a brain with no change yet, and works in English', () => {
    state.current = { ...page(), changes: [], learning: { counts: { aiuta: 0, 'nessun-effetto': 0, raccolta: 0, peggiora: 0, annullato: 0 }, roles: [], from, week: W } };
    expect(renderToStaticMarkup(createElement(LearningPage))).toContain('Nessun cambiamento ancora');
    setLang('en');
    state.current = page();
    expect(renderToStaticMarkup(createElement(LearningPage))).toContain('Proven benefit');
  });
});
