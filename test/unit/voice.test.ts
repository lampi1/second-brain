// Voice mode's pure rules (ADR 0152, src/shared/voice.ts): a spoken answer to a yes/no card, Whisper's noise on
// silence, what of a reply is said aloud, which turn is read while it streams (never one the app started), and how
// a streaming reply is cut into the pieces synthesized one by one.
import { describe, expect, it } from 'vitest';
import { forEar, isNoise, parseSpokenAnswer, settledText, speakable, speechChunks, spokenQuestion, turnToSpeak } from '../../src/shared/voice';
import type { ChatItem } from '../../src/shared/contract';

describe('parseSpokenAnswer', () => {
  it('short yes / no count as the click, with or without punctuation and accents', () => {
    expect(parseSpokenAnswer('Sì.')).toEqual({ kind: 'yes' });
    expect(parseSpokenAnswer('si, vai')).toEqual({ kind: 'yes' });
    expect(parseSpokenAnswer('Certo!')).toEqual({ kind: 'yes' });
    expect(parseSpokenAnswer('No grazie.')).toEqual({ kind: 'no' });
    expect(parseSpokenAnswer('no, non ora')).toEqual({ kind: 'no' });
  });
  it('«non voglio rispondere» and «ci penso dopo» skip', () => {
    expect(parseSpokenAnswer('Non voglio rispondere.')).toEqual({ kind: 'skip' });
    expect(parseSpokenAnswer('ci penso dopo')).toEqual({ kind: 'skip' });
  });
  it.each(['Sì, ma aspetta', 'Sì, non farlo', 'No, fallo pure', 'Sì forse', 'Non voglio rispondere ora, però procedi', 'Sì… no'])('keeps a qualified answer as text: %s', text => {
    expect(parseSpokenAnswer(text)).toEqual({ kind: 'text', text });
  });
  it('a longer sentence is the user own answer, as typed', () => {
    expect(parseSpokenAnswer('Sì però prima fai girare i test sul branch di sviluppo')).toEqual({ kind: 'text', text: 'Sì però prima fai girare i test sul branch di sviluppo' });
    expect(parseSpokenAnswer('Usa la seconda opzione')).toEqual({ kind: 'text', text: 'Usa la seconda opzione' });
    expect(parseSpokenAnswer('   ')).toBeNull();
  });
});

describe('isNoise', () => {
  it('drops Whisper output on silence and empty marks, keeps real words', () => {
    expect(isNoise('Sottotitoli a cura di QTSS')).toBe(true);
    expect(isNoise('Grazie per la visione!')).toBe(true);
    expect(isNoise(' . ')).toBe(true);
    expect(isNoise('Controlla i log degli ordini')).toBe(false);
  });
});

describe('speakable', () => {
  it('leaves out code, links, paths, markdown marks and emoji', () => {
    const s = speakable('## Fatto\n**Tre errori** nel [servizio](https://x.y/z) ordini 🎉\n```ts\nconst a = 1\n```\nVedi C:\\progetti\\shop\\log.txt');
    expect(s).toContain('Fatto');
    expect(s).toContain('Tre errori nel servizio ordini');
    expect(s).toContain('codice in chat');
    expect(s).not.toMatch(/https|```|\*\*|🎉|progetti/);
  });
  it('cuts a long reply at a sentence and says the rest is in the chat', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Frase numero ${i} della risposta.`).join(' ');
    const s = speakable(long, 200);
    expect(s.length).toBeLessThan(260);
    expect(s.endsWith('Il resto è in chat.')).toBe(true);
  });
  it('an emoji-only reply says nothing', () => { expect(speakable('👍')).toBe(''); });
});

describe('turnToSpeak', () => {
  const user = (at: number, from?: string): ChatItem => ({ kind: 'user', id: `u${at}`, at, text: 'ciao', ...(from ? { from } : {}) });
  const said = (at: number, text: string, streaming = false): ChatItem => ({ kind: 'assistant', id: `a${at}`, at, text, ...(streaming ? { streaming } : {}) });
  const done = (at: number): ChatItem => ({ kind: 'result', id: `r${at}`, at, costUsd: 0, durationMs: 1, turns: 1, isError: false });
  it('the reply to the user own message after voice went on, while it is still being written', () => {
    expect(turnToSpeak([user(10), said(11, 'Uno. Du', true)], 5)).toEqual({ key: 'u10', text: 'Uno. Du', done: false });
    expect(turnToSpeak([user(10), said(11, 'Uno.'), said(12, 'Due.'), done(13)], 5)).toEqual({ key: 'u10', text: 'Uno.\n\nDue.', done: true });
  });
  it('never a turn started by the app or another chat, nor one from before voice went on', () => {
    expect(turnToSpeak([user(10, 'Orchestrator'), said(11, 'Uno.'), done(12)], 5)).toBeNull();
    expect(turnToSpeak([user(3), said(11, 'Uno.'), done(12)], 5)).toBeNull();
  });
});

describe('settledText', () => {
  it('a streaming reply: up to its last finished sentence, never inside an open code block', () => {
    expect(settledText('Ciao. Sto contr', false)).toBe('Ciao.');
    expect(settledText('Ecco:\n```js\nconst a', false)).toBe('Ecco:\n');
    expect(settledText('niente ancora', false)).toBe('');
    expect(settledText('Ciao. Sto contr', true)).toBe('Ciao. Sto contr');
  });
  it('a dotted number or a list number does not end a sentence', () => {
    expect(settledText('Versione 1.2 e poi', false)).toBe('');
    expect(settledText('Ecco i passi:\n1. Apri', false)).toBe('Ecco i passi:\n');
  });
});

describe('speechChunks', () => {
  it('one piece per sentence; a long one also at a comma, so the first sound comes soon', () => {
    expect(speechChunks('Fatto. Ho aperto la PR! Vuoi altro?')).toEqual(['Fatto.', 'Ho aperto la PR!', 'Vuoi altro?']);
    const long = `${'parola '.repeat(20).trim()}, ${'altra '.repeat(20).trim()}.`;
    const parts = speechChunks(long, 180);
    expect(parts.length).toBe(2);
    expect(parts.every(p => p.length <= 180)).toBe(true);
    expect(parts.join(' ')).toBe(long);
  });
  it('no piece without a word', () => {
    expect(speechChunks('… . Ok.')).toEqual(['Ok.']);
  });
});

describe('spokenQuestion', () => {
  it('reads like a person, never like a form: labels dropped, a question mark, what yes and no do', () => {
    const s = spokenQuestion({ from: 'Lo Scout', question: 'Contesto: posso fare il merge della PR', done: 'Fatto: test verdi\n- review pulita', ifYes: 'Faccio il merge su main.', ifNo: 'Resta aperta e ti scrivo cosa manca.' }, true);
    expect(s).toBe('Lo Scout ti chiede una cosa. Test verdi, review pulita. Posso fare il merge della PR? Se mi dici di sì, faccio il merge su main. Se mi dici di no, resta aperta e ti scrivo cosa manca. Puoi rispondere sì o no, oppure dirmi con parole tue cosa preferisci.');
    expect(s).not.toMatch(/Contesto|Fatto:|-/);
  });
  it('the how-to-answer line only the first time; no empty parts', () => {
    expect(spokenQuestion({ question: 'Vado avanti?' }, false)).toBe('Ho una domanda per te. Vado avanti?');
  });
});

describe('forEar', () => {
  it('English words and acronyms respelled for the Italian voice, symbols said', () => {
    expect(forEar('Ho aperto la PR #224 su GitHub: il merge è fatto (test verdi).')).toBe('Ho aperto la pi erre numero 224 su ghìt-hab, il mèrg è fatto, test verdi.');
    expect(forEar('Fatto → ora la CI è ok, 100% dei test.')).toBe('Fatto, poi ora la ci i è okèi, 100 per cento dei test.');
  });
  it('a word that only contains a dictionary word stays as it is', () => {
    expect(forEar('Il bugiardo ha un profilo.')).toBe('Il bugiardo ha un profilo.');
    expect(forEar('Ci sono le file alla cassa.')).toBe('Ci sono le file alla cassa.');
  });
  it('text in capitals and Roman numerals are words, not acronyms; km/h and e/o stay readable', () => {
    expect(forEar('NON FARLO ADESSO.')).toBe('NON FARLO ADESSO.');
    expect(forEar('Il capitolo XIV.')).toBe('Il capitolo XIV.');
    expect(forEar('A 50 km/h, tu e/o lui.')).toBe('A 50 km/h, tu e o lui.');
  });
});

