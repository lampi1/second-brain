// AcpSession as OpenCode (`opencode acp`, ADR 0216) against the fake ACP agent in its OpenCode shape
// (test/fixtures/fake-cursor-acp.mjs, FAKE_ACP_OPENCODE=1): the model and the mode are config options, set on the session
// after every open; without modelOption the same answers give no model choice. No real engine ever runs here.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { AcpSession, type AcpOptions } from '../../../src/main/chats/acp';
import { autoPermit } from '../../../src/main/chats/auto-permit';
import { TOOL_CLASSES } from '../../../src/shared/agents';
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

  it.each([
    [{ kind: 'permission', allow: true }, 'allow-once'],
    [{ kind: 'permission', allow: true, always: true }, 'allow-once'],
    [{ kind: 'permission', allow: false, always: true }, 'reject-once'],
  ] as const)('maps only the explicit user choice %j to %s', async (answer, optionId) => {
    const { s, sink, logFile } = start({ ...OPENCODE, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('perm');
    const request = await waitFor(() => sink.pendings[0], 'permission');
    expect(request.noAlways).toBe(true);
    expect(request.alwaysRules).toBeUndefined();
    expect(cursorLog(logFile).some(l => l.answer)).toBe(false);
    s.answer(request.id, answer);
    await waitFor(() => s.state === 'idle', 'answered');
    expect(cursorLog(logFile).find(l => l.answer)?.answer?.outcome).toMatchObject({ outcome: 'selected', optionId });
  });

  it.each([
    {},
    { ceiling: 'default' },
    { ceiling: 'acceptEdits' },
    { ceiling: 'plan' },
    { readOnly: true },
    { permissionMode: 'plan' },
    { toolPolicy: { allow: ['read', 'shell-read'] } },
    { toolPolicy: { allow: [...TOOL_CLASSES], mcp: ['limited'] } },
  ] satisfies Partial<AcpOptions>[])('keeps restricted or unverified sessions once-only: %j', async extra => {
    const { s, sink, logFile } = start({ ...OPENCODE, ...extra, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('perm');
    const request = await waitFor(() => sink.pendings[0], 'permission');
    expect(request.noAlways).toBe(true);
    s.answer(request.id, { kind: 'permission', allow: true, always: true });
    await waitFor(() => s.state === 'idle', 'answered');
    expect(cursorLog(logFile).find(l => l.answer)?.answer?.outcome?.optionId).toBe('allow-once');
  });

  it('does not invent an always option, or ignore a manager gate that removes it', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    for (const text of ['locked', 'perm']) {
      const index = sink.pendings.length;
      s.send(text);
      const request = await waitFor(() => sink.pendings[index], 'permission');
      if (text === 'locked') expect(request.noAlways).toBe(true);
      request.noAlways = true; // the same narrowing the manager applies to shell-read requests
      s.answer(request.id, { kind: 'permission', allow: true, always: true });
      await waitFor(() => s.state === 'idle', 'answered');
    }
    expect(cursorLog(logFile).filter(l => l.answer).map(l => l.answer?.outcome?.optionId)).toEqual(['allow-once', 'allow-once']);
  });

  it('the upstream-cache fixture suppresses Asked for a forbidden command covered by a prior wildcard grant', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, env: { FAKE_ACP_OPENCODE: '1', FAKE_ACP_APPROVED_PATTERN: 'git push *' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('force-push-perm');
    await waitFor(() => s.state === 'idle', 'cached simulated execution');
    expect(sink.pendings).toHaveLength(0);
    expect(cursorLog(logFile).find(l => l.method === 'fake/permission-result')?.params).toEqual({
      command: 'git push --force origin topic', alwaysPattern: 'git push *', cached: true, allowed: true,
    });
  });

  it('keeps a later force push behind the hard deny after an attempted always grant for normal push', async () => {
    const cwd = tmp('push-gate');
    const { s, sink, logFile } = start({ ...OPENCODE, cwd, toolPolicy: { allow: [...TOOL_CLASSES] }, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('push-perm');
    const request = await waitFor(() => sink.pendings[0], 'permission');
    expect(autoPermit(request, { cwd, ceiling: null, undoable: false }).kind).toBe('ask');
    // Simulate a stale client sending always even though the panel no longer offers it.
    s.answer(request.id, { kind: 'permission', allow: true, always: true });
    await waitFor(() => s.state === 'idle', 'first turn');
    s.send('force-push-perm');
    // A cached upstream grant ends the turn WITHOUT requesting permission: fail promptly in that case.
    await waitFor(() => sink.pendings.length === 2 || s.state === 'idle', 'second permission or cached execution');
    expect(sink.pendings).toHaveLength(2);
    const forbidden = sink.pendings[1]!;
    expect(autoPermit(forbidden, { cwd, ceiling: null, undoable: false }).kind).toBe('deny');
    s.answer(forbidden.id, { kind: 'permission', allow: false });
    await waitFor(() => s.state === 'idle', 'denied turn');
    expect(cursorLog(logFile).filter(l => l.method === 'fake/permission-result').map(l => l.params)).toEqual([
      { command: 'git push origin topic', alwaysPattern: 'git push *', cached: false, allowed: true },
      { command: 'git push --force origin topic', alwaysPattern: 'git push *', cached: false, allowed: false },
    ]);
    expect(cursorLog(logFile).filter(l => l.answer).map(l => l.answer?.outcome?.optionId)).toEqual(['allow-once', 'reject-once']);
  });

  it('preserves permission locations when the preceding tool update has no raw input', async () => {
    const cwd = tmp('permission-cwd');
    const { s, sink } = start({ ...OPENCODE, cwd, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('readgate=a.txt');
    const request = await waitFor(() => sink.pendings[0], 'read permission');
    expect(request.input).toMatchObject({ locations: [{ path: path.join(cwd, 'a.txt') }] });
    expect(autoPermit(request, { cwd, ceiling: null, undoable: false })).toEqual({ kind: 'allow' });
    expect(autoPermit(request, { cwd, ceiling: 'default', undoable: false })).toEqual({ kind: 'ask' });
    expect(autoPermit(request, { cwd: tmp('other-cwd'), ceiling: null, undoable: false })).toEqual({ kind: 'ask' });
    expect(sink.resolvedIds).toEqual([]);
  });

  it('never upgrades an opaque tool from its title and never selects a remembered grant', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('opaquegate');
    const request = await waitFor(() => sink.pendings[0], 'opaque permission');
    expect(request.tool).toBe('Tool');
    expect(request.noAlways).toBe(true);
    expect(autoPermit(request, { cwd: tmp('opaque'), ceiling: null, undoable: false }).kind).toBe('ask');
    s.answer(request.id, { kind: 'permission', allow: true, always: true });
    await waitFor(() => cursorLog(logFile).some(l => l.answer), 'answer');
    expect(cursorLog(logFile).find(l => l.answer)?.answer?.outcome?.optionId).toBe('once');
  });

  it('retains both raw input and locations and cancels when only remembered grants are offered', async () => {
    const { s, sink, logFile } = start({ ...OPENCODE, env: { FAKE_ACP_OPENCODE: '1' } });
    await waitFor(() => s.state === 'idle', 'ready');
    s.send('rawlocationsgate');
    const request = await waitFor(() => sink.pendings[0], 'read permission');
    expect(request.input).toMatchObject({ path: 'local.txt', locations: [{ path: '../outside.txt' }] });
    s.answer(request.id, { kind: 'permission', allow: true });
    await waitFor(() => cursorLog(logFile).some(l => l.answer), 'answer');
    expect(cursorLog(logFile).find(l => l.answer)?.answer?.outcome).toEqual({ outcome: 'cancelled' });
  });

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
