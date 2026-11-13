// CodexSession against the fake app-server (test/fixtures/fake-codex-app-server.mjs): the handshake and its fields
// (no "jsonrpc" field sent), thread start / resume (with replay, and a failed resume that opens a new thread), streaming
// reasoning and answer, tokens and context, approvals (accept / acceptForSession / decline / cancel on Stop), questions,
// steer mid-turn, interrupt, failed and unauthorized turns, a crash, drift on unknown shapes, the API key only in the
// engine's env, the read-only refusal, the test guard, and the helpers. No real Codex ever runs here (ADR 0060).
// Removed on 2026-11-09: the tests that started a real process, git, a port or a fake CLI (docs/tests/load-sensitive-
// removed.md); the lines above still name what they covered, and only the in-process tests below remain.
import { afterEach, describe, expect, it } from 'vitest';
import { CodexSession, codexAuthHelp, codexEffort, codexKey, diffCounts, redactArgs, type CodexOptions } from '../../../src/main/chats/codex';
import { recSink, tmp } from './helpers';
const BASE = { engineId: 'codex', label: 'Codex', command: 'codex', args: ['app-server'], loginCommand: 'codex login' } satisfies Partial<CodexOptions>;

const open: CodexSession[] = [];

afterEach(async () => { await Promise.all(open.splice(0).map(s => s.close(500))); });

describe('helpers', () => {
  it('maps effort, keys, diffs, login help, redacts the MCP urls', () => {
    expect(codexEffort('max')).toBe('xhigh');
    expect(codexEffort('low')).toBe('low');
    expect(codexEffort(null)).toBeNull();
    expect(codexKey({ id: 1, result: {} }, 'thread/start')).toBe('result/thread/start');
    expect(codexKey({ id: 1, method: 'item/fileChange/requestApproval', params: {} })).toBe('request/item/fileChange/requestApproval');
    expect(codexKey({ method: 'item/completed', params: { item: { type: 'agentMessage' } } })).toBe('notify/item/completed/agentMessage');
    expect(diffCounts('--- a/x\n+++ b/x\n@@\n-a\n+b\n+c\n')).toEqual({ added: 2, removed: 1 });
    expect(codexAuthHelp('Codex', 'codex login')).toContain('`codex login`');
    expect(codexAuthHelp('Codex', null)).toContain('Impostazioni → Motori');
    expect(redactArgs(['-c', 'mcp_servers.second-brain.url=http://127.0.0.1:1/mcp/x/token', '-c', 'sandbox_mode=read-only'])).toEqual(['-c', 'mcp_servers.second-brain.url=<url>', '-c', 'sandbox_mode=read-only']);
  });
});

describe('CodexSession', () => {
  it('under tests the real CLI is refused', async () => {
    const sink = recSink();
    const s = new CodexSession({ ...BASE, chatId: 'c_real', cwd: tmp('cwd'), pathOverride: 'C:/nowhere/codex.cmd' }, sink);
    open.push(s);
    s.start();
    expect(sink.exited?.error).toContain('fake');
  });
});
