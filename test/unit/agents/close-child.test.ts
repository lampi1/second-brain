// agent_close_child (agents/delegation.ts) and the close rules it shares with app_close_chat (chats/close-rules.ts):
// a parent closes only its own descendants, never while one of them waits for the user, never an Orchestrator.
import { describe, expect, it, vi } from 'vitest';
import { delegationTools, type DelegationChats } from '../../../src/main/agents/delegation';
import { closeRefusal, descendantIds } from '../../../src/main/chats/close-rules';
import type { ChatSummary } from '../../../src/shared/contract';
import type { AgentCatalog } from '../../../src/shared/agents';
import { DELEGATION_DEFAULTS } from '../../../src/shared/roles';

const chat = (id: string, p: Partial<ChatSummary> = {}): ChatSummary => ({ id, title: `T-${id}`, cwd: '.', harness: 'claude', state: 'idle', pending: 0, isOrchestrator: false, ...p } as ChatSummary);

// o (Orchestrator) · root → p → c → g ; p → s (sibling of c) ; x (another tree)
const tree = () => [chat('o', { isOrchestrator: true }), chat('root'), chat('p', { parentId: 'root' }), chat('c', { parentId: 'p' }), chat('g', { parentId: 'c' }), chat('s', { parentId: 'p' }), chat('x')];

function fixture(all = tree()) {
  const close = vi.fn(async (id: string) => { const c = all.find(x => x.id === id)!; c.closedAt = 1; });
  const chats = { list: () => all, close, create: vi.fn(), agentPolicy: () => null, reportDelegation: vi.fn(), limitNotice: vi.fn(), send: async () => {} } as unknown as DelegationChats;
  const tools = delegationTools({ chats, roles: () => ({ profiles: [] }) as unknown as AgentCatalog, settings: () => DELEGATION_DEFAULTS, engineRefusal: () => null, label: '[agent]', runs: () => [] });
  const call = async (caller: string, chatId: string) => JSON.parse(await tools.find(t => t.name === 'agent_close_child')!.run({ chatId }, { params: { chatId: caller } } as never) as string);
  return { all, close, call };
}

describe('close rules', () => {
  it('descendantIds walks children and grandchildren, not the chat itself', () => {
    expect([...descendantIds('p', tree())].sort()).toEqual(['c', 'g', 's']);
    expect(descendantIds('x', tree()).size).toBe(0);
  });
  it('refuses an Orchestrator, a chat waiting for the user and one with a waiting open descendant', () => {
    const all = tree(), by = (id: string) => all.find(c => c.id === id)!;
    expect(closeRefusal(by('o'), all)).toMatch(/Orchestrator/);
    expect(closeRefusal(by('c'), all)).toBeNull();
    by('g').pending = 1;
    expect(closeRefusal(by('c'), all)).toMatch(/«T-g», sotto «T-c»/);
    by('g').closedAt = 1;
    expect(closeRefusal(by('c'), all)).toBeNull();
    by('c').pending = 1;
    expect(closeRefusal(by('c'), all)).toMatch(/aspetta una risposta dell’utente/);
  });
});

describe('agent_close_child', () => {
  it('a parent closes its child and a grandchild', async () => {
    const f = fixture();
    expect(await f.call('p', 'g')).toEqual({ closed: 'T-g' });
    expect(await f.call('p', 'c')).toEqual({ closed: 'T-c' });
    expect(f.close.mock.calls.map(c => c[0])).toEqual(['g', 'c']);
    expect(await f.call('p', 'c')).toEqual({ closed: 'T-c', already: true });
    expect(f.close).toHaveBeenCalledTimes(2);
  });
  it('never its parent, a sibling, another tree or itself', async () => {
    const f = fixture();
    for (const [caller, target] of [['c', 'p'], ['c', 's'], ['p', 'x'], ['c', 'c'], ['c', 'o']] as const) await expect(f.call(caller, target)).rejects.toThrow(/YOUR children/);
    expect(f.close).not.toHaveBeenCalled();
  });
  it('refuses while the child or an open descendant waits for the user (a question or a permission)', async () => {
    const f = fixture(), by = (id: string) => f.all.find(c => c.id === id)!;
    by('g').pending = 1;
    await expect(f.call('p', 'c')).rejects.toThrow(/aspetta una risposta dell’utente/);
    await expect(f.call('p', 'g')).rejects.toThrow(/chiudila solo lui/);
    expect(f.close).not.toHaveBeenCalled();
  });
  it('a closed caller or an Orchestrator caller is refused', async () => {
    const f = fixture();
    f.all.find(c => c.id === 'p')!.closedAt = 1;
    await expect(f.call('p', 'c')).rejects.toThrow(/only an open delegating chat/);
    await expect(f.call('o', 'root')).rejects.toThrow(/only an open delegating chat/);
  });
});
