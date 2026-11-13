// The AI's reply language (ADR 0120, src/main/chats/reply-lang.ts and ChatManager.deliverNow): a new chat's first
// message names the language with its role text; later turns carry nothing; after the user changes the language, only
// the next turn of an open chat carries one short line, and a restart that resumes the session remembers what it was told.
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Lang } from '../../../src/shared/contract';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { AgentCatalogService } from '../../../src/main/agents/catalog';
import { replyLangHint, replyLangTurn } from '../../../src/main/chats/reply-lang';

const SESSION = crypto.randomUUID();
const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lang-')); roots.push(d); return d; };

function manager(dir: string, sent: string[], want: { lang: Lang }): ChatManager {
  const agents = new AgentCatalogService({ userData: dir, models: () => [{ engine: 'anthropic', label: 'API', enabled: true, trusted: true, effort: false, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: null, authenticated: null }] });
  const m = new ChatManager({ userData: dir, resolveAgent: req => agents.resolve(req), emitter: { emit() {} }, coldEveryMs: 0, replyLang: () => want.lang, sessionFactory: (_h, o: { sessionId?: string | null }, s: SessionSink) => ({
    harness: 'anthropic', sessionId: null, pid: null, root: null, alive: true, busy: false,
    start() { if (!o.sessionId) s.changed({ sessionId: SESSION }); s.changed({ state: 'idle' }); },
    send(text: string) { sent.push(text); },
    close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
  } as unknown as HarnessSession) });
  managers.push(m);
  return m;
}

describe('replyLangTurn', () => {
  it('names the language with the role text or in a context never told, again only when it changed', () => {
    expect(replyLangTurn(undefined, 'it', true)).toBe('');
    expect(replyLangTurn('de', 'de', true)).toBe(replyLangHint('de', true));
    expect(replyLangTurn('it', undefined, false)).toBe(replyLangHint('it', true));
    expect(replyLangTurn('en', 'en', false)).toBe('');
    expect(replyLangTurn('de', 'it', false)).toBe(replyLangHint('de', false));
  });
  it('is one short English line with the name the agents read (German as written in Austria)', () => {
    expect(replyLangHint('de', false)).toBe('\n\n[The user\'s language is now German (as written in Austria): reply in it from this message on.]');
    expect(replyLangHint('it', true)).toBe('\n\n[The user\'s language: Italian. Reply to the user in it.]');
    expect(replyLangHint('de', false).length).toBeLessThan(100);
  });
});

describe('the reply language in chats', () => {
  it('a new chat is told once; an open chat gets one line on the first turn after a change, then nothing', async () => {
    const dir = tmp(), sent: string[] = [], want = { lang: 'it' as Lang };
    const m = manager(dir, sent, want);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true, prompt: 'Ciao' });
    expect(sent[0]!.endsWith(replyLangHint('it', true))).toBe(true);
    await m.send(chat.id, 'secondo');
    expect(sent.at(-1)).toBe('secondo');
    want.lang = 'de';
    await m.send(chat.id, 'terzo');
    expect(sent.at(-1)).toBe(`terzo${replyLangHint('de', false)}`);
    await m.send(chat.id, 'quarto');
    expect(sent.at(-1)).toBe('quarto');
  });

  it('a role chat follows the change too, and a restart remembers what the chat was told', async () => {
    const dir = tmp(), sent: string[] = [], want = { lang: 'en' as Lang };
    const m = manager(dir, sent, want);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), roleId: 'scout', prompt: 'cerca' }, 'user');
    expect(sent[0]!).toContain(replyLangHint('en', true));
    await m.shutdown(); managers.splice(managers.indexOf(m), 1);

    const sent2: string[] = [];
    const again = manager(dir, sent2, want);
    await again.send(chat.id, 'dopo il riavvio');
    expect(sent2.at(-1)).toBe('dopo il riavvio');
    want.lang = 'de';
    await again.send(chat.id, 'auf Deutsch');
    expect(sent2.at(-1)).toBe(`auf Deutsch${replyLangHint('de', false)}`);
  });
});
