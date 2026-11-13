// Unit tests of lib/askSplit.ts: an agent's question written as one text splits into a muted context and the real
// question only when the split is certain; everything else comes back whole (the panel never rewrites the question).
import { describe, expect, it } from 'vitest';
import { splitAsk } from '../../src/renderer/lib/askSplit';

describe('splitAsk', () => {
  it('splits statements followed by one question', () => {
    expect(splitAsk('Il test case 7 fallisce anche su master: il bug è vecchio, non della PR. Apro un bug separato per Sara?'))
      .toEqual({ lead: 'Il test case 7 fallisce anche su master: il bug è vecchio, non della PR.', ask: 'Apro un bug separato per Sara?' });
    expect(splitAsk('Ho finito il fix e i test sono verdi!\nFaccio il commit sul ramo?'))
      .toEqual({ lead: 'Ho finito il fix e i test sono verdi!', ask: 'Faccio il commit sul ramo?' });
    expect(splitAsk('La pipeline è rossa per un test instabile. «Rilancio» la pipeline adesso?'))
      .toEqual({ lead: 'La pipeline è rossa per un test instabile.', ask: '«Rilancio» la pipeline adesso?' });
  });

  it('leaves a bare question whole', () => {
    expect(splitAsk('Apro un bug per il test case 7?')).toBeNull();
    expect(splitAsk('Passo 1: procedo?')).toBeNull(); // lowercase after the colon: one sentence
    expect(splitAsk('Il pezzo 1 ti è chiaro?')).toBeNull();
  });

  it('leaves texts that are not a question whole', () => {
    expect(splitAsk('Ho finito. Dimmi tu.')).toBeNull();
    expect(splitAsk('')).toBeNull();
  });

  it('never splits a list of questions', () => {
    expect(splitAsk('Vuoi la variante A con i nodi fermi? Oppure preferisci la B?')).toBeNull();
    expect(splitAsk('Ho due dubbi. Il primo è chiaro? Il secondo anche?')).toBeNull();
  });

  it('never cuts at an abbreviation, a number or inside code and links', () => {
    expect(splitAsk('Controllo i log, es. Kudu e App Insights?')).toBeNull();
    expect(splitAsk('Ci sono 3 file, ecc. Li cancello tutti?')).toBeNull();
    expect(splitAsk('Ho seguito il passo 2. Poi il 3?')).toBeNull(); // the question is too short to stand alone
    expect(splitAsk('Lancio `npm run check. Poi` il resto?')).toBeNull();
    expect(splitAsk('Leggi [il report. Completo](https://x.y) Va bene?')).toBeNull();
  });

  it('keeps a lead too short to be context whole', () => {
    expect(splitAsk('Ok. Procedo con il deploy in test?')).toBeNull();
  });
});
