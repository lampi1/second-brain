// The Classificatori grid's view helpers (src/renderer/lib/classifier-view.ts): every card in a fixed order (an empty
// one for a classifier main did not report), the estimates loop as a card, the weekly series with gaps, the learning
// progress, and the curious facts, which need at least 5 cases and come out in plain Italian.
import { describe, expect, it } from 'vitest';
import type { ClassifierCard, ClassifierWeek, ClassifiersState } from '../../../src/shared/brain-model';
import { cardViews, emptyCard, facts, fromEstimates, fromMain, fromTaskAccuracy, isoWeekOf, hitSeries, hitTrend, progressState, sliceLabel, successSeries, weekLabel } from '../../../src/renderer/lib/classifier-view';
import type { LearnPolicy } from '../../../src/renderer/brain/lib/learn';

const wk = (week: string, decisions: number, hits: number, known = 0, ok = 0): ClassifierWeek => ({ week, decisions, hits, known, ok, avgCostUsd: null });
const card = (o: Partial<ClassifierCard>): ClassifierCard => ({ ...emptyCard('kind'), ...o });

describe('classifier view', () => {
  it('lists the six cards in order, empty when main sent nothing', () => {
    const v = cardViews(null, undefined);
    expect(v.map(c => c.id)).toEqual(['kind', 'model', 'skills', 'tasks', 'estimates', 'jobkind']);
    expect(v.every(c => c.decisions === 0 && c.hit.value === null)).toBe(true);
    expect(progressState(v[0]!)).toBe('idle');
  });

  it('turns the estimates loop into a card', () => {
    const p = { domain: 'estimates', version: 2, appliedAt: '2026-10-10T08:00:00Z', recorded: { predictions: 31, known: 27, unknown: 2 }, n: 243, coverage: { rate: 0.84, n: 30 }, typical: 1.7, spark: [1, 2], lastCheck: { state: 'migliorata', n: 24, need: 20, at: null }, pending: { id: 'x' } } as unknown as LearnPolicy;
    const c = fromEstimates(p);
    expect(c).toMatchObject({ id: 'estimates', decisions: 31, hit: { value: 0.84, n: 30 }, spark: [1, 2], progress: { n: 243, need: 20 }, estimates: { typical: 1.7, version: 2, check: 'migliorata', pending: true } });
    expect(progressState(c)).toBe('ready');
    expect(facts(c)).toEqual([
      '8 volte su 10 il costo vero è rimasto dentro la forchetta stimata.',
      'Di solito la stima sbaglia di ×1,7: è lo scarto tipico fra stima e realtà.',
      'Le regole v2, approvate da te, hanno migliorato le stime rispetto alle precedenti.',
    ]);
    expect(fromEstimates(undefined).hit).toEqual({ value: null, n: 0 });
  });

  it('turns the task estimator’s weekly backtest into a card', () => {
    const mon = new Date(2026, 9, 12).getTime(), prev = new Date(2026, 9, 5).getTime(), old = new Date(2026, 8, 28).getTime();
    expect(isoWeekOf(mon)).toBe('2026-W42');
    const c = fromTaskAccuracy({ n: 20, hitRate: 0.7, trend: 0.3, points: [
      { weekStart: old, n: 0, hitRate: null, medianErr: null, specificShare: null },
      { weekStart: prev, n: 10, hitRate: 0.5, medianErr: 0.6, specificShare: 0.2 },
      { weekStart: mon, n: 10, hitRate: 0.8, medianErr: 0.3, specificShare: 0.6 },
    ] });
    expect(c).toMatchObject({ id: 'tasks', decisions: 20, hit: { value: 0.7, n: 20 }, progress: { n: 20, need: 20 }, tasks: { specific: [null, 0.2, 0.6], medianErr: 0.3, lastSpecific: 0.6 } });
    expect(c.weeks!.map(w => [w.week, w.decisions, w.hits])).toEqual([['2026-W40', 0, 0], ['2026-W41', 10, 5], ['2026-W42', 10, 8]]);
    expect(facts(c).slice(0, 4)).toEqual([
      '7 task su 10 sono durati fra la metà e il doppio della stima.',
      'Sta imparando: le stime giuste sono salite di 30 punti in 2 settimane.',
      'L’ultima settimana 60% delle stime veniva da task dello stesso ruolo e dello stesso tipo.',
      'Di solito il tempo vero si scosta del 30% dalla stima.',
    ]);
    expect(fromTaskAccuracy(null)).toMatchObject({ decisions: 0, hit: { value: null, n: 0 }, weeks: [] });
  });

  it('leaves a gap for a week without data and compares the halves', () => {
    const weeks = [wk('2026-W40', 0, 0), wk('2026-W41', 6, 3, 2, 1), wk('2026-W42', 6, 3), wk('2026-W43', 10, 9)];
    expect(hitSeries(weeks)).toEqual([null, 0.5, 0.5, 0.9]);
    expect(successSeries(weeks)).toEqual([null, 0.5, null, null]);
    expect(weekLabel('2026-W43')).toBe('W43');
    expect(hitTrend(weeks)).toEqual({ before: 0.5, after: 0.75 });
    expect(hitTrend([wk('2026-W42', 2, 1), wk('2026-W43', 2, 2)])).toBeNull(); // under 5 cases a side
  });

  it('tells curious facts only from enough cases', () => {
    const kind = fromMain(card({
      decisions: 20, hit: { value: 0.9, n: 20 }, success: { value: 0.7, n: 10 },
      slices: [{ key: 'bug-fix', count: 10, known: 6, ok: 5, avgCostUsd: 2, top: { key: 'artisan', count: 7 } }, { key: 'altro', count: 2, known: 1, ok: 0, avgCostUsd: 1 }],
      weeks: [wk('2026-W40', 4, 2), wk('2026-W41', 4, 2), wk('2026-W42', 5, 5), wk('2026-W43', 7, 7)],
      compare: { hit: { value: 0.8, n: 6 }, miss: { value: 0.25, n: 4 } },
    }));
    const f = facts(kind);
    expect(f[0]).toBe('70% delle chat di «Fix di bug» va al ruolo Artisan.');
    expect(f).toContain('«Fix di bug» è il tuo lavoro più frequente: 83% delle richieste.');
    expect(f).toContain('Sta imparando: le richieste finite in «altro» sono scese da 50% a 0%.');
    expect(f).toContain('Chat riuscite quando riconosce il lavoro: 80%; quando finisce in «altro»: 25%.');
    expect(f.at(-1)).toBe('Questa settimana 7 decisioni, 2 in più della scorsa.');
    expect(facts(fromMain(card({ decisions: 3, slices: [{ key: 'review', count: 3, known: 0, ok: 0, avgCostUsd: null, top: { key: 'judge', count: 3 } }] })))).toEqual([]);
  });

  it('names the models, the sources, the skills and the cost kinds', () => {
    const sources: ClassifiersState['sources'] = [{ source: 'agent', chats: 7 }, { source: 'table', chats: 3 }];
    const model = fromMain({ ...emptyCard('model'), decisions: 10, slices: [{ key: 'claude-opus-5-5', count: 6, known: 0, ok: 0, avgCostUsd: 3 }, { key: 'claude-haiku-5-5', count: 4, known: 0, ok: 0, avgCostUsd: 0.5 }] });
    expect(facts(model, sources).slice(0, 2)).toEqual(['Il profilo del ruolo sceglie il modello in 7 chat su 10: la tabella decide solo le altre.', 'Una chat su Opus 5.5 costa in media 6× una su Haiku 5.5.']);
    const skills = fromMain({ ...emptyCard('skills'), decisions: 8, hit: { value: 0.75, n: 8 }, weeks: [wk('2026-W43', 8, 6)] });
    expect(facts(skills)).toEqual(['Indovina le skill giuste in 8 avvii su 10.', 'Questa settimana ha sbagliato 2 volte su 8.']);
    const job = fromMain({ ...emptyCard('jobkind'), decisions: 9, hit: { value: 1, n: 9 }, slices: [{ key: 'feature', count: 3, known: 0, ok: 0, avgCostUsd: 3 }, { key: 'question', count: 6, known: 0, ok: 0, avgCostUsd: 0.25 }] });
    expect(facts(job)[0]).toBe('Una «funzionalità» costa in media 12× una «domanda».');
    expect(job.progress).toEqual({ n: 9, need: 20 });
    expect(sliceLabel('skills', '')).toBe('nessuna skill');
    expect(sliceLabel('model', '—')).toBe('predefinito del motore');
  });
});
