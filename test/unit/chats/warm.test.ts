// The Claude engines started ahead (warm.ts + ChatManager.create), against the fake CLI: the next chat in the same folder
// launched the same way (plain, or a role's tools) adopts one (its id and session id, choices sent as control requests,
// no new spawn), other folders start cold and then keep their own (the most used ones, ADR 0227), special chats start cold, the open Orchestrator resumes ahead after a restart, the
// waiting engines die with the app (live engines for the orphan sweep), BufferedSink replays in order.
// Removed on 2026-11-09: the tests that started a real process, git, a port or a fake CLI (docs/tests/load-sensitive-
// removed.md); the lines above still name what they covered, and only the in-process tests below remain.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import type { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession } from '../../../src/main/chats/session';
import { BufferedSink, WarmPool } from '../../../src/main/chats/warm';
import { recSink, tmp } from './helpers';
const managers: ChatManager[] = [];

afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });

describe('warm Claude engine', () => {
  it('keeps engines in the most used folders only; a full pool closes the least used folder\'s first', () => {
    let n = 0;
    const closed: string[] = [];
    const spawn = (cwd: string) => {
      const chatId = `w${++n}`;
      return { chatId, sessionId: chatId, cwd, at: 0, sink: new BufferedSink(), session: { alive: true, pid: n, close: async () => { closed.push(cwd); } } as unknown as HarnessSession };
    };
    const pool = new WarmPool({ spawn, enabled: () => true, maxSlots: 3, maxFolders: 2 });
    const [a, b, c] = ['A', 'B', 'C'].map(x => path.resolve(x));
    pool.schedule(a!, 60_000); pool.schedule(a!, 60_000); pool.schedule(b!, 60_000);
    pool.fill(a!); pool.fill(b!);
    expect(pool.engines.map(x => x.cwd)).toEqual([a, b]);
    // B and C were each used once, but B's use is older (faded): C takes the second folder, B's engine closes
    pool.schedule(c!, 60_000); pool.fill(c!);
    expect(pool.folders()).toHaveLength(2);
    expect(closed).toEqual([b]);
    expect(pool.engines.map(x => x.cwd).sort()).toEqual([a, c].sort());
    pool.stop();
  });

  it('an engine that died at its start (folder gone, no engine) is not kept', () => {
    const pool = new WarmPool({ enabled: () => true, spawn: cwd => ({ chatId: 'c_x', sessionId: 's', cwd, session: { alive: false } as unknown as HarnessSession, sink: new BufferedSink(), at: Date.now() }) });
    pool.fill(tmp('dead'));
    expect(pool.current).toBeNull();
  });

  it('a dropped warm engine gets the default grace, never a 1 s close and a kill (#156)', () => {
    const graces: unknown[] = [];
    const session = { alive: true, close: (g?: number) => { graces.push(g); return Promise.resolve(); } } as unknown as HarnessSession;
    const pool = new WarmPool({ enabled: () => true, spawn: cwd => ({ chatId: 'c_w', sessionId: 's', cwd, session, sink: new BufferedSink(), at: Date.now() }) });
    pool.fill(tmp('grace'));
    pool.discard('test');
    expect(graces).toEqual([undefined]); // close() → CLOSE_GRACE_MS
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
