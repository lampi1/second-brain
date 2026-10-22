// The chat composer's inline suggestion, renderer side (lib/composer-suggest.ts, ADR 0118): local matching (past
// prompts, "/" commands, roles, skills, chat titles, files; only with the caret at the end), the files and prompts read
// from the chats, the debounce (no request while keys keep coming) and the cancel of a request in flight on the next
// key (its late answer ignored), and the shared rule that serves the rest of a cached answer.
import { describe, expect, it, vi } from 'vitest';
import type { ChatItem } from '../../src/shared/contract';
import { continueCached, type SuggestAnswer, type SuggestRequest } from '../../src/shared/composer-suggest';
import { SuggestScheduler, filesOf, localSuggestion, promptsOf, type LocalSources } from '../../src/renderer/lib/composer-suggest';

const src = (o: Partial<LocalSources> = {}): LocalSources => ({
  commands: [{ name: 'review' }, { name: 'rivedi-pr', skill: true }, { name: 'compact' }],
  roles: ['Orchestrator', 'Strategist', 'Scout', 'Artisan', 'Sentinel', 'Herald'],
  chats: ['Magazzino fix login', 'Note personali'], files: ['ChatInput.tsx'],
  history: ['fai girare i test e dimmi cosa fallisce', 'fai il merge su main'], ...o,
});
const at = (text: string, s = src()) => localSuggestion(text, text.length, s);

describe('localSuggestion', () => {
  it('completes a past prompt from its start, newest first, keeping what was typed', () => {
    expect(at('fai g')).toBe('irare i test e dimmi cosa fallisce');
    expect(at('fai ')).toBe('girare i test e dimmi cosa fallisce');
    expect(at('Fai il m')).toBe('erge su main');
    expect(at('fai il merge su main')).toBeNull(); // nothing left
    expect(at('fa')).toBeNull(); // too short to guess
  });
  it('completes only the first line of a multi-line past prompt', () => {
    expect(at('controlla', src({ history: ['controlla il log\npoi dimmi'] }))).toBe(' il log');
  });
  it('completes a "/" command anywhere on the line, skills first', () => {
    expect(at('usa /rev')).toBe('iew ');
    expect(at('/ri')).toBe('vedi-pr ');
    expect(at('/co')).toBe('mpact ');
    expect(at('usa /zz')).toBeNull();
  });
  it('completes roles, skills, chat titles (several words) and files', () => {
    expect(at('chiedi allo Strat')).toBe('egist');
    expect(at('chiedi allo strat')).toBe('egist');
    expect(at('guarda Magazzino fix l')).toBe('ogin');
    expect(at('chiedi allo Strategist di guardare Magazzino fix l')).toBe('ogin'); // more than six words on the line
    expect(at('apri ChatIn')).toBe('put.tsx');
    expect(at('usa rivedi')).toBe('-pr');
    expect(at('chiedi a Sc')).toBeNull(); // under three characters
    expect(at('Strategist ')).toBeNull(); // a new word just started
  });
  it('shows nothing with the caret before the end, or with nothing typed', () => {
    expect(localSuggestion('fai g altro', 5, src())).toBeNull();
    expect(at('')).toBeNull();
  });
});

describe('sources from the chats', () => {
  const tool = (input: unknown, at = 1): ChatItem => ({ kind: 'tool', id: `t${at}`, at, name: 'Read', summary: '', input, status: 'ok' });
  it('filesOf: basenames of the files the tools touched, newest first, no duplicates', () => {
    expect(filesOf([tool({ file_path: 'C:\\repo\\src\\a.ts' }, 1), tool({ path: '/repo/README.md' }, 2), tool({ file_path: 'src/a.ts' }, 3), tool({ command: 'ls' }, 4)])).toEqual(['a.ts', 'README.md']);
    expect(filesOf(undefined)).toEqual([]);
  });
  it('promptsOf: the user\'s own messages only, newest first', () => {
    const items: Record<string, ChatItem[]> = {
      a: [{ kind: 'user', id: 'u1', at: 1, text: 'vecchio' }, { kind: 'user', id: 'u2', at: 3, text: 'da un\'altra chat', from: 'Orchestrator' }],
      b: [{ kind: 'user', id: 'u3', at: 2, text: 'nuovo' }, { kind: 'assistant', id: 'a1', at: 4, text: 'risposta' }],
    };
    expect(promptsOf(items)).toEqual(['nuovo', 'vecchio']);
  });
});

describe('continueCached', () => {
  it('serves the rest of an answer the user types along, nothing when they leave it', () => {
    expect(continueCached('fai il ', 'merge su main', 'fai il ')).toBe('merge su main');
    expect(continueCached('fai il ', 'merge su main', 'fai il mer')).toBe('ge su main');
    expect(continueCached('fai il ', 'merge su main', 'fai il x')).toBeNull();
    expect(continueCached('fai il ', 'merge', 'fai il merge')).toBeNull();
    expect(continueCached('fai il ', 'merge', 'fai')).toBeNull();
  });
});

describe('SuggestScheduler', () => {
  const req = (line: string): SuggestRequest => ({ chatId: 'c1', line, lastMessage: '' });
  function setup() {
    vi.useFakeTimers();
    const pending: { req: SuggestRequest; resolve: (a: SuggestAnswer) => void }[] = [];
    const answers: [string, string | null][] = [];
    const cancel = vi.fn();
    const s = new SuggestScheduler({
      delayMs: 600,
      fetch: r => new Promise(resolve => pending.push({ req: r, resolve })),
      cancel, onAnswer: (t, x) => answers.push([t, x]),
    });
    return { s, pending, answers, cancel };
  }
  it('asks only after a pause: fast typing sends nothing', async () => {
    const { s, pending } = setup();
    try {
      for (const t of ['scrivi', 'scrivi un', 'scrivi un test']) { s.schedule(t, req(t)); vi.advanceTimersByTime(200); }
      expect(pending).toHaveLength(0);
      vi.advanceTimersByTime(400);
      expect(pending.map(p => p.req.line)).toEqual(['scrivi un test']);
    } finally { vi.useRealTimers(); }
  });
  it('the next key cancels the request in flight and its late answer is ignored', async () => {
    const { s, pending, answers, cancel } = setup();
    try {
      s.schedule('scrivi un test', req('scrivi un test'));
      vi.advanceTimersByTime(600);
      expect(pending).toHaveLength(1);
      s.key();
      expect(cancel).toHaveBeenCalledTimes(1);
      pending[0]!.resolve({ text: ' per il login', cached: false });
      await vi.runAllTimersAsync();
      expect(answers).toEqual([]);
      // a key with nothing in flight cancels nothing
      s.key();
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('an answer with no key since reaches the input', async () => {
    const { s, pending, answers } = setup();
    try {
      s.schedule('scrivi un test', req('scrivi un test'));
      vi.advanceTimersByTime(600);
      pending[0]!.resolve({ text: ' per il login', cached: false });
      await vi.runAllTimersAsync();
      expect(answers).toEqual([['scrivi un test', ' per il login']]);
    } finally { vi.useRealTimers(); }
  });
});
