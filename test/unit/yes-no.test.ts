// Yes/no questions only (shared/yes-no.ts, ADR 0135): the shape check the question gates use and when the gate is on.
import { describe, expect, it } from 'vitest';
import { LADDER_TOOL, QUESTION_RULE, YESNO_REFUSAL, isNativeQuestion, isUserQuestion, isYesNo, notYesNoWhy, ranCommandQuestion, yesNoGateOn, yesNoOf, yesNoRefusal, yesNoShape } from '../../src/shared/yes-no';

const q = (...labels: string[]) => ({ options: labels.map(label => ({ label })), multiSelect: false });

describe('whose question it is', () => {
  it('the app\'s card of a worker\'s question is the user\'s like an engine\'s own, and never an engine\'s own', () => {
    const card = { type: 'question' as const, tool: LADDER_TOOL };
    expect([isNativeQuestion(card), isUserQuestion(card)]).toEqual([false, true]);
    expect([isNativeQuestion({ ...card, tool: 'AskUser' }), isUserQuestion({ ...card, tool: 'AskUser' })]).toEqual([true, true]);
    expect(isUserQuestion({ ...card, tool: 'mcp__srv__ask' })).toBe(false);
    expect(isUserQuestion({ type: 'permission', tool: LADDER_TOOL })).toBe(false);
  });
});

describe('yes/no questions', () => {
  it('reads Sì / No in the app languages, with the recommended mark and punctuation aside', () => {
    expect(yesNoOf('Sì (consigliato)')).toBe('yes');
    expect(yesNoOf('si')).toBe('yes');
    expect(yesNoOf('Yes (recommended)')).toBe('yes');
    expect(yesNoOf('Ja')).toBe('yes');
    expect(yesNoOf('No.')).toBe('no');
    expect(yesNoOf('Nein')).toBe('no');
    expect(yesNoOf('Sì, procedi')).toBeNull();
    expect(yesNoOf('Blu')).toBeNull();
  });
  it('a question is yes/no with exactly a yes and a no, single choice', () => {
    expect(isYesNo(q('Sì (consigliato)', 'No'))).toBe(true);
    expect(isYesNo(q('No', 'Sì'))).toBe(true);
    expect(isYesNo(q('Sì', 'Sì'))).toBe(false);
    expect(isYesNo(q('Blu', 'Rosso'))).toBe(false);
    expect(isYesNo(q('Sì', 'No', 'Forse'))).toBe(false);
    expect(isYesNo({ ...q('Sì', 'No'), multiSelect: true })).toBe(false);
  });
  it('a request has one yes/no question at a time', () => {
    expect(yesNoShape([q('Sì', 'No')])).toBe(true);
    expect(yesNoShape([q('Sì', 'No'), q('Yes', 'No')])).toBe(false);
    expect(yesNoShape([q('Sì', 'No'), q('A', 'B')])).toBe(false);
    expect(yesNoShape([])).toBe(false);
  });
  it('a vague question goes back: «Fatto?» does not say what it asks (ADR 0259)', () => {
    for (const v of ['Fatto?', 'Hai fatto?', 'Ok?', 'Procedo?', 'Tutto ok?', 'L\'hai eseguito?']) expect(yesNoShape([{ ...q('Sì', 'No'), question: v }])).toBe(false);
    for (const v of ['Pubblico?', 'Deploy ora?', 'Faccio il merge?']) expect(yesNoShape([{ ...q('Sì', 'No'), question: v }])).toBe(true);
    for (const c of ['Faccio il commit del fix?', 'Hai fatto il login su Azure DevOps?', 'Procedo con il deploy in test?']) expect(yesNoShape([{ ...q('Sì', 'No'), question: c }])).toBe(true);
  });
  it('a question on whether the user ran a command goes back: a Yes to it is not a run (#372)', () => {
    for (const v of ['Hai eseguito il comando sopra?', 'L\'hai già lanciato?', 'Il comando è stato eseguito?', 'Did you run the command above?', 'Have you executed the script?'])
      expect(ranCommandQuestion(v), v).toBe(true);
    for (const v of ['Hai provato a lanciare il comando?', 'Hai fatto partire lo script?', 'Hai incollato il comando nel terminale?', 'Comando eseguito?',
      'Lanciato?', 'Eseguito il comando sopra?', 'Did the command run?', 'Have you tried running it?', 'Ran it?', 'Hai eseguito i test con successo, procedo al merge?'])
      expect(ranCommandQuestion(v), v).toBe(true);
    // the agent's own status before its real question is not one (the user is not the subject)
    for (const v of ['Eseguo il comando sul tuo PC?', 'Lancio i test adesso?', 'Hai preferenze sul nome del ramo?', 'Should I run the tests?',
      'I test sono stati eseguiti con successo: procedo al merge?', 'La migrazione è stata eseguita in staging: la applico in produzione?',
      'L\'agente ha eseguito i test: apro la PR?', 'CI ha lanciato il job notturno: lo disattivo?', 'Abbiamo eseguito la migrazione: aggiorno il README?',
      'I ran the command and tests pass. Merge the PR?', 'Has it run in CI before? Should I re-run it?', 'Lo riprendo quando il comando ha girato?', 'Ho eseguito i test, procedo al merge?',
      'Eseguiti i test, procedo con il merge?', 'Lanciata la build, apro la PR?', 'Eseguito il deploy, faccio il merge?', 'Did you run into any issues?'])
      expect(ranCommandQuestion(v), v).toBe(false);
    expect(yesNoShape([{ ...q('Sì', 'No'), question: 'Hai eseguito il comando sopra?' }])).toBe(false);
    expect(YESNO_REFUSAL).toContain('never whether the user ran a command');
  });
  it('a question too long or with code goes back: its context belongs in the brief (ADR 0259)', () => {
    expect(yesNoShape([{ ...q('Sì', 'No'), question: 'Faccio il commit del fix?' }])).toBe(true);
    expect(yesNoShape([{ ...q('Sì', 'No'), question: 'Ho trovato il bug. '.repeat(10) + 'Procedo?' }])).toBe(false);
    expect(yesNoShape([{ ...q('Sì', 'No'), question: 'Lancio ```npm test```?' }])).toBe(false);
    expect(yesNoShape([{ ...q('Sì', 'No'), question: `Il carrello ora è giusto (C:\\evidence\\${'x'.repeat(150)}.png). Faccio il commit?` }])).toBe(true);
  });
  it('the gate is on in a real profile, off in the test suites unless asked, SB_YESNO=0 turns it off', () => {
    expect(yesNoGateOn({})).toBe(true);
    expect(yesNoGateOn({ SB_YESNO: '0' })).toBe(false);
    expect(yesNoGateOn({ SB_TEST: '1' })).toBe(false);
    expect(yesNoGateOn({ VITEST: 'true', SB_YESNO: '1' })).toBe(true);
  });
});

it('recommends forward progress unless a concrete reason to stop is explained', () => {
  for (const rule of [QUESTION_RULE, YESNO_REFUSAL]) {
    expect(rule).toContain('moves the task forward');
    expect(rule).toContain('concrete reason');
  }
});

describe('#492 point 2: a refused question is told which rule it broke (ADR 0371)', () => {
  const one = (question: string, ...labels: string[]) => [{ question, ...q(...labels) }];
  it('names its own fault, and none when the shape is right', () => {
    expect(notYesNoWhy([...one('Pubblico?', 'Sì', 'No'), ...one('Chiudo?', 'Sì', 'No')])).toMatch(/2 questions: ask exactly one/);
    expect(notYesNoWhy(one('Quale tema uso?', 'Chiaro', 'Scuro'))).toMatch(/"Chiaro", "Scuro": use exactly two, "Sì" and "No"/);
    expect(notYesNoWhy(one('Fatto?', 'Sì', 'No'))).toMatch(/does not say what it decides/);
    expect(notYesNoWhy(one('Hai eseguito il comando sopra?', 'Sì', 'No'))).toMatch(/whether the user ran a command/);
    expect(notYesNoWhy(one('x'.repeat(200) + '?', 'Sì', 'No'))).toMatch(/201 characters; the limit is 160/);
    expect(notYesNoWhy(one('Pubblico la pagina del modulo Ordini?', 'Sì (consigliato)', 'No'))).toBeNull();
    expect(yesNoRefusal(one('Quale tema uso?', 'Chiaro', 'Scuro')).endsWith(YESNO_REFUSAL)).toBe(true);
    expect(yesNoRefusal(one('Pubblico la pagina?', 'Sì', 'No'))).toBe(YESNO_REFUSAL);
  });
});
