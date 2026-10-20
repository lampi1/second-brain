// The steps of a delegated chat's card (src/renderer/lib/run-steps.ts, ADR 0083): the engine's own plan on each engine
// (Claude's TodoWrite, Codex's "Piano:" item, Cursor's ACP plan and todos), else the contract's criteria, and always the
// recent tool calls folded into readable lines (reads under one folder, edits with their diff counts, a command), with
// no sentence the agent did not write.
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../src/shared/contract';
import { actionSteps, contractSteps, enginePlan, runSteps } from '../../src/renderer/lib/run-steps';
import { setLang } from '../../src/renderer/i18n';

let n = 0;
const tool = (name: string, input: unknown, extra: Partial<Extract<ChatItem, { kind: 'tool' }>> = {}): ChatItem =>
  ({ kind: 'tool', id: `t${++n}`, at: 1_000 * n, name, summary: `${name}: x`, input, status: 'ok', ...extra });
const sys = (text: string, code?: string): ChatItem => ({ kind: 'system', id: `s${++n}`, at: 1_000 * n, text, level: 'info', ...(code ? { code } : {}) } as ChatItem);

describe('enginePlan', () => {
  it('Claude: the latest TodoWrite, in progress shown with its active form', () => {
    const items = [tool('TodoWrite', { todos: [{ content: 'old', status: 'pending' }] }), tool('TodoWrite', { todos: [
      { content: 'Leggere il runbook', status: 'completed', activeForm: 'Leggo il runbook' },
      { content: 'Raggruppare per codice', status: 'in_progress', activeForm: 'Raggruppo per codice' },
      { content: 'Riportare i 5 codici', status: 'pending', activeForm: 'Riporto' },
    ] })];
    expect(enginePlan(items)).toEqual([
      { mark: 'done', text: 'Leggere il runbook' }, { mark: 'cur', text: 'Raggruppo per codice' }, { mark: 'todo', text: 'Riportare i 5 codici' },
    ]);
  });
  it('Codex: the "Piano:" item chats/codex.ts keeps up to date', () => {
    expect(enginePlan([sys('Piano: prima i log\n✓ Letti i log\n▸ Filtro per codice\n○ Riassumo')])).toEqual([
      { mark: 'done', text: 'Letti i log' }, { mark: 'cur', text: 'Filtro per codice' }, { mark: 'todo', text: 'Riassumo' },
    ]);
  });
  it('Cursor: the ACP plan and cursor/update_todos items', () => {
    expect(enginePlan([sys('Piano:\n▸ Apro il modulo\n○ Lancio i test', 'plan')])).toEqual([{ mark: 'cur', text: 'Apro il modulo' }, { mark: 'todo', text: 'Lancio i test' }]);
    expect(enginePlan([sys('Attività:\n✓ Fatto\n✗ Annullato', 'todos')])).toEqual([{ mark: 'done', text: 'Fatto' }, { mark: 'bad', text: 'Annullato' }]);
  });
  it('none: no plan, and an ordinary system line is no plan', () => {
    expect(enginePlan([sys('Turno finito'), tool('Read', { file_path: '/a/b.ts' })])).toBeNull();
  });
});

describe('actionSteps', () => {
  it('folds reads under one folder, edits with their diff counts, and names a command; running only while live', () => {
    const items = [
      tool('Read', { file_path: '/w/src/payments/a.ts' }), tool('Grep', { pattern: 'Legacy', path: '/w/src/payments' }), tool('Read', { file_path: '/w/src/payments/b.ts' }),
      tool('Edit', { file_path: '/w/src/payments/a.ts' }, { diff: [{ path: '/w/src/payments/a.ts', added: 100, removed: 40 }] }),
      tool('Write', { file_path: '/w/src/payments/c.ts' }, { diff: [{ path: '/w/src/payments/c.ts', added: 82, removed: 24 }] }),
      tool('Bash', { command: 'dotnet test Shop.Tests\nmore' }, { status: 'running' }),
      tool('WebSearch', { query: 'stripe api 2025' }, { status: 'error' }),
      tool('TodoWrite', { todos: [] }), tool('mcp__second-brain__agent_children', {}),
    ];
    const steps = actionSteps(items, true);
    expect(steps.map(s => [s.mark, s.text, s.code ?? null])).toEqual([
      ['done', 'Letti 2 file in src/payments/', null],
      ['done', 'Modificati 2 file · +182 −64', null],
      ['cur', 'Lancia', 'dotnet test Shop.Tests'],
      ['bad', 'Cerca sul web «stripe api 2025»', null],
    ]);
    expect(actionSteps(items, false)[2]).toMatchObject({ mark: 'done', text: 'Lanciato' });
  });
  it('speaks the UI language: the same lines in English', () => {
    const items = [
      tool('Read', { file_path: '/w/src/a.ts' }), tool('Read', { file_path: '/w/src/b.ts' }),
      tool('Edit', { file_path: '/w/src/a.ts' }, { diff: [{ path: '/w/src/a.ts', added: 3, removed: 1 }] }),
      tool('Bash', { command: 'npm test' }, { status: 'running' }),
    ];
    setLang('en');
    try {
      expect(actionSteps(items, true).map(s => s.text)).toEqual(['Read 2 files in w/src/', 'Edited a.ts · +3 −1', 'Running']);
      expect(actionSteps([tool('Read', { file_path: '/w/a.ts' }), tool('Grep', { pattern: 'x', path: '/w' })], false)[0]!.text).toBe('Read a.ts and 1 search');
    } finally { setLang('it'); }
  });
});

describe('runSteps', () => {
  it('without a plan: the latest actions, then the contract\'s criteria still open; once reported, the criteria go with the result', () => {
    const items = [tool('Read', { file_path: '/w/a.ts' })];
    const open = runSteps(items, { live: true, doneWhen: ['Elenco degli errori', 'Picco datato'] });
    expect(open.source).toBe('contract');
    expect(open.steps.map(s => [s.mark, s.text])).toEqual([['done', 'Legge a.ts'], ['todo', 'Elenco degli errori'], ['todo', 'Picco datato']]);
    const reported = runSteps(items, { live: false, doneWhen: ['Elenco degli errori'], result: { doneWhen: [{ criterion: 'Elenco degli errori', met: true }] } });
    expect(reported.source).toBeNull();
    expect(contractSteps(['a', 'b'], { doneWhen: [{ criterion: 'a', met: true }, { criterion: 'b', met: false }] }).map(s => s.mark)).toEqual(['done', 'bad']);
  });
  it('with a plan: its done items, the latest actions, its open items; the rest counted as earlier', () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) => tool('Bash', { command: `cmd ${i}` })),
      tool('TodoWrite', { todos: [{ content: 'Uno', status: 'completed' }, { content: 'Due', status: 'in_progress' }, { content: 'Tre', status: 'pending' }] }),
    ];
    const r = runSteps(items, { live: true, doneWhen: ['x'] });
    expect(r.source).toBe('plan');
    expect(r.steps[0]).toEqual({ mark: 'done', text: 'Uno' });
    expect(r.steps.slice(-2).map(s => s.text)).toEqual(['Due', 'Tre']);
    expect(r.steps.length).toBeLessThanOrEqual(5);
    expect(r.earlier).toBe(6 - r.steps.filter(s => s.code).length);
  });
});
