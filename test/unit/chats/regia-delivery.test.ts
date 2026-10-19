// Unit tests of main/chats/regia-delivery.ts, the one rule for what reaches an Orchestrator and when (news and mail alike):
// the gate from the Orchestrator's state, the classes, the brain's words (escaped literals, whole words or "stem*").
import { describe, expect, it } from 'vitest';
import { brainClassifier, DEFAULT_WORDS, mailClassifier, newsClass, passes, REGIA_GROUP_MS, REGIA_HOLD_MS, regiaGate, waitOf, wordsFrom } from '../../../src/main/chats/regia-delivery';

describe('regia-delivery', () => {
  it('the gate: idle/closed queue, working injects (busy on an engine without mid-turn input), waiting or hand-off hold', () => {
    expect(regiaGate({ state: 'idle', pending: 0 })).toBe('queue');
    expect(regiaGate({ state: 'closed', pending: 0 })).toBe('queue');
    expect(regiaGate({ state: 'running', pending: 0 })).toBe('inject');
    expect(regiaGate({ state: 'starting', pending: 0 })).toBe('inject');
    expect(regiaGate({ state: 'running', pending: 0 }, false)).toBe('busy');
    expect(regiaGate({ state: 'waiting', pending: 0 })).toBe('hold');
    expect(regiaGate({ state: 'idle', pending: 1 })).toBe('hold');
    expect(regiaGate({ state: 'idle', pending: 0, handoffBusy: true })).toBe('hold');
    expect(regiaGate({ state: 'error', pending: 0 })).toBe('hold');
  });

  it('what passes each gate, and when a queued class is due', () => {
    for (const c of ['now', 'group', 'quiet'] as const) {
      expect(passes('inject', c)).toBe(true);
      expect(passes('queue', c)).toBe(true);
      expect(passes('busy', c)).toBe(false);
      expect(passes('hold', c)).toBe(c === 'now');
    }
    expect([waitOf('now'), waitOf('group'), waitOf('quiet')]).toEqual([0, REGIA_GROUP_MS, REGIA_HOLD_MS]);
    expect(REGIA_GROUP_MS).toBe(30_000); // the owner's choice, 15/10
  });

  it('news: a failure at once, a turn end grouped, what waits for the user quiet unless it ends the turn', () => {
    expect(newsClass('error')).toBe('now');
    expect(newsClass('done')).toBe('group');
    expect(newsClass('question')).toBe('quiet');
    expect(newsClass('command', true)).toBe('group');
  });

  it('words: whole words unless "stem*", case and apostrophes ignored, a "?" or a sha is an action', () => {
    const cls = mailClassifier();
    expect(cls('nota: ok')).toBe('group'); // "ok" is an action word
    expect(cls('nota: token aggiornato, scritto in x.md')).toBe('quiet'); // "ok" inside "token" is no word
    expect(cls('ricevuto, tutto in ordine?')).toBe('group');
    expect(cls('ricevuto: 3c6f315')).toBe('group');
    expect(cls('Nota: L’utente lo sa')).toBe('group');
    expect(cls('Subito: produzione giù')).toBe('now');
  });

  it('the brain\'s lists replace the defaults one by one; anything not a list of strings falls back', () => {
    expect(wordsFrom(undefined)).toEqual(DEFAULT_WORDS);
    expect(wordsFrom({ urgent: ['incendio'], progress: 'x', action: [1] })).toEqual({ ...DEFAULT_WORDS, urgent: ['incendio'] });
    const cls = mailClassifier(wordsFrom({ urgent: ['incendio'], progress: ['avanzament*'] }));
    expect(cls('incendio in sala server')).toBe('now');
    expect(cls('urgente')).toBe('group'); // the brain dropped the word
    expect(cls('avanzamento: metà')).toBe('quiet');
  });

  it('a word list never runs as a pattern: regex characters are literal', () => {
    const cls = mailClassifier({ urgent: ['(a+)+$', 'c.d'], progress: [], action: [] });
    expect(cls('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab')).toBe('group');
    expect(cls('cxd')).toBe('group');
    expect(cls('allarme c.d')).toBe('now');
    expect(mailClassifier({ urgent: ['*', ' * ', ''], progress: [], action: [] })('nulla di urgente qui')).toBe('group'); // a bare "*" matches nothing
  });

  it('brainClassifier follows the brain as it changes and survives a failing read', () => {
    let raw: unknown = { urgent: ['fuoco'] };
    const get = brainClassifier(() => { if (raw === 'throw') throw new Error('x'); return raw; });
    expect(get()('fuoco')).toBe('now');
    raw = undefined;
    expect(get()('fuoco')).toBe('group');
    raw = 'throw';
    expect(get()('urgente')).toBe('now');
  });
});
