// Pure mapping of Claude tool calls to tile rows (src/main/chats/claude-map.ts): summaries, diffs, questions.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { describeSuggestions, diffFor, diffFromResult, flattenAnswers, lineDiff, permissionText, questionsFrom, resultText, toolSummary } from '../../../src/main/chats/claude-map';

const cwd = path.resolve('/repo');

describe('claude-map', () => {
  it('summarises tools in one line', () => {
    expect(toolSummary('Bash', { command: 'npm test\nnpm run lint' })).toBe('Bash: npm test');
    expect(toolSummary('Edit', { file_path: path.join(cwd, 'src', 'a.ts') }, cwd)).toBe('Edit: src/a.ts');
    expect(toolSummary('Read', { file_path: path.resolve('/elsewhere/b.ts') }, cwd)).toMatch(/elsewhere\/b\.ts$/);
    expect(toolSummary('Grep', { pattern: 'foo', path: path.join(cwd, 'src') }, cwd)).toBe('Grep: foo in src');
    expect(toolSummary('Agent', { description: 'review the diff' })).toBe('Agent: review the diff');
    expect(toolSummary('TodoWrite', { todos: [1, 2, 3] })).toBe('TodoWrite: 3 attività');
    expect(toolSummary('AskUserQuestion', { questions: [{ question: 'Che colore?' }] })).toBe('Domanda: Che colore?');
    expect(toolSummary('mcp__second-brain__navigate', { url: 'https://x.test' })).toBe('second-brain: navigate · https://x.test');
    expect(toolSummary('Weird', null)).toBe('Weird');
  });

  it('counts only the changed lines of an edit', () => {
    const d = lineDiff('a\nb\nc', 'a\nB\nc');
    expect(d).toMatchObject({ added: 1, removed: 1 });
    expect(d.patch.split('\n')).toEqual([' a', '-b', '+B', ' c']);
    expect(lineDiff('', 'x\ny')).toMatchObject({ added: 2, removed: 0 });
    expect(lineDiff('x\ny\n', '')).toMatchObject({ added: 0, removed: 2 });
    expect(lineDiff('same', 'same')).toMatchObject({ added: 0, removed: 0 });
  });

  it('falls back to whole-block counts when the change is huge', () => {
    const a = Array.from({ length: 1500 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 1500 }, (_, i) => `b${i}`).join('\n');
    const d = lineDiff(a, b);
    expect(d.added).toBe(1500);
    expect(d.removed).toBe(1500);
    expect(d.patch).toMatch(/righe\)$/);
  });

  it('diffs Edit, MultiEdit and Write inputs, and prefers the CLI structuredPatch', () => {
    expect(diffFor('Edit', { file_path: path.join(cwd, 'a.ts'), old_string: 'x', new_string: 'y\nz' }, cwd)?.[0]).toMatchObject({ path: 'a.ts', added: 2, removed: 1 });
    expect(diffFor('MultiEdit', { file_path: 'f', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: '', new_string: 'c' }] })?.[0]).toMatchObject({ added: 2, removed: 1 });
    expect(diffFor('Write', { file_path: 'f', content: 'l1\nl2\nl3\n' })?.[0]).toMatchObject({ added: 3, removed: 0 });
    expect(diffFor('Bash', { command: 'x' })).toBeUndefined();
    const r = diffFromResult('Write', { file_path: 'f' }, { filePath: 'f', structuredPatch: [{ lines: [' a', '-b', '+c', '+d'] }] });
    expect(r?.[0]).toMatchObject({ added: 2, removed: 1 });
    expect(diffFromResult('Write', {}, { structuredPatch: [] })).toBeUndefined();
    expect(diffFromResult('Bash', {}, { structuredPatch: [{ lines: ['+a'] }] })).toBeUndefined();
  });

  it('reads tool results and questions defensively', () => {
    expect(resultText('ok')).toBe('ok');
    expect(resultText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'x' }])).toBe('a\n[immagine]');
    expect(resultText('x'.repeat(10), 4)).toBe('xxxx… (+6)');
    expect(resultText(undefined)).toBe('');
    const qs = questionsFrom({ questions: [{ question: 'Q1', header: 'H', options: [{ label: 'A', description: 'd' }, { nolabel: 1 }], multiSelect: true }, { bad: 1 }] });
    expect(qs).toEqual([{ question: 'Q1', header: 'H', options: [{ label: 'A', description: 'd' }], multiSelect: true }]);
    expect(questionsFrom(null)).toEqual([]);
    expect(flattenAnswers({ Q1: ['A', 'B'], Q2: 'C' })).toEqual({ Q1: 'A, B', Q2: 'C' });
  });

  it('says in words what "always allow" grants', () => {
    expect(describeSuggestions([
      { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git push:*' }, { toolName: 'WebFetch' }], behavior: 'allow', destination: 'localSettings' },
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
      { type: 'addDirectories', directories: ['C:/repo'], destination: 'session' },
      { type: 'addRules', rules: [{ toolName: 'Read', ruleContent: '.env' }], behavior: 'deny', destination: 'session' },
      null,
    ])).toEqual(['Bash(git push:*)', 'WebFetch', 'modalità: accetta modifiche', 'cartella: C:/repo', 'nega Read(.env)']);
    expect(describeSuggestions([])).toEqual([]);
  });

  it('builds permission panels without ANSI escapes', () => {
    const p = permissionText('Bash', { command: 'rm -rf out' }, { reason: '\u001b[1mnot allowed\u001b[0m', description: 'Delete build' });
    expect(p.title).toBe('Bash: rm -rf out');
    expect(p.detail).toBe('rm -rf out\nDelete build\nMotivo: not allowed');
    expect(permissionText('ExitPlanMode', { plan: '1. do it' }, {}).detail).toBe('1. do it');
    expect(permissionText('Write', { file_path: 'x' }, { title: 'Claude wants to write x' }).title).toBe('Claude wants to write x');
  });
});
