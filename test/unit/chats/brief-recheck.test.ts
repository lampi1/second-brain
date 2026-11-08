// Real adapter question gates with fake time and an intercepted wire: async brief rechecks get one grace period.
// Existing CLI tests cover the process transport; these regressions isolate the retry's promise ordering.
import { afterEach, expect, it, vi } from 'vitest';
import { AcpSession } from '../../../src/main/chats/acp';
import { ClaudeSession } from '../../../src/main/chats/claude';
import { BRIEF_GRACE_MS } from '../../../src/shared/yes-no';
import { recSink } from './helpers';

type Packet = Record<string, unknown>;
interface ClaudeWire { onControlRequest(packet: Packet): Promise<void>; write(packet: unknown): void }
interface AcpWire { onAgentRequest(id: string, method: string, packet: Packet): Promise<void>; write(packet: unknown): void }

function fixture(engine: 'claude' | 'acp', briefReady: () => boolean | Promise<boolean>) {
  const sink = recSink();
  if (engine === 'claude') {
    const wire = new ClaudeSession({ chatId: 'brief', cwd: '.', yesNo: true, briefReady }, sink) as unknown as ClaudeWire;
    return { sink, reply: vi.spyOn(wire, 'write').mockImplementation(() => {}),
      receive: (id: string) => wire.onControlRequest({ request_id: id, request: { subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Procedo?', options: [{ label: 'Sì (consigliato)' }, { label: 'No' }] }] } } }) };
  }
  const wire = new AcpSession({ chatId: 'brief', cwd: '.', engineId: 'cursor', label: 'Cursor', args: ['acp'], yesNo: true, briefReady }, sink) as unknown as AcpWire;
  return { sink, reply: vi.spyOn(wire, 'write').mockImplementation(() => {}),
    receive: (id: string) => wire.onAgentRequest(id, 'cursor/ask_question', {
      questions: [{ id: 'q', prompt: 'Procedo?', options: [{ id: 'yes', label: 'Sì (consigliato)' }, { id: 'no', label: 'No' }] }],
    }) };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

for (const engine of ['claude', 'acp'] as const) {
  it.each(['sync', 'async'])(`${engine} finishes a %s no-brief recheck once, then shows the third question`, async mode => {
    vi.useFakeTimers();
    const f = fixture(engine, mode === 'sync' ? () => false : async () => false);
    for (const attempt of [1, 2]) {
      await f.receive(`question-${attempt}`);
      expect(f.reply).toHaveBeenCalledTimes(attempt - 1);
      await vi.advanceTimersByTimeAsync(BRIEF_GRACE_MS);
      expect(f.reply).toHaveBeenCalledTimes(attempt);
      expect(JSON.stringify(f.reply.mock.calls.at(-1))).toContain('component');
      expect(f.sink.pendings).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    }
    await f.receive('question-3');
    expect(f.sink.pendings).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
}
