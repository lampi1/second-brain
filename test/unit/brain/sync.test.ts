// The domains' multi-PC sync (src/main/brain/sync.ts + guard.ts, ADR 0059) with real git: a local bare repo in a temp
// folder stands in for the private remote, two clones for two PCs. Push and pull, a conflict that stops the sync until
// the user chooses (mine / theirs / both), the publish guard (a fake scan.mjs with the real command line) blocking a push
// with file:line and never the value, the missing guard failing closed (also when only the product's deny.txt is there:
// a domain uses its own list, default deny-work.txt), a this-pc domain never syncing, a new empty
// remote, and the lock of a second writer. Never touches a real repo.

import { afterEach, describe, expect, it } from 'vitest';
import type { DomainSync } from '../../../src/main/brain/sync';
import { syncBeforeCreate } from '../../../src/main/brain/sync';

const made: DomainSync[] = [];

afterEach(() => { for (const s of made.splice(0)) s.stop(); });

describe('sync before a new chat', () => {
  it('create waits for the sync, and still runs when the sync fails', async () => {
    const order: string[] = [];
    const target = { create: async (n: number) => { order.push(`create ${n}`); return n * 2; } };
    syncBeforeCreate(target, async () => { await new Promise(r => setTimeout(r, 50)); order.push('sync'); });
    expect(await target.create(2)).toBe(4);
    expect(order).toEqual(['sync', 'create 2']);
    const failing = { create: async () => 'ok' };
    syncBeforeCreate(failing, () => Promise.reject(new Error('rete')));
    expect(await failing.create()).toBe('ok');
  });
});
