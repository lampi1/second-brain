// The end of a turn as the user sees it (ADR 0317): what shows a chat as working stops with the reply's last text, not
// with the CLI's result, which waits for the Stop hooks (seconds on a brain with several) and for an idle that may come
// late. Three steps, none with a clock or a process: the Claude engine fed the lines a real CLI wrote (2.1.325,
// recorded 2026-11-16: assistant, message_delta end_turn, hook_started Stop … hook_response, result, idle), the
// manager's summary, and the renderer's reading of it. A test here fails if the gap comes back: the hooks below never
// answer until the test says so, and nothing may show the chat as working in the meantime.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeSession } from '../../../src/main/chats/claude';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { showsWork, isBusy } from '../../../src/renderer/store/state';
import { stateInfo } from '../../../src/renderer/lib/format';
import { childState } from '../../../src/renderer/lib/chat-tree';
import { runHook } from '../../../src/main/rules/runtime';
import { autoCommit } from '../../../src/main/rules/maintenance';
import { recSink, type RecSink } from './helpers';

// the stop's commit is synchronous git: here only whether it is called matters, never git itself
vi.mock('../../../src/main/rules/maintenance', async actual => ({ ...(await actual<Record<string, unknown>>()), autoCommit: vi.fn() }));

type Line = Record<string, unknown>;
const stream = (event: Line): Line => ({ type: 'stream_event', parent_tool_use_id: null, event });
const sys = (subtype: string, more: Line = {}): Line => ({ type: 'system', subtype, ...more });
/** One reply of the model, as the CLI writes it: the text block, the whole message, then how the model stopped. */
const reply = (id: string, text: string, stop: string): Line[] => [
  stream({ type: 'message_start', message: { id } }),
  stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
  { type: 'assistant', parent_tool_use_id: null, message: { id, stop_reason: null, content: [{ type: 'text', text }] } },
  stream({ type: 'content_block_stop', index: 0 }),
  stream({ type: 'message_delta', delta: { stop_reason: stop } }),
  stream({ type: 'message_stop' }),
];
const result = (more: Line = {}): Line => ({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.25, duration_ms: 4200, num_turns: 1, usage: { input_tokens: 10, output_tokens: 5 }, ...more });

/** A Claude engine with no process: the test is its CLI. */
function engine(): { sink: RecSink; say: (...lines: Line[]) => void; s: ClaudeSession } {
  const sink = recSink();
  const s = new ClaudeSession({ chatId: 'c_close', cwd: '.', sessionId: 'abc12345' }, sink);
  const raw = s as unknown as { onMessage(m: Line): void };
  const say = (...lines: Line[]) => { for (const l of lines) raw.onMessage(l); };
  say(sys('session_state_changed', { state: 'running' })); // the turn began
  return { sink, say, s };
}

describe('the Claude engine says when the reply is complete', () => {
  afterEach(() => vi.useRealTimers());

  it('the reply ends: closing at once, while the Stop hooks still hold the result back', () => {
    const { sink, say, s } = engine();
    say(...reply('m1', 'Fatto.', 'end_turn'));
    expect(sink.patch.closing).toBe(true);
    expect(sink.last('assistant')).toMatchObject({ text: 'Fatto.', streaming: false });
    // the hooks run for as long as they like: no result yet, the engine is still running, and still closing
    say(sys('hook_started', { hook_id: 'h1', hook_event: 'Stop' }), sys('hook_started', { hook_id: 'h2', hook_event: 'Stop' }));
    expect(sink.last('result')).toBeUndefined();
    expect(s.state).toBe('running');
    expect(sink.patch.closing).toBe(true);
    // the result comes with its cost, and nothing reopens the indicator between it and the CLI's idle
    say(sys('hook_response', { hook_id: 'h2', hook_event: 'Stop' }), sys('hook_response', { hook_id: 'h1', hook_event: 'Stop' }), result());
    expect(sink.last('result')).toMatchObject({ costUsd: 0.25, durationMs: 4200, isError: false });
    expect(sink.patch).toMatchObject({ closing: true, turnCostUsd: 0.25 });
    expect(sink.patches.filter(p => p.closing !== undefined).map(p => p.closing)).toEqual([true]);
    say(sys('session_state_changed', { state: 'idle' }));
    expect(s.state).toBe('idle');
    expect(sink.trace).toEqual(['state:running', 'result', 'state:idle']);
  });

  it('a result with no end of reply before it (a stop, an error) closes too, until the idle or its 3 s fallback', () => {
    vi.useFakeTimers();
    const { sink, say, s } = engine();
    say(result({ subtype: 'error_during_execution', is_error: true }));
    expect(sink.patch.closing).toBe(true);
    expect(s.state).toBe('running');
    vi.advanceTimersByTime(3000); // the CLI never said idle
    expect(s.state).toBe('idle');
  });

  it('a reply that asks for a tool, or stops for a reason the CLI goes on from, is not the end', () => {
    for (const stop of ['tool_use', 'pause_turn', 'max_tokens', 'model_context_window_exceeded', 'a_reason_of_tomorrow']) {
      const { sink, say } = engine();
      say(...reply('m1', 'Guardo il file.', stop));
      expect(sink.patch.closing, stop).toBeUndefined();
    }
    for (const stop of ['end_turn', 'stop_sequence', 'refusal']) {
      const { sink, say } = engine();
      say(...reply('m1', 'Fatto.', stop));
      expect(sink.patch.closing, stop).toBe(true);
    }
  });

  it('it works again: a Stop hook sent it back, a queued turn follows, the CLI starts a turn of its own', () => {
    const blocked = engine();
    blocked.say(...reply('m1', 'Fatto.', 'end_turn'), sys('hook_started', { hook_id: 'h1', hook_event: 'Stop' }), sys('hook_response', { hook_id: 'h1', hook_event: 'Stop' }));
    blocked.say(stream({ type: 'message_start', message: { id: 'm2' } }));
    expect(blocked.sink.patch.closing).toBe(false);

    const queued = engine();
    queued.say(...reply('m1', 'Fatto.', 'end_turn'), result({ queued_turn_count: 1 }));
    expect(queued.sink.patch.closing).toBe(false);
    expect(queued.s.state).toBe('running');

    const own = engine();
    own.say(...reply('m1', 'Fatto.', 'end_turn'), result());
    expect(own.sink.patch.closing).toBe(true);
    own.say(sys('session_state_changed', { state: 'running' })); // e.g. a background agent's report
    expect(own.sink.patch.closing).toBe(false);
  });
});

describe('a product brain\'s Stop hook costs no process (ADR 0317)', () => {
  type Raw = { write(obj: unknown): void; initHooks(): Record<string, { hookCallbackIds: string[] }[]> | null; onControlRequest(m: Line): Promise<void> };
  const product = (stop: boolean) => new ClaudeSession({ chatId: 'c_stop', cwd: '.', sessionId: 'abc12345', readOnly: true,
    productHooks: { root: path.join(os.tmpdir(), 'sb-no-such-brain'), state: path.join(os.tmpdir(), 'sb-no-such-state'), launch: {}, ...(stop ? { stop: true as const } : {}) } }, recSink()) as unknown as Raw;

  it('is registered at initialize only when the launch says so (the runner keeps it for a brain that commits at the stop)', () => {
    expect(product(true).initHooks()?.Stop).toEqual([{ hookCallbackIds: ['sb_product_stop'] }]);
    expect(product(false).initHooks()?.Stop).toBeUndefined();
  });

  it('is answered at once and never sends the model back to work, even for a brain it cannot read', async () => {
    const s = product(true);
    const answers: unknown[] = [];
    s.write = obj => { answers.push(obj); };
    await s.onControlRequest({ type: 'control_request', request_id: 'req-stop', request: { subtype: 'hook_callback', callback_id: 'sb_product_stop', input: { hook_event_name: 'Stop', session_id: 's1' } } });
    expect(answers).toEqual([{ type: 'control_response', response: { subtype: 'success', request_id: 'req-stop', response: {} } }]);
  });

  it('never commits inside the app, even when the brain turns autoCommit on while the chat lives; the runner still does', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stop-brain-')), state = path.join(root, 'state');
    try {
      fs.writeFileSync(path.join(root, 'brain.json'), JSON.stringify({ machinery: 'product-v1', rules: { topicFiles: [], autoCommit: true } }));
      const s = new ClaudeSession({ chatId: 'c_stop', cwd: '.', sessionId: 'abc12345', readOnly: true, productHooks: { root, state, launch: {}, stop: true } }, recSink()) as unknown as Raw;
      s.write = () => {};
      await s.onControlRequest({ type: 'control_request', request_id: 'req-stop', request: { subtype: 'hook_callback', callback_id: 'sb_product_stop', input: { hook_event_name: 'Stop', session_id: 's1' } } });
      expect(autoCommit).not.toHaveBeenCalled();
      runHook(root, state, { hook_event_name: 'Stop', session_id: 's1' }); // as the node runner calls it
      expect(autoCommit).toHaveBeenCalledTimes(1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe('the chat stops showing work while its turn closes', () => {
  const roots: string[] = [], managers: ChatManager[] = [];
  afterEach(async () => {
    for (const m of managers.splice(0)) await m.shutdown();
    for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('turnClosing follows the engine with the state still running, and goes with the turn', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-closing-')); roots.push(dir);
    let sink!: SessionSink;
    const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, sessionFactory: (_h, _o, s) => {
      sink = s;
      return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
        start() { s.changed({ state: 'idle' }); }, send() { s.changed({ state: 'running' }); },
        close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
        rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    } });
    managers.push(m);
    const c = await m.create({ harness: 'claude', cwd: dir, prompt: 'x' }, 'user');
    const chat = () => m.list().find(x => x.id === c.id)!;
    sink.changed({ state: 'running' });
    expect(showsWork(chat())).toBe(true);

    sink.changed({ closing: true }); // the reply is complete, the result is not there yet
    expect(chat()).toMatchObject({ state: 'running', turnClosing: true });
    expect(showsWork(chat())).toBe(false);          // no working line, no person at work
    expect(isBusy(chat())).toBe(true);              // the rules still wait for the real end
    expect(stateInfo(chat()).tone).not.toBe('run'); // nor «al lavoro»
    expect(childState(chat())).not.toBe('run');     // nor a helper at work, a pulsing pill, a running row in the tree

    sink.changed({ closing: false }); // a Stop hook sent it back to work
    expect(showsWork(chat())).toBe(true);
    expect(childState(chat())).toBe('run');

    sink.changed({ closing: true });
    sink.changed({ state: 'idle' });
    expect(chat().turnClosing).toBeUndefined();
    sink.changed({ state: 'running' }); // the next turn starts clean
    expect(showsWork(chat())).toBe(true);
    sink.changed({ state: 'idle' });
  });
});
