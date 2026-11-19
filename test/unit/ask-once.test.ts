// One question, one row, one answer (ADR 0326): the pure rules of shared/ask-once.ts. The same question in other
// words, the user's own words told apart from an option he picked, the app's note after them and off again for the
// screen, and a message that asks about a question instead of deciding it.
import { describe, expect, it } from 'vitest';
import type { Answer, PendingRequest } from '../../src/shared/contract';
import { asksToExplain, askedText, ownCopyNote, reaskNote, sameAsk, typedWords, withoutAppNote, withWordsNote, WORDS_NOTE } from '../../src/shared/ask-once';

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
    for (const t of ['spiegami meglio', 'Spiega cosa cambia', 'non ho capito', 'in che senso?', 'perché su main?', 'cosa succede se dico no?', 'che vuol dire rebase?', 'Quale dei due è più sicuro?', 'e se poi si rompe?', 'why main?', 'what does it mean?', 'Warum?'])
      expect(asksToExplain(t), t).toBe(true);
  });
  it('is never a decision, also one that ends with a question mark', () => {
    for (const t of ['sì', 'Sì, ma sul ramo dev?', 'no', 'ok vai', 'usa dev', 'usa dev, ok?', 'fallo blu scuro', 'procedi ma senza test?', '', 'prima fai il backup'])
      expect(asksToExplain(t), t).toBe(false);
  });
});
