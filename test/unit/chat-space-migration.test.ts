// Legacy chat persistence and Grindhouse regression: saved app workers keep identity, history and browser placement.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatStore, type StoredChat } from '../../src/main/chats/store';
import { migrateOrchestrator } from '../../src/main/chats/orchestrator';
import { workspaceTiles } from '../../src/renderer/lib/grid';
import type { ChatSummary, BrowserTab } from '../../src/shared/contract';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it('drops legacy space with or without a coordinator and preserves archived chats and sessions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-space-')); roots.push(root);
  const worker: StoredChat = { id: 'fix', harness: 'claude', title: 'Fix', cwd: 'C:/repo', space: 'app',
    sessionId: '11111111-1111-4111-8111-111111111111', model: null, effort: null, permissionMode: 'auto', isRegia: false, createdAt: 1 };
  const store = new ChatStore(root);
  fs.writeFileSync(store.file, JSON.stringify({ version: 2, chats: [worker, { ...worker, id: 'archived', closedAt: 5, closedBy: 'user' }] }));
  const loaded = store.load();
  expect(loaded[0]).toEqual(expect.objectContaining({ id: worker.id, cwd: worker.cwd, sessionId: worker.sessionId, permissionMode: 'auto' }));
  expect(loaded.every(c => !('space' in c))).toBe(true);
  expect(loaded[1]).toMatchObject({ closedAt: 5, closedBy: 'user' });
  expect(migrateOrchestrator([worker])[0]).not.toHaveProperty('space');
  const migrated = migrateOrchestrator(loaded);
  store.save(migrated);
  expect(store.load()).toEqual(migrated);
  expect(JSON.parse(fs.readFileSync(store.file, 'utf8')).chats.every((c: object) => !('space' in c))).toBe(true);
  const chats = Object.fromEntries(migrated.map(c => [c.id, c])) as unknown as Record<string, ChatSummary>;
  const browser = { id: 'browser', ownerChatId: 'fix' } as BrowserTab;
  expect(workspaceTiles(['fix', 'archived'], chats, [browser])).toEqual([{ kind: 'chat', id: 'fix' }, { kind: 'browser', id: 'browser' }]);
});
