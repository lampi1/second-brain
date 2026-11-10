// A Yes is not a run (#372): a Yes to «hai eseguito il comando?» reaches the chat with the app's note when no run of
// that chat backs it; any other question, a No, or a Yes backed by a run pass unchanged. Pins chats/ran-check.ts.
import { describe, expect, it } from 'vitest';
import { backedAnswer, RAN_LOOKBACK_MS } from '../../../src/main/chats/ran-check';
import { NOT_RAN_NOTE } from '../../../src/shared/yes-no';
import type { Answer, PendingRequest } from '../../../src/shared/contract';

const AT = 1_000_000_000;
const ask = (question: string, tool = 'AskUserQuestion') => ({ type: 'question', tool, at: AT, questions: [{ question, header: '', multiSelect: false, options: [{ label: 'Sì', description: '' }, { label: 'No', description: '' }] }] }) as Pick<PendingRequest, 'type' | 'tool' | 'questions' | 'at'>;
const say = (question: string, v: string): Answer => ({ kind: 'question', answers: { [question]: v } });

describe('backedAnswer', () => {
  const q = 'Hai eseguito il comando sopra?';
  it('a Yes with no run behind it reaches the chat with the app\'s note', () => {
    expect(backedAnswer(ask(q), say(q, 'Sì'), [])).toEqual(say(q, NOT_RAN_NOTE));
    // a run long before the question does not back it
    expect(backedAnswer(ask(q), say(q, 'Sì (consigliato)'), [{ startedAt: AT - RAN_LOOKBACK_MS - 1 }])).toEqual(say(q, NOT_RAN_NOTE));
  });
  it('a run since shortly before the question, a No, another question or the app\'s own question pass unchanged', () => {
    const yes = say(q, 'Sì');
    expect(backedAnswer(ask(q), yes, [{ startedAt: AT - 60_000 }])).toBe(yes);
    expect(backedAnswer(ask(q), say(q, 'No'), [])).toEqual(say(q, 'No'));
    const other = 'Eseguo il comando sul tuo PC?';
    expect(backedAnswer(ask(other), say(other, 'Sì'), [])).toEqual(say(other, 'Sì'));
    expect(backedAnswer(ask(q, 'app_user_action'), yes, [])).toBe(yes);
  });
});
