// The user's ✕ never loses the chat (ADR 0357): after its «Annulla» the final close ends the engine and the run but the chat
// stays among the closed (closedBy user, with its history and what the ✕ cut short), recent-closed lists it, one reopen
// brings it back and its session resumes on the next message; only close() without keep removes it for good.
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { recentClosed } from '../../../src/main/appctl/tools';
import { recEmitter, tmp, waitFor } from './helpers';

const managers: ChatManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });

function fixture() {
  const dir = tmp('user-close-keep'), em = recEmitter();
  const started: SessionOptions[] = [], sinks = new Map<string, SessionSink>(), busy = new Map<string, boolean>();
  let exitMs = 0;
  const m = new ChatManager({ userData: dir, emitter: em, coldEveryMs: 0, runEveryMs: 0, claudeHome: `${dir}/cfg`, env: { CLAUDE_CONFIG_DIR: `${dir}/cfg` },
    sessionFactory: (harness, o, s) => {
      started.push(o); sinks.set(o.chatId, s);
      let closed = false;
      return { harness, sessionId: o.sessionId, pid: null, root: null, get alive() { return !closed; }, get busy() { return !!busy.get(o.chatId); },
        start() {
          // the CLI's transcript of its session: what a resume looks for
          mkdirSync(`${dir}/cfg/projects/p`, { recursive: true }); writeFileSync(`${dir}/cfg/projects/p/${o.sessionId}.jsonl`, '{}\n');
          s.childrenCoverage?.('complete'); s.changed({ state: 'idle' });
        },
        send(text: string) {
          busy.set(o.chatId, true); s.changed({ state: 'running' });
          if (/keep-busy/.test(text)) return;
          s.item({ kind: 'assistant', id: `a${Math.random()}`, at: Date.now(), text: 'Ok.' }, false);
          s.item({ kind: 'result', id: `r${Math.random()}`, at: Date.now(), isError: false, costUsd: 0, durationMs: 1, turns: 1 }, false);
          busy.set(o.chatId, false); s.changed({ state: 'idle' });
        },
        interrupt: async () => { busy.set(o.chatId, false); s.changed({ state: 'idle' }); },
        close: async () => { if (exitMs) await new Promise(r => setTimeout(r, exitMs)); closed = true; busy.set(o.chatId, false); s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); },
        killNow() {}, answer: () => true, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {},
        contextUsage: async () => null, usage: async () => null,
      } as unknown as HarnessSession;
    } });
  managers.push(m);
  return { m, dir, started, busy, setExitMs: (n: number) => { exitMs = n; }, chat: (id: string) => m.list().find(c => c.id === id) };
}

describe('the user\'s ✕ keeps the chat among the closed', () => {
  it('closes after «Annulla», lists it as closed by the user with what it cut short, and reopens it with its session', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'keep-busy: lavora' });
    await waitFor(() => f.busy.get(c.id), 'the chat at work');
    await f.m.set(c.id, { workStatus: 'assigned' });
    f.setExitMs(120); // an engine slow to exit
    await f.m.archive(c.id, { undoable: true });
    await f.m.finishClose(c.id); // the toast ran out: the final close
    const closed = f.chat(c.id)!;
    expect(closed).toMatchObject({ state: 'closed', closedBy: 'user' });
    expect(closed.closedWith).toMatch(/incarico assegnato.*turno in corso/);
    expect(recentClosed(f.m.list()).map(x => x.id)).toContain(c.id);
    expect(f.m.items(c.id).some(i => i.kind === 'user')).toBe(true); // its history stays
    // one reopen: back on the grid, nothing cut short any more, its session resumes on the next message
    const back = await f.m.reopen(c.id);
    expect(back.closedAt).toBeUndefined();
    expect(back.closedWith).toBeUndefined();
    f.setExitMs(0);
    await f.m.send(c.id, 'Riprendi.', undefined, false, 'Orchestrator');
    await waitFor(() => f.started.filter(o => o.chatId === c.id).length > 1, 'the session starts again');
    const again = f.started.filter(o => o.chatId === c.id).at(-1)!;
    expect(again.resume).toBe(true);
    expect(again.sessionId).toBe(f.started.find(o => o.chatId === c.id)!.sessionId);
  });

  it('is a no-op after an «Annulla» (reopened), and close() without keep still removes a chat for good', async () => {
    const f = fixture();
    const c = await f.m.create({ harness: 'claude', cwd: f.dir, prompt: 'ciao' });
    await waitFor(() => f.chat(c.id)?.state === 'idle', 'idle');
    await f.m.archive(c.id, { undoable: true });
    await f.m.reopen(c.id); // «Annulla»
    await f.m.finishClose(c.id);
    expect(f.chat(c.id)?.closedAt).toBeUndefined();
    await f.m.archive(c.id, { undoable: true });
    await f.m.close(c.id); // the explicit removal
    expect(f.chat(c.id)).toBeUndefined();
  });
});
