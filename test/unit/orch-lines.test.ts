// The one-line texts of the Orchestrator column (ADR 0367): a result's outcome as its first sentence, a command's risk,
// a «Stai aspettando» chip's status and which chats the row lists.
import { describe, expect, it } from 'vitest';
import type { ChatSummary } from '../../src/shared/contract';
import { commandRisk, OUTCOME_MAX, outcomeLine, WAIT_DONE_SHOWN_MS, waitedChats, waitStatus } from '../../src/renderer/lib/orch-lines';

describe('outcomeLine', () => {
  it('keeps the first sentence of the first meaningful line, without its full stop', () => {
    expect(outcomeLine('Branch feature/127268 pushato. Restano 2 test da sistemare.\n\nDettagli sotto.')).toBe('Branch feature/127268 pushato');
    expect(outcomeLine('## Esito\n- **PASS**: 0 problemi alti, 2 bassi')).toBe('Esito');
    expect(outcomeLine('Fatto! Ora tocca a te.')).toBe('Fatto!');
  });
  it('never cuts inside a version, a path or a lower-case abbreviation', () => {
    expect(outcomeLine('Aggiornato a v1.2.3 e provato es. con npm test')).toBe('Aggiornato a v1.2.3 e provato es. con npm test');
    expect(outcomeLine('Letto src/app.ts e corretto il bug')).toBe('Letto src/app.ts e corretto il bug');
  });
  it('is one line of at most OUTCOME_MAX characters, with an ellipsis', () => {
    const long = `${'parola '.repeat(60)}fine`;
    const out = outcomeLine(long);
    expect([...out].length).toBeLessThanOrEqual(OUTCOME_MAX);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('\n');
    expect(outcomeLine('')).toBe('');
  });
});

describe('commandRisk', () => {
  it('says production first, then read or write from the gist', () => {
    expect(commandRisk('read', 'prod database')).toBe('prod');
    expect(commandRisk('list', null)).toBe('read');
    expect(commandRisk('db', undefined)).toBe('write');
    expect(commandRisk('command', null)).toBe('write');
  });
});

const chat = (id: string, p: Partial<ChatSummary>): ChatSummary => ({ id, title: id, state: 'running', pending: 0, isOrchestrator: false, ...p }) as ChatSummary;

describe('the «Stai aspettando» row', () => {
  it('says done, the plan step, or the state', () => {
    expect(waitStatus(chat('a', { userWait: { since: 1, doneAt: 2 } }))).toEqual({ kind: 'done' });
    const steps = [{ state: 'done' }, { state: 'done' }, { state: 'todo' }] as NonNullable<ChatSummary['plan']>['steps'];
    expect(waitStatus(chat('a', { userWait: { since: 1 }, plan: { steps } as ChatSummary['plan'] }))).toEqual({ kind: 'step', done: 2, total: 3 });
    expect(waitStatus(chat('a', { userWait: { since: 1 }, pending: 1 }))).toEqual({ kind: 'state', state: 'waiting' });
    expect(waitStatus(chat('a', { userWait: { since: 1 }, state: 'error' }))).toEqual({ kind: 'state', state: 'error' });
    expect(waitStatus(chat('a', { userWait: { since: 1 }, state: 'idle' }))).toEqual({ kind: 'state', state: 'idle' });
  });
  it('lists open waits and recent finished ones, oldest first, never the Orchestrator or a closed open wait', () => {
    const now = 10 * WAIT_DONE_SHOWN_MS;
    const list = waitedChats([
      chat('late', { userWait: { since: 5 } }),
      chat('early', { userWait: { since: 1 } }),
      chat('done', { userWait: { since: 3, doneAt: now - 1000 } }),
      chat('old', { userWait: { since: 2, doneAt: now - WAIT_DONE_SHOWN_MS - 1 } }),
      chat('closed', { userWait: { since: 4 }, closedAt: 9 }),
      chat('none', {}),
      chat('orch', { userWait: { since: 0 }, isOrchestrator: true }),
    ], now);
    expect(list.map(c => c.id)).toEqual(['early', 'done', 'late']);
  });
});
