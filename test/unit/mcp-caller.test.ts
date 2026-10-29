// The calling chat of a chat-endpoint tool (src/main/mcp/caller.ts): the endpoint's chatId, never an argument.
import { expect, it } from 'vitest';
import { callerOf } from '../../src/main/mcp/caller';

it('reads the chat from the endpoint and refuses a call from any other mount', () => {
  expect(callerOf({ chatId: 'c1', token: 't' })).toBe('c1');
  expect(() => callerOf({})).toThrow(/chat's own endpoint/);
});
