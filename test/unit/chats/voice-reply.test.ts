// A reply made to be heard (ADR 0152, src/main/chats/voice-reply.ts and ChatManager.deliverNow): a message said in the
// voice conversation reaches the engine with the spoken-reply rules once per context, then a short reminder on each
// spoken turn; a typed message carries nothing, and the user's bubble never shows the line.
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { voiceReplyHint } from '../../../src/main/chats/voice-reply';

const SESSION = crypto.randomUUID();
const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-voice-')); roots.push(d); return d; };

function manager(dir: string, sent: string[]): ChatManager {
  const agents = new AgentCatalogService({ userData: dir, models: () => [{ engine: 'anthropic', label: 'API', enabled: true, trusted: true, effort: false, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: null, authenticated: null }] });
  const m = new ChatManager({ userData: dir, resolveAgent: req => agents.resolve(req), emitter: { emit() {} }, coldEveryMs: 0, sessionFactory: (_h, o: { sessionId?: string | null }, s: SessionSink) => ({
    harness: 'anthropic', sessionId: null, pid: null, root: null, alive: true, busy: false,
    start() { if (!o.sessionId) s.changed({ sessionId: SESSION }); s.changed({ state: 'idle' }); },
    send(text: string) { sent.push(text); },
    close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
  } as unknown as HarnessSession) });
  managers.push(m);
  return m;
}

describe('voiceReplyHint', () => {
  it('asks for speech: short Italian sentences, no English words, no formatting; the reminder is short', () => {
    const full = voiceReplyHint(false);
    expect(full).toMatch(/HEAR your reply/);
    expect(full).toMatch(/1 to 3 short sentences/);
    expect(full).toMatch(/No English words/);
    expect(full).toMatch(/No lists, headings, tables, code/);
    expect(voiceReplyHint(true).length).toBeLessThan(140);
  });
});

describe('spoken turns in a chat', () => {
  it('the rules on the first spoken turn, a reminder after, nothing on a typed one', async () => {
    const dir = tmp(), sent: string[] = [];
    const m = manager(dir, sent);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true, prompt: 'Ciao' });
    m.spokenNext(chat.id);
    await m.send(chat.id, 'come va');
    expect(sent.at(-1)).toBe(`come va${voiceReplyHint(false)}`);
    m.spokenNext(chat.id);
    await m.send(chat.id, 'e adesso');
    expect(sent.at(-1)).toBe(`e adesso${voiceReplyHint(true)}`);
    await m.send(chat.id, 'scritto');
    expect(sent.at(-1)).toBe('scritto');
    const items = m.items(chat.id);
    expect(items.filter(i => i.kind === 'user').map(i => (i as { text: string }).text)).not.toContainEqual(expect.stringContaining('Spoken turn'));
  });
});
