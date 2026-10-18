// Restart regressions for main-generated skill context; ordinary profile limits remain unchanged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { ChatStore, type StoredChat } from '../../src/main/chats/store';

it('retains augmented Cursor context across restart without widening plain profile limits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pack-chat-'));
  try {
    const store = new ChatStore(root), pluginDir = path.join(root, 'agent-pack-runtime', 'a'.repeat(64));
    const agentAssets = { pluginDir, skillRoot: path.join(pluginDir, 'skills') };
    const base: StoredChat = { id: 'c_pack', harness: 'cursor', cwd: root, sessionId: null, title: 'Review', model: null, effort: null, permissionMode: null, isRegia: false, createdAt: 1 };
    const instructions = 'x'.repeat(8000) + '\n\n# Learned rules\nCite evidence.';
    store.save([{ ...base, agentInstructions: instructions, agentAssets }, { ...base, id: 'c_plain', agentInstructions: instructions }]);
    const restored = new ChatStore(root).load();
    expect(restored[0]?.agentInstructions).toBe(instructions);
    expect(restored[0]?.agentAssets).toEqual(agentAssets);
    expect(restored[1]).not.toHaveProperty('agentInstructions');
    store.save([{ ...base, agentInstructions: 'x'.repeat(5 * 1024 * 1024), agentAssets }]);
    expect(store.load()[0]).not.toHaveProperty('agentInstructions');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
