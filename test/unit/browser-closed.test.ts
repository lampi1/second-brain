// Tabs the user closed under an agent (main/browser/closed.ts): the agent's next call on such a tab, by id or as its
// active tab, gets a clear "The user closed tab …" error naming its open tabs; a pick clears the active one.
import { describe, expect, it } from 'vitest';
import { UserClosed } from '../../src/main/browser/closed';

describe('UserClosed', () => {
  it('says nothing for tabs the user did not close', () => {
    const u = new UserClosed();
    expect(u.errorFor('chat:a', 't1', [])).toBeNull();
    expect(u.errorFor('chat:a', null, [])).toBeNull();
    u.mark('chat:a', 't1', 'https://x.test/', false);
    expect(u.errorFor('chat:a', 't2', [])).toBeNull();
    expect(u.errorFor('chat:b', 't1', [])).toBeNull();          // another group: not its tab
  });

  it('names the closed tab, its url and the open tabs to pick', () => {
    const u = new UserClosed();
    u.mark('chat:a', 't3', 'https://x.test/page', true);
    expect(u.errorFor('chat:a', 't3', ['t4', 't5'])).toBe('The user closed tab t3 (https://x.test/page) in the app. Your open tabs: t4, t5. Call tabs_select to pick one, or tabs_create to open a new tab.');
    expect(u.errorFor('chat:a', null, [])).toBe('The user closed tab t3 (https://x.test/page) in the app. You have no open tab now: call tabs_create to open one (ask the user first if you need the page they closed).');
  });

  it('keeps the closed active tab until the agent picks one; by id it stays known', () => {
    const u = new UserClosed();
    u.mark('chat:a', 't1', '', true);
    expect(u.closedActive('chat:a')).toBe('t1');
    expect(u.errorFor('chat:a', null, ['t2'])).toContain('The user closed tab t1 in the app.');
    expect(u.errorFor('chat:a', null, ['t2'])).toContain('tabs_select');   // a second call still fails, never lands on t2
    u.picked('chat:a');
    expect(u.closedActive('chat:a')).toBeNull();
    expect(u.errorFor('chat:a', null, ['t2'])).toBeNull();
    expect(u.errorFor('chat:a', 't1', ['t2'])).toContain('The user closed tab t1');
  });

  it('a non-active tab never blocks calls without tabId', () => {
    const u = new UserClosed();
    u.mark('chat:a', 't1', '', false);
    expect(u.closedActive('chat:a')).toBeNull();
    expect(u.errorFor('chat:a', null, ['t2'])).toBeNull();
  });

  it('forgets a group and keeps at most 20 closed tabs per group', () => {
    const u = new UserClosed();
    for (let i = 1; i <= 25; i++) u.mark('chat:a', `t${i}`, '', false);
    expect(u.errorFor('chat:a', 't1', [])).toBeNull();
    expect(u.errorFor('chat:a', 't6', [])).not.toBeNull();
    u.forget('chat:a');
    expect(u.errorFor('chat:a', 't25', [])).toBeNull();
  });
});
