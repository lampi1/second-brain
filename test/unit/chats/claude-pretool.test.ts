// ClaudeSession's PreToolUse hook when the broker decides asynchronously (runtime host): a stop during the decision
// still answers the CLI, with a refusal. No CLI process: the stdin write is observed directly.
import { expect, it } from 'vitest';
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
