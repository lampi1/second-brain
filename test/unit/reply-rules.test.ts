// Reply rules checked by the app at turn end (chats/reply-rules.ts, ADR 0063): a reply that asks the user to open
// the browser, a local URL or to sign in by hand gets one note from the app; the agent's own steps, commands in code
// and ordinary links do not; one note per chat per NOTE_EVERY_MS. And turnReply (manager.ts): the turn's texts.
import { describe, expect, it } from 'vitest';
import { APP_NOTE_LABEL, NOTE_EVERY_MS, ReplyRules, asksUserToBrowse } from '../../src/main/chats/reply-rules';
import { turnReply } from '../../src/main/chats/manager';
import type { ChatItem } from '../../src/shared/contract';

describe('asksUserToBrowse', () => {
  it('finds requests to the user', () => {
    for (const t of [
      'Apri il browser su https://localhost:44319 e dimmi cosa vedi.',
      'Puoi aprire il browser e andare alla pagina?',
      'Apri https://localhost:44319/agenda',
      'Vai su localhost:4200 e controlla',
      "Fai l'accesso nel pannello con l'utente di test.",
      'Accedi dal browser e poi dimmi.',
      'Aprilo nel tuo browser.',
      'Please open the browser and check.',
      'Open http://127.0.0.1:5000 to see it.',
      'Done. Open http://127.0.0.1:5000 to see it.',
      'You can log in on the browser now.',
    ]) expect(asksUserToBrowse(t), t).not.toBeNull();
  });

  it('leaves the agent\'s own steps, code and other links alone', () => {
    for (const t of [
      'Ho aperto il browser su localhost:44319: la pagina carica.',
      'Posso aprire il browser io, se vuoi.',
      "I'll open the browser and check.",
      'Apri la PR: https://dev.example.com/pr/12',
      'Lancia questo:\n```powershell\nStart-Process https://localhost:44319\n```',
      'Il comando `start http://localhost:4200` è nel README.',
      'Open edge cases are listed below.',
      'Apri la sezione Impostazioni nel browser per vedere il tema.',
      'Ti consiglio di aprire il file nel tuo editor, non nel browser.',
      'Per vedere l\'anteprima, apri l\'app in Chrome.',
      'Ora apro il browser nell\'ambiente local.',
    ]) expect(asksUserToBrowse(t), t).toBeNull();
  });
});

describe('ReplyRules', () => {
  it('sends one labelled note per chat per window, none on errors', async () => {
    const sent: Array<[string, string]> = [];
    let now = 1_000_000;
    const rules = new ReplyRules({ send: async (id, t) => { sent.push([id, t]); }, now: () => now });
    const bad = 'Apri il browser su https://localhost:44319.';
    expect(rules.turnEnded('c1', bad, true)).toBeNull();
    expect(rules.turnEnded('c1', 'Tutto fatto.', false)).toBeNull();
    const note = rules.turnEnded('c1', bad, false);
    expect(note).toContain(APP_NOTE_LABEL);
    expect(note).toContain('tabs_create');
    expect(rules.turnEnded('c1', bad, false)).toBeNull();          // the answer to the note never loops
    expect(rules.turnEnded('c2', bad, false)).not.toBeNull();      // other chats are their own
    now += NOTE_EVERY_MS;
    expect(rules.turnEnded('c1', bad, false)).not.toBeNull();
    await Promise.resolve();
    expect(sent.map(s => s[0])).toEqual(['c1', 'c2', 'c1']);
  });

  it('never throws when the note cannot be delivered', async () => {
    const rules = new ReplyRules({ send: () => Promise.reject(new Error('closed')) });
    expect(() => rules.turnEnded('c1', 'Please open the browser.', false)).not.toThrow();
    await new Promise(r => setTimeout(r, 0));
  });
});

describe('turnReply', () => {
  it('joins the assistant texts after the last user message', () => {
    const items = [
      { kind: 'user', id: 'u1', at: 1, text: 'prima' },
      { kind: 'assistant', id: 'a1', at: 2, text: 'vecchia' },
      { kind: 'user', id: 'u2', at: 3, text: 'ora' },
      { kind: 'assistant', id: 'a2', at: 4, text: 'uno' },
      { kind: 'assistant', id: 'a3', at: 5, text: 'due' },
    ] as ChatItem[];
    expect(turnReply(items)).toBe('uno\n\ndue');
    expect(turnReply([])).toBe('');
  });
});
