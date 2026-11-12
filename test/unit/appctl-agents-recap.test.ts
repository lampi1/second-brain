// app_agents_recap (ADR 0260, src/main/appctl/agents-recap.ts): one short plain-text block per open agent with its last
// steps (todo/plan list first, else the first sentence of its last messages), what it does now, what it waits for or
// its report; delegated chats under their parent with their state only; the waiting ones first. isAgentsRecap tells
// the phone the text is a recap. Short by default (#384): one line per agent that works, waits or finished, no steps,
// no closed list, at most SHORT_MAX lines; the blocks only with detail.
import { expect, it } from 'vitest';
import { agentsRecap, agentsRecapTool, isAgentsRecap, SHORT_MAX, stepsOf, STEPS_MAX } from '../../src/main/appctl/agents-recap';
import type { ChatItem, ChatSummary, PendingRequest } from '../../src/shared/contract';
import type { AgentRun } from '../../src/shared/agents';

const chat = (id: string, extra: Partial<ChatSummary> = {}) => ({ id, title: `chat ${id}`, state: 'idle', isOrchestrator: false, updatedAt: 1, lastText: '', ...extra }) as ChatSummary;
const role = (name: string) => ({ agent: { name } as ChatSummary['agent'] });
const todo = (todos: { content: string; status: string }[]): ChatItem => ({ kind: 'tool', id: 't', at: 1, name: 'TodoWrite', summary: '', input: { todos }, status: 'ok' });
const said = (text: string, id = text): ChatItem => ({ kind: 'assistant', id, at: 1, text });

it('takes the steps from the latest todo list: the last done ones, the current and the next', () => {
  const s = stepsOf([
    todo([{ content: 'old', status: 'completed' }]),
    todo([
      { content: 'a', status: 'completed' }, { content: 'b', status: 'completed' }, { content: 'c', status: 'completed' }, { content: 'd', status: 'completed' },
      { content: 'run tests', status: 'in_progress' }, { content: 'open PR', status: 'pending' },
    ]),
  ]);
  expect(s).toEqual({ done: ['b', 'c', 'd'], now: 'run tests', next: 'open PR' });
  expect(s.done).toHaveLength(STEPS_MAX);
});

it('reads a Cursor/ACP todos or plan list the same way', () => {
  const item: ChatItem = { kind: 'system', id: 'p', at: 1, text: '', level: 'info', code: 'plan', params: { list: '✓ letto il codice\n▸ corregge il bug\n○ test' } } as ChatItem;
  expect(stepsOf([item])).toEqual({ done: ['letto il codice'], now: 'corregge il bug', next: 'test' });
});

it('without a list uses the first sentence of each message since the user\'s last one, no repeats, no markdown', () => {
  const s = stepsOf([said('before the user'), { kind: 'user', id: 'u', at: 1, text: 'vai' }, said('**Ho letto** il file. Poi altro.', '1'), said('Ho letto il file.', '2'), said('```\ncode\n```\nTest verdi: 12/12', '3')]);
  expect(s.done).toEqual(['Ho letto il file.', 'Test verdi:']);
});

it('writes one block per agent, the waiting ones first, delegates under their parent with state only', () => {
  const chats = [
    chat('orch', { isOrchestrator: true }),
    chat('run', { ...role('Artisan'), title: 'Fix login', state: 'running', updatedAt: 5 }),
    chat('ask', { ...role('Scout'), title: 'Cerca log', state: 'waiting' }),
    chat('kid', { ...role('Sentinel'), title: 'Verifica', parentId: 'run', state: 'running' }),
    chat('fin', { ...role('Herald'), title: 'Mail', lastResult: { at: 1, isError: false } }),
    chat('flash', { quick: true } as Partial<ChatSummary>),
    chat('gone', { title: 'Vecchia', closedAt: 9_000, state: 'closed' }),
  ];
  const items: Record<string, ChatItem[]> = {
    run: [todo([{ content: 'trovato il bug', status: 'completed' }, { content: 'scrive il test', status: 'in_progress' }])],
    kid: [said('secret content of a delegate')],
  };
  const pending = [{ chatId: 'ask', type: 'question', title: 'q', questions: [{ question: 'Posso leggere i log di prod?' }], at: 1 }] as unknown as PendingRequest[];
  const runs = [{ runId: 'r', chatId: 'fin', report: { canonical: { summary: 'Mail inviata a Marco', at: 3, doneWhen: [] } } }] as unknown as AgentRun[];
  const text = agentsRecap({ chats: () => chats, items: id => items[id] ?? [], pending: () => pending, runs: () => runs, now: () => 10_000 }, { detail: true });
  expect(text).toBe([
    '🙋 Scout · Cerca log — aspetta te\n- 🙋 domanda «Posso leggere i log di prod?»',
    '🟢 Artisan · Fix login — al lavoro\n- ✓ trovato il bug\n- ▸ ora: scrive il test\n  - 🟢 Sentinel · Verifica — al lavoro',
    '✅ Herald · Mail — ha finito\n- 📄 Mail inviata a Marco',
    'Chiuse nelle ultime 6 ore: Vecchia',
  ].join('\n\n'));
  expect(text).not.toContain('secret');
  expect(text).not.toContain('Orchestrator');
  expect(isAgentsRecap(text)).toBe(true);
});

it('never shows a delegate\'s question or error text, also when its parent is closed; a stopped turn is not «ha finito»', () => {
  const chats = [
    chat('p', { closedAt: 1, state: 'closed' }),
    chat('k', { ...role('Sentinel'), title: 'Verifica', parentId: 'p', state: 'error', lastError: 'secret error', lastText: 'secret line' }),
    chat('q', { ...role('Scout'), title: 'Cerca', parentId: 'p', state: 'waiting' }),
    chat('s', { title: 'Ferma', lastResult: { at: 1, isError: false, interrupted: true } }),
  ];
  const pending = [{ chatId: 'q', type: 'question', title: 'secret question', questions: [{ question: 'secret question' }], at: 1 }] as unknown as PendingRequest[];
  const text = agentsRecap({ chats: () => chats, items: id => id === 's' ? [] : [said('secret said')], pending: () => pending, runs: () => [], now: () => 1 }, { detail: true });
  expect(text).not.toContain('secret');
  expect(text).toContain('🙋 Scout · Cerca — aspetta te\n- 🙋 una richiesta per te');
  expect(text).toContain('🔴 Sentinel · Verifica — ferma su un errore\n- ❗ errore');
  expect(text).toContain('✋ Ferma — fermata');
});

it('is short by default: one line per agent that works, waits or finished, no steps, no closed list (#384)', () => {
  const chats = [
    chat('orch', { isOrchestrator: true }),
    chat('run', { ...role('Artisan'), title: 'Fix login', state: 'running', updatedAt: 5 }),
    chat('ask', { ...role('Herald'), title: 'Connettore mail', state: 'waiting' }),
    chat('kid', { ...role('Sentinel'), title: 'Verifica', parentId: 'fin', state: 'waiting' }),
    chat('fin', { ...role('Scout'), title: 'Server tool', lastResult: { at: 1, isError: false } }),
    chat('nap', { title: 'Ferma' }),
    chat('gone', { title: 'Vecchia', closedAt: 9_000, state: 'closed' }),
  ];
  const items: Record<string, ChatItem[]> = { run: [todo([{ content: 'trovato il bug', status: 'completed' }, { content: 'prova il caso 3 sul server di test', status: 'in_progress' }])] };
  const pending = [
    { chatId: 'ask', type: 'question', title: 'q', questions: [{ question: 'Attivo il connettore?' }], at: 1 },
    { chatId: 'kid', type: 'question', title: 'secret', questions: [{ question: 'secret question' }], at: 1 },
  ] as unknown as PendingRequest[];
  const d = { chats: () => chats, items: (id: string) => items[id] ?? [], pending: () => pending, runs: () => [], now: () => 10_000 };
  const text = agentsRecap(d);
  expect(text).toBe([
    '🙋 Connettore mail — aspetta te: domanda «Attivo il connettore?»',
    '🙋 Server tool — aspetta te',
    '🟢 Fix login — prova il caso 3 sul server di test',
  ].join('\n'));
  expect(text).not.toContain('secret');
  expect(isAgentsRecap(text)).toBe(true);
  expect(agentsRecapTool(d).run({})).toBe(text);
  expect(agentsRecapTool(d).run({ detail: true })).toContain('Chiuse nelle ultime 6 ore: Vecchia');
  // many agents: at most SHORT_MAX lines, then how many more
  const many = Array.from({ length: SHORT_MAX + 2 }, (_, i) => chat(`r${i}`, { title: `Lavoro ${i}`, state: 'running' }));
  const lines = agentsRecap({ ...d, chats: () => many, pending: () => [] }).split('\n');
  expect(lines).toHaveLength(SHORT_MAX + 1);
  expect(lines.at(-1)).toBe('+ altri 2: chiedi il dettaglio per vederli tutti');
  expect(agentsRecap({ ...d, chats: () => [chat('nap')], pending: () => [] })).toBe('Nessun agente al lavoro.');
});

it('says so when no agent is open, and the tool is read-only', () => {
  const tool = agentsRecapTool({ chats: () => [chat('orch', { isOrchestrator: true })], items: () => [], pending: () => [], runs: () => [] });
  expect(tool.run({})).toBe('Nessun agente al lavoro.');
  expect(tool.annotations?.readOnlyHint).toBe(true);
});

it('tells a recap from an ordinary reply', () => {
  expect(isAgentsRecap('🟢 Artisan · X — al lavoro\n- ✓ a')).toBe(true);
  expect(isAgentsRecap('Ho finito. 🟢 tutto ok')).toBe(false);
  expect(isAgentsRecap('Ecco il punto:\n🟢 Artisan · X — al lavoro\n- ✓ a\n- ▸ ora: b')).toBe(true);
  expect(isAgentsRecap('🟢 Artisan · X — al lavoro\nPoi ho scritto un romanzo.\nE poi un altro.\nE un terzo.')).toBe(false);
});
