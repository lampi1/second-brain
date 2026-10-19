// The Orchestrator helpers (src/renderer/lib/regia-route.ts): which chat is the Orchestrator, one Grindhouse for every chat, and the
// commands of the turn that ends with a question (shown with "Esegui" on its popup). "Domande all'Orchestrator" is gone
// (the user, 2026-10-13): no routing left to test.
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../src/shared/contract';
import { commandsOfTurn, regiaIdOf } from '../../src/renderer/lib/regia-route';
import { workspaceTiles } from '../../src/renderer/lib/grid';
import type { AppState } from '../../src/renderer/store/state';

describe('the Regia from the app state', () => {
  it('finds the Regia among the chats', () => {
    const s = { order: ['a', 'r'], chats: { a: { isRegia: false }, r: { isRegia: true } } } as unknown as Pick<AppState, 'order' | 'chats'>;
    expect(regiaIdOf(s)).toBe('r');
    expect(regiaIdOf({ order: ['a'], chats: { a: {} } } as unknown as Pick<AppState, 'order' | 'chats'>)).toBe(null);
  });
});

describe('one Grindhouse for every worker', () => {
  it('lists every chat, the app code included, in grid order', () => {
    const s = { order: ['a', 'app1', 'b', 'app2'], chats: { a: {}, app1: { cwd: 'C:/repo' }, b: {}, app2: { cwd: 'C:/repo-wt/x' } } } as unknown as Pick<AppState, 'order' | 'chats'>;
    expect(workspaceTiles(s.order, s.chats, []).map(t => t.id)).toEqual(['a', 'app1', 'b', 'app2']);
  });
});

describe('commandsOfTurn', () => {
  const u = (id: string): ChatItem => ({ kind: 'user', id, at: 0, text: 'vai' });
  const a = (id: string, text: string, streaming = false): ChatItem => ({ kind: 'assistant', id, at: 0, text, ...(streaming ? { streaming } : {}) });
  it('only the shell blocks of the turn after the last user message, with their message id', () => {
    const items = [a('a0', '```bash\nvecchio\n```'), u('u1'), a('a1', 'Lancia:\n```powershell\nGet-Date\n```\n```json\n{}\n```'), a('a2', '```bash\nnpm test\n```')];
    expect(commandsOfTurn(items)).toEqual([{ itemId: 'a1', lang: 'powershell', code: 'Get-Date' }, { itemId: 'a2', lang: 'bash', code: 'npm test' }]);
  });
  it('nothing without items, without fences, or while a message streams', () => {
    expect(commandsOfTurn(undefined)).toEqual([]);
    expect(commandsOfTurn([u('u1'), a('a1', 'solo testo')])).toEqual([]);
    expect(commandsOfTurn([u('u1'), a('a1', '```bash\nnpm test\n```', true)])).toEqual([]);
  });
});
