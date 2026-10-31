// The ask_user MCP tool (src/main/chats/ask-tool.ts): the caller is the endpoint's chat, never an argument; a refusal
// from the chat (no brief yet, an engine with its own question tool) comes back as a tool error, a shown panel as
// ASK_USER_SHOWN; arguments outside the schema's shape are normalised before they reach the chat.
import { describe, expect, it } from 'vitest';
import { ASK_USER_SHOWN, askTools } from '../../../src/main/chats/ask-tool';
import type { AppAsk } from '../../../src/main/chats/session';

const ctx = (params: Record<string, string>) => ({ params }) as never;

describe('ask_user tool', () => {
  it('asks for the endpoint\'s chat and says the panel is shown', async () => {
    const calls: [string, AppAsk][] = [];
    const [tool] = askTools({ askUser: async (id, q) => { calls.push([id, q]); return null; } });
    expect(tool!.name).toBe('ask_user');
    expect(await tool!.run({ question: 'Procedo?', recommended: 'no', header: 'Fix', chatId: 'other' }, ctx({ chatId: 'c1' }))).toBe(ASK_USER_SHOWN);
    expect(calls).toEqual([['c1', { question: 'Procedo?', recommended: 'no', header: 'Fix' }]]);
  });

  it('a refusal is a tool error with its text; odd arguments are normalised; no endpoint chat is refused', async () => {
    const calls: AppAsk[] = [];
    const [tool] = askTools({ askUser: async (_id, q) => { calls.push(q); return 'Not asked yet: brief first'; } });
    await expect(tool!.run({ question: 42, recommended: 'maybe' }, ctx({ chatId: 'c1' }))).rejects.toThrow('Not asked yet: brief first');
    expect(calls).toEqual([{ question: '', recommended: 'yes' }]);
    await expect(tool!.run({ question: 'Procedo?', recommended: 'yes' }, ctx({}))).rejects.toThrow(/own endpoint/);
  });
});
