// ADR 0228 on a real git repository: the message reaches the engine while the turn's checkpoint is still being recorded,
// the engine's first write waits for it, and «Annulla l'ultimo turno» puts back exactly the files as they were before
// the turn, also when the engine writes at once. Claude (the fake CLI and its PreToolUse hooks) is gated; an engine that
// cannot hold its tools (Codex, ACP: a fake session without holdWrites) still waits for the snapshot before send. The
// snapshot is slowed by a gate in front of the real one: a write that slipped through would land in the checkpoint.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type * as Checkpoints from '../../../src/main/chats/checkpoints';
import type { SessionSink } from '../../../src/main/chats/session';
import { FAKE, fakeLog, tmp, waitFor } from './helpers';

/** gates in front of the next snapshots, in order: a snapshot reads the tree only once its gate opens */
const gates: Promise<void>[] = [];
const snapshotsDone: number[] = [];
vi.mock('../../../src/main/chats/checkpoints', async orig => {
  const real = await orig<typeof Checkpoints>();
  return { ...real, snapshot: async (cwd: string, ref: string) => {
    const g = gates.shift();
    if (g) await g;
    const cp = await real.snapshot(cwd, ref);
    snapshotsDone.push(Date.now());
    return cp;
  } };
});
const { ChatManager } = await import('../../../src/main/chats/manager');
type Manager = InstanceType<typeof ChatManager>;

const managers: Manager[] = [];
afterEach(async () => { gates.length = 0; snapshotsDone.length = 0; await Promise.all(managers.splice(0).map(m => m.shutdown())); });

const ORIGINAL = 'export const a = 1;\n';
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@localhost', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@localhost' } });
function repo(): string {
  const d = fs.realpathSync.native(tmp('cpb-repo'));
  git(d, 'init', '-q', '-b', 'main');
  git(d, 'config', 'core.autocrlf', 'false');                    // the undo checks out the file byte for byte
  fs.mkdirSync(path.join(d, 'src'));
  fs.writeFileSync(path.join(d, 'src', 'a.ts'), ORIGINAL);
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'init');
  return d;
}
function gate(): { open: () => void } {
  let open!: () => void;
  gates.push(new Promise<void>(resolve => { open = resolve; }));
  return { open };
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** A Claude engine never reports its sub-agents as complete (coverage stays 'partial'), so the undo refuses while it
 *  is open; these tests are about what the checkpoint holds, so they mark the chat's sub-agents as seen and settled. */
function settleChildren(m: Manager, id: string): void {
  const r = (m as unknown as { chats: Map<string, { children?: { coverage(v: string): boolean; snapshot(): unknown }; s: { agentChildren?: unknown } }> }).chats.get(id)!;
  r.children!.coverage('complete');
  r.s.agentChildren = r.children!.snapshot();
}
const assistantTexts = (m: Manager, id: string) => m.items(id).filter(i => i.kind === 'assistant' && !i.streaming).map(i => (i as { text: string }).text);

/** A Claude chat on the fake CLI in a fresh repository, its engine warm (the write barrier needs the initialize reply). */
async function claudeChat(extra: { checkpointDeadlineMs?: number } = {}) {
  const cwd = repo(), userData = tmp('cpb-ud'), home = tmp('cpb-home'), log = path.join(userData, 'fake.jsonl');
  // a loaded machine (the whole suite in parallel) can take longer than the real 45 s deadline: only the deadline tests
  // lower it, the others must never give a snapshot up
  const m = new ChatManager({ emitter: { emit() {} }, userData, enginePaths: { claude: FAKE }, claudeHome: home, env: { CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_DELAY: '0' }, coldEveryMs: 0, checkpoints: () => true, checkpointDeadlineMs: 110_000, ...extra });
  managers.push(m);
  const c = await m.create({ harness: 'claude', cwd, prompt: 'ciao' });
  await waitFor(() => assistantTexts(m, c.id).includes('Ciao dal motore') && m.list().find(x => x.id === c.id)?.state === 'idle', 'warm engine');
  return { m, id: c.id, cwd, log };
}

describe('parallel checkpoint and the write barrier (ADR 0228)', () => {
  it('Claude: the message goes before the snapshot, the write waits for it, the undo is exact', async () => {
    const { m, id, cwd, log } = await claudeChat();
    const g = gate();
    const usersBefore = fakeLog(log).filter(l => l.user !== undefined).length;
    await m.send(id, 'scrivifile src/a.ts CAMBIATO');                 // resolves with the snapshot still held
    await waitFor(() => fakeLog(log).filter(l => l.user !== undefined).length === usersBefore + 1, 'message reached the engine');
    await waitFor(() => m.items(id).some(i => i.kind === 'tool' && i.name === 'Write'), 'the engine asked to write at once');
    await sleep(200);
    expect(fs.readFileSync(path.join(cwd, 'src', 'a.ts'), 'utf8')).toBe(ORIGINAL); // held behind the snapshot
    expect(fakeLog(log).some(l => (l as { wrote?: string }).wrote)).toBe(false);
    const opened = Date.now();
    g.open();
    await waitFor(() => assistantTexts(m, id).includes('Scritto.') && m.list().find(x => x.id === id)?.state === 'idle', 'turn end');
    const wrote = fakeLog(log).find(l => (l as { wrote?: string }).wrote)!;
    expect(wrote.at!).toBeGreaterThanOrEqual(snapshotsDone.at(-1)!);     // the write came after the snapshot was in
    expect(snapshotsDone.at(-1)!).toBeGreaterThanOrEqual(opened);
    expect(fs.readFileSync(path.join(cwd, 'src', 'a.ts'), 'utf8')).toBe('CAMBIATO');
    settleChildren(m, id);
    await expect(m.undoTurn(id)).resolves.toEqual({ restored: 1, removed: 0 });
    expect(fs.readFileSync(path.join(cwd, 'src', 'a.ts'), 'utf8')).toBe(ORIGINAL);
  });

  it('Claude race: a new file written at once is removed by the undo; a turn with no write that ends before its snapshot keeps the order', async () => {
    const { m, id, cwd } = await claudeChat();
    const slow = gate();
    await m.send(id, 'ciao di nuovo');                               // no tool: ends before its snapshot lands
    await waitFor(() => assistantTexts(m, id).filter(t => t === 'Ciao dal motore').length === 2 && m.list().find(x => x.id === id)?.state === 'idle', 'quiet turn end');
    const next = gate();
    await m.send(id, 'scrivifile src/nuovo.ts creato');             // its snapshot waits behind the first one
    await waitFor(() => m.items(id).some(i => i.kind === 'tool' && i.name === 'Write'), 'write asked');
    await sleep(100);
    expect(fs.existsSync(path.join(cwd, 'src', 'nuovo.ts'))).toBe(false);
    next.open();                                                     // the second snapshot still waits for the first
    await sleep(100);
    expect(fs.existsSync(path.join(cwd, 'src', 'nuovo.ts'))).toBe(false);
    slow.open();
    await waitFor(() => assistantTexts(m, id).includes('Scritto.') && m.list().find(x => x.id === id)?.state === 'idle', 'write turn end');
    expect(fs.readFileSync(path.join(cwd, 'src', 'nuovo.ts'), 'utf8')).toBe('creato');
    settleChildren(m, id);
    await expect(m.undoTurn(id)).resolves.toEqual({ restored: 0, removed: 1 });
    expect(fs.existsSync(path.join(cwd, 'src', 'nuovo.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(cwd, 'src', 'a.ts'), 'utf8')).toBe(ORIGINAL);
    expect(git(cwd, 'status', '--porcelain')).toBe('');
  });

  it('Claude: two quiet turns ending while the first snapshot is held each record their end, so the undo leaves a later edit alone', async () => {
    const { m, id, cwd } = await claudeChat();
    const done = snapshotsDone.length;
    const slow = gate();
    await m.send(id, 'ciao di nuovo');
    await waitFor(() => assistantTexts(m, id).filter(t => t === 'Ciao dal motore').length === 2 && m.list().find(x => x.id === id)?.state === 'idle', 'first quiet turn end');
    await m.send(id, 'ciao ancora');                                 // its snapshot waits behind the held one
    await waitFor(() => assistantTexts(m, id).filter(t => t === 'Ciao dal motore').length === 3 && m.list().find(x => x.id === id)?.state === 'idle', 'second quiet turn end');
    slow.open();
    await waitFor(() => snapshotsDone.length === done + 2, 'both snapshots in');
    // both turn ends recorded after their snapshots (git reads the tree: slow under load)
    await waitFor(() => (m as unknown as { chats: Map<string, { afterPending?: unknown }> }).chats.get(id)!.afterPending === undefined, 'turn ends recorded');
    fs.writeFileSync(path.join(cwd, 'src', 'a.ts'), 'A MANO');       // the user's edit after the last turn ended
    settleChildren(m, id);
    await expect(m.undoTurn(id)).resolves.toEqual({ restored: 0, removed: 0 });
    expect(fs.readFileSync(path.join(cwd, 'src', 'a.ts'), 'utf8')).toBe('A MANO');
  });

  it('an engine that cannot hold its tools (Codex, ACP) still gets the message only after the snapshot', async () => {
    const cwd = repo(), sent: number[] = [];
    const m = new ChatManager({ userData: tmp('cpb-ud'), emitter: { emit() {} }, coldEveryMs: 0, checkpoints: () => true, sessionFactory: (_h, _o, s: SessionSink) => ({
      harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { s.changed({ state: 'idle' }); },
      send() {                                                         // writes at once, as Codex's sandbox lets it
        sent.push(Date.now());
        s.changed({ state: 'running' });
        fs.writeFileSync(path.join(cwd, 'src', 'a.ts'), 'SUBITO');
        s.item({ kind: 'result', id: `r${sent.length}`, at: Date.now(), costUsd: 0, durationMs: 1, turns: 1, isError: false }, false);
        s.changed({ state: 'idle' });
      },
      close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    }) as never });
    managers.push(m);
    const c = await m.create({ harness: 'claude', cwd });
    const g = gate();
    const sending = m.send(c.id, 'cambia a.ts');
    await sleep(150);
    expect(sent).toEqual([]);                                         // held before send: nothing could stop its write
    expect(fs.readFileSync(path.join(cwd, 'src', 'a.ts'), 'utf8')).toBe(ORIGINAL);
    g.open();
    await sending;
    expect(sent[0]!).toBeGreaterThanOrEqual(snapshotsDone[0]!);
    await waitFor(() => m.list().find(x => x.id === c.id)?.state === 'idle', 'idle');
    settleChildren(m, c.id);
    await m.undoTurn(c.id);
    expect(fs.readFileSync(path.join(cwd, 'src', 'a.ts'), 'utf8')).toBe(ORIGINAL);
  });
});
