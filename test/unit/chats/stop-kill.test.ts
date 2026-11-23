// stop-kill: Stop on an engine that answers interrupts it; on one that does not answer (stuck) its process tree is
// killed instead of leaving it alive with «Stop non riuscito»; an engine already gone is not killed again.
import { describe, expect, it } from 'vitest';
import { stopOrKill } from '../../../src/main/chats/stop-kill';

const fake = (o: { fails?: boolean; alive?: boolean }) => {
  const s = { kills: 0, interrupts: 0, alive: o.alive ?? true, pid: 4242 as number | null,
    interrupt: async () => { s.interrupts++; if (o.fails) throw new Error('control request timed out'); },
    killNow: () => { s.kills++; } };
  return s;
};

describe('stopOrKill', () => {
  it('interrupts an engine that answers, and kills nothing', async () => {
    const s = fake({});
    expect(await stopOrKill(s, 'c1')).toBe('interrupted');
    expect(s.kills).toBe(0);
  });

  it('kills the process tree of a stuck engine (no answer to the interrupt)', async () => {
    const s = fake({ fails: true });
    expect(await stopOrKill(s, 'c1')).toBe('killed');
    expect(s.kills).toBe(1);
  });

  it('an engine already gone: no kill, the failure is reported', async () => {
    const s = fake({ fails: true, alive: false });
    await expect(stopOrKill(s, 'c1')).rejects.toThrow(/Stop non riuscito/);
    expect(s.kills).toBe(0);
  });
});
