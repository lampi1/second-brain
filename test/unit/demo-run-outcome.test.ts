// Demo lifecycle coverage for explicit user outcomes, without starting engines or writing files.
import { describe, expect, it } from 'vitest';
import { DemoChats, FROZEN_EPOCH, seed } from '../../src/main/demo';

describe('demo human verdicts', () => {
  it('provides a settled pinned run and records all human verdicts', () => {
    const chats = new DemoChats(() => {}, { freeze: true }, seed(FROZEN_EPOCH));
    const initial = chats.list().find(c => c.id === 'mappa')!;
    expect(initial.run?.version).toBe(1);
    expect(initial.agent?.id).toBe(initial.run?.agentId);
    for (const verdict of ['success', 'partial', 'fail'] as const) {
      const updated = chats.markRun('mappa', verdict);
      expect(updated.run?.outcome).toEqual({ verdict, basis: 'human', at: FROZEN_EPOCH, by: 'user' });
      expect(updated.run?.endReason).toBe('completed');
    }
  });
  it('refuses busy runs, invalid verdicts and legacy chats', () => {
    const chats = new DemoChats(() => {}, { freeze: true }, seed(FROZEN_EPOCH));
    expect(() => chats.markRun('fix', 'success')).toThrow('No agent run');
    expect(() => chats.markRun('mappa', 'fake' as 'success')).toThrow('Invalid outcome');
    chats.patch('mappa', { state: 'running' });
    expect(() => chats.markRun('mappa', 'success')).toThrow('busy');
    expect(chats.list().find(c => c.id === 'mappa')?.run?.outcome).toBeUndefined();
  });
});
