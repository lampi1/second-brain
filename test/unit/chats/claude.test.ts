// ClaudeSession against the fake CLI (test/fixtures/fake-claude.mjs): streaming, questions, permissions, interrupt,
// bad output, crashes and the control requests.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { ClaudeSession, rulePath } from '../../../src/main/chats/claude';
import { FAKE, recSink, tmp } from './helpers';

const open: ClaudeSession[] = [];

afterEach(async () => { await Promise.all(open.splice(0).map(s => s.close(500))); });

describe('ClaudeSession', () => {
  it('passes the permission mode only when chosen and maps resume, fork, model, effort, name, mcp', () => {
    const base = { chatId: 'c', cwd: '.', sessionId: 'abc12345' };
    const a = new ClaudeSession(base, recSink()).args();
    expect(a.join(' ')).toContain('--input-format stream-json');
    expect(a.join(' ')).toContain('--include-partial-messages');
    expect(a.join(' ')).toContain('--permission-prompt-tool stdio');
    expect(a.join(' ')).toContain('--thinking-display summarized'); // else no thinking text streams (ADR 0058)
    expect(a).not.toContain('--permission-mode'); // no choice: the user's settings.json decides (ADR 0002)
    expect(a).toContain('--session-id=abc12345');
    const b = new ClaudeSession({ ...base, resume: true, fork: true, model: 'sonnet', effort: 'high', title: 'T', permissionMode: 'plan', mcpConfig: '{"mcpServers":{}}', worktree: true }, recSink()).args();
    expect(b.join(' ')).toContain('--resume=abc12345 --fork-session'); // `=`: an id can never be read as a flag
    expect(b.join(' ')).toContain('--model sonnet');
    expect(b.join(' ')).toContain('--effort high');
    expect(b.join(' ')).toContain('--name T');
    expect(b.join(' ')).toContain('--permission-mode plan');
    expect(b).not.toContain('--worktree'); // never on a resume
    expect(b.slice(-2)).toEqual(['--mcp-config', '{"mcpServers":{}}']);
  });

  // ADR 0007: chats run by the STABLE app get session-only guard rails; a dev build adds nothing
  it('adds the stable guard rails inline with --settings only for the stable release', () => {
    const base = { chatId: 'c', cwd: '.', sessionId: 'abc12345' };
    const dev = new ClaudeSession({ ...base, stable: false }, recSink()).args();
    expect(dev).not.toContain('--settings');
    const local = ['D:', 'Profiles', 'x', 'AppData', 'Local'].join('\\'); // a %LOCALAPPDATA%-like folder, built at runtime
    const st = new ClaudeSession({ ...base, stable: true, localAppData: local }, recSink()).args();
    const json = st[st.indexOf('--settings') + 1] ?? '';
    const deny = (JSON.parse(json) as { permissions: { deny: string[] } }).permissions.deny;
    expect(deny).toEqual(expect.arrayContaining(['Bash(taskkill:*)', 'Bash(Stop-Process:*)', 'Bash(kill:*)', 'PowerShell(Stop-Process:*)', 'PowerShell(taskkill:*)', 'Edit(//d/Profiles/x/AppData/Local/second-brain/**)']));
    expect(deny.some(r => /^(Write|MultiEdit)\(/.test(r))).toBe(false); // Claude Code ignores path rules for those: Edit covers them
    expect(st.indexOf('--settings')).toBeLessThan(st.length - 1);
    // merged with settings the chat already has: lists concatenated, other keys kept
    const merged = new ClaudeSession({ ...base, stable: true, localAppData: 'C:\\L', settings: { permissions: { deny: ['Read(.env)'], allow: ['Bash(npm test)'] }, outputStyle: 'x' } }, recSink()).args();
    const m = JSON.parse(merged[merged.indexOf('--settings') + 1] ?? '{}') as { outputStyle: string; permissions: { deny: string[]; allow: string[] } };
    expect(m.outputStyle).toBe('x');
    expect(m.permissions.allow).toEqual(['Bash(npm test)']);
    expect(m.permissions.deny[0]).toBe('Read(.env)');
    expect(m.permissions.deny).toContain('Edit(//c/L/second-brain/**)');
    // the environment decides by default
    const prev = process.env.SB_RELEASE;
    try {
      process.env.SB_RELEASE = '0.2.0-abc';
      expect(new ClaudeSession(base, recSink()).args()).toContain('--settings');
      delete process.env.SB_RELEASE;
      expect(new ClaudeSession(base, recSink()).args()).not.toContain('--settings');
    } finally { if (prev === undefined) delete process.env.SB_RELEASE; else process.env.SB_RELEASE = prev; }
    expect(rulePath('D:\\repo\\x\\')).toBe('//d/repo/x');
    expect(rulePath('/home/x')).toBe('//home/x');
  });

  it('fails cleanly when the CLI or the folder does not exist', async () => {
    const sink = recSink();
    const s = new ClaudeSession({ chatId: 'c', cwd: tmp('cwd'), claudePath: path.join(tmp('nocli'), 'claude.exe') }, sink);
    s.start();
    expect(s.state).toBe('error'); // synchronous: nothing spawned
    expect(sink.exited?.error).toMatch(/Motore Claude non trovato: .*claude\.exe/);
    const sink2 = recSink();
    const s2 = new ClaudeSession({ chatId: 'c', cwd: path.join(tmp('x'), 'missing'), claudePath: FAKE }, sink2);
    s2.start();
    expect(sink2.exited?.error).toMatch(/Cartella non trovata/);
  });
});
