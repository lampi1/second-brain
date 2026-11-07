// The user's unread instructions attached to a new assignment (src/shared/user-events.ts).
import { describe, expect, it } from 'vitest';
import { unreadEvents, unreadNote, USER_EVENT_TEXT_MAX } from '../../../src/shared/user-events';
import type { UserTaskEvents } from '../../../src/shared/agents';

const ledger = (texts: string[], acknowledgedSeq: number): UserTaskEvents => ({ events: texts.map((text, i) => ({ seq: i + 1, id: `e${i + 1}`, at: i, text })), latestSeq: texts.length, acknowledgedSeq });

describe('user events', () => {
  it('only the events after the acknowledged cursor, oldest first', () => {
    expect(unreadEvents(ledger(['a', 'b', 'c'], 1)).map(e => e.text)).toEqual(['b', 'c']);
    expect(unreadEvents(ledger(['a'], 1))).toEqual([]);
  });
  it('the note is empty when nothing is unread; else one line per instruction, cut and flattened', () => {
    expect(unreadNote(ledger(['a'], 1))).toBe('');
    const note = unreadNote(ledger(['old', 'non toccare main\npoi rilancia', 'x'.repeat(USER_EVENT_TEXT_MAX + 5)], 1));
    const lines = note.split('\n');
    expect(lines[0]).toMatch(/^\[Istruzioni che l'utente ti ha scritto .* valgono le sue\]$/);
    expect(lines[1]).toBe('- non toccare main poi rilancia');
    expect(lines[2]).toBe(`- ${'x'.repeat(USER_EVENT_TEXT_MAX)}…`);
    expect(lines).toHaveLength(3);
  });
});
