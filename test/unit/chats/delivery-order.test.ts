// Two messages to one Claude chat at once (#127): the first waits on its checkpoint (ADR 0103), the second has nothing
// to wait for. ChatManager.deliver serializes them per chat, so the engine reads them in the transcript's order.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmp } from './helpers';
import type * as Checkpoints from '../../../src/main/chats/checkpoints';

let gate: Promise<void> | null = null;
vi.mock('../../../src/main/chats/checkpoints', async orig => {
  const real = await orig<typeof Checkpoints>();
  return { ...real, snapshot: async (cwd: string) => { const g = gate; gate = null; if (g) await g; return { commit: 'c0', at: Date.now(), root: cwd }; }, prune: async () => {} };
});

const { ChatManager } = await import('../../../src/main/chats/manager');
const managers: InstanceType<typeof ChatManager>[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); });

describe('delivery order', () => {
  it('a message sent while the previous one waits on its checkpoint reaches the engine after it', async () => {
    const sent: string[] = [];
    const m = new ChatManager({ userData: tmp('order'), emitter: { emit() {} }, coldEveryMs: 0, checkpoints: () => true, sessionFactory: (harness, _o, sink) => ({
      harness, sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { sink.changed({ state: 'idle' }); }, send(text: string) { sent.push(text.split('\n\n').at(-1)!); },
      close: async () => { sink.changed({ state: 'closed' }); sink.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false,
      rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    }) as never });
    managers.push(m);
    const c = await m.create({ harness: 'claude', cwd: tmp('order-cwd') });
    let open!: () => void;
    gate = new Promise<void>(resolve => { open = resolve; });
    const first = m.send(c.id, 'dal tuo messaggio');
    const second = m.send(c.id, 'posta del figlio', undefined, false, 'App · Figlio');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(sent).toEqual([]); // the second waits behind the first, it does not overtake it
    open();
    await Promise.all([first, second]);
    expect(sent).toEqual(['dal tuo messaggio', 'posta del figlio']);
    expect(m.items(c.id).filter(i => i.kind === 'user').map(i => (i as { text: string }).text)).toEqual(['dal tuo messaggio', 'posta del figlio']);
  });
});
