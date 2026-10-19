// Auto-close in the chat manager against the fake CLI: the last result and the background tasks on the summary, archive
// (process ends, record kept, persisted), reopen, a message reopens it by itself, the Orchestrator never closes, the auto
// archive is refused while the chat works, runs background tasks (a resumed agent too) or its last answer waits for them.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import { ClaudeSession } from '../../../src/main/chats/claude';
import { FAKE, recEmitter, tmp, waitFor } from './helpers';

const managers: ChatManager[] = [];
function setup(userData = tmp('ud'), home = tmp('home'), cwd = tmp('cwd'), env: Record<string, string> = {}, completeCensus = false) {
  const em = recEmitter();
  const m = new ChatManager({ emitter: em, userData, enginePaths: { claude: FAKE }, claudeHome: home, env: { CLAUDE_CONFIG_DIR: home, ...env },
    // Positive release coverage explicitly simulates a complete provider census; real Claude stays partial.
    ...(completeCensus ? { sessionFactory: (_h, options, sink) => new ClaudeSession({ ...options, claudePath: FAKE }, { ...sink, childrenCoverage: (coverage, reason) => sink.childrenCoverage?.(coverage === 'partial' ? 'complete' : coverage, reason) }) } : {}),
  });
  managers.push(m);
  return { m, em, userData, home, cwd };
}
const summary = (m: ChatManager, id: string) => m.list().find(c => c.id === id)!;

afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });

describe('ChatManager archive (auto-close)', () => {
  it('reports the last result, archives a finished chat, keeps it across a restart and reopens it', async () => {
    const { m, em, userData, home, cwd } = setup();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'hello', title: 'Lavoro' });
    const done = await waitFor(() => { const s = summary(m, c.id); return s.state === 'idle' && s.lastResult ? s : null; }, 'idle with a result');
    expect(done.lastResult).toMatchObject({ isError: false });

    await expect(m.archive(c.id, { auto: true })).rejects.toThrow(/timer verificato/);
    const a = await m.archive(c.id);
    expect(a).toMatchObject({ state: 'closed', closedBy: 'user' });
    expect(a.closedAt).toBeGreaterThan(0);
    const saved = JSON.parse(fs.readFileSync(path.join(userData, 'chats.json'), 'utf8')) as { chats: { closedAt?: number; closedBy?: string }[] };
    expect(saved.chats[0]).toMatchObject({ closedAt: a.closedAt, closedBy: 'user' });
    expect(em.of('chat:removed')).toEqual([]); // archived, not deleted
    await m.shutdown();

    const again = setup(userData, home, cwd);
    expect(summary(again.m, c.id)).toMatchObject({ closedAt: a.closedAt, closedBy: 'user', state: 'closed', title: 'Lavoro' });
    const r = await again.m.reopen(c.id);
    expect(r.closedAt).toBeUndefined();
    expect(again.m.items(c.id).some(i => i.kind === 'user' && i.text === 'hello')).toBe(true); // the history stays
  });

  it('a message to a closed chat reopens it and resumes the session', async () => {
    const { m, cwd } = setup();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'hello' });
    await waitFor(() => summary(m, c.id).state === 'idle', 'idle');
    await m.archive(c.id);
    expect(summary(m, c.id).closedBy).toBe('user');
    await m.send(c.id, 'ancora');
    expect(summary(m, c.id).closedAt).toBeUndefined();
    await waitFor(() => m.items(c.id).filter(i => i.kind === 'result').length === 2, 'resumed turn');
  });

  it('never closes the Regia; the auto archive is refused while the chat works or runs background tasks', async () => {
    const { m, cwd } = setup();
    const regia = await m.create({ harness: 'claude', cwd, regia: true });
    await expect(m.archive(regia.id, { auto: true })).rejects.toThrow(/Orchestrator/);

    const c = await m.create({ harness: 'claude', cwd, prompt: 'background job' });
    await waitFor(() => (summary(m, c.id).background ?? 0) === 1, 'background task counted');
    await waitFor(() => summary(m, c.id).state === 'idle', 'idle while the task runs');
    await expect(m.archive(c.id, { auto: true })).rejects.toThrow(/tornata al lavoro/);
    await waitFor(() => summary(m, c.id).background === undefined, 'task ended');
    await expect(m.archive(c.id, { auto: true })).rejects.toThrow(/timer verificato/);
  });

  it('a paused background task still counts; an update without a status after its end does not revive it', async () => {
    const { m, cwd } = setup(undefined, undefined, undefined, { FAKE_CLAUDE_TASK_MS: '700' });
    const c = await m.create({ harness: 'claude', cwd, prompt: 'background paused workflow' });
    await waitFor(() => summary(m, c.id).state === 'idle', 'idle');
    await new Promise(r => setTimeout(r, 300)); // paused at 50 ms, running again at 150 ms
    expect(summary(m, c.id).background).toBe(1);
    await expect(m.archive(c.id, { auto: true })).rejects.toThrow(/tornata al lavoro/);
    await waitFor(() => summary(m, c.id).background === undefined, 'task ended');
    await new Promise(r => setTimeout(r, 300)); // the update of its description at 800 ms
    expect(summary(m, c.id).background).toBeUndefined();
  });

  for (const completeCensus of [false, true]) it(`a resumed background task restarts idle clocks (${completeCensus ? 'explicit complete census' : 'real partial census'})`, async () => {
    // the 15/10 QA chats: SendMessage to a finished air-qa agent resumed it, the app kept counting 0 and closed the chat
    const { m, cwd } = setup(undefined, undefined, undefined, { FAKE_CLAUDE_TASK_MS: '400' }, completeCensus);
    const c = await m.create({ harness: 'claude', cwd, prompt: 'background resumed agent' });
    await waitFor(() => summary(m, c.id).state === 'idle' && summary(m, c.id).background === undefined && summary(m, c.id).backgroundEndedAt, 'first run ended');
    await waitFor(() => summary(m, c.id).background === 1, 'resumed under the same id');
    await expect(m.archive(c.id, { auto: true })).rejects.toThrow(/tornata al lavoro/);
    expect(m.releaseIdle(1, Date.now() + 3_600_000)).toBe(0);
    const ended = await waitFor(() => summary(m, c.id).background === undefined ? summary(m, c.id).backgroundEndedAt : null, 'second run ended');
    // the CLI now reads the agent's report in a turn of its own: the engine is not idle since the turn, but since the end
    const turn = summary(m, c.id).lastResult!.at;
    expect(ended).toBeGreaterThan(turn + 500);
    expect(m.releaseIdle(1_000, ended + 500)).toBe(0);
    expect(summary(m, c.id).agentChildren?.coverage).toBe(completeCensus ? 'complete' : 'partial');
    expect(m.releaseIdle(1_000, ended + 1_000)).toBe(completeCensus ? 1 : 0);
  });

  it('an ended task that comes back as an update to running counts again (the AT chat of 2026-10-16)', async () => {
    const { m, cwd } = setup(undefined, undefined, undefined, { FAKE_CLAUDE_TASK_MS: '400' });
    const c = await m.create({ harness: 'claude', cwd, prompt: 'background revived agent' });
    await waitFor(() => summary(m, c.id).state === 'idle' && summary(m, c.id).background === undefined && summary(m, c.id).backgroundEndedAt, 'first run ended');
    await waitFor(() => summary(m, c.id).background === 1, 'revived by its update');
    await expect(m.archive(c.id, { auto: true })).rejects.toThrow(/tornata al lavoro/);
    expect(m.releaseIdle(1, Date.now() + 3_600_000)).toBe(0);
    await waitFor(() => summary(m, c.id).background === undefined, 'second run ended');
  });

  for (const mode of ['', ' structured']) {
    it(`an agent resumed by SendMessage counts from the tool's result alone${mode ? ' (structured result)' : ''} (the QA chat of 2026-10-16)`, async () => {
      const { m, cwd } = setup(undefined, undefined, undefined, { FAKE_CLAUDE_TASK_MS: '600' });
      const c = await m.create({ harness: 'claude', cwd, prompt: `sendmessage${mode}` });
      await waitFor(() => summary(m, c.id).state === 'idle' && summary(m, c.id).background === 1, 'idle, the resumed agent counted');
      await expect(m.archive(c.id, { auto: true })).rejects.toThrow(/tornata al lavoro/);
      expect(m.releaseIdle(1, Date.now() + 3_600_000)).toBe(0);
      await waitFor(() => summary(m, c.id).background === undefined, 'its notification ends it');
    });
  }

  it('a SendMessage to a stopped agent that will not resume counts nothing', async () => {
    const { m, cwd } = setup();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'sendmessage stopped' });
    await waitFor(() => summary(m, c.id).state === 'idle' && summary(m, c.id).lastResult, 'idle');
    expect(summary(m, c.id).background).toBeUndefined();
  });

  it('a last answer that waits for its work holds the auto archive and the engine release until a later turn', async () => {
    const { m, cwd } = setup();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'waitqa' });
    await waitFor(() => summary(m, c.id).state === 'idle' && summary(m, c.id).lastResult, 'idle');
    expect(summary(m, c.id)).toMatchObject({ waitsOnWork: true });
    expect(summary(m, c.id).background).toBeUndefined(); // the engine counts nothing: only its words hold it
    await expect(m.archive(c.id, { auto: true })).rejects.toThrow(/tornata al lavoro/);
    expect(m.releaseIdle(1, Date.now() + 3_600_000)).toBe(0);
    await m.send(c.id, 'ok, fatto');
    await waitFor(() => m.items(c.id).filter(i => i.kind === 'result').length === 2 && summary(m, c.id).state === 'idle', 'second turn');
    expect(summary(m, c.id).waitsOnWork).toBeUndefined();
    await expect(m.archive(c.id, { auto: true })).rejects.toThrow(/timer verificato/);
  });

  it('a message sent while the archive closes the session waits for it and reopens the chat on a new one', async () => {
    const { m, cwd } = setup();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'hello' });
    await waitFor(() => summary(m, c.id).state === 'idle' && summary(m, c.id).lastResult, 'idle');
    const closing = m.archive(c.id);
    const sent = m.send(c.id, 'ancora una cosa');
    await closing;
    await sent;
    expect(summary(m, c.id).closedAt).toBeUndefined();
    await waitFor(() => m.items(c.id).filter(i => i.kind === 'result').length === 2, 'the message got its turn');
  });

  it('keeps a token-free hand-off across a user archive; an archived chat is never started for a hand-off', async () => {
    const { m, userData, cwd } = setup();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'hello' });
    await waitFor(() => summary(m, c.id).state === 'idle' && summary(m, c.id).lastResult, 'idle');
    const turns = (id: string) => m.items(id).filter(i => i.kind === 'result').length;
    const before = turns(c.id);
    await m.ensureHandoff(c.id, { ask: false });
    await m.archive(c.id);
    expect(fs.existsSync(path.join(userData, 'handoffs', `${c.id}.md`))).toBe(true);
    expect(summary(m, c.id)).toMatchObject({ handoffSource: 'auto', closedBy: 'user' });
    expect(turns(c.id)).toBe(before); // no turn at close

    const d = await m.create({ harness: 'claude', cwd, prompt: 'hello' });
    await waitFor(() => summary(m, d.id).state === 'idle' && summary(m, d.id).lastResult, 'idle');
    await m.archive(d.id);
    expect(fs.existsSync(path.join(userData, 'handoffs', `${d.id}.md`))).toBe(false); // closed by hand: no note
    const n = turns(d.id);
    expect((await m.handoff(d.id)).source).toBe('auto'); // written by the app, the engine stays off
    expect(turns(d.id)).toBe(n);
    expect(summary(m, d.id).state).toBe('closed');
  });
});
