// The files a run's turns changed (ADR 0130, ADR 0279): the first message of a chat that starts its engine takes its own
// checkpoint although the booting engine counts as busy, and a follow-up turn under the same checkpoint (a message
// queued mid-turn takes none) still knows its files: what changed since the previous turn's end. git is mocked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type * as Checkpoints from '../../../src/main/chats/checkpoints';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';

const git = { snapshots: 0, trees: 0, fail: false };
vi.mock('../../../src/main/chats/checkpoints', async orig => {
  const real = await orig<typeof Checkpoints>();
  return { ...real,
    snapshot: async (cwd: string) => ({ commit: `c${++git.snapshots}`, at: Date.now(), root: cwd }),
    afterTree: async () => git.fail ? null : `t${++git.trees}`,
    turnFiles: async () => ['src/first.ts'],
    treeFiles: async (_root: string, from: string, to: string) => [`src/${from}-${to}.ts`],
    prune: async () => {} };
});

const { ChatManager } = await import('../../../src/main/chats/manager');
const { plainOwner } = await import('../../../src/main/agents/catalog');
const roots: string[] = [], managers: InstanceType<typeof ChatManager>[] = [];
afterEach(async () => { git.snapshots = 0; git.trees = 0; git.fail = false; for (const m of managers.splice(0)) await m.shutdown(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-receipt-files-'));
  roots.push(dir);
  let sink!: SessionSink, state = 'starting';
  const sent: string[] = [];
  const m = new ChatManager({ userData: dir, emitter: { emit() {} }, coldEveryMs: 0, runEveryMs: 0, checkpoints: () => true, env: { CLAUDE_CONFIG_DIR: path.join(dir, 'home') }, sessionFactory: (_h, _o, s) => {
    sink = s;
    // as the real engines: busy while it boots, and it stays «starting» until its first event
    return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, get busy() { return state !== 'idle'; },
      start() {}, send(text: string) { sent.push(text); },
      close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } });
  managers.push(m);
  const set = (st: 'running' | 'idle') => { state = st; sink.changed({ state: st }); };
  let n = 0;
  const command = (cmd: string) => sink.item({ kind: 'tool', id: `t${++n}`, at: Date.now(), name: 'Bash', input: { command: cmd }, status: 'ok', exitCode: 0 } as never, false);
  const result = () => sink.item({ kind: 'result', id: `r${++n}`, at: Date.now(), costUsd: 0, durationMs: 1, turns: 1, isError: false } as never, false);
  const create = () => m.create({ harness: 'claude', cwd: dir, prompt: 'Sistema lo sconto' }, 'user',
    { owner: { ...plainOwner('claude', null), source: 'catalog', id: 'artisan', version: 1 }, instructions: 'Sei un artigiano.', policy: null });
  const receipts = (id: string) => m.list().find(c => c.id === id)?.run?.receipts;
  // the reads are promises only (git is mocked): waited for by what the receipts must show, never by a sleep
  const shows = (id: string, want: object) => vi.waitFor(() => expect(receipts(id)).toMatchObject(want));
  return { m, sent, set, command, result, create, receipts, shows };
}

describe('receipts: the files of a run\'s turns', () => {
  it('the first message of a chat that starts its engine takes its own checkpoint, and its files are known', async () => {
    const f = fixture();
    const c = await f.create();
    expect(f.sent).toHaveLength(1);
    expect(git.snapshots).toBe(1);
    f.set('running');
    f.command('npm install');
    f.result();
    f.set('idle');
    await f.shows(c.id, { filesKnown: true, filesGap: false, files: ['src/first.ts'] });
  });

  it('a second message while the engine still boots joins the turn in flight: one checkpoint', async () => {
    const f = fixture();
    const c = await f.create();
    await f.m.send(c.id, 'e aggiorna il changelog');
    expect(git.snapshots).toBe(1);
  });

  it('a follow-up turn under the same checkpoint knows its files: what changed since the previous turn ended', async () => {
    const f = fixture();
    const c = await f.create();
    f.set('running');
    await f.m.send(c.id, 'anche i test');          // mid-turn: queued, no checkpoint of its own
    expect(git.snapshots).toBe(1);
    f.command('npm install');
    f.result();                                    // the first turn ends, the queued one starts at once
    f.command('npm run build');
    f.result();
    f.set('idle');
    await f.shows(c.id, { filesKnown: true, filesGap: false, files: ['src/first.ts', 'src/t1-t2.ts'] });
  });

  it('a turn the engine starts by itself after an idle gap does not take what changed meanwhile as its own', async () => {
    const f = fixture();
    const c = await f.create();
    f.set('running');
    f.command('npm install');
    f.result();
    f.set('idle');
    await f.shows(c.id, { files: ['src/first.ts'] });
    f.set('running');                              // no message of ours: no checkpoint, and not the moment the last turn ended
    f.command('npm run build');
    f.result();
    f.set('idle');
    await f.shows(c.id, { filesGap: true });       // a command that may write, files not read from git: a gap, as before
    expect(f.receipts(c.id)!.files).toEqual(['src/first.ts']);
    expect(git.trees).toBe(1);                     // only the first turn's end was read from git
  });

  it('a follow-up turn whose files git cannot read is a gap when a command may have written, as before', async () => {
    const f = fixture();
    const c = await f.create();
    f.set('running');
    await f.m.send(c.id, 'anche i test');
    f.command('npm install');
    f.result();
    await f.shows(c.id, { files: ['src/first.ts'] });
    git.fail = true;
    f.command('npm run build');
    f.result();
    f.set('idle');
    await f.shows(c.id, { filesKnown: true, filesGap: true });
    expect(f.receipts(c.id)!.files).toEqual(['src/first.ts']);
  });
});
