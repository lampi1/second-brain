// Cold chats and the compaction window (ADR 0031): the pure rules (when a chat writes its cold note, when its engine is
// kept, when a message goes on in a fresh session), the per-process compaction window, the "long" rule tied to the
// window, and the ChatManager flows on the fake Claude engine: the quiet note, the invisible continuation (same chat,
// title and tile; old session folded behind a divider; a restart reads both sessions back), no switch on a warm cache,
// the engine kept for the note, and the context counters.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import { ClaudeSession, compactSettings } from '../../../src/main/chats/claude';
import { CACHE_TTL_MS, COLD_MIN_TOKENS, coldArmed, coldAsk, coldRoute, type ColdView } from '../../../src/main/chats/continuity';
import { coldPrompt, coldUserText, handoffRequest } from '../../../src/main/chats/handoff';
import { userText } from '../../../src/main/chats/transcript';
import { isLongChat, longAt } from '../../../src/shared/context';
import { FAKE, fakeLog, recEmitter, recSink, tmp, waitFor } from './helpers';

const MIN = 60_000;
const base: ColdView = {
  harness: 'claude', isRegia: false, state: 'idle', pending: 0, busy: false, alive: true, handoffTurn: false,
  contextTokens: 250_000, lastTurnAt: 1_000, noteAt: 0, lastCallAt: 1_000,
};

describe('cold rules', () => {
  it('asks the note once, idle and long, after the idle time and before the cache expires', () => {
    const at = (min: number) => 1_000 + min * MIN;
    expect(coldAsk(base, at(49), 50 * MIN)).toBe(false);
    expect(coldAsk(base, at(50), 50 * MIN)).toBe(true);
    expect(coldAsk(base, at(56), 50 * MIN)).toBe(false); // the cache is gone: a note would cost a full re-read
    for (const v of [
      { harness: 'cursor' }, { isRegia: true }, { appRegia: true }, { continuedBy: { id: 'x' } }, { state: 'running' },
      { pending: 1 }, { busy: true }, { alive: false }, { handoffTurn: true }, { contextTokens: COLD_MIN_TOKENS - 1 },
      { noteAt: 2_000 }, { askedFor: 1_000 }, { lastTurnAt: 0 },
    ] satisfies Partial<ColdView>[]) expect(coldAsk({ ...base, ...v }, at(50), 50 * MIN), JSON.stringify(v)).toBe(false);
    // a turn after the note: a new stretch, asked again
    expect(coldAsk({ ...base, noteAt: 900, askedFor: 500, lastTurnAt: 1_000 }, at(50), 50 * MIN)).toBe(true);
  });

  it('keeps the engine while the note is due, and routes only past the cache with a fresh note', () => {
    expect(coldArmed(base, 1_000 + 10 * MIN)).toBe(true);
    expect(coldArmed({ ...base, noteAt: 2_000 }, 1_000 + 10 * MIN)).toBe(false);
    expect(coldArmed(base, 1_000 + CACHE_TTL_MS)).toBe(false);
    const noted = { ...base, noteAt: 3_000, lastCallAt: 3_000 };
    expect(coldRoute(noted, 3_000 + CACHE_TTL_MS - 1)).toBe(false); // warm: the old session is cheaper
    expect(coldRoute(noted, 3_000 + CACHE_TTL_MS + 1)).toBe(true);
    expect(coldRoute({ ...noted, lastTurnAt: 4_000 }, 4_000 + CACHE_TTL_MS + 1)).toBe(false); // the note is stale
    expect(coldRoute({ ...noted, busy: true }, 3_000 + CACHE_TTL_MS + 1)).toBe(false);
    expect(coldRoute({ ...noted, harness: 'cursor' }, 3_000 + CACHE_TTL_MS + 1)).toBe(false);
  });

  it('the cold request asks what to restart and runs no tool; the prompt carries the note, the transcript only the message', () => {
    const r = handoffRequest({ title: 't', reason: 'cold' });
    expect(r).toContain('## In corso');
    expect(r).toContain('sessione nuova');
    expect(handoffRequest({ title: 't', reason: 'manual' })).not.toContain('## In corso');
    const p = coldPrompt({ title: 'Fix', cwd: 'C:/r', inWorktree: true }, { chatId: 'c', title: 'Fix', path: 'C:/h/c.md', text: '## Stato\nok', at: 1, source: 'chat' }, 'e adesso?\nseconda riga');
    expect(p).toContain('## Stato\nok');
    expect(p).toContain('git worktree list');
    expect(coldUserText(p)).toBe('e adesso?\nseconda riga');
    expect(userText(p)).toEqual({ text: 'e adesso?\nseconda riga' });
    expect(coldUserText('ciao')).toBe('ciao');
  });

  it('the compaction window goes inline per process (clamped), and the meter turns amber near it', () => {
    expect(compactSettings(300_000)).toEqual({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' } });
    expect(compactSettings(5)).toEqual({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000' } });
    expect(compactSettings(0)).toBeNull();
    const args = (w?: number) => new ClaudeSession({ chatId: 'c', cwd: '.', sessionId: '00000000-0000-4000-8000-000000000000', ...(w !== undefined ? { compactWindowTokens: w } : {}), stable: true, localAppData: 'C:/L' }, recSink()).args();
    const settings = JSON.parse(args(300_000)[args(300_000).indexOf('--settings') + 1]!) as { env?: unknown; permissions?: { deny?: unknown[] } };
    expect(settings.env).toEqual({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' });
    expect(settings.permissions?.deny?.length).toBeGreaterThan(0); // the stable guard rails stay
    expect(JSON.parse(args()[args().indexOf('--settings') + 1]!).env).toBeUndefined();
    const claude = { harness: 'claude' as const, contextMaxTokens: 300_000 };
    expect(longAt(claude, 200_000)).toBe(240_000);
    expect(isLongChat({ ...claude, contextTokens: 230_000 }, 200_000)).toBe(false);
    expect(isLongChat({ ...claude, contextTokens: 245_000 }, 200_000)).toBe(true);
    expect(isLongChat({ harness: 'cursor', contextTokens: 210_000, contextEstimated: true }, 200_000)).toBe(true);
  });
});

const managers: ChatManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });

function setup(extra: Partial<ChatManagerOptions> = {}) {
  const userData = tmp('ud'), home = tmp('home'), cwd = tmp('cwd'), log = path.join(userData, 'fake.jsonl');
  const make = (more: Partial<ChatManagerOptions> = {}) => {
    const m = new ChatManager({
      emitter: recEmitter(), userData, enginePaths: { claude: FAKE }, claudeHome: home, env: { CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: log },
      compactWindowTokens: () => 300_000, coldHandoff: () => true, coldIdleMs: () => 0, cacheTtlMs: 1500, coldEveryMs: 0, ...extra, ...more,
    });
    managers.push(m);
    return m;
  };
  return { userData, cwd, log, make };
}
const summary = (m: ChatManager, id: string) => m.list().find(c => c.id === id);
const idle = (m: ChatManager, id: string) => summary(m, id)?.state === 'idle' && !m.items(id).at(-1)?.id.startsWith('u');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('ChatManager cold chats', () => {
  it('every Claude engine reports the configured window (300k), 1M models included', async () => {
    const { make, cwd, log } = setup();
    const m = make();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'big', model: 'claude-opus-5-5[1m]' });
    await waitFor(() => summary(m, c.id)?.contextMaxTokens === 300_000, 'window reported');
    const start = fakeLog(log).find(l => l.argv)!;
    expect(start.argv!.join(' ')).toContain('"CLAUDE_CODE_AUTO_COMPACT_WINDOW":"300000"');
  });

  it('writes the note quietly, then a message after the cache expired goes on in a fresh session of the same chat', async () => {
    const { make, cwd, userData } = setup();
    const m = make();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'big', title: 'Fix totale' });
    await waitFor(() => idle(m, c.id) && summary(m, c.id)?.contextTokens === 250_000, 'long and idle');
    const before = m.items(c.id).length, oldSession = summary(m, c.id)!.sessionId;
    expect(m.coldTick()).toBe(1);
    await waitFor(() => summary(m, c.id)?.handoffAt, 'cold note saved');
    // invisible: no line, no note text, no busy bar in the tile
    expect(m.items(c.id)).toHaveLength(before);
    expect(summary(m, c.id)?.handoffBusy).toBeUndefined();
    expect(m.coldTick()).toBe(0); // once
    expect(m.readHandoff(c.id)?.text).toContain('Aprire la PR.');
    await sleep(1600); // the cache expires
    await m.send(c.id, 'e adesso?');
    await waitFor(() => m.items(c.id).some(i => i.kind === 'assistant' && i.text === 'Continuo dal passaggio: e adesso?'), 'answered from the note');
    const s = summary(m, c.id)!;
    expect(s).toMatchObject({ title: 'Fix totale' });
    expect(s.sessionId).not.toBe(oldSession);
    expect(m.list()).toHaveLength(1); // no "(2)"
    const items = m.items(c.id);
    const div = items.findIndex(i => i.kind === 'system' && !!i.continued);
    expect(div).toBe(before);
    expect(items[div + 1]).toMatchObject({ kind: 'user', text: 'e adesso?' });
    // the divider opens the copy of the note this session started from (a later note overwrites the chat's own file)
    const cont = items[div]!;
    expect(cont.kind === 'system' && cont.continued?.session).toBe(oldSession);
    expect(m.readHandoff(c.id, oldSession!)?.text).toContain('Aprire la PR.');
    expect(m.readHandoff(c.id, oldSession!)?.path).not.toBe(m.readHandoff(c.id)?.path);
    expect(m.contextStats()).toMatchObject({ notesWritten: 1, notesUsed: 1 });
    // a restart reads both sessions back: the old one, the divider, the new one (the note not shown as the message)
    await m.shutdown();
    const again = make();
    const back = again.items(c.id);
    const d2 = back.findIndex(i => i.kind === 'system' && !!i.continued);
    expect(d2).toBeGreaterThan(0);
    expect(back.slice(0, d2).some(i => i.kind === 'user' && i.text === 'big')).toBe(true);
    expect(back[d2 + 1]).toMatchObject({ kind: 'user', text: 'e adesso?' });
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'chats.json'), 'utf8')).chats[0].pastSessions[0].sessionId).toBe(oldSession);
  }, 30_000);

  it('a message while the cache is warm stays in the old session, and the Regia and short chats are never asked', async () => {
    const { make, cwd, userData } = setup({ cacheTtlMs: 60_000 });
    const m = make();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'big' });
    const short = await m.create({ harness: 'claude', cwd, prompt: 'hello' });
    const regia = await m.create({ harness: 'claude', cwd, regia: true, prompt: 'big' });
    // each engine reports its context after its turn (get_context_usage): the tick reads all three sizes, so wait for each
    await waitFor(() => idle(m, c.id) && idle(m, short.id) && idle(m, regia.id)
      && summary(m, c.id)?.contextTokens === 250_000 && summary(m, short.id)?.contextTokens === 1234 && summary(m, regia.id)?.contextTokens === 250_000, 'all idle, sizes reported');
    expect(m.coldTick()).toBe(1);
    await waitFor(() => summary(m, c.id)?.handoffAt, 'cold note');
    const sid = summary(m, c.id)!.sessionId;
    await m.send(c.id, 'ancora');
    await waitFor(() => m.items(c.id).filter(i => i.kind === 'result').length === 2, 'second turn');
    expect(summary(m, c.id)!.sessionId).toBe(sid);
    expect(m.items(c.id).some(i => i.kind === 'system' && !!i.continued)).toBe(false);
    // the message went into the old session: the note is stale (a turn cut before its result keeps it so)
    expect(JSON.parse(fs.readFileSync(path.join(userData, 'chats.json'), 'utf8')).chats.find((x: { id: string }) => x.id === c.id).coldNoteAt).toBeUndefined();
    expect(summary(m, short.id)?.handoffAt).toBeUndefined();
    expect(summary(m, regia.id)?.handoffAt).toBeUndefined();
  }, 20_000);

  it('the idle release and the auto-close keep the engine of a chat that still owes its note', async () => {
    const { make, cwd } = setup({ coldIdleMs: () => 60_000, cacheTtlMs: 120_000 });
    const m = make();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'big' });
    await waitFor(() => idle(m, c.id) && summary(m, c.id)?.contextTokens === 250_000, 'long and idle');
    expect(m.releaseIdle(1, Date.now() + 10)).toBe(0);
    await m.archive(c.id, { auto: true });
    expect(summary(m, c.id)?.closedAt).toBeTruthy();
    expect(m.engines().live.some(e => e.chatId === c.id)).toBe(true);
    // at its time the note is written on the kept engine, then the engine ends; the chat stays archived
    expect(m.coldTick(Date.now() + 61_000)).toBe(1);
    await waitFor(() => !m.engines().live.some(e => e.chatId === c.id), 'kept engine ended', 15_000);
    expect(summary(m, c.id)).toMatchObject({ handoffSource: 'chat' });
    expect(summary(m, c.id)?.closedAt).toBeTruthy();
  }, 25_000);

  it('a chat reopened while its engine is kept for the note is live again: the note is still asked', async () => {
    const { make, cwd } = setup({ coldIdleMs: () => 60_000, cacheTtlMs: 120_000 });
    const m = make();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'big' });
    await waitFor(() => idle(m, c.id) && summary(m, c.id)?.contextTokens === 250_000, 'long and idle');
    await m.archive(c.id, { auto: true });
    await m.reopen(c.id);
    expect(summary(m, c.id)?.state).toBe('idle');
    expect(m.coldTick(Date.now() + 61_000)).toBe(1);
    await waitFor(() => summary(m, c.id)?.handoffSource === 'chat', 'cold note');
    expect(m.engines().live.some(e => e.chatId === c.id)).toBe(true); // reopened: the engine stays
  }, 25_000);

  it('a fresh session that does not start leaves the note for the next message', async () => {
    const { make, cwd } = setup();
    const m = make();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'big' });
    await waitFor(() => idle(m, c.id) && summary(m, c.id)?.contextTokens === 250_000, 'long and idle');
    const oldSession = summary(m, c.id)!.sessionId;
    expect(m.coldTick()).toBe(1);
    await waitFor(() => summary(m, c.id)?.handoffAt, 'cold note');
    await sleep(1600);
    // the engine does not start once (a missing folder, no CLI)
    const mm = m as unknown as { ensureSession: () => Promise<void> };
    const start = mm.ensureSession;
    mm.ensureSession = async () => { mm.ensureSession = start; };
    await expect(m.send(c.id, 'primo')).rejects.toThrow('Avvio della chat non riuscito');
    expect(summary(m, c.id)!.sessionId).toBe(oldSession);
    expect(m.items(c.id).some(i => i.kind === 'system' && !!i.continued)).toBe(false);
    await m.send(c.id, 'secondo');
    await waitFor(() => m.items(c.id).some(i => i.kind === 'assistant' && i.text === 'Continuo dal passaggio: secondo'), 'continued from the note');
    expect(summary(m, c.id)!.sessionId).not.toBe(oldSession);
  }, 30_000);

  it('a message queued behind the quiet note turn shows as work and ends as a normal turn', async () => {
    const { make, cwd } = setup();
    const m = make();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'big' });
    await waitFor(() => idle(m, c.id) && summary(m, c.id)?.contextTokens === 250_000, 'long and idle');
    const sid = summary(m, c.id)!.sessionId;
    expect(m.coldTick()).toBe(1);
    await m.send(c.id, 'ancora');
    if (!summary(m, c.id)?.handoffAt) expect(summary(m, c.id)?.state).toBe('running');
    await waitFor(() => m.items(c.id).filter(i => i.kind === 'result').length === 2 && summary(m, c.id)?.state === 'idle', 'queued turn ended');
    await sleep(1600);
    await m.send(c.id, 'dopo');
    await waitFor(() => m.items(c.id).filter(i => i.kind === 'result').length === 3, 'third turn');
    expect(summary(m, c.id)!.sessionId).toBe(sid); // the note came before that message: no base for a continuation
  }, 30_000);

  it('counts the calls of the main thread from their usage, once per response', async () => {
    const { make, cwd } = setup({ coldHandoff: () => false });
    const m = make();
    const c = await m.create({ harness: 'claude', cwd, prompt: 'meter' });
    await waitFor(() => m.items(c.id).some(i => i.kind === 'result'), 'turn', 15_000);
    expect(m.contextStats()).toMatchObject({ calls: 1, over200k: 0, coldRewrites: 0 });
  }, 20_000);
});
