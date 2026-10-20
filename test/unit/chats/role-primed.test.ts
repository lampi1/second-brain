// The role text once per context (ADR 0088): a chat's first message carries its role frame; later messages, and the
// first one after a restart that resumes the same session, do not; a compaction or a new session brings it back.
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionSink } from '../../../src/main/chats/session';
import { AgentCatalogService } from '../../../src/main/agents/catalog';

const ROLE = '[Role supplied by the app: Orchestrator]';
const SESSION = crypto.randomUUID();
const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.shutdown();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-role-')); roots.push(d); return d; };

function manager(dir: string, sent: string[], sinks: SessionSink[]): ChatManager {
  const agents = new AgentCatalogService({ userData: dir, models: () => [{ engine: 'anthropic', label: 'API', enabled: true, trusted: true, effort: false, defaultModel: true, modelSelectable: true, modelReason: null, source: 'observed', models: [], installed: null, authenticated: null }] });
  const m = new ChatManager({ userData: dir, resolveAgent: req => agents.resolve(req), emitter: { emit() {} }, coldEveryMs: 0, sessionFactory: (_h, o: { sessionId?: string | null }, s: SessionSink) => {
    sinks.push(s);
    return { harness: 'anthropic', sessionId: null, pid: null, root: null, alive: true, busy: false,
      // a new session gets its id from the engine, like an ACP/API one; a resumed one keeps it
      start() { if (!o.sessionId) s.changed({ sessionId: SESSION }); s.changed({ state: 'idle' }); },
      send(text: string) { sent.push(text); },
      close: async () => { s.changed({ state: 'closed' }); s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } });
  managers.push(m);
  return m;
}

describe('role text once per context', () => {
  it('goes with the first message only, also across a restart that resumes the session', async () => {
    const dir = tmp(), sent: string[] = [], sinks: SessionSink[] = [];
    const m = manager(dir, sent, sinks);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true, prompt: 'Ciao' });
    expect(sent[0]!.startsWith(ROLE)).toBe(true);
    await m.send(chat.id, 'secondo');
    expect(sent.at(-1)).toBe('secondo');
    await m.shutdown(); managers.splice(managers.indexOf(m), 1);

    const sent2: string[] = [];
    const again = manager(dir, sent2, []);
    await again.send(chat.id, 'dopo il riavvio');
    expect(sent2.at(-1)).toBe('dopo il riavvio');
  });

  it('comes back after a compaction', async () => {
    const dir = tmp(), sent: string[] = [], sinks: SessionSink[] = [];
    const m = manager(dir, sent, sinks);
    const chat = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true, prompt: 'Ciao' });
    sinks.at(-1)!.changed({ compacted: { pre: 200_000, post: 20_000 } });
    await m.send(chat.id, 'dopo la compattazione');
    expect(sent.at(-1)!.startsWith(ROLE)).toBe(true);
    expect(sent.at(-1)!.endsWith('dopo la compattazione')).toBe(true);
  });
});
