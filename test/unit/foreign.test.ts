// Unit tests of the classifier that folds user-role items the user did not type (src/renderer/lib/foreign.ts). The
// texts come from main's own builders (mail render, wake message, Esegui result, AGENT_LABEL, RESUME_TEXT): a label
// changed in main without the classifier breaks here.
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '@shared/contract';
import { foreignOf } from '../../src/renderer/lib/foreign';
import { render } from '../../src/main/chats/mail';
import { wakeMessage } from '../../src/main/chats/regia-wake';
import { runResultMessage } from '../../src/main/run/results';
import { AGENT_LABEL } from '../../src/main/appctl/tools';
import { RESUME_TEXT } from '../../src/main/chats/manager';

type User = Extract<ChatItem, { kind: 'user' }>;
const user = (text: string, p: Partial<User> = {}): User => ({ kind: 'user', id: 'u1', at: 0, text, ...p });

describe('foreignOf', () => {
  it('leaves the user\'s own messages alone, a bracket at the start included', () => {
    expect(foreignOf(user('Che si fa adesso?'))).toBeNull();
    expect(foreignOf(user('[nota] ricordati il test'))).toBeNull();
    expect(foreignOf(user('Ho fatto l\'accesso nel browser (scheda t1): riprendi da dove eri.'))).toBeNull();
  });

  it('folds mail from another chat: sender from the structured from, first words of the message', () => {
    const text = render([{ id: 'm1', from: 'App · QA rimborsi', to: 'Regia', at: '2026-10-13T10:00:00Z', text: 'Test case 7 passato su master.\nDettagli nel report.', hop: 1 } as never], 'abcd');
    const f = foreignOf(user(text, { from: 'App · QA rimborsi' }))!;
    expect(f).toMatchObject({ kind: 'mail', sender: 'App · QA rimborsi', summary: 'Test case 7 passato su master.' });
    expect(f.body).toContain('Dettagli nel report.');
    expect(f.body).not.toMatch(/^\[Messaggio/);
    // read back from a transcript: no from, the label names the sender
    expect(foreignOf(user(text))).toMatchObject({ kind: 'mail', sender: 'App · QA rimborsi (non verificato)' }); // unsigned in this test: the label keeps that
  });

  it('folds an agent\'s prompt (app_create_chat) and message (app_send_to_chat)', () => {
    const created = `${AGENT_LABEL}\n\nLa tua Regia è «Regia dell'app»: scrivile con send_to_chat.\n\nYou work in the worktree X.\nMore.`;
    expect(foreignOf(user(created))).toMatchObject({ kind: 'agent', sender: 'un agente', summary: 'You work in the worktree X.' });
    const renamed = `${AGENT_LABEL}\n\nIl tuo Orchestrator è «Orchestrator»: scrivigli con send_to_chat.\n\nYou work in the worktree X.`;
    expect(foreignOf(user(renamed))).toMatchObject({ kind: 'agent', summary: 'You work in the worktree X.' });
    expect(foreignOf(user(`${AGENT_LABEL}\n\nRiprova il test.`, { from: 'Regia' }))).toMatchObject({ kind: 'agent', sender: 'Regia', summary: 'Riprova il test.' });
    // a from with an unknown text is still not the user's
    expect(foreignOf(user('ciao', { from: 'Regia' }))).toMatchObject({ kind: 'agent', sender: 'Regia', summary: 'ciao' });
  });

  it('folds the app\'s news to the Regia with its first news line', () => {
    const text = wakeMessage([{ kind: 'done', chatId: 'c1', title: 'App · Mappa', harness: 'claude', detail: 'v2 in main', at: 0 }]);
    expect(foreignOf(user(text))).toMatchObject({ kind: 'event', sender: 'App', summary: '«App · Mappa» (Claude): ha finito il turno. Ultima riga: «v2 in main»' });
  });

  it('folds an Esegui result: the command and how it ended', () => {
    const text = runResultMessage([{ id: 'r1', chatId: 'c1', code: 'npm test', cwd: 'C:\\x', state: 'done', exitCode: 0, startedAt: 0, endedAt: 3000, output: 'ok' } as never]);
    const f = foreignOf(user(text))!;
    expect(f.kind).toBe('run');
    expect(f.summary).toMatch(/^npm test · /);
    expect(f.body).toContain('npm test');
  });

  it('folds the app\'s "riprendi" after a restart and a hook\'s note', () => {
    expect(foreignOf(user(RESUME_TEXT))).toMatchObject({ kind: 'resume', sender: 'App' });
    expect(foreignOf(user(RESUME_TEXT))!.summary).toMatch(/^L'app è stata riavviata/);
    expect(foreignOf(user('UserPromptSubmit hook additional context: Focus: Mario è qui.'))).toMatchObject({ kind: 'hook', summary: 'Focus: Mario è qui.' });
  });

  it('cuts a long first line to one row', () => {
    const f = foreignOf(user(`${AGENT_LABEL}\n\n${'parola '.repeat(60)}`))!;
    expect(f.summary.length).toBeLessThanOrEqual(120);
    expect(f.summary.endsWith('…')).toBe(true);
  });
});
