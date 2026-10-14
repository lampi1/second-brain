// The Miglioramento page's numbers and words (src/renderer/brain/lib/learn.ts): /api/improve normalized defensively, the
// typical error, the 80% range's coverage with its n, a proposal's gain from its 90% interval (a revert's in the right
// direction), the after-check of the last change.
import { describe, expect, it } from 'vitest';
import { HELP, checkLine, coverageLine, errorLine, factor, gainLine, normLearn, policyLabel } from '../../../src/renderer/brain/lib/learn';

const row = {
  domain: 'estimates', version: 2, appliedAt: '2026-10-04T10:00:00Z', by: 'app (clic)', name: 'per tipo', previous: 1,
  pending: { id: 'estimates-3', kind: 'cambio', name: 'stessa area e tipo', at: '2026-10-12T10:00:00Z', evidence: { shared: 42, diff: { mean: 0.14, lo: 0.05, hi: 0.22 } } },
  lastCheck: { version: 2, state: 'migliorata', n: 24, need: 20, at: '2026-10-11T10:00:00Z' },
  recorded: { predictions: 31, known: 27, unknown: 2 }, n: 243, noData: false, unknownItems: 3, noPrediction: 6,
  typical: 1.7, spark: [1.2, 'x', 2.5], coverage: { rate: 0.84, n: 30 }, drift: { changed: true },
};

describe('learn page data', () => {
  it('normalizes the brain status, dropping what it cannot trust', () => {
    const [p, r] = normLearn({ policies: [row, { domain: 'routing', version: 1, n: 12, noData: true }, { domain: 'BAD name' }, 'x'] });
    expect(p).toMatchObject({ domain: 'estimates', version: 2, previous: 1, unknown: 5, noPrediction: 6, spark: [1.2, 2.5], driftChanged: true, coverage: { rate: 0.84, n: 30 } });
    expect(p!.pending).toEqual({ id: 'estimates-3', kind: 'cambio', name: 'stessa area e tipo', at: '2026-10-12T10:00:00Z', shared: 42, diff: { mean: 0.14, lo: 0.05, hi: 0.22 } });
    expect(r).toMatchObject({ domain: 'routing', noData: true, pending: null, lastCheck: null, coverage: null, previous: null, typical: null });
    expect(normLearn(null)).toEqual([]);
    expect(normLearn({ policies: [{ domain: 'x', noData: undefined }] })[0]!.noData).toBe(true); // unknown = no data
    expect(normLearn({ policies: [{ ...row, coverage: { rate: 0.5, n: 0 } }] })[0]!.coverage).toBeNull();
    expect(p!.lastCheck).toMatchObject({ state: 'migliorata', n: 24 });
    // a check of an older version is not this version's
    expect(normLearn({ policies: [{ ...row, version: 3 }] })[0]!.lastCheck).toBeNull();
  });

  it('says the error with its n, or "senza dati" with how many are missing', () => {
    const [p, r] = normLearn({ policies: [row, { domain: 'routing', n: 1, noData: true }] });
    expect(errorLine(p!)).toBe('errore tipico ×1,7 sulle ultime 2');
    expect(errorLine(r!)).toBe('senza dati: 1 misurato, ne servono 20');
    expect(factor(12.34)).toBe('×12,3');
    expect(coverageLine({ rate: 0.84, n: 30 })).toBe("l'intervallo dell'80% ha contenuto il reale 84% delle volte (su 30)");
    expect(coverageLine(null)).toBeNull();
    expect(policyLabel('estimates')).toBe('Stime di tempo e costo');
    expect(policyLabel('nuova')).toBe('nuova');
  });

  it("a proposal's gain from its 90% interval; a revert's in the same direction", () => {
    const p = normLearn({ policies: [row] })[0]!.pending!;
    expect(gainLine(p)).toBe('errore più piccolo del 13% (tra 5% e 20%), su 42 casi in comune');
    // revert: the after-check's diff is old − current < 0 when the current one is worse; going back gains
    expect(gainLine({ ...p, kind: 'ripristino', diff: { mean: -0.2, lo: -0.3, hi: -0.1 } })).toBe('errore più piccolo del 18% (tra 10% e 26%), su 42 casi in comune');
    expect(gainLine({ ...p, diff: { mean: -0.1, lo: -0.2, hi: 0.05 } })).toMatch(/^errore più grande del 11%/);
    expect(gainLine({ ...p, diff: null })).toBe('su 42 casi in comune');
    expect(gainLine({ ...p, diff: null, shared: null })).toBe('misura non disponibile');
  });

  it('every "?" explains in plain words, no jargon', () => {
    for (const [k, t] of Object.entries(HELP)) {
      expect(t.length, k).toBeGreaterThan(40);
      expect(t, k).not.toMatch(/champion|challenger|bootstrap|conformal|backtest|baseline/i);
    }
    expect(HELP.intro).toMatch(/Applica/);
    expect(HELP.intro).toMatch(/Ripristina/);
  });

  it('the after-check in words', () => {
    expect(checkLine({ state: 'in attesa', n: 7, need: 20, at: null })).toBe('in attesa: 7 casi dopo il cambio su 20 che servono');
    expect(checkLine({ state: 'peggiorata', n: 22, need: 20, at: null })).toBe("peggiorata (su 22 casi): c'è una proposta di ripristino");
    expect(checkLine({ state: 'come prima (rumore)', n: 21, need: 20, at: null })).toBe('come prima (rumore) (su 21 casi)');
    expect(checkLine(null)).toBeNull();
  });
});
