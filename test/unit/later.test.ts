// "Rispondi dopo" (src/main/later.ts): the flag starts off, survives a restart through its file, is sent to the page
// only when it changes, and a broken file reads as off; a new request rings (src/renderer/lib/chime.ts requestChimes).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AnswerLaterStore, REQUEST_KINDS } from '../../src/main/later';
import type { AnswerLater } from '../../src/shared/contract';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-later-')), 'answer-later.json');

describe('AnswerLaterStore', () => {
  it('off at first; on is saved, sent once, and read back by a new store (a restart)', () => {
    const file = tmp();
    const sent: AnswerLater[] = [];
    const s = new AnswerLaterStore(file, x => sent.push(x));
    expect(s.get()).toEqual({ on: false });
    expect(s.set(true)).toEqual({ on: true });
    s.set(true);
    expect(sent).toEqual([{ on: true }]);
    expect(new AnswerLaterStore(file, () => {}).get()).toEqual({ on: true });
    s.set(false);
    expect(sent).toEqual([{ on: true }, { on: false }]);
    expect(new AnswerLaterStore(file, () => {}).get()).toEqual({ on: false });
  });

  it('a broken file is off', () => {
    const file = tmp();
    fs.writeFileSync(file, '{not json');
    expect(new AnswerLaterStore(file, () => {}).get()).toEqual({ on: false });
  });

  it('holds the requests of app chats (questions and commands share the feed kind "question")', () => {
    expect(REQUEST_KINDS.has('question')).toBe(true);
    expect(REQUEST_KINDS.has('chat-waiting')).toBe(false);
  });
});

describe('requestChimes', () => {
  it('a new request rings with the alerts\' switch on, never muted or in do-not-disturb', async () => {
    const { requestChimes } = await import('../../src/renderer/lib/chime');
    const on = { soundOn: true, muted: {}, dnd: false };
    expect(requestChimes(on)).toBe(true);
    expect(requestChimes({ ...on, soundOn: false })).toBe(false);
    expect(requestChimes({ ...on, dnd: true })).toBe(false);
    expect(requestChimes({ ...on, muted: { question: true } })).toBe(false);
  });
});
