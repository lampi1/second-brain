// Flash's answer outcomes (main/agents/flash-outcomes.ts, ADR 0131): with no model call, an answer holds when, within
// five minutes, the user neither corrects it, asks it again nor hands it to the Orchestrator; questions are kept only as
// word hashes; the log is bounded and read leniently.
import { describe, expect, it } from 'vitest';
import { FLASH_DONE, FLASH_OPEN, FLASH_SETTLE_MS, emptyFlashLog, flashAnswered, flashAsked, flashHanded, readFlashLog, saysWrong, settleDue, signature } from '../../../src/main/agents/flash-outcomes';
import { CORRECTION_TAG } from '../../../src/shared/correction';

const T = Date.UTC(2026, 9, 20, 9);
const Q = 'Quanto costa il piano Pro di Claude al mese?';
/** one question and its answer at `at` */
function answered(at = T, q = Q) { const log = emptyFlashLog(); flashAsked(log, q, at); flashAnswered(log, at + 20_000); return log; }

describe('Flash answer outcomes', () => {
  it('an answer nothing happens to for five minutes held: a success', () => {
    const log = answered();
    settleDue(log, T + 20_000 + FLASH_SETTLE_MS - 1);
    expect(log.open).toHaveLength(1);
    settleDue(log, T + 20_000 + FLASH_SETTLE_MS);
    expect(log.done).toEqual([{ at: T + 20_000 + FLASH_SETTLE_MS, verdict: 'success', why: 'held' }]);
    expect(log.total).toEqual({ success: 1, partial: 0, fail: 0 });
  });
  it('a correction right after is a fail (a «no, …», the correction tag)', () => {
    for (const text of ['no, è sbagliato: costa 20 dollari', 'Non è corretto', `${CORRECTION_TAG}\nil prezzo è un altro`, 'Wrong, it is 20', 'Falsch, das stimmt nicht']) {
      const log = answered();
      flashAsked(log, text, T + 60_000);
      expect(log.done[0]).toMatchObject({ verdict: 'fail', why: 'corrected' });
    }
    expect(saysWrong('nota bene: ok')).toBe(false);
    expect(saysWrong('nonostante tutto, grazie')).toBe(false);
  });
  it('the same question again is a fail; a new question is not', () => {
    const again = answered();
    flashAsked(again, 'quanto costa il piano Pro di Claude al mese, esattamente?', T + 90_000);
    expect(again.done[0]).toMatchObject({ verdict: 'fail', why: 'reasked' });
    const other = answered();
    flashAsked(other, 'e il piano Max quanti messaggi permette?', T + 90_000);
    expect(other.done).toHaveLength(0);
    expect(other.open).toHaveLength(1);
  });
  it('the question handed to the Orchestrator (typed, or «Fanne un lavoro») is a partial; another message is not', () => {
    const typed = answered();
    flashHanded(typed, 'Da Flash. La mia domanda: «Quanto costa il piano Pro di Claude al mese?»\nFanne un lavoro: confronta i piani', T + 120_000);
    expect(typed.done[0]).toMatchObject({ verdict: 'partial', why: 'handed' });
    const other = answered();
    flashHanded(other, 'Prepara il report di ottobre per il cliente', T + 120_000);
    expect(other.done).toHaveLength(0);
  });
  it('after the window, what the user does no longer decides the answer: it already held', () => {
    const log = answered();
    flashAsked(log, 'no, sbagliato', T + 20_000 + FLASH_SETTLE_MS + 1);
    expect(log.done[0]).toMatchObject({ verdict: 'success', why: 'held' });
  });
  it('an answer with no question asked (a resumed turn) records nothing', () => {
    const log = emptyFlashLog();
    flashAnswered(log, T);
    expect(log.open).toHaveLength(0);
  });
  it('keeps hashes of the words, never the question', () => {
    const log = answered();
    expect(JSON.stringify(log)).not.toMatch(/costa|piano|Claude/i);
    expect(signature('Il piano PRO')).toEqual(signature('il piàno pro'));
    expect(signature('a b c')).toEqual([]);
  });
  it('is bounded, and a log out of shape is read as a fresh one, entries out of shape dropped', () => {
    const log = emptyFlashLog();
    for (let i = 0; i < FLASH_DONE + 50; i++) { flashAsked(log, `domanda numero ${i} sul progetto`, T + i * 1000); flashAnswered(log, T + i * 1000 + 10); }
    expect(log.open.length).toBeLessThanOrEqual(FLASH_OPEN);
    settleDue(log, T + 1e9);
    expect(log.done.length).toBeLessThanOrEqual(FLASH_DONE);
    expect(readFlashLog(JSON.parse(JSON.stringify(log)))).toEqual(log);
    expect(readFlashLog(null)).toEqual(emptyFlashLog());
    expect(readFlashLog({ version: 2 })).toEqual(emptyFlashLog());
    const bad = readFlashLog({ version: 1, open: [{ askedAt: 1, answeredAt: 2, sig: ['<script>'] }], done: [{ at: 1, verdict: 'success', why: 'held' }, { at: -1, verdict: 'x', why: 'held' }], total: { success: 0, partial: 0, fail: 0 } });
    expect(bad).toMatchObject({ open: [], done: [{ at: 1, verdict: 'success', why: 'held' }], total: { success: 1 } });
  });
});
