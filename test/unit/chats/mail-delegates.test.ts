// Mail from delegated chats (src/main/chats/mail.ts delegateRefusal, send_to_chat): a delegate writes up its own tree
// only (parent, ancestors, the Orchestrator that opened the root), kind "info" by default; reports always reach owners.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { ChatSummary } from '../../../src/shared/contract';
import { delegateRefusal, inboxDir, mailTools, MAX_HOPS, MAX_SENDS_PER_MINUTE, unread } from '../../../src/main/chats/mail';
import { tmp } from './helpers';

const chat = (id: string, title: string, p: Partial<ChatSummary> = {}): ChatSummary => ({
  id, harness: 'claude', title, cwd: '.', model: null, effort: null, permissionMode: null, state: 'idle', costUsd: 0, pending: 0, isOrchestrator: false, lastText: '', updatedAt: 0, browserTabIds: [], ...p,
} as ChatSummary);
const run = (startedBy: string) => ({ run: { startedBy } } as unknown as Partial<ChatSummary>);

// Orchestrator → root (opened by it) → parent → child; a sibling of child; another tree; a user-opened root with its child
const tree = () => [
  chat('o', 'Orchestrator', { isOrchestrator: true }),
  chat('root', 'App · Radice', run('orchestrator')),
  chat('p', 'App · Padre', { parentId: 'root' }),
  chat('c', 'App · Figlio', { parentId: 'p' }),
  chat('s', 'App · Fratello', { parentId: 'p' }),
  chat('x', 'Altro · Albero', run('orchestrator')),
  chat('u', 'Utente · Radice', run('user')),
  chat('uc', 'Utente · Figlio', { parentId: 'u' }),
];

function setup(list: ChatSummary[]) {
  const root = tmp('mail-delegates');
  const dir = inboxDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const tools = mailTools({ root: () => root, chats: () => list, crossRefusal: () => null, deliver: () => {}, chainOf: () => null });
  const call = (from: string, args: Record<string, unknown>) => tools.find(t => t.name === 'send_to_chat')!.run(args, { params: { chatId: from } });
  return { dir, call };
}

describe('delegateRefusal', () => {
  const all = tree(), by = (id: string) => all.find(c => c.id === id)!;
  it('allows the parent, every ancestor and the Orchestrator that opened the root', () => {
    expect(delegateRefusal(by('c'), by('p'), all)).toBeNull();
    expect(delegateRefusal(by('c'), by('root'), all)).toBeNull();
    expect(delegateRefusal(by('c'), by('o'), all)).toBeNull();
  });
  it('refuses siblings, other trees, chats outside the app and an Orchestrator that is not the root of the tree', () => {
    expect(delegateRefusal(by('c'), by('s'), all)).toMatch(/genitore o ai suoi antenati/);
    expect(delegateRefusal(by('c'), by('x'), all)).toMatch(/genitore/);
    expect(delegateRefusal(by('c'), undefined, all)).toMatch(/genitore/);
    expect(delegateRefusal(by('uc'), by('o'), all)).toMatch(/non l’ha aperto l’Orchestrator/);
    expect(delegateRefusal(by('uc'), by('u'), all)).toBeNull();
  });
  it('a parent cycle in the data ends the walk', () => {
    const loop = [chat('a', 'A', { parentId: 'b' }), chat('b', 'B', { parentId: 'a' }), chat('o', 'O', { isOrchestrator: true })];
    expect(delegateRefusal(loop[0]!, loop[1]!, loop)).toBeNull();
    expect(delegateRefusal(loop[0]!, loop[2]!, loop)).toMatch(/Orchestrator/);
  });
});

describe('send_to_chat from a delegated chat', () => {
  it('reaches its parent and the Orchestrator as info by default, labelled as not written by the user', () => {
    const { dir, call } = setup(tree());
    expect(call('c', { to: 'App · Padre', text: 'il contratto cita un file che non esiste' })).toMatch(/^inviato a "App · Padre"/);
    expect(call('c', { to: 'Orchestrator', text: 'feat/x pronto' })).toMatch(/solo un avanzamento/);
    const [toOrchestrator] = unread(dir, 'orchestrator');
    expect(toOrchestrator?.msg).toMatchObject({ from: 'App · Figlio', kind: 'info' });
    expect(call('c', { to: 'Orchestrator', text: 'build rotta in produzione', kind: 'urgent' })).toMatch(/adesso/);
  });
  it('is refused towards a sibling or another tree', () => {
    const { call } = setup(tree());
    expect(() => call('c', { to: 'App · Fratello', text: 'x' })).toThrow(/genitore o ai suoi antenati/);
    expect(() => call('c', { to: 'Altro · Albero', text: 'x' })).toThrow(/genitore/);
  });
  it.each(['p', 'o'])('delivers more than six replies to owner %s even after reporting', target => {
    const list = tree();
    list.find(c => c.id === 'c')!.run = { endedAt: 1, report: { via: 'agent_report' } } as ChatSummary['run'];
    const { dir, call } = setup(list);
    let replyTo: string | undefined;
    for (let i = 0; i < Math.max(MAX_HOPS, MAX_SENDS_PER_MINUTE) + 2; i++) {
      expect(call('c', { to: target, text: `verified result ${i}`, ...(replyTo ? { reply_to: replyTo } : {}) })).toMatch(/^inviato/);
      replyTo = unread(dir, target === 'p' ? 'app-padre' : 'orchestrator').at(-1)!.msg.id;
    }
    expect(unread(dir, target === 'p' ? 'app-padre' : 'orchestrator').at(-1)!.msg.hop).toBeGreaterThan(MAX_HOPS);
  });
  it('keeps the per-minute limit for unrelated root-chat traffic', () => {
    const { call } = setup(tree());
    for (let i = 0; i < MAX_SENDS_PER_MINUTE; i++) call('root', { to: 'x', text: `note ${i}` });
    expect(() => call('root', { to: 'x', text: 'too many' })).toThrow(/ultimo minuto/);
  });
  it('a root chat is not limited to a tree', () => {
    const { call } = setup(tree());
    expect(call('root', { to: 'Altro · Albero', text: 'x' })).toMatch(/^inviato/);
  });
});
