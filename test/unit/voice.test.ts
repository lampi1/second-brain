// Voice mode's pure rules (ADR 0152, src/shared/voice.ts): a spoken answer to a yes/no card, Whisper's noise on
// silence, what of a reply is said aloud, and which reply is read when a turn ends (never one the app started).
import { describe, expect, it } from 'vitest';
import { isNoise, parseSpokenAnswer, replyToSpeak, speakable, spokenQuestion } from '../../src/shared/voice';
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

describe('replyToSpeak', () => {
  const user = (at: number, from?: string): ChatItem => ({ kind: 'user', id: `u${at}`, at, text: 'ciao', ...(from ? { from } : {}) });
  const said = (at: number, text: string): ChatItem => ({ kind: 'assistant', id: `a${at}`, at, text });
  const done = (at: number, extra: Partial<Extract<ChatItem, { kind: 'result' }>> = {}): ChatItem => ({ kind: 'result', id: `r${at}`, at, costUsd: 0, durationMs: 1, turns: 1, isError: false, ...extra });
  it('the reply to the user own message after voice went on, once per result', () => {
    expect(replyToSpeak([user(10), said(11, 'Uno.'), said(12, 'Due.'), done(13)], 5)).toEqual({ key: 'r13', text: 'Uno. Due.' });
  });
  it('never a turn started by the app or another chat, nor one from before voice mode', () => {
    expect(replyToSpeak([user(10, 'Orchestrator'), said(11, 'Uno.'), done(12)], 5)).toBeNull();
    expect(replyToSpeak([user(3), said(11, 'Uno.'), done(12)], 5)).toBeNull();
  });
  it('nothing while the turn runs, after an error or a stop', () => {
    expect(replyToSpeak([user(10), said(11, 'Uno.')], 5)).toBeNull();
    expect(replyToSpeak([user(10), said(11, 'Uno.'), done(12, { isError: true })], 5)).toBeNull();
    expect(replyToSpeak([user(10), said(11, 'Uno.'), done(12, { interrupted: true })], 5)).toBeNull();
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
