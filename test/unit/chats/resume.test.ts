// Resume after a restart (ChatManager.resumeInterrupted) against the fake CLI: a turn cut by the quit is saved as
// "working" and resumes by itself on the next start with RESUME_TEXT and the resumedAt mark (cleared by the user's next
// message); a chat that had finished, or whose CLI crashed while the app ran, stays closed.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager, RESUME_TEXT } from '../../../src/main/chats/manager';
import { FAKE, alive, fakeLog, recEmitter, tmp, waitFor } from './helpers';

const managers: ChatManager[] = [];
function setup(userData: string, home: string, argLog: string, delayMs = 50) {
  const m = new ChatManager({ emitter: recEmitter(), userData, enginePaths: { claude: FAKE }, claudeHome: home, env: { CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: argLog, FAKE_CLAUDE_DELAY: String(delayMs) } });
  managers.push(m);
  return m;
}
const dirs = () => ({ userData: tmp('ud'), home: tmp('home'), cwd: tmp('cwd'), argLog: path.join(tmp('log'), 'args.jsonl') });
const saved = (userData: string) => (JSON.parse(fs.readFileSync(path.join(userData, 'chats.json'), 'utf8')) as { chats: { id: string; working?: boolean }[] }).chats;
const summary = (m: ChatManager, id: string) => m.list().find(c => c.id === id)!;

afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown(200))); });

describe('ChatManager resume after a restart', () => {
  it('a turn cut by the quit resumes by itself on the next start, marked until the user writes', async () => {
    const d = dirs();
    const m = setup(d.userData, d.home, d.argLog);
    const c = await m.create({ harness: 'claude', cwd: d.cwd, prompt: 'slow' }); // a 10 s turn
    await waitFor(() => summary(m, c.id).state === 'running', 'running');
    await waitFor(() => saved(d.userData)[0]?.working === true, 'saved as working while the turn runs');
    // App state becomes running before the CLI has started. A resumable session needs a persisted first turn.
    await waitFor(() => fakeLog(d.argLog).some(l => l.grandchild), 'the fake CLI persisted the slow turn');
    await m.shutdown(200);
    expect(saved(d.userData)[0]?.working).toBe(true); // the quit cut it: still working on disk

    const again = setup(d.userData, d.home, d.argLog);
    expect(summary(again, c.id).state).toBe('closed');
    expect(again.resumeInterrupted()).toBe(1);
    expect(summary(again, c.id).resumedAt).toBeGreaterThan(0);
    await waitFor(() => again.items(c.id).some(i => i.kind === 'user' && i.text === RESUME_TEXT), 'the automatic message');
    await waitFor(() => fakeLog(d.argLog).filter(l => l.argv?.some(a => a.startsWith('--resume='))).length === 1, 'the session resumed (--resume)', 30000); // the new CLI starts slowly under load
    await waitFor(() => summary(again, c.id).state === 'idle' && saved(d.userData)[0]?.working === undefined, 'the resumed turn over, no longer working');
    expect(summary(again, c.id).resumedAt).toBeGreaterThan(0); // the mark stays until the user writes
    await again.send(c.id, 'grazie');
    expect(summary(again, c.id).resumedAt).toBeUndefined();
  }, 60000);

  it('a queued turn cut by the quit resumes too (the first turn\'s result does not clear "working")', async () => {
    const d = dirs();
    const m = setup(d.userData, d.home, d.argLog);
    const c = await m.create({ harness: 'claude', cwd: d.cwd, prompt: 'stream' }); // 1.2 s
    await waitFor(() => summary(m, c.id).state === 'running', 'running');
    await m.send(c.id, 'slow'); // queued in the CLI, as app_send_to_chat does while the chat works
    await waitFor(() => m.items(c.id).filter(i => i.kind === 'result').length === 1, 'the first turn over');
    await new Promise(r => setTimeout(r, 300)); // the queued turn is running now, with no state change in between
    expect(summary(m, c.id).state).toBe('running');
    expect(saved(d.userData)[0]?.working).toBe(true);
    await m.shutdown(200);
    expect(setup(d.userData, d.home, d.argLog).resumeInterrupted()).toBe(1);
  }, 60000);

  it('a hand-off turn is no work to resume, a message queued behind it is', async () => {
    const d = dirs();
    const m = setup(d.userData, d.home, d.argLog);
    const c = await m.create({ harness: 'claude', cwd: d.cwd, prompt: 'hello' });
    await waitFor(() => summary(m, c.id).state === 'idle' && saved(d.userData)[0]?.working === undefined, 'first turn over');
    const handoff = m.handoff(c.id);
    await waitFor(() => summary(m, c.id).handoffBusy === true && summary(m, c.id).state === 'running', 'hand-off turn running');
    expect(saved(d.userData)[0]?.working).toBeUndefined();
    await m.send(c.id, 'slow'); // queued in the CLI behind the hand-off: no new "running" comes
    await handoff;
    await new Promise(r => setTimeout(r, 300));
    expect(summary(m, c.id).state).toBe('running');
    expect(saved(d.userData)[0]?.working).toBe(true);
    await m.shutdown(200);
    expect(setup(d.userData, d.home, d.argLog).resumeInterrupted()).toBe(1);
  }, 60000);

  it('a resume that fails drops the mark: the error shows alone', async () => {
    const d = dirs();
    const m = setup(d.userData, d.home, d.argLog);
    // a turn that never ends by itself: under load the kill lands seconds late, and a turn that ended meanwhile is
    // rightly not resumed (its 'idle' clears the mark)
    const c = await m.create({ harness: 'claude', cwd: d.cwd, prompt: 'slow' });
    await waitFor(() => saved(d.userData)[0]?.working === true, 'saved as working');
    await m.shutdown(200);
    // its folder is gone: the CLI cannot start. Pointed elsewhere rather than deleted: under load Windows holds the
    // folder of the process just killed for seconds (EBUSY)
    const file = path.join(d.userData, 'chats.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { chats: { cwd: string }[] };
    data.chats[0]!.cwd = path.join(d.cwd, 'gone');
    fs.writeFileSync(file, JSON.stringify(data));
    const again = setup(d.userData, d.home, d.argLog);
    expect(again.resumeInterrupted()).toBe(1);
    await waitFor(() => summary(again, c.id).state === 'error', 'the failed start');
    expect(summary(again, c.id).resumedAt).toBeUndefined();
  }, 90000); // the quit alone takes up to 15 s under load, then the folder's 30 s

  it('a chat that had finished, or whose CLI died while the app ran, is not resumed', async () => {
    const d = dirs();
    const m = setup(d.userData, d.home, d.argLog, 500); // the stream turn lasts 12 s: the kill lands mid-turn
    const done = await m.create({ harness: 'claude', cwd: d.cwd, prompt: 'hello' });
    await waitFor(() => summary(m, done.id).state === 'idle' && summary(m, done.id).lastResult, 'finished');
    const crash = await m.create({ harness: 'claude', cwd: d.cwd, prompt: 'stream' }); // 24 deltas, no child process
    await waitFor(() => summary(m, crash.id).state === 'running', 'running');
    const own = `--session-id=${summary(m, crash.id).sessionId}`;
    const pid = (await waitFor(() => fakeLog(d.argLog).find(l => l.argv?.includes(own)), 'its CLI started')).pid;
    process.kill(pid); // the CLI crashes mid-turn while the app runs: shown as an error, not resumed later
    await waitFor(() => !alive(pid) && summary(m, crash.id).state !== 'running', 'the crash seen');
    expect(m.items(crash.id).some(i => i.kind === 'result')).toBe(false); // it really died mid-turn
    await m.shutdown(200);
    expect(saved(d.userData).some(c => c.working)).toBe(false);
    expect(setup(d.userData, d.home, d.argLog).resumeInterrupted()).toBe(0);
  }, 60000);
});
