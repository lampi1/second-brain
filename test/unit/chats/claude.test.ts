// ClaudeSession against the fake CLI (test/fixtures/fake-claude.mjs): streaming, questions, permissions, interrupt,
// bad output, crashes and the control requests.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ClaudeSession, rulePath } from '../../../src/main/chats/claude';
import { FAKE, PNG_1PX, fakeLog, killStray, recSink, tmp, waitFor, type RecSink } from './helpers';

const open: ClaudeSession[] = [];
function start(extra: Partial<ConstructorParameters<typeof ClaudeSession>[0]> = {}): { s: ClaudeSession; sink: RecSink; cwd: string } {
  const cwd = tmp('cwd');
  const sink = recSink();
  const s = new ClaudeSession({ chatId: 'c_test', cwd, claudePath: FAKE, sessionId: '11111111-2222-4333-8444-555555555555', ...extra }, sink);
  open.push(s);
  s.start();
  return { s, sink, cwd };
}
const resultOf = (sink: RecSink) => waitFor(() => sink.last('result'), 'result');

afterEach(async () => { await Promise.all(open.splice(0).map(s => s.close(500))); });

describe('ClaudeSession', () => {
  it('clears the previous submitted effort when a native running event starts an autonomous turn', async () => {
    const { s, sink } = start({ effort: 'xhigh', env: { FAKE_CLAUDE_LATER_MS: '200' } });
    s.send('later');
    await waitFor(() => sink.trace.filter(t => t === 'result').length === 2 && s.state === 'idle', 'unsolicited native turn');
    const efforts = sink.patches.filter(p => 'effortSubmitted' in p).map(p => p.effortSubmitted);
    expect(efforts).toEqual(['xhigh', null]);
  });
  it('does not reuse the previous submitted effort for a turn queued inside the CLI', async () => {
    const { s, sink } = start({ effort: 'xhigh', env: { FAKE_CLAUDE_DELAY: '0' } });
    // A protocol question holds the turn until the explicit reply, instead of racing200 timed text deltas.
    s.send('ask me');
    const question = await waitFor(() => sink.pendings[0], 'current turn question');
    await s.setEffort('medium');
    s.send('queued new assignment');
    // Both writes use the same stdin: the queued message arrives before the reply releases the current turn.
    expect(s.answer(question.id, { kind: 'question', answers: { 'Che colore?': 'Blu' } })).toBe(true);
    await waitFor(() => [...sink.items.values()].filter(i => i.kind === 'result').length === 2 && s.state === 'idle', 'both turns');
    expect(sink.patches.filter(p => 'effortSubmitted' in p).map(p => p.effortSubmitted)).toEqual(['xhigh', null]);
    expect(sink.patch.effort).toBe('medium');
  });
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

  it('streams assistant text as replace events and ends the turn with a result', async () => {
    const { s, sink } = start();
    await waitFor(() => s.state === 'idle', 'idle after initialize');
    s.send('hello');
    const r = await resultOf(sink);
    expect(r).toMatchObject({ costUsd: 0.01, turns: 1, isError: false });
    const a = sink.last('assistant');
    expect(a).toMatchObject({ text: 'Ciao dal motore', streaming: false });
    const versions = sink.events.filter(e => e.item.id === a?.id);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions[0]).toMatchObject({ replace: false, item: { streaming: true } });
    expect(versions.at(-1)?.replace).toBe(true);
    // the CLI reports idle on its own line after the result: wait for it, as the unsolicited-turn test does (no short
    // deadline: under load that would be the next flake; the state event itself is covered by the session-state tests)
    await waitFor(() => s.state === 'idle', 'idle after result');
    expect(s.sessionId).toBe('11111111-2222-4333-8444-555555555555');
    // A requested UUID is not a provider observation until native init confirms it, even when unchanged.
    expect(sink.patch.sessionId).toBe('11111111-2222-4333-8444-555555555555');
    expect(sink.patch).toMatchObject({ model: 'claude-fake-1', permissionMode: 'default', lastText: 'Ciao dal motore', turnCostUsd: 0.01, totalCostUsd: 0.01, version: '0.0.0-fake' });
    await waitFor(() => sink.patch.contextTokens === 1234, 'context usage after the turn');
    expect(sink.patch.contextMaxTokens).toBe(200000);
    expect(sink.last('system')?.text).toBe('MCP broken: failed');
  });

  it('round-trips an AskUserQuestion: panel, answer, tool result', async () => {
    const { s, sink } = start();
    s.send('ask me');
    const q = await waitFor(() => sink.pendings[0], 'question');
    expect(s.state).toBe('waiting');
    expect(q).toMatchObject({ type: 'question', tool: 'AskUserQuestion', title: 'Che colore?' });
    expect(q.questions?.[0]?.options.map(o => o.label)).toEqual(['Blu', 'Rosso']);
    // the request names its tool_use: its context ends at that row (renderer/lib/askContext.ts requestItems)
    expect(q.toolUseId).toBeTruthy();
    expect(sink.items.has(`t-${q.toolUseId}`)).toBe(true);
    expect(() => s.answer(q.id, { kind: 'permission', allow: true })).toThrow(/domanda/);
    expect(s.answer(q.id, { kind: 'question', answers: { 'Che colore?': 'Blu' } })).toBe(true);
    expect(sink.resolvedIds).toEqual([q.id]);
    expect(s.answer(q.id, { kind: 'question', answers: {} })).toBe(false); // already answered
    await resultOf(sink);
    const tool = sink.last('tool');
    expect(tool).toMatchObject({ name: 'AskUserQuestion', status: 'ok', summary: 'Domanda: Che colore?' });
    expect(tool?.output).toContain('"Che colore?":"Blu"');
    expect(sink.last('assistant')?.text).toBe('Hai scelto Blu');
  });

  it('never offers a suggested mode above an agent ceiling (A2)', async () => {
    const free = start();
    free.s.send('mode');
    expect((await waitFor(() => free.sink.pendings[0], 'permission')).alwaysRules?.length).toBeGreaterThan(0);
    const capped = start({ ceiling: 'default' });
    capped.s.send('mode');
    const p = await waitFor(() => capped.sink.pendings[0], 'permission');
    expect(p.alwaysRules).toBeUndefined();
    expect(p.noAlways).toBe(true);
    capped.s.answer(p.id, { kind: 'permission', allow: true, always: true });
    await resultOf(capped.sink);
    expect(capped.sink.last('tool')?.output ?? '').not.toContain('setMode');
  });

  it('allows a permission for the session only when "always" is chosen', async () => {
    const { s, sink } = start();
    s.send('run bash');
    const p = await waitFor(() => sink.pendings[0], 'permission');
    expect(p).toMatchObject({ type: 'permission', tool: 'Bash', title: 'Bash: npm test' });
    expect(p.detail).toContain('Motivo: comando non in allow list'); // ANSI stripped
    expect(() => s.answer(p.id, { kind: 'question', answers: {} })).toThrow(/permesso/);
    s.answer(p.id, { kind: 'permission', allow: true, always: true });
    await resultOf(sink);
    const tool = sink.last('tool');
    expect(tool?.status).toBe('ok');
    expect(tool?.output).toContain('"destination":"session"'); // never localSettings: the app writes no settings file
    expect(tool?.output).toContain('"toolUseID":"toolu_bash"');
  });

  it('denies a permission with the user\'s message', async () => {
    const { s, sink } = start();
    s.send('bash please');
    const p = await waitFor(() => sink.pendings[0], 'permission');
    s.answer(p.id, { kind: 'permission', allow: false, message: 'no, non ora' });
    await resultOf(sink);
    expect(sink.last('tool')).toMatchObject({ status: 'error', output: 'Permission denied: no, non ora' });
    expect(sink.last('assistant')?.text).toBe('Ok, non lo eseguo.');
  });

  it('interrupts a streaming turn', async () => {
    const { s, sink } = start({ env: { FAKE_CLAUDE_DELAY: '30' } });
    s.send('slow');
    await waitFor(() => sink.last('assistant')?.text.includes('tick'), 'some streamed text');
    await s.interrupt({ byUser: true });
    const r = await resultOf(sink);
    // The CLI sends its authoritative idle event after the result; separate pipe chunks are valid.
    await waitFor(() => s.state === 'idle', 'the interrupted turn became idle');
    // the user's own stop is no error (12/10: "quando faccio Invia subito vedo sempre un errore"), told once
    expect(r).toMatchObject({ isError: false, interrupted: true });
    expect(sink.last('assistant')?.streaming).toBe(false);
    const notes = [...sink.items.values()].filter(i => i.kind === 'system').map(i => (i as { code?: string; level: string }));
    expect(notes.map(n => n.code).filter(c => c === 'stoppedByYou' || c === 'stoppedByYouResend')).toEqual(['stoppedByYou']);
    expect(notes.some(n => n.level === 'error')).toBe(false);
    expect(s.state).toBe('idle');
  });

  // "Invia subito" (renderer store.sendQueuedNow): interrupt, the chat reports idle, then the message is sent
  it('send now: after an interrupt the chat goes idle and the next message runs once, as a normal turn', async () => {
    const { s, sink } = start({ env: { FAKE_CLAUDE_DELAY: '30' } });
    s.send('slow');
    await waitFor(() => sink.last('assistant')?.text.includes('tick'), 'some streamed text');
    await s.interrupt({ keepQueued: true, byUser: true });
    await waitFor(() => s.state === 'idle' || undefined, 'idle after the interrupt');
    s.send('subito');
    const results = () => [...sink.items.values()].filter(i => i.kind === 'result');
    await waitFor(() => (results().length === 2 && s.state === 'idle') || undefined, 'the second turn');
    expect(results().map(r => r.kind === 'result' && [r.isError, !!r.interrupted])).toEqual([[false, true], [false, false]]);
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.code === 'stoppedByYouResend')).toBe(true);
    expect(sink.last('assistant')?.text).toBe('Ciao dal motore');
    expect(sink.trace.filter(t => t === 'result')).toHaveLength(2); // one turn per message, nothing replayed
  });

  it('a real failure with no words from the CLI still says why (its subtype); no interrupt = no "interrotto da te"', async () => {
    const { s, sink } = start();
    s.send('hello');
    await resultOf(sink);
    s.line(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, duration_ms: 5, num_turns: 9, total_cost_usd: 1, errors: [] }));
    const r = [...sink.items.values()].filter(i => i.kind === 'result').at(-1);
    expect(r).toMatchObject({ isError: true });
    expect(r).not.toHaveProperty('interrupted');
    expect([...sink.items.values()].some(i => i.kind === 'system' && i.level === 'error' && i.code === 'turnFailed.error_max_turns')).toBe(true);
  });

  it("the app's own interrupt (a hand-off that timed out) is never told as the user's", async () => {
    const { s, sink } = start({ env: { FAKE_CLAUDE_DELAY: '30' } });
    s.send('slow');
    await waitFor(() => sink.last('assistant')?.text.includes('tick'), 'some streamed text');
    await s.interrupt();
    const r = await resultOf(sink);
    expect(r).not.toHaveProperty('interrupted');
    expect([...sink.items.values()].some(i => i.kind === 'system' && /da te/.test(i.text))).toBe(false);
  });

  it('interrupt withdraws an open question', async () => {
    const { s, sink } = start();
    s.send('ask');
    const q = await waitFor(() => sink.pendings[0], 'question');
    await s.interrupt();
    await resultOf(sink);
    expect(sink.resolvedIds).toContain(q.id);
    expect(sink.last('tool')?.status).toBe('error');
    expect(s.state).toBe('idle');
  });

  it('survives non-JSON and odd lines on stdout', async () => {
    const { s, sink } = start();
    s.send('garbage then hello');
    await resultOf(sink);
    expect(sink.last('assistant')?.text).toBe('Ciao dal motore');
    s.line('{"type":"assistant","message":{"content":"not an array"}}');
    s.line('{"type":"user","message":null}');
    s.line('{"type":"system","subtype":"init","mcp_servers":"x"}');
    s.line('[]');
    expect(s.state).not.toBe('error');
  });

  it('reports a crash as state error with the stderr reason', async () => {
    const { s, sink } = start();
    s.send('crash now');
    await waitFor(() => sink.exited, 'exit');
    expect(s.state).toBe('error');
    expect(sink.exited?.code).toBe(3);
    expect(sink.exited?.error).toContain('fatal: fake crash for tests');
    expect(() => s.send('again')).toThrow(/non è attiva/);
    await expect(s.interrupt()).resolves.toBeUndefined();
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

  it('counts the lines of an edit from the CLI structured patch', async () => {
    const { s, sink, cwd } = start();
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'a\nb\nc');
    s.send('edit it');
    await resultOf(sink);
    const edit = [...sink.items.values()].find(i => i.kind === 'tool' && i.name === 'Edit');
    expect(edit).toMatchObject({ summary: 'Edit: a.txt', status: 'ok' });
    expect(edit?.kind === 'tool' && edit.diff?.[0]).toMatchObject({ path: 'a.txt', added: 2, removed: 1 });
  });

  it('sends the control requests and applies their effects', async () => {
    const { s, sink } = start();
    await waitFor(() => s.state === 'idle', 'idle');
    await s.setModel('sonnet');
    await s.setPermissionMode('acceptEdits');
    await s.setEffort('low');
    await s.rename('Nuovo titolo');
    expect(await s.contextUsage()).toEqual({ totalTokens: 1234, maxTokens: 200000, percentage: 0.617 });
    expect(sink.patch).toMatchObject({ model: 'sonnet', permissionMode: 'acceptEdits', effort: 'low' });
    await s.close();
    expect(s.state).toBe('closed');
    expect(sink.exited).toEqual({ code: 0, error: null });
    await expect(s.setModel('x')).rejects.toThrow(/non è attiva/);
  });

  // finding 1: a queued turn must keep the chat running between the two results
  for (const mode of ['session state events', 'queued_turn_count only (older CLI)']) {
    it(`stays running while queued turns remain (${mode})`, async () => {
      const env = { FAKE_CLAUDE_DELAY: '20', ...(mode.startsWith('queued') ? { FAKE_CLAUDE_NO_STATE_EVENTS: '1' } : {}) };
      const { s, sink } = start({ env });
      await waitFor(() => s.state === 'idle', 'idle');
      s.send('first');
      s.send('second'); // queued in the CLI while the first runs
      await waitFor(() => sink.trace.filter(t => t === 'result').length === 2 && s.state === 'idle', 'two results then idle');
      const first = sink.trace.indexOf('result'), second = sink.trace.lastIndexOf('result');
      expect(sink.trace.slice(first, second)).not.toContain('state:idle');
      expect(sink.trace.at(-1)).toBe('state:idle');
      expect(s.busy).toBe(false);
    });
  }

  it('goes back to running when the CLI starts a turn by itself (no session state events)', async () => {
    const { s, sink } = start({ env: { FAKE_CLAUDE_NO_STATE_EVENTS: '1', FAKE_CLAUDE_LATER_MS: '200' } });
    s.send('later');
    await waitFor(() => sink.trace.filter(t => t === 'result').length === 2 && s.state === 'idle', 'second, unsolicited turn');
    const t = sink.trace.join(' ');
    expect(t).toMatch(/result state:idle state:running result state:idle$/);
    expect([...sink.items.values()].some(i => i.kind === 'assistant' && i.text === 'Notifica elaborata')).toBe(true);
  });

  it('sends pasted images as base64 image blocks before the text; images alone are a message too', async () => {
    const logFile = path.join(tmp('log'), 'fake.jsonl');
    const { s, sink } = start({ env: { FAKE_CLAUDE_LOG: logFile } });
    const png = { mimeType: 'image/png' as const, data: PNG_1PX };
    s.send('cosa vedi?', [png, { ...png, mimeType: 'image/png' }]);
    await waitFor(() => sink.last('result'), 'result');
    await waitFor(() => s.state === 'idle' || undefined, 'idle');
    s.send('', [png]);
    await waitFor(() => fakeLog(logFile).filter(l => l.blocks).length === 2 || undefined, 'second message');
    const blocks = fakeLog(logFile).flatMap(l => (l.blocks ? [l.blocks] : []));
    const img = `image:base64:image/png:${PNG_1PX.length}`;
    expect(blocks).toEqual([[img, img, 'text'], [img]]);
  });

  it('sets CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS and follows session_state_changed', async () => {
    const logFile = path.join(tmp('log'), 'fake.jsonl');
    const { s, sink } = start({ env: { FAKE_CLAUDE_LOG: logFile } });
    s.send('hello');
    await waitFor(() => fakeLog(logFile)[0], 'start line');
    expect(fakeLog(logFile)[0]?.stateEventsEnv).toBe('1');
    await waitFor(() => sink.last('result'), 'result');
    // with state events the result alone does not end the turn: the CLI's idle does
    await waitFor(() => s.state === 'idle', 'idle from session_state_changed');
    const t = sink.trace;
    expect(t.lastIndexOf('state:idle')).toBeGreaterThan(t.indexOf('result'));
  });

  // finding 3 + B: no "always" when the CLI forbids it; otherwise say exactly what "always" grants
  it('honours suppress_always_allow_rule and lists what "always" grants', async () => {
    const { s, sink } = start();
    s.send('locked');
    const p = await waitFor(() => sink.pendings[0], 'locked permission');
    expect(p).toMatchObject({ tool: 'Bash', noAlways: true });
    expect(p.alwaysRules).toBeUndefined();
    s.answer(p.id, { kind: 'permission', allow: true, always: true });
    await waitFor(() => sink.last('result'), 'result');
    expect(sink.last('tool')?.output).not.toContain('updatedPermissions');

    const two = start();
    two.s.send('bash');
    const q = await waitFor(() => two.sink.pendings[0], 'bash permission');
    expect(q.alwaysRules).toEqual(['Bash(npm test)']);
    expect(q.noAlways).toBeUndefined();
  });

  // finding 6: prompts inherited by a resume arrive on the initialize envelope
  it('shows a prompt inherited at initialize (pending_permission_requests on the envelope)', async () => {
    const { s, sink } = start({ env: { FAKE_CLAUDE_INHERITED: '1' } });
    const p = await waitFor(() => sink.pendings[0], 'inherited prompt');
    expect(p).toMatchObject({ id: 'req_inherited', tool: 'Bash', title: 'Bash: ls' });
    expect(s.state).toBe('waiting');
    s.answer(p.id, { kind: 'permission', allow: true });
    await waitFor(() => sink.last('assistant')?.text === 'inherited: allow', 'the CLI got the answer');
  });

  // finding 7: a fork never names the original session before init
  it('a fork sends no session id before init and renames only its own new session', async () => {
    const logFile = path.join(tmp('log'), 'fake.jsonl');
    const orig = '99999999-8888-4777-8666-555555555555';
    const { s, sink } = start({ sessionId: orig, resume: true, fork: true, env: { FAKE_CLAUDE_LOG: logFile } });
    expect(s.sessionId).toBeNull();
    await s.rename('Il mio fork'); // deferred: the new id is not known yet
    expect(fakeLog(logFile).some(l => l.control === 'rename_session')).toBe(false);
    s.send('hello');
    await waitFor(() => fakeLog(logFile).find(l => l.control === 'rename_session'), 'deferred rename');
    const newId = s.sessionId;
    expect(newId).not.toBe(orig);
    expect(sink.patch.sessionId).toBe(newId);
    expect(fakeLog(logFile).find(l => l.control === 'rename_session')?.request).toMatchObject({ title: 'Il mio fork', session_id: newId });
    expect(fakeLog(logFile).find(l => l.user !== undefined)?.user).toBe('');
  });

  it('forwards rate_limit_event and answers get_usage', async () => {
    const { s, sink } = start();
    const seen: unknown[] = [];
    sink.rateLimit = msg => { seen.push(msg); };
    s.send('hello');
    await waitFor(() => sink.last('result'), 'result');
    expect(seen[0]).toMatchObject({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.25 } });
    expect(await s.usage()).toMatchObject({ rate_limits: { five_hour: { utilization: 25 } } });
  });

  // finding C: an error result reporting total 0 must not reset the cost base
  it('ignores the cost total of an error result below the base', async () => {
    const { s, sink } = start({ costBaseUsd: 0.5 });
    s.send('expired');
    const r = await waitFor(() => sink.last('result'), 'error result');
    expect(r).toMatchObject({ isError: true, costUsd: 0 });
    expect(sink.patch.totalCostUsd).toBe(0.5);
    expect(sink.last('system')?.text).toContain('/login');
  });

  // the user, 2026-10-11: work chats stayed at 0 $ for hours because the cost came only with the result
  it('reports a live cost from the usage of assistant messages, the real one from get_usage, then the result', async () => {
    const { s, sink } = start();
    s.send('meter');
    // m1 counted once (two blocks, output 10 → 20) + the subagent's response, at the Opus 5.5 list price (no brain
    // table in this test): 2 × (100 × 4 + 1000 × 0.2 + 20 × 20) / 1e6
    await waitFor(() => (sink.patch.liveCostUsd ?? 0) > 0.0015, 'live estimate');
    expect(sink.patch.liveCostUsd).toBeCloseTo(0.002, 9);
    expect(sink.last('result')).toBeUndefined();
    await s.usage(); // the CLI's tracker says 0.05 spent mid-turn: the real figure replaces the estimate
    expect(sink.patch.liveCostUsd).toBeCloseTo(0.05, 9);
    const r = await resultOf(sink);
    expect(r).toMatchObject({ costUsd: 0.01 });
    expect(sink.patch).toMatchObject({ liveCostUsd: 0, turnCostUsd: expect.closeTo(0.01, 9), totalCostUsd: 0.01 });
    // a get_usage answer after the result changes nothing: the turn is settled
    await s.usage();
    expect(sink.patch.liveCostUsd).toBe(0);
  });

  it('an engine that exited while a leftover holds its pipes closes without a kill; a killed one gets no grace', async () => {
    const log = path.join(tmp('hold'), 'log.jsonl');
    const { s } = start({ env: { FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_HOLD_PIPES: '60000' } });
    const holder = await waitFor(() => (fakeLog(log).find(l => 'holder' in l) as { holder?: number } | undefined)?.holder, 'holder pid');
    await waitFor(() => s.state === 'idle', 'idle');
    const t0 = Date.now();
    await s.close(1500);
    expect(Date.now() - t0).toBeLessThan(10000);
    expect(s.alive).toBe(false);
    expect(fakeLog(log).some(l => (l as { exit?: string }).exit === 'stdin closed')).toBe(true);
    killStray(holder);
    const b = start();
    await waitFor(() => b.s.state === 'idle', 'idle b');
    b.s.killNow();
    await b.s.close(60000); // already killed: resolves with the kill, not after the grace
    expect(b.s.alive).toBe(false);
  }, 30000);
});
