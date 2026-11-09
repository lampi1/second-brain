// ChatManager (the app's ChatService) against the fake CLI: events, questions, persistence and restore,
// resume on send with history, forks of external sessions, settings, close, crash recovery.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ChatManager, type ChatManagerOptions } from '../../../src/main/chats/manager';
import { FAKE, recEmitter, tmp, type RecEmitter } from './helpers';

interface Env { userData: string; home: string; cwd: string; argLog: string }
const managers: ChatManager[] = [];
function env(): Env {
  const e = { userData: tmp('ud'), home: tmp('home'), cwd: tmp('cwd'), argLog: '' };
  e.argLog = path.join(e.userData, 'argv.jsonl');
  return e;
}
function manager(e: Env, extra: Partial<ChatManagerOptions> = {}): { m: ChatManager; em: RecEmitter } {
  const em = recEmitter();
  const m = new ChatManager({ emitter: em, userData: e.userData, enginePaths: { claude: FAKE }, claudeHome: e.home, env: { CLAUDE_CONFIG_DIR: e.home, FAKE_CLAUDE_LOG: e.argLog }, ...extra });
  managers.push(m);
  return { m, em };
}

afterEach(async () => { await Promise.all(managers.splice(0).map(m => m.shutdown())); });

describe('ChatManager', () => {
  it('rejects bad folders and bad options', async () => {
    const e = env();
    const { m } = manager(e);
    await expect(m.create({ harness: 'claude', cwd: 'relative/dir' })).rejects.toThrow(/Cartella non valida/);
    await expect(m.create({ harness: 'claude', cwd: path.join(e.cwd, 'missing') })).rejects.toThrow(/Cartella non valida/);
    await expect(m.create({ harness: 'claude', cwd: e.cwd, permissionMode: 'yolo' as never })).rejects.toThrow(/permessi/);
    await expect(m.create({ harness: 'claude', cwd: e.cwd, resumeSessionId: '../x', fork: true })).rejects.toThrow(/duplicare/);
    await expect(m.create({ harness: 'claude', cwd: e.cwd, model: 'x" & calc' })).rejects.toThrow(/Modello non valido/);
    // a model an ACP CLI would read as one of its flags (qwen -m --yolo)
    await expect(m.create({ harness: 'cursor', cwd: e.cwd, model: '--yolo' })).rejects.toThrow(/Modello non valido/);
    await expect(m.create({ harness: 'anthropic', cwd: e.cwd, effort: 'high' })).rejects.toThrow(/effort/i);
    await expect(m.send('nope', 'x')).rejects.toThrow(/non trovata/);
    expect(m.items('nope')).toEqual([]);
  });

  it('survives a corrupt chats.json and reports a missing CLI on send', async () => {
    const e = env();
    fs.writeFileSync(path.join(e.userData, 'chats.json'), '{not json');
    const { m } = manager(e, { enginePaths: { claude: path.join(e.userData, 'no-claude.exe') } });
    expect(m.list()).toEqual([]);
    expect(fs.readdirSync(e.userData).some(f => f.startsWith('chats.json.bad-'))).toBe(true);
    const c = await m.create({ harness: 'claude', cwd: e.cwd });
    expect(m.list().find(x => x.id === c.id)).toMatchObject({ state: 'error', lastError: expect.stringMatching(/Motore Claude non trovato/) });
    await expect(m.send(c.id, 'x')).rejects.toThrow(/Motore Claude non trovato/);
    const withPrompt = await m.create({ harness: 'claude', cwd: e.cwd, prompt: 'hi' }); // resolves: the chat exists, in error
    expect(withPrompt).toMatchObject({ state: 'error', lastError: expect.stringMatching(/Motore Claude non trovato/) });
    expect(m.cliStatus()).toMatchObject({ found: false, path: path.join(e.userData, 'no-claude.exe'), version: null });
  });

  // finding 5: only full UUIDs reach --resume
  it('resumes only full session UUIDs', async () => {
    const e = env();
    const { m } = manager(e);
    await expect(m.create({ harness: 'claude', cwd: e.cwd, resumeSessionId: 'a976a8bc', fork: true })).rejects.toThrow(/duplicare/);
    await expect(m.create({ harness: 'claude', cwd: e.cwd, resumeSessionId: '--dangerously-skip-permissions', fork: true })).rejects.toThrow(/duplicare/);
    // a tampered chats.json id is dropped, never passed to the CLI
    fs.writeFileSync(path.join(e.userData, 'chats.json'), JSON.stringify({ chats: [{ id: 'c_x', harness: 'claude', cwd: e.cwd, sessionId: '--evil', forkFrom: '../x', title: 'T' }] }));
    const r = manager(e);
    expect(r.m.list()[0]).toMatchObject({ sessionId: null });
  });
});

