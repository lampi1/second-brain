// Unit tests of "N novità in attesa" (#88): OrchestratorWake.heldNews and ChatMail.heldMail list what the delivery rule holds
// back for the Orchestrator (chats/orchestrator-delivery.ts heldWhy says why), and HeldNewsHub (chats/held-news.ts) tells the
// page only when that list changed. Reading the list never sends anything to the Orchestrator and never changes when
// the news goes: the cases are the issue's (a question panel open + a worker that finishes = 1, cleared on delivery; a
// quiet permission request counted too).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import type { ChatSummary, HeldNewsState, PendingRequest } from '../../../src/shared/contract';
import { OrchestratorWake } from '../../../src/main/chats/orchestrator-wake';
import { heldWhy } from '../../../src/main/chats/orchestrator-delivery';
import { attachHeldNews, HeldNewsHub } from '../../../src/main/chats/held-news';
import { ChatMail, inboxDir, ORCHESTRATOR_GROUP_MS, sendMail } from '../../../src/main/chats/mail';
import { tmp } from './helpers';

const chat = (p: Partial<ChatSummary> & { id: string }): ChatSummary => ({
  harness: 'claude', origin: 'app', title: p.id, cwd: 'C:/x', sessionId: null, model: null, effort: null, permissionMode: null,
  state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
} as ChatSummary);

const perm = (chatId: string, id = 'p1'): PendingRequest => ({ id, chatId, type: 'permission', tool: 'Bash', title: 'Bash · npm test', detail: 'npm test', input: {}, at: 1 });

function make() {
  const sent: { chatId: string; text: string }[] = [];
  const w = new OrchestratorWake({ send: async (chatId, text) => { sent.push({ chatId, text }); }, enabled: () => true, groupMs: 1000, perChatMs: 10_000, now: () => Date.now() });
  const emitted: HeldNewsState[] = [];
  const hub = attachHeldNews({ emit: (ch, p) => { if (ch === 'orchestrator:heldChanged') emitted.push(p as HeldNewsState); } }, w);
  const up = (p: Partial<ChatSummary> & { id: string }) => w.observe('chat:updated', chat(p));
  const finish = (id: string, lastText: string) => { up({ id, state: 'running' }); up({ id, state: 'idle', lastText }); };
  up({ id: 'orchestrator', isOrchestrator: true, title: 'Orchestrator', state: 'idle' });
  return { w, sent, hub, emitted, up, finish };
}

describe('heldWhy', () => {
  it('the gate holds it (waits for the user / busy) or it waits its turn by class', () => {
    const idle = { state: 'idle' as const, pending: 0 }, asking = { state: 'waiting' as const, pending: 1 };
    expect(heldWhy('hold', 'group', asking)).toBe('user');
    expect(heldWhy('hold', 'quiet', { state: 'idle', pending: 0 })).toBe('busy'); // a hand-off or an error: not the user's
    expect(heldWhy('busy', 'group', { state: 'running', pending: 0 })).toBe('busy');
    expect(heldWhy('queue', 'group', idle)).toBe('group');
    expect(heldWhy('queue', 'quiet', idle)).toBe('quiet');
    expect(heldWhy('hold', 'now', asking)).toBe('group'); // a failure passes a waiting Orchestrator: it goes now
    expect(heldWhy('inject', 'quiet', { state: 'running', pending: 0 })).toBe('group');
  });
});

describe('OrchestratorWake.heldNews and the hub', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a question panel open on the Orchestrator and a worker that finishes: 1 held, cleared on delivery', async () => {
    const { w, sent, hub, emitted, up, finish } = make();
    up({ id: 'orchestrator', isOrchestrator: true, title: 'Orchestrator', state: 'waiting', pending: 1 });
    finish('App · Mappa', 'Mappa pronta.');
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toEqual([]); // the rule is unchanged: nothing goes while it waits for the user
    expect(hub.get().items).toEqual([expect.objectContaining({ orchestratorId: 'orchestrator', chatId: 'App · Mappa', title: 'App · Mappa', kind: 'done', why: 'user' })]);
    expect(emitted.at(-1)?.items).toHaveLength(1);
    expect(w.held()).toBe(1);
    // the user answers: the news goes after the group window, and the list empties
    up({ id: 'orchestrator', isOrchestrator: true, title: 'Orchestrator', state: 'idle', pending: 0 });
    expect(hub.get().items[0]?.why).toBe('group');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(1);
    expect(hub.get().items).toEqual([]);
    expect(emitted.at(-1)).toEqual({ items: [] });
  });

  it('a quiet permission request is counted too, as riding along with the next news', async () => {
    const { w, sent, hub, up } = make();
    up({ id: 'fb', state: 'running' });
    w.observe('pending:added', perm('fb'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([]);
    expect(hub.get().items).toEqual([expect.objectContaining({ chatId: 'fb', kind: 'permission', why: 'quiet' })]);
    // answered before it went: the chat's next state is told instead, still held until it goes
    w.observe('pending:resolved', { chatId: 'fb', requestId: 'p1' });
    expect(hub.get().items).toEqual([]);
  });

  it('the hub tells the page only when the list changed; streaming updates of other chats send nothing', async () => {
    const { w, emitted, up } = make();
    const n = emitted.length;
    for (let i = 0; i < 5; i++) up({ id: 'other', state: 'running', lastText: `riga ${i}` });
    expect(emitted).toHaveLength(n);
    up({ id: 'fb', state: 'running' });
    w.observe('pending:added', perm('fb'));
    expect(emitted).toHaveLength(n + 1);
    up({ id: 'fb', state: 'waiting', lastText: 'still' });
    up({ id: 'other', state: 'running', lastText: 'again' });
    expect(emitted).toHaveLength(n + 1);
  });

  it('a closed chat\'s news is not listed; a source that throws is skipped', () => {
    const { w, hub, up } = make();
    up({ id: 'fb', state: 'running' });
    w.observe('pending:added', perm('fb'));
    expect(hub.get().items).toHaveLength(1);
    up({ id: 'fb', state: 'closed', closedAt: 5 });
    expect(hub.get().items).toEqual([]);
    const bad = new HeldNewsHub([{ list: () => { throw new Error('boom'); }, onChange: () => {} }], () => {});
    bad.refresh();
    expect(bad.get().items).toEqual([]);
  });
});

describe('ChatMail.heldMail', () => {
  const clock = { t: Date.parse('2026-10-19T10:00:00Z') };
  let mails: ChatMail[] = [];
  afterEach(() => { for (const m of mails) m.stop(); mails = []; });

  function setup(orchestrator: Partial<ChatSummary>) {
    const root = tmp('held'); const dir = inboxDir(root);
    fs.mkdirSync(dir, { recursive: true });
    const list = [chat({ id: 'w', title: 'App · Lavoro' }), chat({ id: 'r', title: 'Orchestrator', isOrchestrator: true, ...orchestrator })];
    const sent: string[] = [];
    const mail = new ChatMail({ root: () => root, chats: { list: () => list, send: async id => { sent.push(id); } }, instance: 'second-brain-dev', now: () => clock.t });
    mails.push(mail);
    const post = (text: string, kind?: 'info' | 'request' | 'urgent') => sendMail(dir, { from: 'App · Lavoro', fromHarness: 'claude', to: 'Orchestrator', toHarness: null, text, ...(kind ? { kind } : {}), refusal: () => null, now: new Date(clock.t) })!;
    return { mail, list, sent, post };
  }

  it('mail held by a waiting Orchestrator is listed with its sender; it clears once delivered', async () => {
    const { mail, list, sent, post } = setup({ state: 'waiting', pending: 1 });
    const changes = vi.fn();
    mail.onHeldChange(changes);
    post('feat/x pronto da unire: 3c6f315');
    expect(await mail.tick()).toBe(0);
    expect(mail.heldMail()).toEqual([expect.objectContaining({ orchestratorId: 'r', chatId: 'w', title: 'App · Lavoro', kind: 'mail', why: 'user', at: clock.t })]);
    expect(changes).toHaveBeenCalledTimes(1);
    await mail.tick();
    expect(changes).toHaveBeenCalledTimes(1); // same list: no second call
    list[1] = { ...list[1]!, state: 'idle', pending: 0 };
    clock.t += ORCHESTRATOR_GROUP_MS;
    expect(await mail.tick()).toBe(1);
    expect(sent).toEqual(['r']);
    expect(mail.heldMail()).toEqual([]);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('progress mail to an idle Orchestrator is held as quiet; a work chat\'s mail is never listed', async () => {
    const { mail, post } = setup({ state: 'idle' });
    post('nota: rilasciato', 'info');
    await mail.tick();
    expect(mail.heldMail().map(i => i.why)).toEqual(['quiet']);
  });

  it('the hub merges the news and the mail, oldest first', async () => {
    const { mail, post } = setup({ state: 'waiting', pending: 1 });
    const w = new OrchestratorWake({ send: async () => {}, enabled: () => true, list: () => [chat({ id: 'r', title: 'Orchestrator', isOrchestrator: true, state: 'waiting', pending: 1 })] });
    const hub = attachHeldNews({ emit: () => {} }, w, mail);
    post('pronto da unire');
    await mail.tick();
    w.observe('chat:updated', chat({ id: 'fb', state: 'running' }));
    w.observe('pending:added', perm('fb'));
    w.stop();
    expect(hub.get().items.map(i => i.kind)).toEqual(['mail', 'permission']);
  });
});

describe('a request of a chat not seen since the start', () => {
  it('is read from the list: the quiet permission is counted (and rides along with the next news)', () => {
    const list = [chat({ id: 'orchestrator', isOrchestrator: true, state: 'waiting', pending: 1 }), chat({ id: 'fix', title: 'Fix totale ordine', state: 'running' })];
    const w = new OrchestratorWake({ send: async () => {}, enabled: () => true, list: () => list });
    const hub = attachHeldNews({ emit: () => {} }, w);
    w.observe('pending:added', perm('fix'));
    w.stop();
    expect(hub.get().items).toEqual([expect.objectContaining({ chatId: 'fix', title: 'Fix totale ordine', kind: 'permission', why: 'user' })]);
  });
});
