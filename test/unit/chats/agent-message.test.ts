// The app's envelope for what the user did not type (ADR 0261, chats/agent-message.ts and ChatManager.deliverNow): a
// Claude engine gets an agent's mail, the app's notices and its resume wholly inside <agent-message from="second-brain">,
// so AI-DLC's record-human-turn hook classifies them as the host's; the user's typed text (PC or phone) and every other
// engine's messages go as they are, and the history shows the message without the envelope.
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { agentMessage, forEngine, withoutAgentMessage } from '../../../src/main/chats/agent-message';
import { userText } from '../../../src/main/chats/transcript';
import { AGENT_LABEL } from '../../../src/shared/agent-label';

// AI-DLC's own template (.claude/tools/aidlc-lib.ts, CLAUDE_HOST_TEMPLATES "claude agent message"), on the trimmed prompt
const AIDLC_HOST = /^<agent-message from="[^"\r\n]*">\r?\n[\s\S]*\r?\n<\/agent-message>$/;
const host = (sent: string | undefined): boolean => AIDLC_HOST.test((sent ?? '').trim());

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-envelope-')); roots.push(d); return d; };

function manager(sent: string[]): ChatManager {
  const m = new ChatManager({ userData: tmp(), emitter: { emit() {} }, coldEveryMs: 0,
    sessionFactory: (h, o: { sessionId?: string | null }, s: SessionSink) => ({
      harness: h, sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { if (!o.sessionId) s.changed({ sessionId: crypto.randomUUID() }); s.changed({ state: 'idle' }); },
      send(text: string) { sent.push(text); },
      close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {},
      answer: () => true, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    }) as unknown as HarnessSession });
  managers.push(m);
  return m;
}

describe('the envelope at the send boundary', () => {
  it('leaves the user\'s typed text untouched in a Claude chat, on the PC and from the phone', async () => {
    const sent: string[] = [], m = manager(sent);
    const chat = await m.create({ harness: 'claude', cwd: tmp(), prompt: 'Procedi con la Unit 3' });
    expect(sent[0]).toContain('Procedi con la Unit 3');
    expect(sent[0]).not.toContain('<agent-message');
    await m.send(chat.id, 'Sì, approvo il piano');
    expect(sent.at(-1)).toBe('Sì, approvo il piano');
    await m.sendFromPhone(chat.id, 'ok dal telefono');
    expect(sent.at(-1)).not.toContain('<agent-message');
    expect(host(sent.at(-1))).toBe(false);
  });

  it('wraps an agent\'s message, the app\'s notice and its resume wholly, as AI-DLC reads a host turn', async () => {
    const sent: string[] = [], m = manager(sent);
    const chat = await m.create({ harness: 'claude', cwd: tmp() });
    await m.send(chat.id, `${AGENT_LABEL}\n\nContinua da dove eri`, undefined, false, 'Orchestrator', false, { kind: 'chat', chatId: 'c-other' });
    expect(host(sent.at(-1))).toBe(true);
    expect(sent.at(-1)).toContain('Continua da dove eri');
    expect(sent.at(-1)!.startsWith('<agent-message from="second-brain">\n')).toBe(true);
    await m.send(chat.id, '[evento app] Decisione registrata', undefined, false, 'App', false, { kind: 'app' });
    expect(host(sent.at(-1))).toBe(true);
    await m.send(chat.id, 'Piano approvato dall\'app', undefined, false, undefined, false, { kind: 'app' });
    expect(host(sent.at(-1))).toBe(true);
    await m.send(chat.id, 'Riprendi da dove eri', undefined, true, undefined, false, { kind: 'app' });
    expect(host(sent.at(-1))).toBe(true);
    // the user's own message after them still goes as typed
    await m.send(chat.id, 'grazie');
    expect(sent.at(-1)).toBe('grazie');
  });

  it('wraps a delegated chat\'s contract (from its parent) but never a chat the user started', async () => {
    const sent: string[] = [], m = manager(sent);
    await m.create({ harness: 'claude', cwd: tmp(), prompt: 'Contratto della chat' }, 'app');
    expect(host(sent.at(-1))).toBe(true);
    await m.create({ harness: 'claude', cwd: tmp(), prompt: 'Contratto di un agente' }, 'agent');
    expect(host(sent.at(-1))).toBe(true);
    await m.create({ harness: 'claude', cwd: tmp(), prompt: 'La mia richiesta' }, 'user');
    expect(sent.at(-1)).not.toContain('<agent-message');
  });

  it('never wraps for an engine that is not Claude', async () => {
    const sent: string[] = [], m = manager(sent);
    const chat = await m.create({ harness: 'codex', cwd: tmp() });
    await m.send(chat.id, `${AGENT_LABEL}\n\nContinua`, undefined, false, 'Orchestrator', false, { kind: 'app' });
    expect(sent.at(-1)).not.toContain('<agent-message');
  });
});

describe('agent-message helpers', () => {
  it('wraps the whole text, trimmed, and only for Claude and a relayed message', () => {
    expect(agentMessage('  riga 1\nriga 2\n')).toBe('<agent-message from="second-brain">\nriga 1\nriga 2\n</agent-message>');
    expect(host(agentMessage('[Role supplied by the app: Artisan]\n…\n[End role]\n\ntesto'))).toBe(true);
    expect(forEngine('x', { claude: true, relayed: false })).toBe('x');
    expect(forEngine('x', { claude: false, relayed: true })).toBe('x');
    expect(host(forEngine('x', { claude: true, relayed: true }))).toBe(true);
  });

  it('shows the message without the envelope in the history, any other text as it is', () => {
    expect(withoutAgentMessage(agentMessage('ciao\nmondo'))).toBe('ciao\nmondo');
    expect(userText(agentMessage('Continua da dove eri'))?.text).toBe('Continua da dove eri');
    expect(withoutAgentMessage('<agent-message from="altro">\nx\n</agent-message>')).toBe('<agent-message from="altro">\nx\n</agent-message>');
    expect(withoutAgentMessage('testo normale')).toBe('testo normale');
  });
});
