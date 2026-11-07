// The user's entries in a work chat that its assigner has not seen, as the assign tools return them (src/shared/user-events.ts).
import { describe, expect, it } from 'vitest';
import { readableUserEvent, unreadEvents, unreadInstructions, USER_EVENT_TEXT_MAX } from '../../../src/shared/user-events';
import type { UserTaskEvents } from '../../../src/shared/agents';

const ledger = (texts: string[], acknowledgedSeq: number): UserTaskEvents => ({ events: texts.map((text, i) => ({ seq: i + 1, id: `e${i + 1}`, at: i, text })), latestSeq: texts.length, acknowledgedSeq });

describe('user events', () => {
  it('only the events after the acknowledged cursor, oldest first', () => {
    expect(unreadEvents(ledger(['a', 'b', 'c'], 1)).map(e => e.text)).toEqual(['b', 'c']);
    expect(unreadEvents(ledger(['a'], 1))).toEqual([]);
  });
  it('panel answers recorded as JSON read as a person reads them; typed text stays as written', () => {
    expect(readableUserEvent(JSON.stringify({ requestId: 'q1', answers: ['Sì', 'ordini'] }))).toBe('Answer to a question: Sì · ordini');
    expect(readableUserEvent(JSON.stringify({ requestId: 'p1', allow: true }))).toBe('Permission allowed');
    expect(readableUserEvent(JSON.stringify({ requestId: 'p2', allow: false, message: 'non su main' }))).toBe('Permission denied: non su main');
    expect(readableUserEvent('{"note": "a JSON the user typed"}')).toBe('{"note": "a JSON the user typed"}');
    expect(readableUserEvent('{not json')).toBe('{not json');
    expect(readableUserEvent('non toccare main')).toBe('non toccare main');
  });
  it('the unread entries for the assigner: readable, long ones cut', () => {
    expect(unreadInstructions(ledger(['a'], 1))).toEqual([]);
    const out = unreadInstructions(ledger(['old', JSON.stringify({ requestId: 'q', answers: ['B'] }), 'x'.repeat(USER_EVENT_TEXT_MAX + 5)], 1));
    expect(out).toEqual([{ seq: 2, text: 'Answer to a question: B' }, { seq: 3, text: `${'x'.repeat(USER_EVENT_TEXT_MAX)}…` }]);
  });
});
