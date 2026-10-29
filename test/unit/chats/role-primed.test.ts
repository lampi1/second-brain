// The role text once per context (ADR 0089): a chat's first message carries its role frame; later messages, and the
// first one after a restart that resumes the same session, do not; a compaction or a new session brings it back. Also
// which of its endpoint's tools a chat sees (ChatManager.chatToolShown, browserAccess), with the same manager.
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

describe('the tools a chat sees on its own endpoint', () => {
  it('the Orchestrator never sees delegation tools it cannot use; a root chat has no parent to ask; a child keeps them all', async () => {
    const dir = tmp(), sent: string[] = [], sinks: SessionSink[] = [];
    const m = manager(dir, sent, sinks);
    const orch = await m.create({ harness: 'anthropic', cwd: tmp(), orchestrator: true, prompt: 'Ciao' });
    for (const t of ['agent_delegate', 'agent_report', 'agent_ask_parent', 'agent_answer_child', 'agent_children', 'agent_child_feedback', 'agent_catalog', 'agent_learn_propose']) expect(m.chatToolShown(orch.id, t)).toBe(false);
    expect(m.chatToolShown(orch.id, 'send_to_chat')).toBe(true);
    const root = await m.create({ harness: 'anthropic', cwd: tmp(), prompt: 'Lavoro' });
    expect(m.chatToolShown(root.id, 'agent_ask_parent')).toBe(false);
    expect(m.chatToolShown(root.id, 'agent_report')).toBe(true);
    expect(m.chatToolShown(root.id, 'agent_delegate')).toBe(true);
    expect(m.chatToolShown('unknown', 'agent_ask_parent')).toBe(true);
    // the Orchestrator delegates browsing: no browser tools in its list
    expect(m.browserAccess(orch.id)).toBe('none');
    expect(m.chatToolShown(orch.id, 'brain_script_add')).toBe(false);
  });

  it('delegation follows role permissions; direct-user reports stay local and app reports require a contract', async () => {
    const dir = tmp(), sent: string[] = [], sinks: SessionSink[] = [];
    const m = manager(dir, sent, sinks);
    const scout = await m.create({ harness: 'anthropic', cwd: tmp(), roleId: 'scout', prompt: 'cerca' }, 'agent');
    for (const t of ['agent_delegate', 'agent_children', 'agent_answer_child', 'agent_child_feedback', 'agent_catalog']) expect(m.chatToolShown(scout.id, t), t).toBe(false);
    expect(m.chatToolShown(scout.id, 'agent_report')).toBe(true);
    const strategist = await m.create({ harness: 'anthropic', cwd: tmp(), roleId: 'strategist', prompt: 'piano' }, 'agent');
    expect(m.chatToolShown(strategist.id, 'agent_delegate')).toBe(true);
    const mine = await m.create({ harness: 'anthropic', cwd: tmp(), roleId: 'scout', prompt: 'mia' }, 'user');
    expect(m.chatToolShown(mine.id, 'agent_report')).toBe(true); // direct-user role reports stay local
    const app = await m.create({ harness: 'anthropic', cwd: tmp(), roleId: 'scout', title: 'Automatic work', prompt: 'Read' }, 'app');
    expect(m.chatToolShown(app.id, 'agent_report')).toBe(false); // app work needs an explicit report contract
  });
});
