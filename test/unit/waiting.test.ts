// waitsForWork (shared/waiting.ts): the words of a chat's last answer that say it still waits for work it started, the
// engine-independent hold of the auto-close, the idle release and the continuity rules (the chats of 2026-10-16).
import { describe, expect, it } from 'vitest';
import { waitsForPeople, waitsForWork } from '../../src/shared/waiting';

describe('waitsForWork', () => {
  it('the last answers of the chats closed on 2026-10-16 and their like say they wait', () => {
    for (const t of [
      'Aspetto la QA sui controlli A, B e C…',
      '2820 è chiuso: 7 Passed, 9 Blocked. Non ho pubblicato niente. Aspetto il report dell\'agente 2800 (TC13, TC16, TC18), poi ti preparo il testo.',
      'Login test 1 fatto, agente ripartito su TC13/16/18. Il rerun 2820 su test 3 è in corso. Aspetto i report.',
      'La prova del "dopo" e il secondo giro del reviewer sono in corso.',
      'Registro l\'errore, poi aspetto reviewer e QA.',
      'Attendo l\'esito della build.',
      'Resto in attesa del sotto-agente.',
      'Lanciato in background: ti scrivo quando finisce.',
      'Waiting for the reviewer to finish.',
      'The tests are still running.',
    ]) expect(waitsForWork(t), t).toBe(true);
  });

  it('a finished answer, or one that waits only for the user, does not', () => {
    for (const t of [
      '', undefined, null,
      'Fatto: il fix è committato, test verdi.',
      'Aspetto il tuo ok.',
      'Ho letto il report: nessun problema.',
      'Il controllo D passa: i totali sono scesi da 62 € a 31 €.',
      'Prossimo passo: apri la PR.',
      'Rispettosamente, aspettiamo lunedì.',
      'Aspetto il tuo ok, poi lancio il deploy.',
      'Aspetto il tuo ok per il job di stasera.',
      'Attendo che tu confermi, poi rilancio i test.',
      'Waiting for your ok before the build.',
    ]) expect(waitsForWork(t), String(t)).toBe(false);
  });
});

// #86: a report that waits for the user or for a colleague keeps the chat open ("In attesa di…"); a finished one closes.
describe('waitsForPeople', () => {
  it('a report or answer that waits for the user', () => {
    for (const t of [
      'Aspetto il tuo ok.',
      'Report inviato. Aspetto il tuo ok, poi lancio il deploy.',
      'Attendo che tu confermi, poi rilancio i test.',
      'Resto in attesa di una tua decisione sul nome.',
      'In attesa dell\'utente per il login.',
      'Waiting for your approval before merging.',
      'Bozza pronta. Procedo?',
      'Vuoi che apra la PR?',
      'Mi serve il tuo ok per cancellare i file.',
      'Attendo conferma.',
      'Blocked on the user: the token expired.',
    ]) expect(waitsForPeople(t), t).toBe('user');
  });
  it('a report that waits for a colleague', () => {
    for (const t of [
      'Ho chiesto a «QA rimborsi» i dati: aspetto la sua risposta da «QA rimborsi».',
      'Aspetto la risposta della chat Backend.',
      'Waiting for the other chat to push the fix.',
      'In attesa dei colleghi per l\'integrazione.',
      'Attendo l\'Orchestrator per il prossimo incarico.',
    ]) expect(waitsForPeople(t), t).toBe('colleagues');
  });
  it('a finished report, running work or a denied wait is nobody', () => {
    for (const t of [
      '', undefined, null,
      'Fatto: report inviato all\'Orchestrator. Ricerca conclusa, 3 fonti.',
      'Tool aggiornato, test verdi, commit locale abc123.',
      'Aspetto la QA sui controlli A, B e C…',
      'Attendo l\'esito della build.',
      'Non aspetto nulla: il lavoro è finito.',
      'Se ti serve altro, scrivimi.',
    ]) expect(waitsForPeople(t), String(t)).toBeNull();
  });
});
