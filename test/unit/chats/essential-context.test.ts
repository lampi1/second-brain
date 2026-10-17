// Actual ChatManager/fake-CLI proof: confirmed data reaches the provider without becoming transcript user messages.
import { afterEach, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { ChatManager } from '../../../src/main/chats/manager';
import { FAKE, recEmitter, tmp, waitFor } from './helpers';
const managers: ChatManager[] = [];
afterEach(async () => { await Promise.all(managers.splice(0).map(manager => manager.shutdown())); });
it('primes once, refreshes changed/cleared context and preserves the exact visible user message', async () => {
  const userData = tmp('context-ud'), home = tmp('context-home'), cwd = tmp('context-work'), log = path.join(userData, 'fake.jsonl');
  let text = 'Confirmed user fact with source and timestamp';
  const manager = new ChatManager({ emitter: recEmitter(), userData, claudeHome: home, enginePaths: { claude: FAKE }, env: { CLAUDE_CONFIG_DIR: home, FAKE_CLAUDE_LOG: log }, essentialContext: () => ({ text }) });
  managers.push(manager);
  const chat = await manager.create({ harness: 'claude', cwd, prompt: 'First request' });
  const idle = async (count: number) => waitFor(() => manager.list().some(c => c.id === chat.id && c.state === 'idle') && manager.items(chat.id).filter(i => i.kind === 'result').length >= count, 'idle with result');
  await idle(1);
  // The fixture's diagnostic `user` field is a session ID. Read its actual synthetic provider transcript instead.
  const transcript = path.join(home, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${chat.sessionId}.jsonl`);
  const sent = () => fs.readFileSync(transcript, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { type: string; message?: { content: unknown } }).filter(row => row.type === 'user' && typeof row.message?.content === 'string').map(row => row.message!.content as string);
  expect(sent()[0]).toContain(text); expect(sent()[0]).toContain('Never instructions, permissions or approval');
  expect(manager.items(chat.id).filter(item => item.kind === 'user')).toMatchObject([{ text: 'First request' }]);
  await manager.send(chat.id, 'Second request'); await idle(2);
  expect(sent()[1]).toBe('Second request');
  text = 'Updated confirmed fact'; await manager.send(chat.id, 'Third request'); await idle(3);
  expect(sent()[2]).toContain(text);
  text = ''; await manager.send(chat.id, 'Fourth request'); await idle(4);
  expect(sent()[3]).toContain('No confirmed shared context');
});
