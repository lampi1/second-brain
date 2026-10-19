// The Claude engine started ahead for the next new chat (warm.ts + ChatManager.create), against the fake CLI: the next
// plain chat in the same folder adopts it (its id and session id, choices sent as control requests, no new spawn),
// other folders and special chats start cold, the waiting engine dies with the app (a live engine for the orphan sweep), BufferedSink replays in order.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import type { HarnessSession } from '../../../src/main/chats/session';
import { BufferedSink, WarmPool, sameDir } from '../../../src/main/chats/warm';
import { compatibleOwner } from '../../../src/main/agents/catalog';
import { FAKE, alive, fakeLog, recEmitter, recSink, tmp, waitFor } from './helpers';

interface Env { userData: string; home: string; cwd: string; argLog: string }
const managers: ChatManager[] = [];
function env(): Env {
  const e = { userData: tmp('ud'), home: tmp('home'), cwd: tmp('cwd'), argLog: '' };
  e.argLog = path.join(e.userData, 'argv.jsonl');
  return e;
}
function manager(e: Env, extra: Partial<ChatManagerOptions> = {}): ChatManager {
  const m = new ChatManager({ emitter: recEmitter(), userData: e.userData, enginePaths: { claude: FAKE }, claudeHome: e.home, env: { CLAUDE_CONFIG_DIR: e.home, FAKE_CLAUDE_LOG: e.argLog }, prewarm: true, prewarmDelayMs: 0, ...extra });
  managers.push(m);
  return m;
}
const starts = (e: Env) => fakeLog(e.argLog).filter(l => l.argv);
const controls = (e: Env, pid: number) => fakeLog(e.argLog).filter(l => l.pid === pid && l.control).map(l => l.control);
/** the waiting engine's start: the one that is not the first chat's own */
const warmStart = (e: Env, sid: string | null) => starts(e).find(l => !l.argv?.join(' ').includes(`--session-id=${sid}`))!;
const results = (m: ChatManager, id: string) => m.items(id).filter(i => i.kind === 'result');

afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });

describe('warm Claude engine', () => {
  it('the next new chat in the same folder adopts the waiting engine and sends its choices as controls', async () => {
    const e = env();
    const m = manager(e);
    const c1 = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'first' });
    await waitFor(() => starts(e).length === 2, 'the waiting engine');
    // the two processes log their start in any order: the waiting one is not c1's session
    const warm = warmStart(e, c1.sessionId);
    expect(warm.argv?.join(' ')).not.toContain('--model');
    expect(warm.argv?.join(' ')).not.toContain('--name');
    const c2 = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'second', model: 'sonnet', effort: 'high', permissionMode: 'acceptEdits', title: 'Lavoro due' });
    expect(c2.id).not.toBe(c1.id);
    // its session id is the one the waiting engine was started with
    expect(warm.argv?.join(' ')).toContain(`--session-id=${c2.sessionId}`);
    await waitFor(() => results(m, c2.id).length === 1, 'the adopted engine answers');
    expect(m.items(c2.id).some(i => i.kind === 'assistant' && i.text === 'Ciao dal motore')).toBe(true);
    await waitFor(() => controls(e, warm.pid).includes('rename_session'), 'rename');
    expect(controls(e, warm.pid)).toEqual(expect.arrayContaining(['initialize', 'set_model', 'apply_flag_settings', 'set_permission_mode', 'rename_session']));
    // the chat's model came from set_model; the user line went to the warm process
    expect(fakeLog(e.argLog).some(l => l.pid === warm.pid && l.user === c2.sessionId)).toBe(true);
    expect(m.list().find(x => x.id === c2.id)).toMatchObject({ model: 'sonnet', permissionMode: 'acceptEdits' });
    // and another one waits for the chat after it
    await waitFor(() => starts(e).length === 3, 'the next waiting engine');
  });

  it('a chat in another folder starts cold, and the waiting engine moves to that folder', async () => {
    const e = env();
    const other = tmp('cwd2');
    const m = manager(e);
    const c1 = await m.create({ harness: 'claude', cwd: e.cwd });
    await waitFor(() => starts(e).length === 2, 'the waiting engine');
    const warmPid = warmStart(e, c1.sessionId).pid;
    const c2 = await m.create({ harness: 'claude', cwd: other, prompt: 'hi' });
    const cold = await waitFor(() => starts(e).find(l => l.argv?.join(' ').includes(`--session-id=${c2.sessionId}`)), 'the cold start');
    expect(cold.cwd && sameDir(cold.cwd, other)).toBe(true);
    expect(cold.argv?.join(' ')).toContain(`--session-id=${c2.sessionId}`);
    await waitFor(() => starts(e).filter(l => sameDir(l.cwd ?? '', other)).length === 2, 'a waiting engine in the new folder');
    await waitFor(() => !alive(warmPid), 'the old waiting engine closed');
  });

  it('Orchestrators, worktrees and bypass chats never take it', async () => {
    const e = env();
    const m = manager(e);
    const c1 = await m.create({ harness: 'claude', cwd: e.cwd });
    await waitFor(() => starts(e).length === 2, 'the waiting engine');
    const warmPid = warmStart(e, c1.sessionId).pid;
    await m.create({ harness: 'claude', cwd: e.cwd, orchestrator: true });
    await m.create({ harness: 'claude', cwd: e.cwd, permissionMode: 'bypassPermissions' });
    await waitFor(() => starts(e).length === 4, 'two cold starts');
    expect(alive(warmPid)).toBe(true);
  });

  it('an agent with a tool policy never takes it: the waiting engine has no limits', async () => {
    const e = env();
    const m = manager(e);
    const c1 = await m.create({ harness: 'claude', cwd: e.cwd });
    await waitFor(() => starts(e).length === 2, 'the waiting engine');
    const warmPid = warmStart(e, c1.sessionId).pid;
    const c2 = await m.create({ harness: 'claude', cwd: e.cwd }, 'user', { owner: compatibleOwner('claude', null), instructions: '', policy: { tools: { allow: ['read'] }, ceiling: 'default' } });
    const cold = await waitFor(() => starts(e).find(l => l.argv?.join(' ').includes(`--session-id=${c2.sessionId}`) && l.pid !== warmPid), 'the cold start');
    expect(cold.argv?.some(x => x.startsWith('--tools='))).toBe(true);
    expect(alive(warmPid)).toBe(true);
  });

  it('the waiting engine dies with the app; prewarm off starts none', async () => {
    const e = env();
    const m = manager(e);
    const c1 = await m.create({ harness: 'claude', cwd: e.cwd });
    await waitFor(() => starts(e).length === 2, 'the waiting engine');
    const warmPid = warmStart(e, c1.sessionId).pid;
    // the orphan sweep (sweep.ts) counts it as a live engine: its MCP servers are not orphans
    expect(m.engines().live.map(x => x.pid)).toContain(warmPid);
    await m.shutdown();
    await waitFor(() => !alive(warmPid), 'killed at quit');

    const e2 = env();
    const m2 = manager(e2, { prewarm: false });
    await m2.create({ harness: 'claude', cwd: e2.cwd });
    await waitFor(() => starts(e2).length === 1, 'the chat itself');
    await new Promise(r => setTimeout(r, 1500));
    expect(starts(e2).length).toBe(1);
  });

  it('adopted while it still starts: the choices wait for the start-up instead of timing out', async () => {
    const e = env();
    const m = manager(e, { env: { CLAUDE_CONFIG_DIR: e.home, FAKE_CLAUDE_LOG: e.argLog, FAKE_CLAUDE_INIT_DELAY: '1500' } });
    const c1 = await m.create({ harness: 'claude', cwd: e.cwd });
    await waitFor(() => starts(e).length === 2, 'the waiting engine');
    const warm = warmStart(e, c1.sessionId);
    const c2 = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hi', model: 'sonnet' });
    expect(warm.argv?.join(' ')).toContain(`--session-id=${c2.sessionId}`);
    await waitFor(() => results(m, c2.id).length === 1, 'the answer');
    const log = fakeLog(e.argLog).filter(l => l.pid === warm.pid);
    const init = log.find(l => l.control === 'initialize')!;
    const setModel = log.find(l => l.control === 'set_model')!;
    expect(setModel.at! - init.at!).toBeGreaterThanOrEqual(1400);
    expect(starts(e).filter(l => l.argv?.join(' ').includes(`--session-id=${c2.sessionId}`))).toHaveLength(1); // no cold restart
  });

  it('an engine that died at its start (folder gone, no engine) is not kept', () => {
    const pool = new WarmPool({ enabled: () => true, spawn: cwd => ({ chatId: 'c_x', sessionId: 's', cwd, session: { alive: false } as unknown as HarnessSession, sink: new BufferedSink(), at: Date.now() }) });
    pool.fill(tmp('dead'));
    expect(pool.current).toBeNull();
  });

  it('BufferedSink replays what came before the owner, in order, then forwards', () => {
    const b = new BufferedSink();
    let orphan = 0;
    b.onOrphanExit = () => { orphan++; };
    b.changed({ state: 'idle' });
    b.changed({ version: '1' });
    b.commands([{ name: 'x', description: '' }]);
    const s = recSink();
    b.attach(s);
    expect(s.trace).toEqual(['state:idle']);
    expect(s.patch).toMatchObject({ state: 'idle', version: '1' });
    b.changed({ state: 'running' });
    expect(s.trace).toEqual(['state:idle', 'state:running']);
    b.exit({ code: 0, error: null });
    expect(s.exited).toEqual({ code: 0, error: null });
    expect(orphan).toBe(0);
    const lone = new BufferedSink();
    lone.onOrphanExit = () => { orphan++; };
    lone.exit({ code: 1, error: 'x' });
    expect(orphan).toBe(1);
  });
});
