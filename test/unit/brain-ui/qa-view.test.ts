// The "Test e QA" section's local rules (src/renderer/brain/lib/qa.ts): outcomes in Italian, stand-up order (failed,
// blocked, to do, rest), people across PRs, the headline's tone, and the stand-up text with names and titles, no ids.
import { describe, expect, it } from 'vitest';
import type { QaPoint, QaReport } from '../../../src/shared/contract';
import { qaHeadline, qaOrder, qaOutcome, qaPeople, qaStandup } from '../../../src/renderer/brain/lib/qa';

const pt = (id: number, outcome: string | null, ranBy: string | null = null): QaPoint =>
  ({ id, suite: 'S', testCase: { id: 500 + id, title: `Caso ${id}`, url: `https://x/${500 + id}` }, outcome, ranBy, ranAt: null, tester: 'Sara Neri', bugs: [] });
const totals = (o: Partial<QaReport['totals']> = {}): QaReport['totals'] =>
  ({ total: 4, done: 3, missing: 1, passed: 1, failed: 1, blocked: 1, notApplicable: 0, other: 0, byPerson: [{ name: 'Anna Neri', done: 2, passed: 1, failed: 1, blocked: 0 }, { name: 'Mario', done: 1, passed: 0, failed: 0, blocked: 1 }], bugs: 1, openBugs: 1, ...o });
const report = (o: Partial<QaReport> = {}): QaReport => ({
  pr: { id: 2798, title: 'Preventivi eliminati', repo: 'Web', project: 'P', author: null, createdAt: '', url: 'https://x/pr/2798' },
  plans: [{ id: 127029, name: 'Piano', url: 'https://x/plan', points: [pt(1, 'passed', 'Anna Neri'), pt(2, null), pt(3, 'failed', 'Anna Neri'), pt(4, 'blocked', 'Mario')], totals: totals() }],
  bugs: [{ id: 601, title: 'Conteggio sbagliato', state: 'Active', open: true, assignedTo: 'Mario', createdAt: null, url: 'https://x/601', testCases: [503] },
    { id: 602, title: 'Chiuso', state: 'Closed', open: false, assignedTo: null, createdAt: null, url: 'https://x/602', testCases: [] }],
  totals: totals(), ...o,
});

describe('qa view', () => {
  it('outcomes in Italian with their tone', () => {
    expect(qaOutcome('passed')).toEqual({ label: 'passato', tone: 'good' });
    expect(qaOutcome('Failed').tone).toBe('bad');
    expect(qaOutcome('notApplicable').label).toBe('non applicabile');
    expect(qaOutcome(null)).toEqual({ label: 'da fare', tone: 'outline' });
    expect(qaOutcome('inconclusive')).toEqual({ label: 'inconclusive', tone: 'warn' });
  });

  it('stand-up order: failed, blocked, to do, then the rest', () => {
    expect(qaOrder(report().plans[0]!.points).map(p => p.id)).toEqual([3, 4, 2, 1]);
  });

  it('people across PRs, most first', () => {
    expect(qaPeople([report(), report()])).toEqual([{ name: 'Anna Neri', done: 4 }, { name: 'Mario', done: 2 }]);
  });

  it('headline and its tone', () => {
    expect(qaHeadline(report())).toEqual({ text: '3 su 4 fatti · mancano 1 · 1 fallito · 1 bloccato · 1 bug aperto', tone: 'bad' });
    expect(qaHeadline(report({ totals: totals({ done: 4, missing: 0, failed: 0, blocked: 0, openBugs: 0 }) }))).toEqual({ text: '4 su 4 fatti · tutti eseguiti', tone: 'good' });
    expect(qaHeadline(report({ totals: totals({ failed: 0, blocked: 0, openBugs: 0 }) })).tone).toBe('warn');
    expect(qaHeadline(report({ totals: totals({ total: 0 }) })).text).toBe('nessun test case');
  });

  it('stand-up text: titles and names, open bugs only, no ids', () => {
    const t = qaStandup([report()]);
    expect(t).toContain('PR «Preventivi eliminati»: 3 su 4 fatti');
    expect(t).toContain('(Anna Neri 2, Mario 1)');
    expect(t).toContain('- fallito: Caso 3 (Anna Neri)');
    expect(t).toContain('- da fare: Caso 2');
    expect(t).toContain('- bug aperto: Conteggio sbagliato (Active, Mario)');
    expect(t).not.toContain('Chiuso');
    expect(t).not.toMatch(/2798|127029|601/);
    expect(qaStandup([])).toBe('Test e QA: nessuna PR attiva con test.');
  });
});
