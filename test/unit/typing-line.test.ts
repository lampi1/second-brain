// The working line (src/renderer/lib/typing-line.ts, ADR 0173): what the chat does now, read from the transcript for
// every engine: the tool running, else the plan's item in progress, else a plain "sta pensando…" / "sta lavorando…";
// "sta scrivendo…" while the reply streams. A finished tool is no "now".
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../src/shared/contract';
import { liveLine } from '../../src/renderer/lib/typing-line';

let n = 0;
const tool = (name: string, input: unknown, status: 'running' | 'ok' | 'error' = 'ok', summary = `${name}: x`): ChatItem =>
  ({ kind: 'tool', id: `t${++n}`, at: n, name, summary, input, status });
const todos = (...st: string[]): ChatItem => tool('TodoWrite', { todos: st.map((s, i) => ({ content: `Passo ${i + 1}`, activeForm: `Faccio il passo ${i + 1}`, status: s })) });

describe('liveLine', () => {
  it('nothing yet: a plain thinking line, never a joke', () => {
    expect(liveLine([], 'pensa')).toEqual({ text: 'sta pensando…' });
    expect(liveLine(undefined, 'pensa')).toEqual({ text: 'sta pensando…' });
  });
  it('a command running now (Claude Bash, Cursor/Codex Shell) is the line, with its command', () => {
    expect(liveLine([tool('Bash', { command: 'npm test\nmore' }, 'running')], 'lavora')).toEqual({ text: 'Lancia', code: 'npm test' });
    expect(liveLine([tool('Shell', { command: 'dotnet build' }, 'running')], 'lavora')).toEqual({ text: 'Lancia', code: 'dotnet build' });
  });
  it('a file being read or edited names it; a delegation says so', () => {
    expect(liveLine([tool('Edit', { file_path: 'src/login.ts' }, 'running')], 'lavora').text).toContain('login.ts');
    expect(liveLine([tool('Read', { file_path: 'src/a.ts' }, 'running')], 'lavora').text).toContain('a.ts');
    expect(liveLine([tool('mcp__second-brain__agent_delegate', { tasks: [{ title: 'Correggi il login', role: 'artisan' }] }, 'running')], 'lavora').text).toBe('Delega «Correggi il login» (Artisan)');
  });
  it('a finished tool is no "now": the plan item in progress, else thinking', () => {
    expect(liveLine([tool('Edit', { file_path: 'src/x.ts' })], 'pensa')).toEqual({ text: 'sta pensando…' });
    expect(liveLine([todos('completed', 'in_progress', 'pending'), tool('Read', { file_path: 'a.ts' })], 'pensa')).toEqual({ text: 'Faccio il passo 2' });
  });
  it('a plan item an earlier, stopped turn left in progress is not shown in the next turn', () => {
    const user: ChatItem = { kind: 'user', id: `u${++n}`, at: n, text: 'altro' } as ChatItem;
    expect(liveLine([todos('completed', 'in_progress'), user], 'pensa')).toEqual({ text: 'sta pensando…' });
  });
  it('a running tool that is no step of the work reads as working; a streaming reply as writing', () => {
    expect(liveLine([tool('AskUserQuestion', {}, 'running')], 'lavora')).toEqual({ text: 'sta lavorando…' });
    expect(liveLine([tool('Bash', { command: 'ls' }, 'running')], 'scrive')).toEqual({ text: 'sta scrivendo…' });
  });
});
