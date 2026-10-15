// Unit tests of the renderer store actions with a fake bridge (src/renderer/store/store.ts): a failed send rolls back
// only its own optimistic copy (a newer chat:updated wins); a failed answer comes back answerable (attempt bumped),
// except when main says the request is no longer open; "Invia subito" interrupts and the message goes exactly once;
// while a message is on its way to main the chat counts as busy (what the user types is queued, a late idle flushes nothing).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppInfo, ChatSummary, CliStatus, PendingRequest } from '@shared/contract';
import { engineInfos } from '../../src/main/engines/registry';

const invoke = vi.fn();
vi.mock('../../src/renderer/sb', () => ({ sb: { invoke: (...a: unknown[]) => invoke(...a), on: () => () => {} } }));

const { app, answer, attemptOf, cliCheck, cliFetch, dispatch, send, sendQueuedNow } = await import('../../src/renderer/store/store');

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', origin: 'app', title: id, cwd: 'C:\\x', sessionId: null, model: null, effort: null, permissionMode: null, state: 'idle',
  costUsd: 0, pending: 0, isRegia: false, lastText: '', updatedAt: 1, browserTabIds: [], ...p,
});
const req: PendingRequest = { id: 'r1', chatId: 'a', type: 'permission', tool: 'Bash', title: 't', detail: 'd', input: {}, at: 1 };
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  invoke.mockReset();
  dispatch({ type: 'init', chats: [chat('a')], pending: [], tabs: [], feed: [], usage: null, info: null });
  dispatch({ type: 'chat:updated', chat: chat('a') });
  for (const m of app.get().queued.a ?? []) dispatch({ type: 'unqueue', chatId: 'a', id: m.id });
});

describe('send', () => {
  it('a failed send rolls back the optimistic state', async () => {
    invoke.mockRejectedValueOnce(new Error('rete'));
    expect(send('a', 'ciao')).toBe('sent');
    expect(app.get().chats.a?.state).toBe('running');
    await flush();
    expect(app.get().chats.a?.state).toBe('idle');
    expect(app.get().queued.a?.map(m => m.text)).toEqual(['ciao']);
  });

  it('images go with the message: optimistic previews at once, base64 to main; queued while busy, sent with it', async () => {
    invoke.mockResolvedValue(undefined);
    const img = { mimeType: 'image/png' as const, data: 'iVBORw0KGgo=', thumb: 'data:image/webp;base64,AAAA' };
    expect(send('a', '', [])).toBe('empty');
    expect(send('a', '', [img])).toBe('sent'); // images only is a message
    const local = app.get().items.a?.at(-1);
    expect(local).toMatchObject({ kind: 'user', text: '', images: 1, thumbs: [img.thumb] });
    expect(invoke).toHaveBeenCalledWith('chat:send', { chatId: 'a', text: '', images: [img] });
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    await flush(); // main's reply (it comes after its "running", same pipe): the message is no longer on its way
    expect(send('a', 'guarda qui', [img, img])).toBe('queued');
    expect(app.get().queued.a?.[0]).toMatchObject({ text: 'guarda qui', images: [img, img] });
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    expect(invoke).toHaveBeenLastCalledWith('chat:send', { chatId: 'a', text: 'guarda qui', images: [img, img] });
  });

  it('images main refused are not retried forever: the text goes back to the queue without them', async () => {
    const img = { mimeType: 'image/jpeg' as const, data: 'iVBORw0KGgo=' };
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    send('a', 'guarda', [img]);
    send('a', '', [img]);
    const refused = new Error("Error invoking remote method 'chat:send': Error: Immagine 1: il contenuto non è un image/jpeg.");
    invoke.mockRejectedValueOnce(refused).mockResolvedValueOnce(undefined).mockRejectedValueOnce(refused);
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    await flush();
    expect(app.get().queued.a?.map(m => [m.text, m.images?.length ?? 0])).toEqual([['guarda', 0], ['', 1]]);
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    await flush();
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    await flush();
    expect(app.get().queued.a).toEqual([]); // the image-only one is dropped (a toast says why), not retried
  });

  it('a failed flush puts the message back first in the queue, not behind later ones', async () => {
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    send('a', 'primo');
    send('a', 'secondo');
    invoke.mockRejectedValueOnce(new Error('rete'));
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    await flush();
    expect(app.get().queued.a?.map(m => m.text)).toEqual(['primo', 'secondo']);
  });

  it('while a flushed message is on its way to main, what the user types is queued, even past a late idle', async () => {
    let resolve: () => void = () => {};
    invoke.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; })).mockResolvedValue(undefined);
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    send('a', 'slow');
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) }); // the old turn ends: "slow" leaves
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(app.get().chats.a?.state).toBe('running'); // shown running at once, like a message sent by hand
    const img = { mimeType: 'image/png' as const, data: 'iVBORw0KGgo=' };
    expect(send('a', '', [img])).toBe('queued');
    // an idle main reported before it got "slow" (the old turn's last update) flushes nothing; the next is queued too
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle', costUsd: 0.01 }) });
    expect(send('a', 'dopo')).toBe('queued');
    expect(invoke).toHaveBeenCalledTimes(1);
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) }); // main has "slow": its turn runs
    resolve();
    await flush();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(app.get().queued.a?.map(m => [m.text, m.images?.length ?? 0])).toEqual([['', 1], ['dopo', 0]]);
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) }); // "slow" ends: the image goes first
    expect(invoke).toHaveBeenLastCalledWith('chat:send', { chatId: 'a', text: '', images: [img] });
  });

  it('main took a flushed message while the chat still shows free: the next queued one goes on', async () => {
    let resolve: () => void = () => {};
    invoke.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; })).mockResolvedValue(undefined);
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    send('a', 'primo');
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    send('a', 'secondo');
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle', costUsd: 0.02 }) }); // no "running" from main
    resolve();
    await flush();
    expect(invoke).toHaveBeenLastCalledWith('chat:send', { chatId: 'a', text: 'secondo' });
    expect(app.get().queued.a).toEqual([]);
  });

  it('a failed send never overwrites a newer chat:updated (e.g. the error main reported)', async () => {
    let reject: (e: Error) => void = () => {};
    invoke.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    send('a', 'ciao');
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'error', lastError: 'avvio non riuscito' }) });
    reject(new Error('rete'));
    await flush();
    expect(app.get().chats.a).toMatchObject({ state: 'error', lastError: 'avvio non riuscito' });
  });
});

describe('sendQueuedNow ("Invia subito")', () => {
  const sends = () => invoke.mock.calls.filter(c => c[0] === 'chat:send').map(c => (c[1] as { text: string }).text);
  const texts = () => app.get().queued.a?.map(m => m.text);
  const idOf = (text: string) => app.get().queued.a!.find(m => m.text === text)!.id;
  const busyWith = (...ts: string[]) => {
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    for (const t of ts) expect(send('a', t)).toBe('queued');
  };

  it('interrupts the turn (keeping what the engine already holds), then sends the chosen message once when idle; the others follow in order', async () => {
    invoke.mockResolvedValue(undefined);
    busyWith('uno', 'due', 'tre');
    expect(await sendQueuedNow('a', idOf('tre'))).toBe('interrupting');
    expect(invoke).toHaveBeenCalledWith('chat:stop', { chatId: 'a', keepQueued: true });
    expect(texts()).toEqual(['tre', 'uno', 'due']);
    expect(sends()).toEqual([]); // nothing goes before the turn is over
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) }); // the interrupt landed
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle', costUsd: 0.4, updatedAt: 2 }) }); // another idle update (the cost): no second send
    expect(sends()).toEqual(['tre']);
    expect(texts()).toEqual(['uno', 'due']);
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'running' }) });
    await flush(); // main's reply to "tre"
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    expect(sends()).toEqual(['tre', 'uno']);
  });

  it('two messages with the same text: the one clicked is the one moved', async () => {
    invoke.mockResolvedValue(undefined);
    busyWith('ok', 'altro', 'ok');
    const ids = app.get().queued.a!.map(m => m.id);
    await sendQueuedNow('a', ids[2]!);
    expect(app.get().queued.a!.map(m => m.id)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it('a failed interrupt keeps the message first in the queue (sent when the turn ends)', async () => {
    busyWith('uno', 'due');
    invoke.mockRejectedValueOnce(new Error('nessuna risposta dal CLI'));
    expect(await sendQueuedNow('a', idOf('due'))).toBe('failed');
    expect(texts()).toEqual(['due', 'uno']);
    invoke.mockResolvedValue(undefined);
    dispatch({ type: 'chat:updated', chat: chat('a', { state: 'idle' }) });
    expect(sends()).toEqual(['due']);
  });

  it('a chat that is not busy gets the message at once, with its images, without an interrupt; a gone one is a no-op', async () => {
    invoke.mockResolvedValue(undefined);
    const img = { mimeType: 'image/png' as const, data: 'iVBORw0KGgo=' };
    dispatch({ type: 'queue', chatId: 'a', msg: { id: 'back', text: 'rimasto', images: [img] } }); // e.g. re-queued after a failed send
    expect(await sendQueuedNow('a', 'back')).toBe('sent');
    await flush();
    expect(invoke.mock.calls.map(c => c[0])).toEqual(['chat:send']);
    expect(invoke).toHaveBeenCalledWith('chat:send', { chatId: 'a', text: 'rimasto', images: [img] });
    expect(app.get().queued.a).toEqual([]);
    expect(await sendQueuedNow('a', 'back')).toBe('none');
  });
});

describe('answer', () => {
  it('a failed answer brings the request back, answerable again (attempt bumped)', async () => {
    dispatch({ type: 'pending:added', req });
    invoke.mockRejectedValueOnce(new Error('rete'));
    const before = attemptOf('a/r1');
    expect(await answer(req, { kind: 'permission', allow: true })).toBe(false);
    expect(app.get().pending.some(p => p.id === 'r1')).toBe(true);
    expect(attemptOf('a/r1')).toBe(before + 1);
  });

  it('when main says it is no longer open, it stays gone', async () => {
    dispatch({ type: 'pending:added', req: { ...req, id: 'r2' } });
    invoke.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:answer': Error: Questa richiesta non è più aperta."));
    expect(await answer({ ...req, id: 'r2' }, { kind: 'permission', allow: true })).toBe(false);
    expect(app.get().pending.some(p => p.id === 'r2')).toBe(false);
  });

  it('a good answer resolves true and the request is gone', async () => {
    dispatch({ type: 'pending:added', req: { ...req, id: 'r3' } });
    invoke.mockResolvedValueOnce(undefined);
    expect(await answer({ ...req, id: 'r3' }, { kind: 'permission', allow: false })).toBe(true);
    expect(app.get().pending.some(p => p.id === 'r3')).toBe(false);
  });
});

describe('cliFetch (Nuova chat while the check at start has not reported)', () => {
  const st = (version: string): CliStatus => ({ found: true, path: 'x', version, loggedIn: true });
  const info: AppInfo = { version: '1', brainRoot: null, mcpUrl: 'u', cli: null, engines: engineInfos().filter(e => e.id === 'claude' || e.id === 'cursor') }; // the two this test asks; every listed one must answer

  it('a failed check, or one with no answer in time, is null ("non verificato") and leaves app:info alone', async () => {
    dispatch({ type: 'info', info });
    invoke.mockRejectedValueOnce(new Error('spawn'));
    expect(await cliFetch('claude')).toBeNull();
    invoke.mockReturnValueOnce(new Promise(() => {}));
    expect(await cliFetch('cursor', 30)).toBeNull();
    expect(app.get().info?.cli).toBeNull();
  });

  it('each CLI answers on its own; once both did, app:info keeps them', async () => {
    dispatch({ type: 'info', info });
    invoke.mockImplementation((_ch: string, a: { harness: string }) => Promise.resolve(st(a.harness)));
    expect(await cliFetch('claude')).toEqual(st('claude'));
    expect(app.get().info?.cli).toBeNull();
    expect(await cliFetch('cursor')).toEqual(st('cursor'));
    expect(app.get().info?.cli).toEqual({ claude: st('claude'), cursor: st('cursor') });
    // a re-check of one CLI changes only that one
    invoke.mockResolvedValueOnce(st('nuova'));
    await cliCheck('cursor');
    expect(app.get().info?.cli).toEqual({ claude: st('claude'), cursor: st('nuova') });
  });
});
