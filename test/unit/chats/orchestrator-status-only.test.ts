// The Orchestrator sees every delegated chat's state changes, never its content (ADR 0083): its news says started,
// waiting, finished, failed with the role and the parent and without the chat's text; app_chats and app_digest give the
// state only; app_chat_items, app_command_runs and app_resolve_question refuse a delegated chat; app_pending and app_feed
// strip it; and a delegated chat may not mail the Orchestrator (it reports to its parent).
import { describe, expect, it } from 'vitest';
import { OrchestratorWake, wakeLine, wakeMessage } from '../../../src/main/chats/orchestrator-wake';
import { appControlTools } from '../../../src/main/appctl/tools';
import { mailTools } from '../../../src/main/chats/mail';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrainService, BrowserService, ChatService } from '../../../src/main/services';
import type { ChatSummary } from '../../../src/shared/contract';

const chat = (id: string, extra: Partial<ChatSummary> = {}): ChatSummary => ({ id, harness: 'claude', origin: 'app', title: id, cwd: '/w', sessionId: null, model: null, effort: null,
  permissionMode: null, state: 'idle', costUsd: 0.5, pending: 0, isOrchestrator: false, lastText: 'una riga', updatedAt: 1, browserTabIds: [], ...extra });
const orchestrator = chat('o', { isOrchestrator: true, title: 'Orchestrator' });
const parent = chat('p', { title: 'Piano', agent: { id: 'strategist', name: 'Strategist', purpose: '', engine: 'claude', model: null, revision: 1, source: 'catalog' } });
const child = chat('k', { title: 'Log', parentId: 'p', lastText: 'SECRET LINE', lastError: 'SECRET ERROR', agent: { id: 'scout', name: 'Scout', purpose: '', engine: 'claude', model: null, revision: 1, source: 'catalog' },
  delegation: { role: 'scout', goal: 'SECRET GOAL', doneWhen: ['x'], at: 1 } });

describe('Orchestrator news about a delegated chat', () => {
  it('says started, finished and failed with role and parent, never the text', () => {
    const sent: string[] = [];
    const w = new OrchestratorWake({ send: async (_id, text) => { sent.push(text); }, enabled: () => true, list: () => [orchestrator, parent, child], now: () => 1000, groupMs: 0, perChatMs: 0 });
    w.observe('chat:updated', orchestrator);
    w.observe('chat:updated', parent);
    w.observe('chat:updated', { ...child, state: 'starting' });
    expect(w.queued().map(e => e.kind)).toEqual(['started']);
    w.observe('chat:updated', { ...child, state: 'running' });
    w.observe('chat:updated', { ...child, state: 'idle', lastResult: { at: 5, isError: false } });
    const e = w.queued().find(x => x.chatId === 'k')!;
    expect(e.kind).toBe('done');
    const line = wakeLine(e);
    expect(line).toContain('«Log» (Scout, delegata da «Piano»)');
    expect(line).not.toContain('SECRET');
    w.observe('chat:updated', { ...child, state: 'error' });
    expect(wakeMessage(w.queued())).not.toContain('SECRET');
    w.stop();
  });
});

describe('Orchestrator tools on a delegated chat', () => {
  const pending = [{ id: 'q', chatId: 'k', type: 'question', tool: 'AskUserQuestion', title: 'SECRET Q', detail: 'SECRET', input: { a: 'SECRET' }, at: 1, questions: [{ question: 'SECRET?', options: [], multiSelect: false }] }];
  const chats = { list: () => [orchestrator, parent, child], items: () => [{ kind: 'assistant', text: 'SECRET' }], pending: () => pending, send: async () => {} } as unknown as ChatService;
  const brain = { feed: () => [{ kind: 'chat-done', title: 'SECRET', chatId: 'k' }, { kind: 'idea', title: 'ok' }], settings: () => ({ contextWarnTokens: 200000 }), info: () => ({ brainRoot: null }) } as unknown as BrainService;
  const tools = appControlTools({ chats, browser: { list: () => [] } as unknown as BrowserService, brain, window: () => null, emitUi: () => {}, version: '0' }, 'o');
  const tool = (n: string) => tools.find(t => t.name === n)!;
  it('app_chats and app_digest give its state only', async () => {
    const listed = JSON.stringify(await tool('app_chats').run({}));
    expect(listed).toContain('"delegated":true');
    expect(listed).toContain('"parentId":"p"');
    const digest = JSON.stringify(await tool('app_digest').run({}));
    expect(listed + digest).not.toMatch(/SECRET/);
  });
  it('refuses its items and strips its requests and feed', async () => {
    await expect(Promise.resolve().then(() => tool('app_chat_items').run({ chatId: 'k' }))).rejects.toThrow(/delegata/);
    expect(JSON.stringify(await tool('app_pending').run({}))).not.toMatch(/SECRET/);
    expect(JSON.stringify(await tool('app_feed').run({}))).not.toMatch(/SECRET/);
    await expect(Promise.resolve().then(() => tool('app_resolve_question').run({ chatId: 'k', requestId: 'q', answers: {} }))).rejects.toThrow(/delegata/);
  });
});

describe('mail from a delegated chat', () => {
  it('may not go to the Orchestrator: the child reports to its parent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-status-mail-'));
    try {
      const send = mailTools({ root: () => root, chats: () => [orchestrator, parent, child], crossRefusal: () => null, deliver: () => {}, chainOf: () => null }).find(t => t.name === 'send_to_chat')!;
      const ctx = { params: { chatId: 'k' } } as never;
      expect(() => send.run({ to: 'Orchestrator', text: 'SECRET' }, ctx)).toThrow(/agent_report/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
