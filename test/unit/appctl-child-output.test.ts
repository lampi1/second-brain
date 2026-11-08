// app_child_output (ADR 0226, src/main/appctl/child-output.ts): the Orchestrator reads the latest agent_report of a chat in
// its tree, delegates of other roles included: summary + doneWhen by default, the output only with full: true and cut at
// 4,000 characters with a visible marker; never a Flash chat, an Orchestrator or a chat whose ancestry is unknown; read
// only (it never touches the chats or runs it is given).
import { expect, it } from 'vitest';
import { CHILD_OUTPUT_MAX, childOutputTool, inTree } from '../../src/main/appctl/child-output';
import type { ChatSummary } from '../../src/shared/contract';
import type { AgentRun } from '../../src/shared/agents';

const chat = (id: string, extra: Partial<ChatSummary> = {}) => ({ id, title: `chat ${id}`, state: 'idle', isOrchestrator: false, ...extra }) as ChatSummary;
const chats: ChatSummary[] = [
  chat('orch', { isOrchestrator: true }),
  chat('root', { agent: { name: 'Strategist' } as ChatSummary['agent'] }),
  chat('kid', { parentId: 'root', agent: { name: 'Scout' } as ChatSummary['agent'] }),
  chat('grand', { parentId: 'kid', state: 'done' as ChatSummary['state'], delegation: { role: 'sentinel', goal: 'g', doneWhen: ['a'], at: 1, result: { outcome: 'partial', summary: 'only the result', at: 5, doneWhen: [{ criterion: 'a', met: false }] } } as ChatSummary['delegation'] }),
  chat('flash', { quick: true } as Partial<ChatSummary>),
  chat('underFlash', { parentId: 'flash' }),
  chat('orphan', { parentId: 'gone' }),
  chat('quiet'),
];
const long = 'x'.repeat(CHILD_OUTPUT_MAX + 123);
const canonical = (at: number, summary: string, output: string) => ({ outcome: 'done', summary, output, doneWhen: [{ criterion: 'tests green', met: true, evidence: 'vitest 12/12' }], at, taskId: 't', runId: `r${at}`, taskVersion: 1 });
const runs = [
  { runId: 'r1', chatId: 'kid', report: { at: 10, outcome: 'done', verified: 'yes', summary: 'old', canonical: canonical(10, 'old summary', 'old output') } },
  { runId: 'r2', chatId: 'kid', report: { at: 20, outcome: 'done', verified: 'yes', summary: 'new', canonical: canonical(20, 'new summary', long) } },
  { runId: 'r3', chatId: 'root' },
] as unknown as AgentRun[];
const frozen = JSON.stringify({ chats, runs });
const tool = childOutputTool({ chats: () => chats, runs: () => runs });

it('returns summary and doneWhen of the latest report by default, without the output', () => {
  const out = tool.run({ chatId: 'kid' }) as Record<string, unknown>;
  expect(out).toMatchObject({ chatId: 'kid', role: 'Scout', parentId: 'root', state: 'idle', report: { outcome: 'done', summary: 'new summary', doneWhen: [{ criterion: 'tests green', met: true, evidence: 'vitest 12/12' }] } });
  expect(out).not.toHaveProperty('output');
  expect(tool.annotations?.readOnlyHint).toBe(true);
});

it('with full: true returns the output cut at 4,000 characters with a visible marker', () => {
  const out = tool.run({ chatId: 'kid', full: true }) as { output: string; truncated: boolean; outputChars: number };
  expect(out.output.startsWith('x'.repeat(CHILD_OUTPUT_MAX))).toBe(true);
  expect(out.output.slice(CHILD_OUTPUT_MAX)).toBe(`\n…[troncato: ${CHILD_OUTPUT_MAX} di ${long.length} caratteri]`);
  expect(out).toMatchObject({ truncated: true, outputChars: long.length });
  const short = childOutputTool({ chats: () => chats, runs: () => [runs[0]!] }).run({ chatId: 'kid', full: true });
  expect(short).toMatchObject({ output: 'old output' });
  expect(short).not.toHaveProperty('truncated');
});

it('never cuts an emoji in half on the 4,000 boundary', () => {
  const emoji = 'a'.repeat(CHILD_OUTPUT_MAX - 1) + '😀' + 'tail';
  const runsE = [{ runId: 'e', chatId: 'kid', report: { at: 1, outcome: 'done', verified: 'yes', summary: 's', canonical: canonical(1, 's', emoji) } }] as unknown as AgentRun[];
  const out = childOutputTool({ chats: () => chats, runs: () => runsE }).run({ chatId: 'kid', full: true }) as { output: string };
  expect(out.output.isWellFormed()).toBe(true);
  expect(out.output.startsWith('a'.repeat(CHILD_OUTPUT_MAX - 1) + '\n…[troncato:')).toBe(true);
});

it('falls back to the delegation result (no output) and says when there is no report', () => {
  expect(tool.run({ chatId: 'grand', full: true })).toMatchObject({ report: { outcome: 'partial', summary: 'only the result', doneWhen: [{ criterion: 'a', met: false }] }, output: null });
  expect(tool.run({ chatId: 'root' })).toMatchObject({ chatId: 'root', report: null });
  expect(tool.run({ chatId: 'quiet' })).toMatchObject({ report: null });
});

it('reads only chats of the tree: never an Orchestrator, a Flash chat or its children, an orphan, an unknown id', () => {
  for (const id of ['orch', 'flash', 'underFlash', 'orphan', 'nope', '']) expect(() => tool.run({ chatId: id })).toThrow(/albero/);
  expect(inTree(chats, 'grand')?.id).toBe('grand');
  const loop = [chat('a', { parentId: 'b' }), chat('b', { parentId: 'a' })];
  expect(inTree(loop, 'a')).toBeUndefined();
});

it('is read only: the chats and runs it reads are unchanged', () => {
  tool.run({ chatId: 'kid', full: true }); tool.run({ chatId: 'grand' });
  expect(JSON.stringify({ chats, runs })).toBe(frozen);
});
