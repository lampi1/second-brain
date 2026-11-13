// Quote what is on screen (ADR 0300, src/renderer/lib/quote.ts): how the selected text becomes quote lines, where it
// goes in a draft, and which right click counts as a quote (a selection under the pointer, outside the fields the
// user types in), so a little person's right click stays its own (ADR 0297).
import { describe, expect, it } from 'vitest';
import { draftWithQuote, quoteAt, quoteBlock, QUOTE_MAX, type SelectionLike } from '../../src/renderer/lib/quote';
import { REVIEWED_CONTEXT_MARKER, reviewedContextDraft } from '../../src/renderer/lib/reviewed-context';

describe('quoteBlock', () => {
  it('one «> » per line, an empty line stays a bare «>»', () => {
    expect(quoteBlock('prima riga\n\nseconda riga')).toBe('> prima riga\n>\n> seconda riga');
  });
  it('drops the blank lines around, the spaces at line ends and Windows line ends; keeps the indent', () => {
    expect(quoteBlock('\n\n  uno  \r\ndue\t\n\n\n\ntre\n\n')).toBe('>   uno\n> due\n>\n> tre');
  });
  it('nothing to quote in an empty or blank selection', () => {
    expect(quoteBlock('')).toBe('');
    expect(quoteBlock(' \n\t\n')).toBe('');
  });
  it('a very long selection is cut and says so', () => {
    const block = quoteBlock('a'.repeat(QUOTE_MAX + 500));
    expect(block).toBe(`> ${'a'.repeat(QUOTE_MAX)} […]`);
  });
});

describe('draftWithQuote', () => {
  it('an empty field: the quote and an empty line under it for the answer', () => {
    expect(draftWithQuote('', 'il testo')).toBe('> il testo\n\n');
  });
  it('what was already written stays above the quote', () => {
    expect(draftWithQuote('ho una domanda  \n', 'il testo')).toBe('ho una domanda\n\n> il testo\n\n');
  });
  it('two quotes follow each other', () => {
    expect(draftWithQuote(draftWithQuote('', 'uno'), 'due')).toBe('> uno\n\n> due\n\n');
  });
  it('a blank selection leaves the draft as it is', () => {
    expect(draftWithQuote('scritto', '  ')).toBe('scritto');
  });
  it('a reviewed context stays last and still reads as one', () => {
    const payload = `${REVIEWED_CONTEXT_MARKER}\n${JSON.stringify({ kind: 'untrusted-user-context', schemaVersion: 1, facts: [] })}`;
    const next = draftWithQuote(`guarda\n\n${payload}`, 'il testo');
    expect(next.endsWith(payload)).toBe(true);
    expect(reviewedContextDraft(next)?.message).toBe('guarda\n\n> il testo\n\n');
  });
});

describe('quoteAt', () => {
  const el = (chatId: string | null, editable = false) => ({
    nodeType: 1,
    closest: (selector: string) => selector === '[data-chat-id]' ? (chatId ? { getAttribute: () => chatId } : null) : editable ? {} : null,
  });
  const textIn = (parent: unknown) => ({ nodeType: 3, parentElement: parent });
  const selection = (text: string, within: unknown, rects = [{ left: 100, right: 300, top: 50, bottom: 70 }]): SelectionLike => ({
    isCollapsed: !text, rangeCount: 1, toString: () => text,
    getRangeAt: () => ({ commonAncestorContainer: within, getClientRects: () => rects }),
  });

  it('a right click on the selected text inside a chat quotes it for that chat', () => {
    expect(quoteAt(selection('ciao', textIn(el('c1'))), el('c1'), 150, 60)).toEqual({ text: 'ciao', chatId: 'c1' });
  });
  it('a text outside every chat (a page) has no chat: the caller sends it to the Orchestrator', () => {
    expect(quoteAt(selection('ciao', el(null)), el(null), 150, 60)).toEqual({ text: 'ciao', chatId: null });
  });
  it('a selection of several lines: a click on any of them', () => {
    const lines = [{ left: 200, right: 400, top: 50, bottom: 70 }, { left: 100, right: 250, top: 70, bottom: 90 }];
    expect(quoteAt(selection('due righe', el('c1'), lines), el('c1'), 120, 80)?.text).toBe('due righe');
    expect(quoteAt(selection('due righe', el('c1'), lines), el('c1'), 120, 55)).toBeNull();
  });
  it('a click away from the selection is a click like any other (the whack of a little person)', () => {
    expect(quoteAt(selection('ciao', el('c1')), el(null), 600, 400)).toBeNull();
  });
  it('a few pixels around the lines still count', () => {
    expect(quoteAt(selection('ciao', el('c1')), el('c1'), 303, 72)).not.toBeNull();
  });
  it('no selection, a collapsed or a blank one: nothing', () => {
    expect(quoteAt(null, el('c1'), 150, 60)).toBeNull();
    expect(quoteAt(selection('', el('c1')), el('c1'), 150, 60)).toBeNull();
    expect(quoteAt(selection(' \n ', el('c1')), el('c1'), 150, 60)).toBeNull();
    expect(quoteAt({ ...selection('ciao', el('c1')), rangeCount: 0 }, el('c1'), 150, 60)).toBeNull();
  });
  it('never in a field the user types in: its own right click stays', () => {
    expect(quoteAt(selection('ciao', el('c1')), el('c1', true), 150, 60)).toBeNull();
    expect(quoteAt(selection('ciao', el('c1')), textIn(el('c1', true)), 150, 60)).toBeNull();
  });
});
