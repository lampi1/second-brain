// The Classificatori grid's view helpers (src/renderer/lib/classifier-view.ts): every card in a fixed order (an empty
// one for a classifier main did not report; no card for the brain's retired estimator, ADR 0053/0101), the estimates
// loop's data shape, the weekly series with gaps, k/n beside a share, and the advice: only from 20 cases up and only
// when it ends with something to do (ADR 0101: no "Lo sapevi?" on 5 cases, no "sta imparando" trend, no calibration).
import { describe, expect, it } from 'vitest';
import type { ClassifierCard, ClassifierWeek, ClassifiersState } from '../../../src/shared/brain-model';
import { cardViews, emptyCard, facts, fromEstimates, fromMain, fromTaskAccuracy, isoWeekOf, hitSeries, hitTrend, kOfN, MIN_FACT, sliceLabel, successSeries, weekLabel } from '../../../src/renderer/lib/classifier-view';
import type { LearnPolicy } from '../../../src/renderer/brain/lib/learn';

const wk = (week: string, decisions: number, hits: number, known = 0, ok = 0): ClassifierWeek => ({ week, decisions, hits, known, ok, avgCostUsd: null });
const card = (o: Partial<ClassifierCard>): ClassifierCard => ({ ...emptyCard('kind'), ...o });

describe('classifier view', () => {
  it('lists the five cards in order, empty when main sent nothing; no card for the retired estimator', () => {
    const v = cardViews(null, undefined);
    expect(v.map(c => c.id)).toEqual(['kind', 'model', 'tasks', 'jobkind']);
    expect(v.every(c => c.decisions === 0 && c.hit.value === null)).toBe(true);
    expect(v[0]).not.toHaveProperty('progress');
  });

  it('keeps the estimates loop’s data shape, without advice from it', () => {
    const p = { domain: 'estimates', version: 2, appliedAt: '2026-10-10T08:00:00Z', recorded: { predictions: 31, known: 27, unknown: 2 }, n: 243, coverage: { rate: 0.84, n: 30 }, typical: 1.7, spark: [1, 2], lastCheck: { state: 'migliorata', n: 24, need: 20, at: null }, pending: { id: 'x' } } as unknown as LearnPolicy;
    const c = fromEstimates(p);
    expect(c).toMatchObject({ id: 'estimates', decisions: 31, hit: { value: 0.84, n: 30 }, spark: [1, 2], estimates: { typical: 1.7, version: 2, check: 'migliorata', pending: true, n: 243 } });
    expect(facts(c)).toEqual([]);
    expect(fromEstimates(undefined).hit).toEqual({ value: null, n: 0 });
  });

  it('turns the task estimator’s weekly backtest into a card, with k/n and no trend', () => {
    const mon = new Date(2026, 9, 12).getTime(), prev = new Date(2026, 9, 5).getTime(), old = new Date(2026, 8, 28).getTime();
    expect(isoWeekOf(mon)).toBe('2026-W42');
    const c = fromTaskAccuracy({ n: 20, hits: 14, hitRate: 0.7, points: [
      { weekStart: old, n: 0, hitRate: null, medianErr: null, specificShare: null },
      { weekStart: prev, n: 10, hitRate: 0.5, medianErr: 0.6, specificShare: 0.2 },
      { weekStart: mon, n: 10, hitRate: 0.8, medianErr: 0.3, specificShare: 0.6 },
    ] });
    expect(c).toMatchObject({ id: 'tasks', decisions: 20, hit: { value: 0.7, n: 20 }, tasks: { specific: [null, 0.2, 0.6], medianErr: 0.3, lastSpecific: 0.6 } });
    expect(c.tasks).not.toHaveProperty('trend');
    expect(kOfN(c.hit)).toBe('14/20');
    expect(c.weeks!.map(w => [w.week, w.decisions, w.hits])).toEqual([['2026-W40', 0, 0], ['2026-W41', 10, 5], ['2026-W42', 10, 8]]);
    expect(facts(c)).toEqual([]); // 70% within ×2: nothing to do
    const loose = fromTaskAccuracy({ n: 24, hits: 9, hitRate: 9 / 24, points: [{ weekStart: mon, n: 24, hitRate: 9 / 24, medianErr: 1.1, specificShare: 0.5 }] });
    expect(facts(loose)).toEqual(['Solo 9 stime su 24 sono rimaste entro ×2: leggile come ordine di grandezza, non come scadenza.']);
    expect(fromTaskAccuracy(null)).toMatchObject({ decisions: 0, hit: { value: null, n: 0 }, weeks: [] });
  });

  it('leaves a gap for a week without data and compares the halves only from MIN_FACT cases a side', () => {
    expect(MIN_FACT).toBe(20);
    const weeks = [wk('2026-W40', 0, 0), wk('2026-W41', 20, 10, 2, 1), wk('2026-W42', 6, 3), wk('2026-W43', 20, 18)];
    expect(hitSeries(weeks)).toEqual([null, 0.5, 0.5, 0.9]);
    expect(successSeries(weeks)).toEqual([null, 0.5, null, null]);
    expect(weekLabel('2026-W43')).toBe('W43');
    expect(hitTrend(weeks)).toEqual({ before: 0.5, after: 21 / 26 });
    expect(hitTrend([wk('2026-W42', 6, 3), wk('2026-W43', 6, 6)])).toBeNull(); // under 20 cases a side
  });

  it('carries the unverified outcomes apart from the verified success (ADR 0095)', () => {
    const v = fromMain(card({ success: { value: 0.5, n: 4 }, unverified: { value: 1, n: 34 } }));
    expect(v.success).toEqual({ value: 0.5, n: 4 });
    expect(v.unverified).toEqual({ value: 1, n: 34 });
    expect(fromMain(card({})).unverified).toBeUndefined();
  });

  it('gives advice only from enough cases and only when it ends with an action', () => {
    const kind = fromMain(card({
      decisions: 40, hit: { value: 0.7, n: 40 }, success: { value: 0.7, n: 10 },
      slices: [{ key: 'bug-fix', count: 28, known: 6, ok: 5, avgCostUsd: 2, top: { key: 'artisan', count: 20 } }, { key: 'altro', count: 12, known: 1, ok: 0, avgCostUsd: 1 }],
    }));
    expect(facts(kind)).toEqual(['12 richieste su 40 finiscono in «altro»: aggiungi una regola nel brain (Regole) per il tipo di lavoro che manca.']);
    expect(kOfN(kind.hit)).toBe('28/40');
    // few cases, or few «altro»: no advice (no "Lo sapevi?" curiosity either)
    expect(facts(fromMain(card({ decisions: 8, slices: [{ key: 'altro', count: 8, known: 0, ok: 0, avgCostUsd: null }] })))).toEqual([]);
    expect(facts(fromMain(card({ decisions: 40, slices: [{ key: 'review', count: 38, known: 0, ok: 0, avgCostUsd: null }, { key: 'altro', count: 2, known: 0, ok: 0, avgCostUsd: null }] })))).toEqual([]);
  });

  it('compares the cost of models and job kinds only on 10 cases a side, with the action', () => {
    const sources: ClassifiersState['sources'] = [{ source: 'agent', chats: 7 }, { source: 'table', chats: 3 }];
    const model = fromMain({ ...emptyCard('model'), decisions: 30, slices: [{ key: 'claude-opus-5-5', count: 16, known: 0, ok: 0, avgCostUsd: 3 }, { key: 'claude-haiku-5-5', count: 14, known: 0, ok: 0, avgCostUsd: 0.5 }] });
    expect(facts(model, sources)).toEqual(['Una chat su Opus 5.5 costa in media 6× una su Haiku 5.5 (16 e 14 chat): se gli esiti sono simili, scegli il più leggero nel profilo del ruolo.']);
    const few = fromMain({ ...emptyCard('model'), decisions: 10, slices: [{ key: 'claude-opus-5-5', count: 6, known: 0, ok: 0, avgCostUsd: 3 }, { key: 'claude-haiku-5-5', count: 4, known: 0, ok: 0, avgCostUsd: 0.5 }] });
    expect(facts(few, sources)).toEqual([]);
    const job = fromMain({ ...emptyCard('jobkind'), decisions: 30, hit: { value: 1, n: 30 }, slices: [{ key: 'app-feature', count: 12, known: 0, ok: 0, avgCostUsd: 3 }, { key: 'writing', count: 18, known: 0, ok: 0, avgCostUsd: 0.25 }] });
    // one taxonomy (ADR 0182): the cost ledger's kinds read like the routing table's
    expect(facts(job)[0]).toBe('Una «Funzione nuova» costa in media 12× una «Scrittura» (12 e 18 lavori): è il primo posto dove cercare un risparmio, un modello più leggero o una skill.');
    expect(sliceLabel('model', '—')).toBe('predefinito del motore');
  });
});
