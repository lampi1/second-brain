// An engine request handler that throws (agent-runtime/request-failure.ts): only a runtime broker failure stops the
// engine; an engine that is gone before its answer is only noted (#459); any other error is logged and the engine
// keeps running, as when the handlers were synchronous.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, errText: (e: unknown) => (e instanceof Error ? e.message : String(e)) }));
import { log } from '../../src/main/log';
import { RuntimeOperationError } from '../../src/main/agent-runtime/channel';
import { requestFailed } from '../../src/main/agent-runtime/request-failure';

describe('requestFailed', () => {
  it('a handler error is logged and the engine keeps running', () => {
    const kill = vi.fn();
    requestFailed(new Error('SQLITE_BUSY'), { chatId: 'c', what: 'control_request', kill });
    expect(kill).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith('chats', 'control_request failed', expect.objectContaining({ chat: 'c', cause: 'SQLITE_BUSY' }));
  });

  it('an engine gone before its answer is noted, not an error (#459)', () => {
    const kill = vi.fn();
    vi.mocked(log.error).mockClear();
    requestFailed(new Error('La sessione non è attiva.'), { chatId: 'c', what: 'control_request', kill, gone: () => true });
    expect(kill).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('chats', 'control_request: the engine was gone before its answer', expect.objectContaining({ chat: 'c' }));
    // the same error from a live engine is still an error
    requestFailed(new Error('La sessione non è attiva.'), { chatId: 'c', what: 'control_request', kill, gone: () => false });
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('a runtime broker failure stops the engine', () => {
    const kill = vi.fn();
    requestFailed(new RuntimeOperationError('uncertain', 'op-1', 'lost'), { chatId: 'c', what: 'session/request_permission', kill });
    expect(kill).toHaveBeenCalledOnce();
  });
});
