// Claude Code Remote Control of the Orchestrator (ADR 0229): the reply and bridge_state readers, the request the engine
// gets (claude.ts against the fake CLI: on, off, reattach, refusal, drift), the phone's messages shown in the chat
// (--replay-user-messages), and the manager's state: saved, paused when the engine goes, reattached by the next one,
// «Spegni» while it starts, and an engine that dies while reattaching.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INVOKE_CHANNELS } from '../../../src/shared/contract';
import { ClaudeSession } from '../../../src/main/chats/claude';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import type { StoredChat } from '../../../src/main/chats/store';
import { bridgePatch, pausedState, phoneText, readRemoteControlReply, readStoredRemote } from '../../../src/main/chats/remote-control';
import { recSink, waitFor } from './helpers';

describe('remote-control readers', () => {
  it('takes only a claude.ai session link and a plain bridge id from the reply', () => {
    expect(readRemoteControlReply({ session_url: 'https://claude.ai/code/session_01ab', bridge_session_id: 'cse_01ab' })).toEqual({ url: 'https://claude.ai/code/session_01ab', bridgeSessionId: 'cse_01ab' });
    expect(readRemoteControlReply({ session_url: 'https://claude.ai/code?environment=env_1', bridge_session_id: 'bad id!' })).toEqual({ url: 'https://claude.ai/code?environment=env_1', bridgeSessionId: null });
    expect(readRemoteControlReply({ session_url: 'https://evil.example/code/x' })).toBeNull();
    expect(readRemoteControlReply({ session_url: 'http://claude.ai/code/x' })).toBeNull();
    expect(readRemoteControlReply({})).toBeNull();
  });
  it('maps bridge_state to a status; an unknown state is drift (null)', () => {
    expect(bridgePatch('ready', undefined)).toEqual({ status: 'ready' });
    expect(bridgePatch('connected', 'x')).toEqual({ status: 'connected' });
    expect(bridgePatch('failed', 'token expired')).toEqual({ status: 'failed', error: 'token expired' });
    expect(bridgePatch('policy_disabled', undefined)?.error).toMatch(/policy/);
    expect(bridgePatch('reconnecting', undefined)).toBeNull();
  });
  it('a state without its engine is paused when on, off otherwise; only a wanted bridge is read back', () => {
    expect(pausedState({ on: true, url: 'https://claude.ai/code/s', bridgeSessionId: 'cse_1', status: 'connected' })).toEqual({ on: true, url: 'https://claude.ai/code/s', bridgeSessionId: 'cse_1', status: 'paused' });
    expect(pausedState({ on: false, url: null, bridgeSessionId: null, status: 'failed', error: 'x' })?.status).toBe('off');
    expect(pausedState(undefined)).toBeUndefined();
    expect(readStoredRemote({ on: true, url: 'https://claude.ai/code/s', bridgeSessionId: 'cse_1', status: 'ready' })).toEqual({ on: true, url: 'https://claude.ai/code/s', bridgeSessionId: 'cse_1', status: 'paused' });
    expect(readStoredRemote({ on: true, url: 'javascript:alert(1)', bridgeSessionId: '../x' })).toEqual({ on: true, url: null, bridgeSessionId: null, status: 'paused' });
    expect(readStoredRemote({ on: false })).toBeUndefined();
    expect(readStoredRemote('on')).toBeUndefined();
  });
  it('a replayed message is the phone\'s only when it is not ours, not meta and plain text', () => {
    const ours = new Set(['u-ours']);
    const msg = (p: Record<string, unknown>) => ({ type: 'user', isReplay: true, message: { role: 'user', content: 'dal bus' }, ...p });
    expect(phoneText(msg({ uuid: 'u-phone' }), ours)).toBe('dal bus');
    expect(phoneText(msg({ message: { content: [{ type: 'text', text: ' ciao ' }, { type: 'text', text: 'due' }] } }), ours)).toBe('ciao \ndue');
    expect(phoneText(msg({ uuid: 'u-ours' }), ours)).toBeNull();
    expect(phoneText(msg({ isReplay: false }), ours)).toBeNull();
    expect(phoneText(msg({ isMeta: true }), ours)).toBeNull();
    expect(phoneText(msg({ isSynthetic: true }), ours)).toBeNull();
    expect(phoneText(msg({ message: { content: '<system-reminder>x</system-reminder>' } }), ours)).toBeNull();
    expect(phoneText(msg({ message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } }), ours)).toBeNull();
  });
  it('the IPC channel is in the contract list', () => {
    expect(INVOKE_CHANNELS).toContain('chat:remoteControl');
  });
});

const open: ClaudeSession[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(s => s.close(500))); });

describe('ClaudeSession Remote Control', () => {
  it('asks the engine to echo queued messages only for a writable Remote Control chat', () => {
    const base = { chatId: 'c', cwd: '.', sessionId: 'abc12345' };
    expect(new ClaudeSession({ ...base, remoteControl: true }, recSink()).args()).toContain('--replay-user-messages');
    expect(new ClaudeSession(base, recSink()).args()).not.toContain('--replay-user-messages');
    expect(new ClaudeSession({ ...base, remoteControl: true, readOnly: true }, recSink()).args()).not.toContain('--replay-user-messages');
  });
  it('keeps our uuids only when the engine echoes them, at most 500', () => {
    const fake = (o: { remoteControl?: boolean; readOnly?: boolean }) => {
      const s = new ClaudeSession({ chatId: 'c', cwd: '.', sessionId: 'abc12345', ...o }, recSink());
      Object.assign(s as unknown as Record<string, unknown>, { proc: {}, write: () => {} });
      for (let i = 0; i < 600; i++) s.send(`m${i}`);
      return (s as unknown as { sentUuids: Set<string> }).sentUuids;
    };
    expect(fake({}).size).toBe(0);
    expect(fake({ remoteControl: true, readOnly: true }).size).toBe(0);
    expect(fake({ remoteControl: true }).size).toBe(500);
  });
  it('waits 60 s for the bridge (it registers with claude.ai first) and rejects with the timeout', async () => {
    const s = new ClaudeSession({ chatId: 'c', cwd: '.', sessionId: 'abc12345', remoteControl: true }, recSink());
    const spy = vi.spyOn(s as unknown as { control(r: unknown, ms?: number): Promise<unknown> }, 'control').mockRejectedValue(new Error('remote_control: nessuna risposta dal CLI'));
    await expect(s.setRemoteControl(true, { name: 'O', reattach: 'cse_1' })).rejects.toThrow(/nessuna risposta/);
    expect(spy).toHaveBeenCalledWith({ subtype: 'remote_control', enabled: true, name: 'O', reattach_session_id: 'cse_1' }, 60000);
  });
});

// ---- the manager: state, persistence, reattach (a recording session, no process)

interface RcCall { enabled: boolean; name?: string; reattach?: string | null }
const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const row = (p: Partial<StoredChat> & { id: string }): StoredChat => ({
  harness: 'claude', cwd: 'C:/brain', sessionId: null, title: p.id, model: null, effort: null, permissionMode: null, isOrchestrator: false, createdAt: 1, ...p,
});
function fixture(stored: StoredChat[], opts: { refuse?: (c: RcCall) => string | null; hold?: (c: RcCall) => Promise<void> | undefined; dir?: string } = {}) {
  const dir = opts.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sb-rc-'));
  if (!opts.dir) roots.push(dir);
  fs.writeFileSync(path.join(dir, 'chats.json'), JSON.stringify({ version: 2, chats: stored }));
  const calls: RcCall[] = [];
  const sinks: SessionSink[] = [];
  let n = 0;
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, sessionFactory: (_h, o, s: SessionSink) => (sinks.push(s), {
    harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false, ready: Promise.resolve(), opts: o,
    start() { s.changed({ state: 'idle' }); },
    send() {}, close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
    rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    async setRemoteControl(enabled: boolean, x: { name?: string; reattach?: string | null } = {}) {
      const call = { enabled, ...x };
      calls.push(call);
      await opts.hold?.(call);
      const refused = opts.refuse?.(call);
      if (refused) throw new Error(refused);
      if (!enabled) return null;
      const id = x.reattach ?? `cse_${++n}`;
      return { url: `https://claude.ai/code/session_${id}`, bridgeSessionId: id };
    },
  } as unknown as HarnessSession) });
  managers.push(m);
  const file = () => (JSON.parse(fs.readFileSync(path.join(dir, 'chats.json'), 'utf8')) as { chats: StoredChat[] }).chats;
  const rec = (id: string) => (m as unknown as { need(id: string): unknown }).need(id);
  const startEngine = (id: string) => (m as unknown as { ensureSession(r: unknown): Promise<void> }).ensureSession(rec(id));
  return { m, dir, calls, sinks, file, startEngine };
}
const chat = (m: ChatManager, id: string) => m.list().find(c => c.id === id);
const ORCH = row({ id: 'o1', title: 'Orchestrator', isOrchestrator: true });

describe('ChatManager Remote Control', () => {
  it('turns it on for the Orchestrator: link shown, saved as paused with its bridge', async () => {
    const f = fixture([ORCH]);
    const c = await f.m.remoteControl('o1', true);
    expect(c.remoteControl).toEqual({ on: true, url: 'https://claude.ai/code/session_cse_1', bridgeSessionId: 'cse_1', status: 'ready' });
    expect(f.calls).toEqual([{ enabled: true, name: 'Orchestrator', reattach: null }]);
    await waitFor(() => f.file().find(x => x.id === 'o1')?.remoteControl, 'saved');
    expect(f.file().find(x => x.id === 'o1')?.remoteControl).toEqual({ on: true, url: 'https://claude.ai/code/session_cse_1', bridgeSessionId: 'cse_1', status: 'paused' });
  });
  it('after a restart the next engine reattaches the same bridge by itself', async () => {
    const f = fixture([{ ...ORCH, remoteControl: { on: true, url: 'https://claude.ai/code/session_cse_9', bridgeSessionId: 'cse_9', status: 'paused' } }]);
    expect(chat(f.m, 'o1')?.remoteControl?.status).toBe('paused');
    const c = await f.m.remoteControl('o1', true);
    expect(f.calls).toEqual([{ enabled: true, name: 'Orchestrator', reattach: 'cse_9' }]);
    expect(c.remoteControl).toMatchObject({ on: true, bridgeSessionId: 'cse_9', url: 'https://claude.ai/code/session_cse_9', status: 'ready' });
  });
  it('a refused reattach makes a new bridge (a new link) instead of failing', async () => {
    const f = fixture([{ ...ORCH, remoteControl: { on: true, url: null, bridgeSessionId: 'cse_gone', status: 'paused' } }], { refuse: c => (c.reattach ? 'Remote Control initialization failed' : null) });
    const c = await f.m.remoteControl('o1', true);
    expect(f.calls.map(x => x.reattach ?? null)).toEqual(['cse_gone', null]);
    expect(c.remoteControl).toMatchObject({ on: true, bridgeSessionId: 'cse_1', status: 'ready' });
  });
  it('a refusal is shown with the engine\'s words and nothing stays on', async () => {
    const f = fixture([ORCH], { refuse: () => 'Remote Control cannot be enabled from inside a remote session' });
    const c = await f.m.remoteControl('o1', true);
    expect(c.remoteControl).toEqual({ on: false, url: null, bridgeSessionId: null, status: 'failed', error: 'Remote Control cannot be enabled from inside a remote session' });
  });
  it('off from the button: the engine is told, the state and the file forget the bridge', async () => {
    const f = fixture([ORCH]);
    await f.m.remoteControl('o1', true);
    const c = await f.m.remoteControl('o1', false);
    expect(f.calls.at(-1)).toEqual({ enabled: false });
    expect(c.remoteControl).toEqual({ on: false, url: null, bridgeSessionId: null, status: 'off' });
    await waitFor(() => !f.file().find(x => x.id === 'o1')?.remoteControl, 'forgotten');
  });
  it('a lost bridge (bridge_state failed) turns it off with the reason', async () => {
    const f = fixture([ORCH]);
    await f.m.remoteControl('o1', true);
    // what claude.ts sends on bridge_state failed
    f.sinks.at(-1)!.changed({ remote: { status: 'failed', error: 'token scaduto' } });
    expect(chat(f.m, 'o1')?.remoteControl).toEqual({ on: false, url: null, bridgeSessionId: null, status: 'failed', error: 'token scaduto' });
  });
  it('the engine going away pauses it (the next engine reattaches)', async () => {
    const f = fixture([ORCH]);
    await f.m.remoteControl('o1', true);
    f.sinks.at(-1)!.exit({ code: 1, error: 'crash' });
    expect(chat(f.m, 'o1')?.remoteControl).toEqual({ on: true, url: 'https://claude.ai/code/session_cse_1', bridgeSessionId: 'cse_1', status: 'paused' });
  });
  it('only for the Orchestrator on Claude', async () => {
    const f = fixture([ORCH, row({ id: 'w1' }), row({ id: 'o2', harness: 'cursor', isOrchestrator: true })]);
    await expect(f.m.remoteControl('w1', true)).rejects.toThrow(/solo per l’Orchestrator/);
    await expect(f.m.remoteControl('o2', true)).rejects.toThrow(/solo con Claude Code/);
    expect(f.calls).toEqual([]);
  });
  it('a reattach with no answer in time (60 s) asks once more without the id', async () => {
    const f = fixture([{ ...ORCH, remoteControl: { on: true, url: null, bridgeSessionId: 'cse_slow', status: 'paused' } }], { refuse: c => (c.reattach ? 'remote_control: nessuna risposta dal CLI' : null) });
    const c = await f.m.remoteControl('o1', true);
    expect(f.calls).toEqual([{ enabled: true, name: 'Orchestrator', reattach: 'cse_slow' }, { enabled: true, name: 'Orchestrator' }]);
    expect(c.remoteControl).toMatchObject({ on: true, bridgeSessionId: 'cse_1', status: 'ready' });
  });
  it('a double click asks the engine once', async () => {
    const f = fixture([ORCH]);
    const [a, b] = await Promise.all([f.m.remoteControl('o1', true), f.m.remoteControl('o1', true)]);
    expect(f.calls).toEqual([{ enabled: true, name: 'Orchestrator', reattach: null }]);
    expect(a.remoteControl?.status).toBe('ready');
    expect(b.remoteControl?.status).toBe('ready');
  });
  it('«Spegni» while it starts is off at once, and the late bridge is turned off', async () => {
    let release!: () => void;
    const f = fixture([ORCH], { hold: c => (c.enabled ? new Promise<void>(res => { release = res; }) : undefined) });
    const on = f.m.remoteControl('o1', true);
    await waitFor(() => f.calls.length === 1, 'asked');
    expect(chat(f.m, 'o1')?.remoteControl?.status).toBe('starting');
    const off = await f.m.remoteControl('o1', false);
    expect(off.remoteControl).toEqual({ on: false, url: null, bridgeSessionId: null, status: 'off' });
    release();
    await on;
    expect(f.calls.map(c => c.enabled)).toEqual([true, false, false]);
    expect(chat(f.m, 'o1')?.remoteControl).toEqual({ on: false, url: null, bridgeSessionId: null, status: 'off' });
  });
  it('on, «Spegni», on again while the first ask is out: it ends on, with a bridge', async () => {
    const releases: (() => void)[] = [];
    const f = fixture([ORCH], { hold: c => (c.enabled && releases.length === 0 ? new Promise<void>(res => { releases.push(res); }) : undefined) });
    const first = f.m.remoteControl('o1', true);
    await waitFor(() => f.calls.length === 1, 'asked');
    await f.m.remoteControl('o1', false);
    const again = f.m.remoteControl('o1', true);
    releases[0]!();
    await first;
    const c = await again;
    expect(f.calls.map(x => x.enabled)).toEqual([true, false, false, true]);
    expect(c.remoteControl).toMatchObject({ on: true, bridgeSessionId: 'cse_2', status: 'ready' });
  });
  it('an engine that dies while reattaching: the next engine still asks for its bridge', async () => {
    let fail!: (e: Error) => void;
    const f = fixture([{ ...ORCH, remoteControl: { on: true, url: 'https://claude.ai/code/session_cse_9', bridgeSessionId: 'cse_9', status: 'paused' } }], {
      hold: c => (c.enabled && f.calls.length === 1 ? new Promise<void>((_res, rej) => { fail = rej; }) : undefined),
    });
    const on = f.m.remoteControl('o1', true);
    await waitFor(() => f.calls.length === 1, 'engine A asked');
    // the real order (claude.ts finish): the pending ask is rejected, then the exit, in one go
    fail(new Error('La sessione è terminata.'));
    f.sinks[0]!.exit({ code: 1, error: 'crash' });
    await on;
    expect(chat(f.m, 'o1')?.remoteControl).toEqual({ on: true, url: 'https://claude.ai/code/session_cse_9', bridgeSessionId: 'cse_9', status: 'paused' });
    await f.startEngine('o1');
    expect(f.sinks).toHaveLength(2);
    await waitFor(() => chat(f.m, 'o1')?.remoteControl?.status === 'ready', 'engine B ready');
    expect(f.calls).toEqual([{ enabled: true, name: 'Orchestrator', reattach: 'cse_9' }, { enabled: true, name: 'Orchestrator', reattach: 'cse_9' }]);
    expect(chat(f.m, 'o1')?.remoteControl).toEqual({ on: true, url: 'https://claude.ai/code/session_cse_9', bridgeSessionId: 'cse_9', status: 'ready' });
  });
});
