// AcpSession against the fake ACP agent (test/fixtures/fake-cursor-acp.mjs), run as Cursor: engine resolution and the
// test guard, streaming, permissions (allow once / always / reject, no "always"), cursor/ask_question (free text as the
// skip reason), cursor/create_plan, cancel, queued prompts, login missing, resume with session/load, model and mode, MCP,
// diffs, usage → cost. Then the same fake run as another ACP engine (Kimi): its own harness, argv, texts, and none of
// Cursor's options unless given (ADR 0046). No real engine ever runs here.
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cliArgv, engineAllowed, newestCursorVersion, resolveAcp, resolveCursor } from '../../../src/main/chats/cli';
import { AcpSession, acpExitCode, authHelp, isNetError, type AcpOptions } from '../../../src/main/chats/acp';
import { costOf, priceOf } from '../../../src/main/chats/cursor-prices';
import { engineStatus, openLogin } from '../../../src/main/cli';
import { FAKE_CURSOR, cursorLog, recSink, tmp } from './helpers';

/** The Cursor entry's options, as engines/sessions.ts passes them. */
const CURSOR = {
  engineId: 'cursor', label: 'Cursor', args: ['acp'], modelFlag: '--model', acpCommand: 'agent', loginCommand: 'agent login',
  subagentHooks: true, priceFallback: true,
} satisfies Partial<AcpOptions>;
/** Another ACP engine: only its identity and start shape, none of Cursor's options. */
const KIMI = { engineId: 'kimi', label: 'Kimi', args: ['acp'], acpCommand: 'kimi' } satisfies Partial<AcpOptions>;

describe('acpExitCode (the run receipts, ADR 0130)', () => {
  it('reads an exit code only when the rawOutput carries one; a status is never one', () => {
    expect(acpExitCode({ exitCode: 0, stdout: 'ok' })).toEqual({ exitCode: 0 });
    expect(acpExitCode({ exit_code: 3 })).toEqual({ exitCode: 3 });
    expect(acpExitCode({ exitStatus: { exitCode: 1, signal: null } })).toEqual({ exitCode: 1 });
    expect(acpExitCode({ output: 'done' })).toEqual({});
    expect(acpExitCode('plain text')).toEqual({});
    expect(acpExitCode({ exitCode: -1 })).toEqual({});
  });
});

const open: AcpSession[] = [];
const logs: string[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map(s => s.close(500)));
  // in every test: session/set_model writes the user's global Cursor config, the app must never send it;
  // authenticate would open a browser login from a hidden process
  for (const f of logs.splice(0)) for (const l of cursorLog(f)) expect(['session/set_model', 'authenticate']).not.toContain(l.method);
});

describe('authHelp', () => {
  it('names the login command, or the key in Settings when the engine has none', () => {
    expect(authHelp('Kimi', 'kimi login')).toContain('`kimi login`');
    expect(authHelp('Kimi', null)).toContain('Impostazioni → Motori');
  });
});

describe('Cursor engine resolution', () => {
  it('starts the newest CLI version with its own node.exe (no PowerShell launcher)', () => {
    const local = tmp('local');
    const v = path.join(local, 'cursor-agent', 'versions');
    const mk = (name: string, files = ['node.exe', 'index.js']) => { fs.mkdirSync(path.join(v, name), { recursive: true }); for (const f of files) fs.writeFileSync(path.join(v, name, f), ''); };
    mk('2026.07.16-899851b');
    mk('2026.07.23-e383d2b');
    mk('2026.07.23-10-11-12-abc123'); // same day, later build (timestamp form)
    mk('2026.08.01-deadbee', ['index.js']); // no node.exe: incomplete install
    mk('not-a-version');
    fs.writeFileSync(path.join(v, `${crypto.randomUUID()}.zip`), ''); // a stray download next to the versions
    expect(newestCursorVersion(v)).toBe(path.join(v, '2026.07.23-10-11-12-abc123'));
    const c = resolveCursor(null, { LOCALAPPDATA: local }, 'win32');
    expect(c).toMatchObject({ kind: 'node', command: path.join(v, '2026.07.23-10-11-12-abc123', 'node.exe'), prefix: [path.join(v, '2026.07.23-10-11-12-abc123', 'index.js')] });
    expect(c?.env).toMatchObject({ CURSOR_INVOKED_AS: 'agent.cmd', NODE_COMPILE_CACHE: path.join(local, 'cursor-compile-cache') });
    expect(cliArgv(c!, ['--model', 'gpt-5', 'acp']).args).toEqual([path.join(v, '2026.07.23-10-11-12-abc123', 'index.js'), '--model', 'gpt-5', 'acp']);
  });

  it('macOS and Linux: the newest version under ~/.local/share/cursor-agent with its own node (ADR 0054)', () => {
    const home = tmp('home');
    const v = path.join(home, '.local', 'share', 'cursor-agent', 'versions', '2026.07.23-e383d2b');
    fs.mkdirSync(v, { recursive: true });
    for (const f of ['node', 'index.js']) fs.writeFileSync(path.join(v, f), '');
    const c = resolveCursor(null, {}, 'linux', home);
    expect(c).toMatchObject({ kind: 'node', command: path.join(v, 'node'), prefix: [path.join(v, 'index.js')] });
    expect(c?.env).toMatchObject({ CURSOR_INVOKED_AS: 'cursor-agent' });
  });

  it('falls back to agent.cmd through cmd.exe with safe arguments only', () => {
    const c = resolveCursor('C:\\Tools\\agent.cmd', {});
    expect(c?.kind).toBe('cmd');
    expect(cliArgv(c!, ['--model', 'claude-opus-4-8[effort=high]', 'acp'])).toMatchObject({ verbatim: true, args: ['/d', '/s', '/c', '""C:\\Tools\\agent.cmd" --model claude-opus-4-8[effort=high] acp"'] });
    expect(() => cliArgv(c!, ['--model', 'x & calc', 'acp'])).toThrow(/non sicuro/);
  });

  it('never starts the real Cursor engine under tests', async () => {
    const real = { kind: 'node' as const, command: 'C:\\x\\node.exe', prefix: ['C:\\x\\index.js'], env: {}, verbatim: false, display: 'C:\\x' };
    expect(engineAllowed(real, { VITEST: 'true' })).toBe(false);
    expect(engineAllowed(real, { SB_TEST: '1' })).toBe(false);
    expect(engineAllowed(real, {})).toBe(true);
    expect(engineAllowed(resolveCursor(FAKE_CURSOR, {})!, { SB_TEST: '1' })).toBe(true);
    // a script that is not a .mjs fake, or that lives in Cursor's install, is the real engine run as a script
    expect(engineAllowed(resolveCursor('C:\\x\\cursor-agent\\versions\\v\\index.js', {})!, { SB_TEST: '1' })).toBe(false);
    expect(engineAllowed(resolveCursor('C:\\x\\cursor-agent\\versions\\v\\evil.mjs', {})!, { VITEST: 'true' })).toBe(false);
    expect(engineAllowed(resolveCursor('C:\\x\\other.cjs', {})!, { VITEST: 'true' })).toBe(false);
    const sink = recSink();
    const s = new AcpSession({ ...CURSOR, chatId: 'c', cwd: tmp('cwd') }, sink, real);
    s.start();
    expect(s.state).toBe('error');
    expect(s.pid).toBeNull(); // nothing spawned
    expect(sink.exited?.error).toMatch(/Nei test il motore Cursor reale non parte mai/);
  });

  it('status and login never run the real Cursor CLI under tests', async () => {
    const prev = process.env.SB_CURSOR_PATH;
    delete process.env.SB_CURSOR_PATH;
    try {
      const st = await engineStatus('cursor'); // resolves the installed CLI if any, but does not run it
      expect(st.version).toBeNull();
      expect(() => openLogin('cursor')).toThrow(/Nei test/);
    } finally { if (prev !== undefined) process.env.SB_CURSOR_PATH = prev; }
  });
});

describe('AcpSession as Cursor', () => {
  it('tells Cursor\'s network errors from the model\'s words', () => {
    // what the CLI appends: "\n\nError: " + String(error)
    expect(isNetError('\n\nError: RetriableError: [aborted] read ECONNRESET')).toBe(true);
    expect(isNetError('Sto lavorando\n\nError: RetriableError: [aborted] read ECONNRESET\n')).toBe(true);
    expect(isNetError('Leggo.\n\nError: RetriableError: [unavailable] PING timed out')).toBe(true);
    expect(isNetError('Leggo.\n\nError: RetriableError: [unavailable]')).toBe(true);
    expect(isNetError('Leggo.\n\nError: RetriableError: Stream ended without turnEnded — connection likely dropped mid-stream')).toBe(true);
    expect(isNetError('Leggo.\n\nError: [unavailable] PING timed out')).toBe(true);
    // the model quoting the error is not one
    expect(isNetError('Nei log c\'è Error: RetriableError: [aborted] read ECONNRESET')).toBe(false);
    expect(isNetError('Ecco il log:\nError: RetriableError: [aborted] read ECONNRESET')).toBe(false);
    expect(isNetError('Riga dal log:\n\n[unavailable] PING timed out')).toBe(false);
    expect(isNetError('\n\nError: RetriableError: x\nquindi ho corretto il retry.')).toBe(false);
    expect(isNetError('\n\nError: NonRetriableError: bad request')).toBe(false);
    expect(isNetError('\n\nError: [unauthenticated] Backend rejected authentication')).toBe(false);
    expect(isNetError('')).toBe(false);
  });
});

describe('cursor prices', () => {
  it('matches Cursor model ids to list prices (read 2026-10-11)', () => {
    expect(priceOf('claude-sonnet-5.5')).toMatchObject({ input: 2, output: 10 });
    expect(priceOf('sonnet-5.5-thinking')).toMatchObject({ input: 2, output: 10 });
    expect(priceOf('gpt-5.6-sol[effort=high]')).toMatchObject({ input: 4, output: 20 });
    expect(priceOf('composer-2.5-fast')).toMatchObject({ input: 3 });
    expect(priceOf('composer-2.5')).toMatchObject({ input: 0.5 });
    expect(priceOf('auto')).toBeNull();
    expect(costOf('claude-opus-5.5', { inputTokens: 1e6, outputTokens: 1e6 })).toBe(24);
    expect(costOf('auto', { inputTokens: 10 })).toBeNull();
    expect(costOf('claude-opus-5.5', {})).toBeNull();
  });
});

// ADR 0046: the same adapter runs any ACP CLI; here the fake plays Kimi (`kimi acp`, no model flag)
describe('AcpSession as another ACP engine (Kimi)', () => {
  it('resolves its own command: SB_KIMI_PATH or the given override, a .cmd shim through cmd.exe, refused under tests unless a .mjs fake', () => {
    expect(resolveAcp('kimi', 'kimi', null, { SB_KIMI_PATH: FAKE_CURSOR })).toMatchObject({ kind: 'fake', prefix: [FAKE_CURSOR] });
    expect(resolveAcp('kimi', 'kimi', 'C:\\Tools\\kimi.cmd', {})).toMatchObject({ kind: 'cmd', display: 'C:\\Tools\\kimi.cmd' });
    const exe = resolveAcp('kimi', 'kimi', 'C:\\Tools\\kimi.exe', {});
    expect(exe).toMatchObject({ kind: 'exe', command: 'C:\\Tools\\kimi.exe' });
    expect(cliArgv(exe!, ['acp']).args).toEqual(['acp']);
    expect(engineAllowed(exe!, { VITEST: 'true' })).toBe(false);
    expect(engineAllowed(exe!, { SB_TEST: '1' })).toBe(false);
    expect(engineAllowed(resolveAcp('kimi', 'kimi', 'C:\\x\\kimi.cjs', {})!, { VITEST: 'true' })).toBe(false);
    expect(engineAllowed(resolveAcp('kimi', 'kimi', FAKE_CURSOR, {})!, { VITEST: 'true' })).toBe(true);
    expect(engineAllowed(exe!, {})).toBe(true);
    // the session refuses the real one before spawning anything, in the engine's own words
    const sink = recSink();
    const s = new AcpSession({ ...KIMI, chatId: 'c', cwd: tmp('cwd') }, sink, exe);
    s.start();
    expect(s.pid).toBeNull();
    expect(sink.exited?.error).toMatch(/^Nei test il motore Kimi reale non parte mai: serve il fake \(SB_KIMI_PATH=/);
  });

  it('a CLI that is not installed: the message names the engine and its command', () => {
    const sink = recSink();
    const s = new AcpSession({ ...KIMI, acpCommand: 'kimi-not-installed-0046', chatId: 'c', cwd: tmp('cwd') }, sink);
    s.start();
    expect(s.state).toBe('error');
    expect(sink.exited?.error).toBe('Kimi CLI non trovato: installa la CLI di Kimi (kimi-not-installed-0046) e fai login.');
  });
});
