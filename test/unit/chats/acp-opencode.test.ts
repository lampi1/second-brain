// AcpSession as OpenCode (`opencode acp`, ADR 0216) against the fake ACP agent in its OpenCode shape
// (test/fixtures/fake-cursor-acp.mjs, FAKE_ACP_OPENCODE=1): the model and the mode are config options, set on the session
// after every open; without modelOption the same answers give no model choice. No real engine ever runs here.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { AcpSession, type AcpOptions } from '../../../src/main/chats/acp';
import { FAKE_CURSOR, cursorLog, recSink, tmp, waitFor, type RecSink } from './helpers';

const open: AcpSession[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(s => s.close(500))); });

function start(extra: Partial<AcpOptions> = {}): { s: AcpSession; sink: RecSink; logFile: string } {
  const logFile = path.join(tmp('log'), 'opencode.jsonl');
  const sink = recSink();
  const s = new AcpSession({ engineId: 'kimi', label: 'Kimi', args: ['acp'], acpCommand: 'kimi', chatId: 'c_oc', cwd: tmp('cwd'), pathOverride: FAKE_CURSOR, ...extra, env: { FAKE_CURSOR_LOG: logFile, ...extra.env } }, sink);
  open.push(s);
  s.start();
  return { s, sink, logFile };
}
describe('AcpSession as OpenCode (modelOption, ADR 0216)', () => {
  const OPENCODE = { engineId: 'opencode', label: 'OpenCode', args: ['acp'], acpCommand: 'opencode', loginCommand: 'opencode auth login', modelOption: true } satisfies Partial<AcpOptions>;
  const sets = (logFile: string) => cursorLog(logFile).filter(l => l.method === 'session/set_config_option').map(l => [l.params?.configId, l.params?.value]);

  it('lists the model option\'s models and sets the chat\'s model there, no model flag, then its effort', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, model: 'openrouter/qwen/qwen3-coder', effort: 'high', env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    expect(cursorLog(logFile).find(l => l.argv)?.argv).toEqual(['acp']);
    expect(sink.modelLists.at(-1)?.map(m => m.id)).toEqual(['opencode/big-pickle', 'openrouter/qwen/qwen3-coder', 'anthropic/claude-sonnet-5-5']);
    expect(sets(logFile)).toEqual([['model', 'openrouter/qwen/qwen3-coder'], ['effort', 'high']]);
    expect(sink.patch).toMatchObject({ model: 'openrouter/qwen/qwen3-coder[effort=high]', effortObserved: 'high' });
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.level === 'warn')).toBe(false);
  });

  it('a model it does not offer is a visible warning; the default model keeps running', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, model: 'nope/model', env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    expect(sets(logFile)).toEqual([]);
    expect(sink.patch.model).toBe('opencode/big-pickle');
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.level === 'warn')).toBe(true);
  });

  it('plan goes through the mode option (build back for the working mode); a resume sets the model again', async () => {
    const first = start({ ...OPENCODE, permissionMode: 'plan', env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => first.s.state === 'idle', 'ready');
    await waitFor(() => first.sink.patch.permissionMode === 'plan', 'plan mode');
    expect(sets(first.logFile)).toEqual([['mode', 'plan']]);
    await first.s.setPermissionMode('default');
    expect(sets(first.logFile).at(-1)).toEqual(['mode', 'build']);
    expect(cursorLog(first.logFile).some(l => l.method === 'session/set_mode')).toBe(false);
    const sessionId = first.sink.patch.sessionId!;
    const again = start({ ...OPENCODE, resume: true, sessionId, model: 'anthropic/claude-sonnet-5-5', env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => again.s.state === 'idle', 'resumed');
    expect(cursorLog(again.logFile).some(l => l.method === 'session/load')).toBe(true);
    expect(sets(again.logFile)[0]).toEqual(['model', 'anthropic/claude-sonnet-5-5']);
    expect(again.sink.patch.model).toMatch(/^anthropic\/claude-sonnet-5-5/);
  });

  it('without modelOption the same answers give no model list (Cursor never sets a model on the session)', async () => {
    const { s, sink, logFile } = start({ model: 'openrouter/qwen/qwen3-coder', env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    expect(sink.modelLists).toEqual([]);
    expect(sets(logFile).some(([id]) => id === 'model')).toBe(false);
  });
});
