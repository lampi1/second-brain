// ClaudeSession's PreToolUse hook when the broker decides asynchronously (runtime host): a stop during the decision
// still answers the CLI, with a refusal; a failing in-process hook lets the call go on; a question withdrawn while it is
// still checked shows no panel. No CLI process: the stdin write is observed directly.
import { expect, it, vi } from 'vitest';
import { ClaudeSession } from '../../../src/main/chats/claude';
import { recSink } from './helpers';

type Hooked = { write(obj: unknown): void; onPreToolUse(id: string, input: Record<string, unknown>): Promise<void> };

it('refuses the hooked call when the session is stopped while the broker decides, instead of leaving it unanswered', async () => {
  let decide!: (v: { deny: string } | null) => void;
  const s = new ClaudeSession({ chatId: 'c_pretool', cwd: '.', sessionId: 'abc12345', preToolUse: {
    decide: () => new Promise(resolve => { decide = resolve; }), turnEnded: () => {},
  } }, recSink());
  const writes: unknown[] = [];
  const hooked = s as unknown as Hooked;
  hooked.write = obj => { writes.push(obj); };
  const answered = hooked.onPreToolUse('req-1', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} });
  await s.interrupt();
  decide(null); // the broker would have allowed it: the stop wins
  await answered;
  expect(writes).toEqual([{ type: 'control_response', response: { subtype: 'success', request_id: 'req-1', response: {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining('stopped') },
  } } }]);
});

it('a failing in-process PreToolUse hook lets the call go on; only an unreachable runtime broker refuses', async () => {
  const { RuntimeOperationError } = await import('../../../src/main/agent-runtime/channel');
  const answers: unknown[] = [];
  for (const error of [new Error('budget file unreadable'), new RuntimeOperationError('uncertain', 'op-1', 'lost')]) {
    const s = new ClaudeSession({ chatId: 'c_pretool', cwd: '.', sessionId: 'abc12345', preToolUse: { decide: async () => { throw error; }, turnEnded: () => {} } }, recSink());
    const hooked = s as unknown as Hooked;
    hooked.write = obj => { answers.push((obj as { response: { response: unknown } }).response.response); };
    await hooked.onPreToolUse('req-1', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} });
  }
  expect(answers[0]).toEqual({});
  expect(answers[1]).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
});

it('a question the CLI withdraws while it is still checked never shows a panel', async () => {
  let brief!: (v: boolean) => void;
  const sink = recSink();
  const s = new ClaudeSession({ chatId: 'c_q', cwd: '.', sessionId: 'abc12345', yesNo: true, briefReady: () => new Promise(r => { brief = r; }) }, sink);
  const raw = s as unknown as { write(obj: unknown): void; onMessage(m: Record<string, unknown>): void; onControlRequest(m: Record<string, unknown>): Promise<void> };
  raw.write = () => {};
  const asked = raw.onControlRequest({ type: 'control_request', request_id: 'req-q', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', tool_use_id: 'tu-1',
    input: { questions: [{ question: 'Apro la PR?', header: 'PR', options: [{ label: 'Sì' }, { label: 'No' }], multiSelect: false }] } } });
  raw.onMessage({ type: 'control_cancel_request', request_id: 'req-q' });
  brief(true);
  await asked;
  expect(sink.pendings).toEqual([]);
});

it('a question withdrawn while its brief was checked, with no brief, is neither refused nor re-checked later', async () => {
  vi.useFakeTimers();
  try {
    let brief!: (v: boolean) => void;
    const sink = recSink();
    const s = new ClaudeSession({ chatId: 'c_q', cwd: '.', sessionId: 'abc12345', yesNo: true, briefReady: () => new Promise(r => { brief = r; }) }, sink);
    const writes: unknown[] = [];
    const raw = s as unknown as { write(obj: unknown): void; onMessage(m: Record<string, unknown>): void; onControlRequest(m: Record<string, unknown>): Promise<void> };
    raw.write = obj => { writes.push(obj); };
    const asked = raw.onControlRequest({ type: 'control_request', request_id: 'req-q', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', tool_use_id: 'tu-1',
      input: { questions: [{ question: 'Apro la PR?', header: 'PR', options: [{ label: 'Sì' }, { label: 'No' }], multiSelect: false }] } } });
    raw.onMessage({ type: 'control_cancel_request', request_id: 'req-q' });
    brief(false);
    await asked;
    await vi.runAllTimersAsync(); // a grace re-check would ask for the brief again here
    brief?.(false);
    await vi.runAllTimersAsync();
    expect(writes).toEqual([]);
    expect(sink.pendings).toEqual([]);
  } finally { vi.useRealTimers(); }
});

it('the same tool request arriving again while the first is still checked shows one panel', async () => {
  let brief!: (v: boolean) => void;
  const sink = recSink();
  const s = new ClaudeSession({ chatId: 'c_q', cwd: '.', sessionId: 'abc12345', yesNo: true, briefReady: () => new Promise(r => { brief = r; }) }, sink);
  const raw = s as unknown as { write(obj: unknown): void; onControlRequest(m: Record<string, unknown>): Promise<void> };
  raw.write = () => {};
  const m = { type: 'control_request', request_id: 'req-q', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', tool_use_id: 'tu-1',
    input: { questions: [{ question: 'Apro la PR?', header: 'PR', options: [{ label: 'Sì' }, { label: 'No' }], multiSelect: false }] } } };
  const first = raw.onControlRequest(m);
  const firstBrief = brief;
  const second = raw.onControlRequest(m);
  firstBrief(true);
  brief(true);
  await Promise.all([first, second]);
  expect(sink.pendings.map(p => p.id)).toEqual(['req-q']);
});
