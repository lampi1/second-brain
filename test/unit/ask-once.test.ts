// One question, one row, one answer (ADR 0326): the pure rules of shared/ask-once.ts. The same question in other
// words, the user's own words told apart from an option he picked, the app's note after them and off again for the
// screen, and a message that asks about a question instead of deciding it.
import { describe, expect, it } from 'vitest';
import type { Answer, PendingRequest } from '../../src/shared/contract';
import { asksToExplain, askedText, isAppAnswer, ownCopyNote, reaskNote, sameAsk, typedWords, withoutAppNote, withWordsNote, WORDS_NOTE } from '../../src/shared/ask-once';
import { ENOUGH_QUESTIONS } from '../../src/shared/strategy';
import { genuiRequestIt as IT } from '../../src/renderer/i18n/areas/genui-request.it';
import { genuiRequestEn as EN } from '../../src/renderer/i18n/areas/genui-request.en';
import { genuiRequestDe as DE } from '../../src/renderer/i18n/areas/genui-request.de';

const req = (question: string, options = ['Sì (consigliato)', 'No'], multiSelect = false): Pick<PendingRequest, 'questions' | 'title'> => ({ title: question, questions: [{ question, multiSelect, options: options.map(label => ({ label })) }] });
const said = (question: string, value: string | string[]): Answer => ({ kind: 'question', answers: { [question]: value } });

describe('the same question', () => {
  it('is the same text whatever its case, punctuation, mark or picture', () => {
    expect(sameAsk('Faccio il merge su main?', 'faccio il merge su main')).toBe(true);
    expect(sameAsk('Faccio il merge su main? (consigliato)', 'Faccio il merge su main?')).toBe(true);
    expect(sameAsk('Tolgo il vecchio login? ![prima](C:\\a.png)', 'Tolgo il vecchio login?')).toBe(true);
  });
  it('is the same decision asked in almost the same words', () => {
    expect(sameAsk('Faccio applicare al pacchetto della routine i primi 3 cambi?', 'Faccio applicare i primi 3 cambi al pacchetto della routine ora?')).toBe(true);
    expect(sameAsk('Applico la migrazione al database locale?', 'Applico ora la migrazione al database locale?')).toBe(true);
  });
  it('one changed word is another decision, never the same question (the next file, the next step, prod)', () => {
    for (const [a, b] of [['Applico il fix al file A?', 'Applico il fix al file B?'], ['Faccio il commit delle modifiche?', 'Faccio il push delle modifiche?'],
      ['Rilancio il test 7 anche su master?', 'Rilancio il test 8 anche su master?'], ['Posso chiudere il task 12?', 'Posso chiudere il task 13?'],
      ['Vuoi che lanci la migrazione del database su staging?', 'Vuoi che lanci la migrazione del database su prod?'], ['Cancello la tabella orders_old?', 'Cancello la tabella orders?'],
      ['Procedo con il merge su main?', 'Procedo con il merge su dev?']] as const)
      expect(sameAsk(a, b), `${a} / ${b}`).toBe(false);
    // the re-asks measured in the owner's chats: the same question with words added
    expect(sameAsk('Demo su MCP, con UTCP lasciato a un eventuale nostro agente futuro?', 'Demo su MCP con login Keycloak, e UTCP lasciato a un eventuale nostro agente futuro?')).toBe(true);
  });
  it('is not another decision, nor two short questions that only look alike', () => {
    expect(sameAsk('Faccio il merge su main?', 'Apro la pull request verso main?')).toBe(false);
    expect(sameAsk('Applico anche il secondo file?', 'Cancello il ramo vecchio dopo il merge?')).toBe(false);
    expect(sameAsk('Procedo?', 'Procedo ora?')).toBe(false);
    expect(sameAsk('', 'Faccio il merge?')).toBe(false);
  });
  it('reads a request as its questions, else its title', () => {
    expect(askedText(req('Faccio il merge?'))).toBe('Faccio il merge?');
    expect(askedText({ title: 'Permesso', questions: [] })).toBe('Permesso');
  });
});

describe('his own words', () => {
  const r = req('Faccio il merge su main?');
  it('are what he typed, never an option he picked', () => {
    expect(typedWords(r, said('Faccio il merge su main?', 'Sì (consigliato)'))).toBeNull();
    expect(typedWords(r, said('Faccio il merge su main?', 'No'))).toBeNull();
    expect(typedWords(r, said('Faccio il merge su main?', 'perché su main e non su un ramo?'))).toBe('perché su main e non su un ramo?');
    expect(typedWords(req('Quali?', ['A', 'B'], true), said('Quali?', ['A', 'solo il primo']))).toBe('solo il primo');
    expect(typedWords(r, { kind: 'permission', allow: true })).toBeNull();
  });
  it('an option typed instead of clicked is the option, and the app\'s own texts are not his words', () => {
    const marked: Pick<PendingRequest, 'questions'> = { questions: [{ question: 'Faccio il merge su main?', multiSelect: false, options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] }] };
    for (const x of ['Sì', 'sì', 'Si', 'no', 'NO.', 'sì (consigliato)']) expect(typedWords(marked, said('Faccio il merge su main?', x)), x).toBeNull();
    expect(typedWords(marked, said('Faccio il merge su main?', 'sì ma su dev'))).toBe('sì ma su dev');
    expect(typedWords(marked, said('Faccio il merge su main?', ENOUGH_QUESTIONS))).toBeNull();
    for (const skip of [IT['genui.decision.skipAnswer'], EN['genui.decision.skipAnswer'], DE['genui.decision.skipAnswer']])
      expect(typedWords(marked, said('Faccio il merge su main?', String(skip))), String(skip)).toBeNull();
  });
  it('in a list the note follows what he typed, never an option', () => {
    const multi: Pick<PendingRequest, 'questions'> = { questions: [{ question: 'Quali file?', multiSelect: true, options: [{ label: 'a.ts' }, { label: 'b.ts' }] }] };
    const told = withWordsNote(multi, { kind: 'question', answers: { 'Quali file?': ['a.ts', 'anche c.ts', 'b.ts'] } }) as Extract<Answer, { kind: 'question' }>;
    expect(told.answers['Quali file?']).toEqual(['a.ts', `anche c.ts${WORDS_NOTE}`, 'b.ts']);
  });
  it('knows an answer the app gave for him', () => {
    expect(isAppAnswer(reaskNote('in che senso?'))).toBe(true);
    expect(isAppAnswer(ownCopyNote('QA', 'c1', 'q1'))).toBe(true);
    expect(isAppAnswer('Sì')).toBe(false);
    expect(isAppAnswer('in che senso?')).toBe(false);
  });
  it('reach the chat with the app\'s note; an option stays as it is; the screen shows them without it', () => {
    const picked = said('Faccio il merge su main?', 'No');
    expect(withWordsNote(r, picked)).toBe(picked);
    const told = withWordsNote(r, said('Faccio il merge su main?', 'spiegami meglio'));
    const text = (told as Extract<Answer, { kind: 'question' }>).answers['Faccio il merge su main?'] as string;
    expect(text.startsWith('spiegami meglio')).toBe(true);
    expect(text).toContain(WORDS_NOTE);
    expect(withoutAppNote(text)).toBe('spiegami meglio');
    expect(withoutAppNote('Sì')).toBe('Sì');
  });
  it('the notes say what to do: reply in plain words first, the question only after that reply', () => {
    expect(WORDS_NOTE).toContain('they are his answer');
    expect(WORDS_NOTE).toContain('in plain words');
    expect(WORDS_NOTE).toContain('Only after that reply may this question come back');
    expect(reaskNote('perché?\nnon capisco')).toContain('«perché? non capisco»');
    expect(reaskNote('x')).toContain('write the answer in your reply first');
    expect(reaskNote('x')).toContain('a brief or a card is not that reply');
    expect(ownCopyNote('QA', 'c1', 'q1')).toContain('app_resolve_question (chatId c1, requestId q1)');
  });
});

describe('a message that asks about the question instead of deciding it', () => {
  it('asks to explain, or is a question that opens with a question word', () => {
    for (const t of ['spiegami meglio', 'Spiega cosa cambia', 'non ho capito', 'in che senso?', 'perché su main?', 'cosa succede se dico no?', 'che vuol dire rebase?', 'Quale dei due è più sicuro?', 'e se poi si rompe?', 'why main?', 'what does it mean?', 'warum?',
      'Mi spieghi meglio?', 'Me lo spieghi?', 'mi fai un esempio?', 'Qual è la differenza?', 'Cos\'è il rebase?', 'Ma perché?', 'Scusa, non ho capito', 'Non è chiaro', 'Boh, in che senso?', 'ok ma cosa cambia?', 'quindi cosa devo fare?',
      'Si può annullare dopo?', 'Can you explain?', 'I don\'t get it', 'Wieso?', 'Kannst du das erklären?'])
      expect(asksToExplain(t), t).toBe(true);
  });
  it('is never a decision, also one that ends with a question mark or opens like a question', () => {
    for (const t of ['sì', 'Sì, ma sul ramo dev?', 'si, ma su dev?', 'no', 'ok vai', 'usa dev', 'usa dev, ok?', 'fallo blu scuro', 'procedi ma senza test?', '', 'prima fai il backup',
      'Perché no, vai', 'Why not, go ahead', 'Che ne dici di dev?', 'E se usassimo dev?', 'come prima?', 'Spiegami dopo, intanto procedi con il sì', 'Cosa cambia non mi interessa, vai'])
      expect(asksToExplain(t), t).toBe(false);
  });
});
