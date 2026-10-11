import { describe, expect, it } from 'vitest';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/contract';

describe('contract', () => {
  it('channel lists have no duplicates and use the area:verb form', () => {
    for (const list of [INVOKE_CHANNELS, EVENT_CHANNELS]) {
      expect(new Set(list).size).toBe(list.length);
      for (const c of list) expect(c).toMatch(/^[a-z]+(:[a-zA-Z]+)?$/);
    }
  });
});
