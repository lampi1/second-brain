// The Orchestrator wrote to a chat that waits on the user (src/main/appctl/tools.ts waitsOnUser, ADR 0329): a chat
// reads no message while its own question is open and a plan's row stays until the plan is decided, so the tool's
// result says how to close the row (on the owner's PC, 2026-11-19, his answer went as a plain message and the row stayed).
import { describe, expect, it } from 'vitest';
import { appControlTools, waitsOnUser } from '../../src/main/appctl/tools';
import type { BrainService, BrowserService, ChatService } from '../../src/main/services';
import type { PendingRequest } from '../../src/shared/contract';

const question = (chatId: string, id: string, tool = 'AskUserQuestion') => ({ id, chatId, type: 'question', tool, title: 'Valuto anche Q web sopra Air?', detail: '', at: 1,
  questions: [{ question: 'Valuto anche Q web sopra Air?', multiSelect: false, options: [{ label: 'Sì' }, { label: 'No' }] }] }) as unknown as PendingRequest;
const chat = (id: string, more: Record<string, unknown> = {}) => ({ id, title: 'Ricerca stack', harness: 'claude', state: 'waiting', ...more });

describe('waitsOnUser', () => {
  it('a chat with its own question open: the message waits behind it, the answer goes with app_resolve_question', () => {
    const line = waitsOnUser(chat('w'), [question('other', 'x'), question('w', 'q9')]);
    expect(line).toMatch(/requestId q9/);
    expect(line).toMatch(/app_resolve_question/);
    expect(line).toMatch(/chatId w/);
  });
  it('a Strategist whose plan waits for his ok: what he wants changed goes as the plan\'s change', () => {
    const line = waitsOnUser(chat('s', { plan: { phase: 'proposed', at: 5 } }), []);
    expect(line).toMatch(/requestId plan/);
    expect(line).toMatch(/decision change/);
  });
  it('nothing of his is open: no note (a permission, a command or an MCP form are not answered in words)', () => {
    expect(waitsOnUser(chat('w'), [])).toBeNull();
    expect(waitsOnUser(chat('w'), [{ id: 'p', chatId: 'w', type: 'permission', tool: 'Bash', title: 'git push', detail: '', at: 1 } as unknown as PendingRequest])).toBeNull();
    expect(waitsOnUser(chat('w'), [question('w', 'f', 'mcp__jira')])).toBeNull();
    expect(waitsOnUser(chat('s', { plan: { phase: 'running', at: 5 } }), [])).toBeNull();
    expect(waitsOnUser(chat('s', { plan: { phase: 'proposed', at: 5 }, closedAt: 9 }), [])).toBeNull();
  });
});

describe('app_send_to_chat tells the Orchestrator when the chat waits on the user', () => {
  const run = async (caller: string | undefined, target: Record<string, unknown>, pending: PendingRequest[]) => {
    const list = [{ id: 'o', title: 'Orchestrator', harness: 'claude', state: 'running', isOrchestrator: true }, target];
    const chats = { list: () => list, pending: () => pending, send: async () => {} } as unknown as ChatService;
    const t = appControlTools({ chats, browser: {} as BrowserService, brain: {} as BrainService, window: () => null, emitUi: () => {}, version: '0' }, caller).find(x => x.name === 'app_send_to_chat')!;
    return String(await t.run({ chatId: String(target.id), text: 'le sue parole: solo da zero' }));
  };
  it('sent, with how to close the row', async () => {
    const out = await run('o', chat('w'), [question('w', 'q9')]);
    expect(out.startsWith('sent. But «Ricerca stack» waits on its open question (requestId q9)')).toBe(true);
  });
  it('plain «sent» when the chat waits on nothing, for another caller, and for a delegated chat (its parent answers it)', async () => {
    expect(await run('o', chat('w'), [])).toBe('sent');
    expect(await run(undefined, chat('w'), [question('w', 'q9')])).toBe('sent');
    expect(await run('o', chat('w', { parentId: 'p' }), [question('w', 'q9')])).toBe('sent');
  });
});
