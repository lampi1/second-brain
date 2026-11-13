// A question that is still being checked across the runtime broker (briefReady) when the user stops the chat: the
// stop's own round of cancels never saw it, so the adapter answers it itself (review of the app-owned runtime,
// finding 3). ACP requires an answer to every request; Claude's CLI waits for its control_response. No engine
// process: the writes to stdin are observed directly.
import { describe, expect, it, vi } from 'vitest';
import { AcpSession } from '../../../src/main/chats/acp';
import { ClaudeSession } from '../../../src/main/chats/claude';
import { recSink } from './helpers';

const later = () => { let done!: (v: boolean) => void; return { p: new Promise<boolean>(r => { done = r; }), done: (v: boolean) => done(v) }; };

describe('a question cut by a stop is answered, never left waiting', () => {
  it('Claude: AskUserQuestion gets a refusal when the stop came while its brief was checked', async () => {
    const brief = later();
    const s = new ClaudeSession({ chatId: 'c_q', cwd: '.', sessionId: 'abc12345', yesNo: true, briefReady: () => brief.p }, recSink());
    const writes: unknown[] = [];
    const raw = s as unknown as { write(obj: unknown): void; onControlRequest(m: Record<string, unknown>): Promise<void> };
    raw.write = obj => { writes.push(obj); };
    const asked = raw.onControlRequest({ type: 'control_request', request_id: 'req-q', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', tool_use_id: 'tu-1',
      input: { questions: [{ question: 'Apro la PR?', header: 'PR', options: [{ label: 'Sì' }, { label: 'No' }], multiSelect: false }] } } });
    await s.interrupt();
    brief.done(true);
    await asked;
    expect(writes).toEqual([{ type: 'control_response', response: { subtype: 'success', request_id: 'req-q', response: { behavior: 'deny', message: expect.stringContaining('stopped'), toolUseID: 'tu-1' } } }]);
  });

  it('ACP: cursor/ask_question is answered cancelled when the stop came while its brief was checked', async () => {
    const brief = later();
    const s = new AcpSession({ chatId: 'c_q', cwd: '.', yesNo: true, briefReady: () => brief.p } as ConstructorParameters<typeof AcpSession>[0], recSink());
    const answers: unknown[] = [];
    const raw = s as unknown as { respond(id: number | string, result: unknown): void; onAgentRequest(id: number | string, method: string, p: Record<string, unknown>): Promise<void> };
    raw.respond = (id, result) => { answers.push({ id, result }); };
    const asked = raw.onAgentRequest(7, 'cursor/ask_question', { questions: [{ id: 'q1', prompt: 'Apro la PR?', options: [{ id: 'y', label: 'Sì' }, { id: 'n', label: 'No' }] }] });
    await s.interrupt();
    brief.done(true);
    await asked;
    expect(answers).toEqual([{ id: 7, result: { outcome: { outcome: 'cancelled' } } }]);
  });
});

describe('a question re-checked after its brief grace and then stopped is answered once', () => {
  it('ACP: the stop answers it cancelled and the late re-check stays silent', async () => {
    vi.useFakeTimers();
    try {
      const briefs: ((v: boolean) => void)[] = [];
      const s = new AcpSession({ chatId: 'c_q', cwd: '.', yesNo: true, briefReady: () => new Promise<boolean>(r => { briefs.push(r); }) } as ConstructorParameters<typeof AcpSession>[0], recSink());
      const answers: unknown[] = [];
      const raw = s as unknown as { respond(id: number | string, result: unknown): void; onAgentRequest(id: number | string, method: string, p: Record<string, unknown>): Promise<void> };
      raw.respond = (id, result) => { answers.push({ id, result }); };
      // a live engine for the stop's own cancel round (no real process: its notify is a no-op)
      Object.assign(raw, { proc: {}, notify: () => {} });
      const asked = raw.onAgentRequest(7, 'cursor/ask_question', { questions: [{ id: 'q1', prompt: 'Apro la PR?', options: [{ id: 'y', label: 'Sì' }, { id: 'n', label: 'No' }] }] });
      briefs[0]!(false); // no brief yet: a grace, then a re-check
      await asked;
      await vi.runAllTimersAsync(); // the re-check now waits for its brief
      expect(briefs).toHaveLength(2);
      await s.interrupt();
      briefs[1]!(true);
      await vi.runAllTimersAsync();
      expect(answers).toEqual([{ id: 7, result: { outcome: { outcome: 'cancelled' } } }]);
    } finally { vi.useRealTimers(); }
  });
});
