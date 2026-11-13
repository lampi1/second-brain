// The user's own words as an answer (shared/answer-in-words.ts, ADR 0274): which requests take them, the answer they
// give, and the check that words the Orchestrator passes on are really his.
import { describe, expect, it } from 'vitest';
import { answerableInWords, sameWords, wordsAnswer } from '../../src/shared/answer-in-words';

const q = (over: Record<string, unknown> = {}) => ({ type: 'question' as const, tool: 'AskUserQuestion', questions: [{ question: 'Quale?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }], ...over });

describe('answer in words', () => {
  it('an engine question takes them; a permission, a command, an MCP form or a question without questions does not', () => {
    expect(answerableInWords(q())).toBe(true);
    expect(answerableInWords(q({ tool: 'AskUser' }))).toBe(true);
    expect(answerableInWords(q({ type: 'permission', tool: 'Bash' }))).toBe(false);
    expect(answerableInWords(q({ type: 'command', tool: 'Esegui' }))).toBe(false);
    expect(answerableInWords(q({ tool: 'mcp__srv' }))).toBe(false);
    expect(answerableInWords(q({ questions: [] }))).toBe(false);
  });

  it('every question reads the words; a multi-select takes them as its one pick', () => {
    const req = { questions: [{ question: 'Uno?', options: [], multiSelect: false }, { question: 'Due?', options: [], multiSelect: true }] };
    expect(wordsAnswer(req, '  la seconda  ')).toEqual({ kind: 'question', answers: { 'Uno?': 'la seconda', 'Due?': ['la seconda'] } });
  });

  it('his words: in what he wrote, case, quotes and spaces aside; never empty', () => {
    expect(sameWords('Usa «Postgres  16», grazie', 'postgres 16')).toBe(true);
    expect(sameWords('Usa Postgres', 'SQL Server')).toBe(false);
    expect(sameWords('qualcosa', '  ')).toBe(false);
  });
});
