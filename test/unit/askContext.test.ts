// The context of a question (src/renderer/lib/askContext.ts): the prose of the turn that ends with the request (its
// reasoning too), the links it names (markdown links keep their text; PRs and work items get a name; file:/// and
// C:\ paths are files; never a repeat), the documents the turn wrote, and which reasoning blocks show open in the
// transcript because they are the only prose right before a question.
import { describe, expect, it } from 'vitest';
import type { ChatItem, PendingRequest } from '../../src/shared/contract';
import { askContext, linksIn, thinkingBeforeAsk, turnItems, writtenDocs } from '../../src/renderer/lib/askContext';

const user = (id: string, text = 'fai'): ChatItem => ({ kind: 'user', id, at: 1, text } as ChatItem);
const say = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, at: 1, text } as ChatItem);
const think = (id: string, text: string): ChatItem => ({ kind: 'thinking', id, at: 1, text } as ChatItem);
const tool = (id: string, name: string, input: unknown = {}, status: 'ok' | 'error' = 'ok'): ChatItem =>
  ({ kind: 'tool', id, at: 1, name, summary: name, input, status } as unknown as ChatItem);
const req = (): PendingRequest => ({
  id: 'q1', chatId: 'c', type: 'question', tool: 'AskUserQuestion', title: 'Pubblico?', detail: 'Pubblico?', input: {}, at: 1,
  questions: [{ question: 'Pubblico?', multiSelect: false, options: [{ label: 'Sì', description: 'lo posto su https://example.com/pr/9' }] }],
} as unknown as PendingRequest);

describe('turnItems', () => {
  it('is what came after the user\'s last message', () => {
    expect(turnItems([say('a', 'x'), user('u'), say('b', 'y')]).map(i => i.id)).toEqual(['b']);
    expect(turnItems(undefined)).toEqual([]);
  });
});

describe('linksIn', () => {
  it('names PRs and work items, keeps a markdown link\'s text, never repeats', () => {
    const l = linksIn([
      'La PR: https://dev.azure.com/o/p/_git/app/pullrequest/27. Il bug: https://dev.azure.com/o/p/_workitems/edit/4242',
      'di nuovo https://dev.azure.com/o/p/_git/app/pullrequest/27 e [il report](https://example.com/r.html)',
    ]);
    expect(l).toEqual([
      { kind: 'web', href: 'https://dev.azure.com/o/p/_git/app/pullrequest/27', label: 'PR 27' },
      { kind: 'web', href: 'https://dev.azure.com/o/p/_workitems/edit/4242', label: 'Work item 4242' },
      { kind: 'web', href: 'https://example.com/r.html', label: 'il report' },
    ]);
  });
  it('local files: file:/// URLs, C:\\ and C:/ paths, written documents; the same file spelled twice counts once', () => {
    const l = linksIn(['vedi file:///C:/rep/tc16.md e C:\\rep\\tc16.md, poi C:/rep/shot.png.'], ['C:\\rep\\out.html']);
    expect(l.map(x => [x.kind, x.label])).toEqual([['file', 'tc16.md'], ['file', 'shot.png'], ['file', 'out.html']]);
  });
  it('never a relative path or a word with a colon', () => {
    expect(linksIn(['docs/adr/0001.md, nota: ok, ./x.md'])).toEqual([]);
  });
});

describe('writtenDocs', () => {
  it('reports and screenshots the turn wrote; never code, a failed write or a relative path', () => {
    expect(writtenDocs([
      tool('1', 'Write', { file_path: 'C:\\r\\report.md' }), tool('2', 'Edit', { file_path: 'C:\\src\\a.ts' }),
      tool('3', 'Write', { file_path: 'C:\\r\\x.png' }, 'error'), tool('4', 'Write', { file_path: 'r/rel.md' }),
    ])).toEqual(['C:\\r\\report.md']);
  });
});

describe('askContext', () => {
  it('the turn\'s prose (reasoning marked), newest last, and every link (the question\'s own too)', () => {
    const items = [say('old', 'turno prima'), user('u'), say('a', 'Ho scritto il report C:\\r\\tc16.md'), tool('t', 'Read'), think('th', 'serve il tuo ok')];
    const c = askContext(items, req());
    expect(c.pieces.map(p => [p.kind, p.text])).toEqual([['text', 'Ho scritto il report C:\\r\\tc16.md'], ['thinking', 'serve il tuo ok']]);
    expect(c.links.map(l => l.label)).toEqual(['tc16.md', 'example.com · 9']);
  });
  it('long turns: the last pieces only, the oldest one kept cut at its start', () => {
    const items = [user('u'), ...Array.from({ length: 6 }, (_, i) => say(`a${i}`, `${i}`.repeat(3500)))];
    const c = askContext(items, req());
    expect(c.pieces.map(p => p.id)).toEqual(['a2', 'a3', 'a4', 'a5']);
    expect(c.pieces[0]!.text.startsWith('…')).toBe(true);
    expect(c.pieces.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(12_001);
  });
});

describe('askContext of a second question in the same turn (the user, 2026-10-13: "la stessa, e con il ragionamento della domanda precedente")', () => {
  // transcript of 2026-10-10: a free answer to "Il pezzo 1 ti è chiaro?", the chat replies only in its reasoning and asks it again
  const pezzo = { questions: [{ question: 'Il pezzo 1 ti è chiaro?', options: [] }] };
  const again = (toolUseId?: string): PendingRequest => ({
    id: 'q2', chatId: 'c', type: 'question', tool: 'AskUserQuestion', title: 'Il pezzo 1 ti è chiaro?', detail: '', input: pezzo, at: 2,
    questions: [{ question: 'Il pezzo 1 ti è chiaro?', multiSelect: false, options: [{ label: 'Chiaro, vai avanti' }] }],
    ...(toolUseId ? { toolUseId } : {}),
  } as PendingRequest);
  const answered = { ...tool('t-toolu_1', 'AskUserQuestion', pezzo), output: 'The user answered: "Il pezzo 1 ti è chiaro?"="su tutte le piattaforme?". Read the answers carefully' } as ChatItem;
  const items = [
    user('u', '/explain'), think('th1', 'La casella di posta risolve la comunicazione tra chat'), answered,
    think('th2', 'Solo su questo PC: Claude e Cursor'), { ...tool('t-toolu_2', 'AskUserQuestion', pezzo), status: 'running' } as ChatItem,
  ];
  it('only the reasoning written for this question, never the previous question\'s', () => {
    expect(askContext(items, again('toolu_2')).pieces.map(p => p.id)).toEqual(['th2']);
    expect(askContext(items, again()).pieces.map(p => p.id)).toEqual(['th2']); // no tool_use id (Cursor): the running row is not a boundary
  });
  it('the same question asked again says so, with what the user answered then', () => {
    expect(askContext(items, again('toolu_2')).again).toEqual({ answer: 'su tutte le piattaforme?' });
    const other = { ...again('toolu_2'), questions: [{ question: 'Il pezzo 2 ti è chiaro?', multiSelect: false, options: [] }] };
    expect(askContext(items, other).again).toBeUndefined();
    expect(askContext([user('u'), think('t', 'x')], again()).again).toBeUndefined();
  });
  it('ends at the request\'s own tool row: what the chat wrote after it is not its context', () => {
    const later = [...items, say('after', 'scritto dopo la domanda')];
    expect(askContext(later, again('toolu_2')).pieces.map(p => p.id)).toEqual(['th2']);
  });
  it('links still come from the whole turn (a report written before the first question)', () => {
    const withDoc = [user('u'), tool('w', 'Write', { file_path: 'C:\\r\\report.md' }), ...items.slice(1)];
    expect(askContext(withDoc, again('toolu_2')).links.map(l => l.label)).toEqual(['report.md']);
  });
});

describe('thinkingBeforeAsk', () => {
  it('the reasoning right before an ask tool; not one before another tool or before answer text', () => {
    const items = [user('u'), think('t1', 'sul Bash'), tool('b', 'Bash'), think('t2', 'cosa chiedere'), tool('q', 'AskUserQuestion'), say('a', 'ok'), think('t3', 'dopo')];
    expect([...thinkingBeforeAsk(items, false)]).toEqual(['t2']);
  });
  it('a chat asking now (Cursor has no ask tool row): the reasoning at the end counts', () => {
    const items = [user('u'), think('t1', 'x'), say('a', 'testo'), think('t2', 'y')];
    expect([...thinkingBeforeAsk(items, true)]).toEqual(['t2']);
    expect([...thinkingBeforeAsk(items, false)]).toEqual([]);
  });
});
