// «Lampo», the quick lane (ADR 0105): one at a time, only the user's; read and web tools in plan mode (no edit, no
// command, no popup); its own short frame; never auto-closed, never in the Orchestrator's picture; «Fanne un lavoro»
// takes the last question and answer; it sees no mail or delegation tool and stays Lampo after a restart; like a "btw"
// it gets the Orchestrator's conversation with each question, only the new part (ADR 0106).
import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, LAMPO_TITLE } from '../../../src/main/chats/manager';
import type { HarnessSession, SessionOptions, SessionSink } from '../../../src/main/chats/session';
import { lastExchange } from '../../../src/renderer/lib/lampo';
import { LAMPO_CONTEXT_LABEL, orchestratorContext } from '../../../src/main/chats/lampo-context';
import type { ChatItem } from '../../../src/shared/contract';

const roots: string[] = [], managers: ChatManager[] = [];
afterEach(async () => { for (const m of managers.splice(0)) await m.shutdown(); for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-lampo-')); roots.push(d); return d; };

function manager(starts: SessionOptions[], sent: string[]): ChatManager {
  const m = new ChatManager({ userData: tmp(), emitter: { emit() {} }, coldEveryMs: 0, sessionFactory: (_h, o: SessionOptions, s: SessionSink) => {
    starts.push(o);
    return { harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { if (!o.sessionId) s.changed({ sessionId: crypto.randomUUID() }); s.changed({ state: 'idle' }); },
      send(text: string) { sent.push(text); s.item({ kind: 'result', id: `r${sent.length}`, at: Date.now(), text: '', costUsd: 0, isError: false } as never, false); },
      close: async () => { s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    } as unknown as HarnessSession;
  } });
  managers.push(m);
  return m;
}

describe('Lampo', () => {
  it('is one, the user\'s, read-only in plan mode, with its own frame', async () => {
    const starts: SessionOptions[] = [], sent: string[] = [];
    const m = manager(starts, sent);
    const l = await m.create({ harness: 'claude', cwd: tmp(), quick: true, prompt: 'che ore sono a Tokyo?' });
    expect(l).toMatchObject({ quick: true, title: LAMPO_TITLE, isOrchestrator: false });
    expect(starts[0]).toMatchObject({ permissionMode: 'plan', toolPolicy: { allow: ['read', 'web'] }, ceiling: 'plan' });
    expect(sent[0]).toMatch(/^\[Role supplied by the app: .*\]\nYou are Lampo/);
    expect(sent[0]).toMatch(/che ore sono a Tokyo\?$/);
    expect((await m.create({ harness: 'claude', cwd: tmp(), quick: true })).id).toBe(l.id);
    await expect(m.create({ harness: 'claude', cwd: tmp(), quick: true }, 'agent')).rejects.toThrow(/only the user/);
    expect(m.autoCloseCandidates(() => false).find(c => c.id === l.id)?.eligible).toBe(false);
    expect(m.releaseIdle(0, Date.now() + 3_600_000)).toBe(0);
    for (const tool of ['send_to_chat', 'list_chats', 'agent_delegate', 'agent_report', 'agent_ask_parent', 'brain_script_add']) expect(m.chatToolShown(l.id, tool)).toBe(false);
  });

  it('stays Lampo after a restart: one chat, never a second', async () => {
    const userData = tmp(), cwd = tmp();
    const make = () => { const m = new ChatManager({ userData, emitter: { emit() {} }, coldEveryMs: 0, sessionFactory: (_h, o: SessionOptions, s: SessionSink) => ({
      harness: 'claude', sessionId: null, pid: null, root: null, alive: true, busy: false,
      start() { if (!o.sessionId) s.changed({ sessionId: crypto.randomUUID() }); s.changed({ state: 'idle' }); },
      send() {}, close: async () => { s.exit({ code: 0, error: null }); }, killNow() {}, interrupt: async () => {}, answer: () => false, rename: async () => {}, setModel: async () => {}, setEffort: async () => {}, setPermissionMode: async () => {}, contextUsage: async () => null, usage: async () => null,
    }) as unknown as HarnessSession }); managers.push(m); return m; };
    const a = make();
    const l = await a.create({ harness: 'claude', cwd, quick: true });
    await a.shutdown();
    const b = make();
    expect(b.list().find(c => c.id === l.id)?.quick).toBe(true);
    expect((await b.create({ harness: 'claude', cwd, quick: true })).id).toBe(l.id);
  });

  it('«Fanne un lavoro» takes the last question and its answer', () => {
    const at = 1;
    expect(lastExchange([])).toBeNull();
    expect(lastExchange([
      { kind: 'user', id: 'u1', at, text: 'vecchia' }, { kind: 'assistant', id: 'a1', at, text: 'x', streaming: false },
      { kind: 'user', id: 'u2', at, text: 'Cosa fa manager.ts?' }, { kind: 'assistant', id: 'a2', at, text: 'Gestisce le chat.', streaming: false },
    ] as never)).toEqual({ question: 'Cosa fa manager.ts?', answer: 'Gestisce le chat.' });
  });
});

describe('Lampo is a "btw" (ADR 0106)', () => {
  it('a question carries the Orchestrator\'s conversation, then only what is new', () => {
    const items = [
      { kind: 'user', id: 'u1', at: 1, text: 'Sistema il login' },
      { kind: 'tool', id: 't1', at: 2, name: 'agent_delegate', summary: 'Artisan: login', input: {}, status: 'ok' },
      { kind: 'assistant', id: 'a1', at: 3, text: 'Ho passato il login all\'Artisan.', streaming: false },
    ] as never as ChatItem[];
    const first = orchestratorContext(items, 0);
    expect(first.text.startsWith(LAMPO_CONTEXT_LABEL)).toBe(true);
    expect(first.text).toContain('User: Sistema il login');
    expect(first.text).toContain('Orchestrator used agent_delegate: Artisan: login');
    expect(first.text).toContain('Orchestrator: Ho passato il login');
    expect(first.seenAt).toBe(3);
    expect(orchestratorContext(items, 3)).toEqual({ text: '', seenAt: 3 });
    const more = [...items, { kind: 'assistant', id: 'a2', at: 4, text: 'Sto scrivendo', streaming: true }] as never as ChatItem[];
    const live = orchestratorContext(more, 3);
    expect(live.text).toContain('Orchestrator (writing): Sto scrivendo');
    expect(live.text).not.toContain('Sistema il login');
    expect(live.seenAt).toBe(3); // seen again once it is written
  });

  it('keeps the newest lines under the cap', () => {
    const items = Array.from({ length: 40 }, (_, k) => ({ kind: 'assistant', id: `a${k}`, at: k + 1, text: `${k} ${'x'.repeat(600)}`, streaming: false })) as never as ChatItem[];
    const { text } = orchestratorContext(items, 0);
    expect(text.length).toBeLessThan(8400);
    expect(text).toContain('(older lines left out)');
    expect(text).toContain('Orchestrator: 39 ');
    expect(text).not.toContain('Orchestrator: 0 ');
  });

  it('the user\'s message to Lampo gets the block; its next one only the news; the Orchestrator never sees Lampo', async () => {
    const starts: SessionOptions[] = [], sent: string[] = [];
    const m = manager(starts, sent);
    const o = await m.create({ harness: 'claude', cwd: tmp(), orchestrator: true, prompt: 'Prepara il report di ottobre' });
    const l = await m.create({ harness: 'claude', cwd: tmp(), quick: true });
    await m.send(l.id, 'a che punto è?');
    const q1 = sent.at(-1)!;
    expect(q1).toContain(LAMPO_CONTEXT_LABEL);
    expect(q1).toContain('User: Prepara il report di ottobre');
    expect(q1).toMatch(/a che punto è\?$/);
    await m.send(l.id, 'e poi?');
    expect(sent.at(-1)).not.toContain('Prepara il report');
    await m.send(o.id, 'aggiungi novembre');
    expect(sent.at(-1)).not.toContain('Lampo');
    await m.send(l.id, 'e adesso?');
    expect(sent.at(-1)).toContain('User: aggiungi novembre');
    expect(sent.at(-1)).not.toContain('Prepara il report');
  });
});
